-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ O webhook passa a guardar o que recebe                                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- A `20261012e` preencheu o passado. Esta fecha a torneira — sem ela, venda
-- nova entra amanhã e o telefone, o Pix e o IP se perdem de novo. Carga
-- inicial sem gatilho é a quarta armadilha, e foi exatamente o que aconteceu
-- com o CPF: 2.388 vieram de uma importação antiga e nada manteve.
--
-- ── A causa raiz do telefone é UMA PALAVRA ──────────────────────────────
--
-- `fn_processar_venda_payt` chamava:
--
--     fn_resolver_cliente(p_vp.cliente_email, p_vp.cliente_nome, NULL, v_data)
--                                                                ^^^^
--
-- `fn_resolver_cliente` ACEITA `p_telefone` e o grava no INSERT. Quem chama é
-- que passava nulo. O telefone chega em 96,5% das vendas e morria nesse
-- argumento — e com ele morria a régua de pós-venda inteira, que é metade do
-- plano de crescimento.
--
-- ── E um segundo defeito logo atrás ─────────────────────────────────────
--
-- `fn_resolver_cliente` só preenche nome e telefone **quando cria** o cliente.
-- Cliente que já existe nunca ganha o telefone numa compra posterior. Então
-- passar o número não bastaria: o caso mais comum é justamente a aluna que já
-- está na base.
--
-- Por isso o conserto tem duas partes, e a segunda é um UPDATE que completa o
-- que falta — nunca sobrescrevendo o que já existe, porque dado digitado à mão
-- vale mais que dado de webhook.
--
-- ── A armadilha que esta função já documenta, aplicada aos campos novos ──
--
-- `fn_normalizar_venda_payt` já aprendeu, com dor, que "mudança de status não
-- pode apagar o valor: o estorno chega zerado e sobrescrevia a venda boa".
--
-- Vale igual para os campos novos, e de forma ainda mais direta: o evento
-- `paid` chega SEM `pix_url` — o Pix já foi usado. Sem proteção, a aprovação
-- apagaria o link que o `waiting_payment` havia guardado, e o campo ficaria
-- vazio exatamente nas vendas que converteram. Por isso todo campo novo entra
-- com `COALESCE(EXCLUDED.x, vendas.x)` no conflito.
--
-- `cart_recovered` é `OR`, não `COALESCE`: uma vez recuperado, sempre
-- recuperado, e nenhum evento posterior desmarca.
--
-- ── O que esta migração NÃO faz ─────────────────────────────────────────
--
-- Não mexe na função Deno do webhook. Ela já grava `payload_raw` com o corpo
-- inteiro em `vendas_payt` — tudo que falta está lá dentro, e quem não lia era
-- o SQL. Um deploy a menos, e um lugar a menos para divergir.

begin;

-- ── 1. A venda: IP, Pix, fbclid, erro e carrinho recuperado ──────────────
create or replace function public.fn_normalizar_venda_payt(p_vp vendas_payt)
 returns uuid
 language plpgsql
as $function$
DECLARE
  v_venda_id      uuid;
  v_status        status_venda;
  v_produto       produto_tipo;
  v_code          text;
  v_data_venda    timestamptz;
  v_meio          meio_pagamento;
  v_total         numeric;
  v_obs           numeric := 0;
  v_assinatura_id uuid;
  v_sub           jsonb;
  v_paid_at       text;
  v_ciclo         integer;
  v_sub_status    status_assinatura;
  v_pay_status    text;
