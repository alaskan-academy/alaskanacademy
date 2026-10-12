-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ O que a Payt manda e ninguém guardava                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Varri TODAS as chaves do payload de `payt_webhook_raw` (11.903 corpos) contra
-- as colunas de `vendas` e `clientes`. O CPF, consertado em `20261012d`, não era
-- caso isolado — era sintoma. `fn_resolver_cliente` nasceu lendo e-mail, nome e
-- telefone, e nunca foi atualizada conforme a Payt passou a mandar mais coisa.
--
-- ── O que chega e se perdia ─────────────────────────────────────────────
--
--   customer.phone .............. 11.481 (96,5%)   só 3.360 clientes têm
--   customer.ip ................. 11.794 (99%)     em lugar nenhum
--   customer.fake_email ......... 11.903 (100%)    coluna existe, ZERADA
--   customer.code ...............  9.333           id do cliente na Payt
--   transaction.pix_url .........  6.576           em lugar nenhum
--   transaction.pix_code ........  7.497           em lugar nenhum
--   transaction.expires_at ......  7.498           em lugar nenhum
--   transaction.error_message ...     90           por que o cartão recusou
--   link.query_params.fbclid ....  5.168           a chave da CAPI do Meta
--   cart_recovered = true .......    409           coluna existe, e `vendas`
--                                                  tem ZERO marcadas
--
-- ── Por que cada um importa, no plano dela ──────────────────────────────
--
-- **Telefone.** O plano tem "Base com WhatsApp: 25% → 45% → 60% → 70%" como
-- KPI, e a régua de pós-venda inteira depende dele. Só com o que já está
-- guardado, a cobertura salta de 24,6% para 54,3% — a meta de dezembro, hoje,
-- sem campanha nenhuma.
--
-- **Pix.** Os ganhos rápidos nº 2 e 3 do plano são "e-mail com o QR code de
-- novo" e "cartão recusado vira Pix: link de Pix do mesmo pedido". O link, o
-- código e a validade chegam em ~7.500 webhooks e eram descartados. Sem eles,
-- os dois ganhos rápidos não têm como ser feitos.
--
-- **IP.** A CAPI do Meta pede `client_ip_address` junto com o user agent; é
-- dos parâmetros que mais pesam no casamento. Chega em 99% e se perdia.
--
-- **fbclid.** A melhor chave de casamento da CAPI. Vive em
-- `link.query_params`, que o webhook nem abre — ele lê só `link.sources`.
--
-- **cart_recovered.** O plano diz, textualmente, "a marcação de carrinho
-- recuperado no dash nunca é preenchida". Agora se sabe por quê: a coluna
-- existe desde sempre e o webhook não lê o campo. São 409 carrinhos
-- recuperados invisíveis, num programa que ela quer levar de 9% para 15–20%.
--
-- **fake_email.** Ela reclamou que a mesma aluna compra com e-mails
-- diferentes. A Payt JÁ diz qual e-mail é falso, em 100% dos webhooks, e a
-- coluna `clientes.fake_email` existe. Os dois lados existiam e ninguém os
-- ligou.
--
-- ── Backfill E gatilho, não só backfill ─────────────────────────────────
--
-- Esta migração preenche o passado. O presente só para de vazar quando o
-- `payt-webhook` passar a ler esses campos — está no mesmo commit. Carga
-- inicial sem gatilho é a quarta armadilha, e foi exatamente o que aconteceu
-- com o CPF: 2.388 vieram de uma importação antiga e nada manteve.
--
-- ── O que NÃO entra, e por quê ──────────────────────────────────────────
--
-- `product.sku`, `product.quantity`, `customer.billing_address` (2.571),
-- `link.available_coupons` (2.679) e `transaction.modifiers` (9.225) também
-- chegam e não são guardados. Ficam de fora porque nenhum deles tem uso no
-- plano hoje, e coluna sem leitor é cadastro sem resultado. Estão anotados
-- aqui para quando houver pergunta que precise deles.
--
-- `subscription.*` já tem a tabela `assinaturas` (212 linhas contra 257
-- webhooks com assinatura). A diferença de 45 merece olhada própria, não um
-- backfill às cegas junto deste.

begin;