BEGIN
  v_pay_status := NULLIF(p_vp.payload_raw->'transaction'->>'payment_status', '');

  v_status := CASE COALESCE(v_pay_status, p_vp.status)
    WHEN 'paid'              THEN 'aprovada'
    WHEN 'expired'           THEN 'expirada'
    WHEN 'refused'           THEN 'cancelada'
    WHEN 'canceled'          THEN 'cancelada'
    WHEN 'refunded'          THEN 'reembolsada'
    WHEN 'refunded_partial'  THEN 'reembolsada'
    WHEN 'chargeback'        THEN 'chargeback'
    WHEN 'peding_refund'     THEN 'pendente'   -- grafia da própria Payt
    WHEN 'refund_requested'  THEN 'pendente'
    ELSE 'pendente'
  END::status_venda;

  v_code := p_vp.payload_raw->'product'->>'code';
  IF v_code IS NOT NULL THEN
    SELECT o.produto INTO v_produto FROM ofertas o
     WHERE o.code_payt = v_code AND o.produto IS NOT NULL LIMIT 1;
  END IF;
  IF v_produto IS NULL AND p_vp.produto IS NOT NULL THEN
    SELECT o.produto INTO v_produto FROM ofertas o
     WHERE lower(o.nome) = lower(p_vp.produto) AND o.produto IS NOT NULL LIMIT 1;
  END IF;

  v_paid_at := p_vp.payload_raw->'transaction'->>'paid_at';
  v_data_venda := CASE
    WHEN NULLIF(v_paid_at, '') IS NOT NULL THEN (v_paid_at::timestamp AT TIME ZONE 'America/Sao_Paulo')
    WHEN NULLIF(p_vp.payload_raw->>'started_at', '') IS NOT NULL
      THEN ((p_vp.payload_raw->>'started_at')::timestamp AT TIME ZONE 'America/Sao_Paulo')
    WHEN p_vp.data IS NOT NULL              THEN (p_vp.data::timestamp AT TIME ZONE 'America/Sao_Paulo')
    ELSE p_vp.criado_em
  END;

  v_meio := CASE p_vp.payload_raw->'transaction'->>'payment_method'
    WHEN 'pix'              THEN 'pix'
    WHEN 'credit_card'      THEN 'cartao_credito'
    WHEN 'debit_card'       THEN 'cartao_debito'
    WHEN 'boleto'           THEN 'boleto'
    WHEN 'two_credit_cards' THEN 'dois_cartoes'
    ELSE NULL
  END::meio_pagamento;

  v_total := COALESCE(
    NULLIF(NULLIF(p_vp.payload_raw->'transaction'->>'total_price', '')::numeric, 0) / 100,
    NULLIF(NULLIF(p_vp.payload_raw->'transaction'->>'price_without_installments', '')::numeric, 0) / 100,
    NULLIF(NULLIF(p_vp.payload_raw->'product'->>'price', '')::numeric, 0) / 100,
    NULLIF(p_vp.valor, 0),
    0);

  SELECT COALESCE(SUM(NULLIF(b->'product'->>'price', '')::numeric) / 100, 0)
    INTO v_obs
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(p_vp.payload_raw->'order_bumps') = 'array'
                THEN p_vp.payload_raw->'order_bumps' ELSE '[]'::jsonb END) b;

  v_sub := p_vp.payload_raw->'subscription';
  IF v_sub IS NOT NULL AND NULLIF(v_sub->>'code', '') IS NOT NULL THEN
    v_ciclo := CASE v_sub->>'periodicity'
      WHEN '1 month'  THEN 30  WHEN '2 months' THEN 60  WHEN '3 months' THEN 90
      WHEN '6 months' THEN 180 WHEN '1 year'   THEN 365 ELSE NULL END;

    v_sub_status := CASE v_sub->>'status'
      WHEN 'active'   THEN 'ativa'    WHEN 'canceled' THEN 'cancelada'
      WHEN 'expired'  THEN 'expirada' WHEN 'paused'   THEN 'pausada'
      ELSE 'ativa' END::status_assinatura;

    INSERT INTO assinaturas (
      subscription_id_payt, produto, plano_nome, plano_preco, ciclo_dias, status,
      data_inicio, data_proximo_ciclo, utm_source, utm_medium, utm_campaign, utm_content
    ) VALUES (
      v_sub->>'code', v_produto, v_sub->>'plan_name', v_total, v_ciclo, v_sub_status,
      (NULLIF(v_sub->>'started_at', '')::timestamp AT TIME ZONE 'America/Sao_Paulo'),
      (NULLIF(v_sub->>'next_charge_at', '')::timestamp AT TIME ZONE 'America/Sao_Paulo'),
      p_vp.utm_source, p_vp.utm_medium, p_vp.utm_campaign, p_vp.utm_content
    )
    ON CONFLICT (subscription_id_payt) DO UPDATE SET
      plano_nome = EXCLUDED.plano_nome, plano_preco = EXCLUDED.plano_preco,
      ciclo_dias = EXCLUDED.ciclo_dias, status = EXCLUDED.status,
      data_proximo_ciclo = EXCLUDED.data_proximo_ciclo, atualizado_em = now()
    RETURNING id INTO v_assinatura_id;
  END IF;

  INSERT INTO vendas (
    pedido_id, pedido_id_payt, assinatura_id, produto, data_venda, status,
    meio_pagamento, valor_oferta_principal, valor_obs, valor_total,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    ad_id_meta, payload_webhook, funil_id, cart_id, empresa_id,
    -- Campos que a Payt sempre mandou e ninguem lia. Ver `20261012e`.
    ip_comprador, pix_url, pix_code, pix_expira_em, erro_pagamento, fbclid,
    cart_recovered
  ) VALUES (
    p_vp.payt_id, p_vp.payt_id, v_assinatura_id, v_produto, v_data_venda, v_status,
    v_meio, GREATEST(v_total - v_obs, 0), v_obs, v_total,
    p_vp.utm_source, p_vp.utm_medium, p_vp.utm_campaign, p_vp.utm_content, p_vp.utm_term,
    p_vp.utm_ad_id, p_vp.payload_raw, NULL,
    NULLIF(p_vp.payload_raw->>'cart_id', ''), p_vp.empresa_id,
    NULLIF(p_vp.payload_raw->'customer'->>'ip', ''),
    NULLIF(p_vp.payload_raw->'transaction'->>'pix_url', ''),
    NULLIF(p_vp.payload_raw->'transaction'->>'pix_code', ''),
    (NULLIF(p_vp.payload_raw->'transaction'->>'expires_at', '')::timestamptz),
    NULLIF(p_vp.payload_raw->'transaction'->>'error_message', ''),
    -- `link.query_params` e o saco de passagem livre da URL; e dele que vem o
    -- fbclid. O codigo lia so `link.sources`, que tem as UTMs e mais nada.
    NULLIF(p_vp.payload_raw->'link'->'query_params'->>'fbclid', ''),
    COALESCE((p_vp.payload_raw->>'cart_recovered')::boolean, false)
  )
  ON CONFLICT (pedido_id) DO UPDATE SET
    assinatura_id = EXCLUDED.assinatura_id,
    produto = COALESCE(EXCLUDED.produto, vendas.produto),
    data_venda = EXCLUDED.data_venda, status = EXCLUDED.status,
    meio_pagamento = EXCLUDED.meio_pagamento,
    valor_oferta_principal = CASE WHEN EXCLUDED.valor_total > 0
                                  THEN EXCLUDED.valor_oferta_principal
                                  ELSE vendas.valor_oferta_principal END,
    valor_obs = CASE WHEN EXCLUDED.valor_total > 0 THEN EXCLUDED.valor_obs ELSE vendas.valor_obs END,
    valor_total = CASE WHEN EXCLUDED.valor_total > 0 THEN EXCLUDED.valor_total ELSE vendas.valor_total END,
    utm_source = EXCLUDED.utm_source, utm_medium = EXCLUDED.utm_medium,
    utm_campaign = EXCLUDED.utm_campaign, utm_content = EXCLUDED.utm_content,
    utm_term = EXCLUDED.utm_term, ad_id_meta = EXCLUDED.ad_id_meta,
    payload_webhook = EXCLUDED.payload_webhook,
    -- COALESCE e nao atribuicao direta, pela MESMA razao do valor logo acima:
    -- o evento `paid` chega sem `pix_url` (o Pix ja foi usado), e sobrescrever
    -- apagaria o link justamente nas vendas que converteram.
    ip_comprador   = COALESCE(EXCLUDED.ip_comprador,   vendas.ip_comprador),
    pix_url        = COALESCE(EXCLUDED.pix_url,        vendas.pix_url),
    pix_code       = COALESCE(EXCLUDED.pix_code,       vendas.pix_code),
    pix_expira_em  = COALESCE(EXCLUDED.pix_expira_em,  vendas.pix_expira_em),
    erro_pagamento = COALESCE(EXCLUDED.erro_pagamento, vendas.erro_pagamento),
    fbclid         = COALESCE(EXCLUDED.fbclid,         vendas.fbclid),
    -- Uma vez recuperado, sempre recuperado: OR, nao COALESCE.
    cart_recovered = vendas.cart_recovered OR EXCLUDED.cart_recovered,
    atualizado_em = now()
  RETURNING id INTO v_venda_id;

  DELETE FROM venda_itens WHERE venda_id = v_venda_id;

  INSERT INTO venda_itens (venda_id, oferta_id, code_payt, tipo, nome, valor, converteu, pedido_id_payt)
  SELECT v_venda_id, o.id, b->'product'->>'code',
         COALESCE(o.tipo, 'orderbump_1'::tipo_item_venda),
         COALESCE(b->'product'->>'name', b->>'name', 'Order bump'),
         COALESCE(NULLIF(b->'product'->>'price', '')::numeric / 100, 0),
         true, p_vp.payt_id
  FROM jsonb_array_elements(
         CASE WHEN jsonb_typeof(p_vp.payload_raw->'order_bumps') = 'array'
              THEN p_vp.payload_raw->'order_bumps' ELSE '[]'::jsonb END) b
  LEFT JOIN ofertas o ON o.code_payt = b->'product'->>'code';

  PERFORM fn_atualizar_taxa_plataforma(v_venda_id, p_vp.payload_raw, v_total);
  PERFORM fn_herdar_origem_do_upsell();

  RETURN v_venda_id;
END;
$function$;

-- ── 2. O cliente: telefone, CPF e o codigo da Payt ───────────────────────
create or replace function public.fn_processar_venda_payt(p_vp vendas_payt)
 returns uuid
 language plpgsql
as $function$
DECLARE
  v_venda_id uuid;
  v_cliente  uuid;
  v_data     timestamptz;
  v_nome     text;
  v_tel      text;
  v_cpf      text;
  v_codigo   text;
BEGIN
  v_venda_id := fn_normalizar_venda_payt(p_vp);
  IF v_venda_id IS NULL THEN RETURN NULL; END IF;

  v_nome := COALESCE(
    NULLIF(p_vp.payload_raw->'product'->>'name', ''),
    NULLIF(p_vp.produto, '')
  );

  UPDATE vendas
     SET produto_nome = v_nome,
         link_titulo  = NULLIF(p_vp.payload_raw->'link'->>'title', ''),
         link_url     = NULLIF(p_vp.payload_raw->'link'->>'url', '')
   WHERE id = v_venda_id;

  SELECT data_venda INTO v_data FROM vendas WHERE id = v_venda_id;

  -- So digito, para casar com a exportacao da Payt e nao quebrar envio de
  -- WhatsApp depois — o erro de formato so apareceria la na frente.
  v_tel    := NULLIF(regexp_replace(COALESCE(p_vp.payload_raw->'customer'->>'phone',''), '\D', '', 'g'), '');
  v_cpf    := NULLIF(regexp_replace(COALESCE(p_vp.payload_raw->'customer'->>'doc',''),   '\D', '', 'g'), '');
  v_codigo := NULLIF(p_vp.payload_raw->'customer'->>'code', '');

  -- O TELEFONE, que antes era NULL escrito a mao nesta chamada.
  v_cliente := fn_resolver_cliente(p_vp.cliente_email, p_vp.cliente_nome, v_tel, v_data);

  IF v_cliente IS NOT NULL THEN
    UPDATE vendas SET cliente_id = v_cliente
     WHERE id = v_venda_id AND cliente_id IS DISTINCT FROM v_cliente;

    /* `fn_resolver_cliente` so grava nome e telefone no INSERT: cliente que ja
       existe nunca ganhava o telefone numa compra posterior, e esse e o caso
       mais comum — a aluna que ja esta na base.

       COALESCE em todos: completa o que falta e NUNCA sobrescreve o que ja
       existe. Dado corrigido a mao vale mais que dado de webhook. */
    UPDATE clientes c
       SET telefone      = COALESCE(NULLIF(trim(c.telefone), ''), v_tel),
           cpf           = COALESCE(c.cpf, CASE WHEN length(v_cpf) BETWEEN 11 AND 14 THEN v_cpf END),
           codigo_payt   = COALESCE(c.codigo_payt, v_codigo),
           fake_email    = c.fake_email
                           OR COALESCE((p_vp.payload_raw->'customer'->>'fake_email')::boolean, false),
           atualizado_em = now()
     WHERE c.id = v_cliente;

    PERFORM fn_marcar_upsell_por_sessao(v_venda_id);
  END IF;

  RETURN v_venda_id;