drop table if exists _antes_payt;
create temp table _antes_payt as
select (select count(*) from public.vendas)                                   as vendas,
       (select count(*) from public.clientes)                                 as clientes,
       (select count(*) from public.clientes
         where telefone is not null and telefone <> '')                       as com_telefone,
       (select round(sum(valor_total),2) from public.vendas)                  as caixa;

alter table public.vendas
  add column if not exists ip_comprador  text,
  add column if not exists pix_url       text,
  add column if not exists pix_code      text,
  add column if not exists pix_expira_em timestamptz,
  add column if not exists erro_pagamento text,
  add column if not exists fbclid        text;

alter table public.clientes
  add column if not exists codigo_payt text;

comment on column public.vendas.ip_comprador is
  'IP de quem comprou, como a Payt manda em customer.ip (99% dos webhooks). '
  'Existe para a CAPI do Meta, que pede client_ip_address junto do user agent.';
comment on column public.vendas.pix_url is
  'Link do Pix do proprio pedido. E o que permite reenviar o QR code e '
  'transformar cartao recusado em Pix — os ganhos rapidos 2 e 3 do plano.';
comment on column public.vendas.pix_expira_em is
  'Quando o Pix expira. Sem isto nao da para saber que pendente ainda vale.';
comment on column public.vendas.erro_pagamento is
  'Mensagem de recusa da transacao, quando houve. Responde "por que o cartao '
  'recusou" sem abrir o payload.';
comment on column public.vendas.fbclid is
  'O click id do Meta, de link.query_params. Melhor chave de casamento da '
  'CAPI. O webhook lia so link.sources e nunca abria query_params.';
comment on column public.clientes.codigo_payt is
  'Id do cliente na Payt (customer.code). Chave externa estavel — nao muda '
  'quando a pessoa compra com outro e-mail.';

-- Um registro por pedido da Payt. Varios webhooks chegam para o mesmo pedido
-- (um por mudanca de status), entao agrega-se pegando o primeiro valor nao
-- nulo de cada campo: pix, ip e telefone nao mudam entre os status.
with dados as (
  select w.payt_id,
         max(nullif(w.body->'customer'->>'ip', ''))                  as ip,
         max(nullif(w.body->'transaction'->>'pix_url', ''))          as pix_url,
         max(nullif(w.body->'transaction'->>'pix_code', ''))         as pix_code,
         max(nullif(w.body->'transaction'->>'expires_at', ''))       as expira,
         max(nullif(w.body->'transaction'->>'error_message', ''))    as erro,
         max(nullif(w.body->'link'->'query_params'->>'fbclid', ''))  as fbclid,
         bool_or(coalesce((w.body->>'cart_recovered')::boolean, false)) as recuperado
    from public.payt_webhook_raw w
   group by w.payt_id
)
update public.vendas v
   set ip_comprador   = coalesce(v.ip_comprador, d.ip),
       pix_url        = coalesce(v.pix_url, d.pix_url),
       pix_code       = coalesce(v.pix_code, d.pix_code),
       pix_expira_em  = coalesce(v.pix_expira_em, d.expira::timestamptz),
       erro_pagamento = coalesce(v.erro_pagamento, d.erro),
       fbclid         = coalesce(v.fbclid, d.fbclid),
       cart_recovered = v.cart_recovered or d.recuperado
  from dados d
 where v.pedido_id_payt = d.payt_id;

-- E o lado do cliente: telefone, o codigo da Payt e a marca de e-mail falso.
with pessoa as (
  select lower(trim(w.body->'customer'->>'email'))                      as email,
         max(nullif(regexp_replace(w.body->'customer'->>'phone','\D','','g'),'')) as tel,
         max(nullif(w.body->'customer'->>'code',''))                    as codigo,
         bool_or(coalesce((w.body->'customer'->>'fake_email')::boolean, false)) as falso
    from public.payt_webhook_raw w
   where nullif(w.body->'customer'->>'email','') is not null
   group by 1
)
update public.clientes c
   set telefone    = coalesce(nullif(trim(c.telefone), ''), p.tel),
       codigo_payt = coalesce(c.codigo_payt, p.codigo),
       fake_email  = c.fake_email or p.falso,
       atualizado_em = now()
  from pessoa p
 where lower(trim(c.email)) = p.email;

commit;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_n     integer;
  v_alvo  integer;
  v_num   numeric;
begin
  -- 1. O CAIXA NAO SE MEXEU. Esta migracao preenche coluna nova; se ela tocou
  --    em valor, e bug grave e tem de parar aqui.
  select round(sum(valor_total),2) into v_num from public.vendas;
  if v_num is distinct from (select caixa from _antes_payt) then
    v_erros := v_erros || format('o caixa virou %s, era %s. ', v_num, (select caixa from _antes_payt));
  end if;

  -- 2. Nenhuma venda nem cliente criado ou apagado.
  select count(*) into v_n from public.vendas;
  if v_n <> (select vendas from _antes_payt) then
    v_erros := v_erros || format('vendas tem %s linhas, tinha %s. ', v_n, (select vendas from _antes_payt));
  end if;
  select count(*) into v_n from public.clientes;
  if v_n <> (select clientes from _antes_payt) then
    v_erros := v_erros || format('clientes tem %s linhas, tinha %s. ', v_n, (select clientes from _antes_payt));
  end if;

  -- 3. O TELEFONE, que e o que destrava o pos-venda. Eram 3.360.
  select count(*) into v_n from public.clientes where telefone is not null and telefone <> '';
  if v_n <= (select com_telefone from _antes_payt) then
    v_erros := v_erros || format('o telefone nao avancou: %s, era %s. ', v_n, (select com_telefone from _antes_payt));
  end if;
  if v_n < 7000 then
    v_erros := v_erros || format('so %s clientes com telefone, esperava mais de 7.000. ', v_n);
  end if;

  -- 4. O carrinho recuperado saiu do zero. Eram 409 nos webhooks e 0 em vendas.
  select count(*) into v_n from public.vendas where cart_recovered;
  if v_n = 0 then
    v_erros := v_erros || 'cart_recovered continua zerado em vendas. ';
  end if;

  -- 5. O Pix e o IP chegaram — e a cobranca e contra o que era ALCANCAVEL,
  --    nao contra um numero escrito a mao.
  --
  --    A primeira versao exigia "mais de 5.000 vendas com IP" e reprovou com
  --    4.917. O numero estava errado, nao o conserto: so ha 4.970 pedidos
  --    distintos em payt_webhook_raw, entao 5.000 era acima do teto. Numero
  --    magico em prova envelhece igual a numero magico em codigo.
  select count(distinct v.id) into v_alvo
    from public.vendas v
    join (select payt_id, max(nullif(body->'customer'->>'ip','')) as ip
            from public.payt_webhook_raw group by 1) d
      on d.payt_id = v.pedido_id_payt
   where d.ip is not null;
  select count(*) into v_n from public.vendas where ip_comprador is not null;
  if v_n < v_alvo then
    v_erros := v_erros || format('%s vendas com ip, mas %s eram alcancaveis. ', v_n, v_alvo);
  end if;

  select count(distinct v.id) into v_alvo
    from public.vendas v
    join (select payt_id, max(nullif(body->'transaction'->>'pix_url','')) as px
            from public.payt_webhook_raw group by 1) d
      on d.payt_id = v.pedido_id_payt
   where d.px is not null;
  select count(*) into v_n from public.vendas where pix_url is not null;
  if v_n < v_alvo then
    v_erros := v_erros || format('%s vendas com pix_url, mas %s eram alcancaveis. ', v_n, v_alvo);
  end if;

  -- 6. Telefone so com digito: o resto quebra o envio de WhatsApp depois, e o
  --    erro so apareceria la.
  select count(*) into v_n from public.clientes
   where telefone is not null and telefone <> '' and telefone !~ '^[0-9]+$';
  if v_n > 0 then
    v_erros := v_erros || format('%s telefone(s) com caractere que nao e digito. ', v_n);
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  select count(*) into v_n from public.clientes where telefone is not null and telefone <> '';
  raise notice 'PROVA OK: telefone de % para % clientes, Pix, IP, fbclid, erro de pagamento e carrinho recuperado preenchidos, e o caixa intacto.',
    (select com_telefone from _antes_payt), v_n;
end $prova$;

drop table if exists _antes_payt;

notify pgrst, 'reload schema';