END;
$function$;

commit;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_norm  text := pg_get_functiondef('public.fn_normalizar_venda_payt'::regproc);
  v_proc  text := pg_get_functiondef('public.fn_processar_venda_payt'::regproc);
begin
  -- 1. O NULL do telefone morreu. E o caso central desta migracao.
  if v_proc ~ 'fn_resolver_cliente\(p_vp\.cliente_email,\s*p_vp\.cliente_nome,\s*NULL' then
    v_erros := v_erros || 'fn_resolver_cliente voltou a receber NULL no telefone. ';
  end if;
  if v_proc !~ 'fn_resolver_cliente\(p_vp\.cliente_email,\s*p_vp\.cliente_nome,\s*v_tel' then
    v_erros := v_erros || 'o telefone nao esta sendo passado para fn_resolver_cliente. ';
  end if;
  if position('phone' in v_proc) = 0 then
    v_erros := v_erros || 'o processador parou de ler o telefone do payload. ';
  end if;

  -- 2. Cliente que JA EXISTE tambem completa. Sem este UPDATE, passar o
  --    telefone nao adianta para quem ja esta na base, que e a maioria.
  if v_proc !~ 'UPDATE clientes' then
    v_erros := v_erros || 'sumiu o UPDATE que completa o cliente existente. ';
  end if;

  -- 3. Os seis campos novos entram na venda.
  for i in 1..1 loop
    if v_norm !~ 'ip_comprador'  then v_erros := v_erros || 'falta ip_comprador. ';  end if;
    if v_norm !~ 'pix_url'       then v_erros := v_erros || 'falta pix_url. ';       end if;
    if v_norm !~ 'pix_expira_em' then v_erros := v_erros || 'falta pix_expira_em. '; end if;
    if v_norm !~ 'erro_pagamento'then v_erros := v_erros || 'falta erro_pagamento. ';end if;
    if v_norm !~ 'query_params'  then v_erros := v_erros || 'falta o fbclid de query_params. '; end if;
  end loop;

  -- 4. A PROTECAO. O evento `paid` chega sem pix_url; sem COALESCE no conflito
  --    ele apagaria o link exatamente nas vendas que converteram. Este caso
  --    vale mais que os de cima: sem ele a migracao parece funcionar e perde
  --    dado em silencio.
  if v_norm !~ 'pix_url\s*=\s*COALESCE\(EXCLUDED\.pix_url,\s*vendas\.pix_url\)' then
    v_erros := v_erros || 'pix_url sobrescreve no conflito em vez de preservar. ';
  end if;
  if v_norm !~ 'ip_comprador\s*=\s*COALESCE\(EXCLUDED\.ip_comprador' then
    v_erros := v_erros || 'ip_comprador sobrescreve no conflito. ';
  end if;
  if v_norm !~ 'fbclid\s*=\s*COALESCE\(EXCLUDED\.fbclid' then
    v_erros := v_erros || 'fbclid sobrescreve no conflito. ';
  end if;

  -- 5. Carrinho recuperado e OR: uma vez recuperado, nenhum evento desmarca.
  if v_norm !~ 'cart_recovered\s*=\s*vendas\.cart_recovered\s+OR' then
    v_erros := v_erros || 'cart_recovered pode ser desmarcado por evento posterior. ';
  end if;

  -- 6. E o que ja funcionava continua: o valor nao pode voltar a ser
  --    sobrescrito pelo estorno zerado, que foi a dor que ensinou a regra.
  if v_norm !~ 'valor_total = CASE WHEN EXCLUDED\.valor_total > 0' then
    v_erros := v_erros || 'a protecao do valor contra o estorno zerado se perdeu. ';
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: o telefone deixou de ser NULL na chamada, cliente existente tambem completa, e os seis campos novos entram preservando o que ja estava gravado.';
end $prova$;

notify pgrst, 'reload schema';
