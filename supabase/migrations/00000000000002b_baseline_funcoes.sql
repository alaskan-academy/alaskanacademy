-- BASELINE — funções
--
-- 47 funções, entre gatilhos, agregações do dashboard e as que alimentam os
-- alertas. Depende das tabelas e dos tipos.
--
-- A `fn_dump_schema`, usada para gerar estes arquivos, foi deixada de fora de
-- propósito: era andaime, não parte do sistema.
--
-- Repare que várias são SECURITY DEFINER. Duas delas — `fn_alerta_cron_falhando` e
-- `fn_ultima_execucao_cron` — precisam disso para ler o schema `cron` sem que o
-- papel `authenticated` ganhe acesso a ele, onde o comando do agendamento guarda
-- a chave do cs-sync em texto puro.

CREATE OR REPLACE FUNCTION public.aplicar_regras_categoria()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  updated_count INTEGER;
BEGIN
  WITH matched AS (
    SELECT DISTINCT ON (t.id)
      t.id,
      r.categoria,
      r.centro_custo
    FROM transacoes t
    JOIN regras_categoria r ON r.ativo = true
      AND (
        (r.tipo_match = 'contains'    AND LOWER(t.descricao) LIKE '%' || LOWER(r.padrao) || '%') OR
        (r.tipo_match = 'starts_with' AND LOWER(t.descricao) LIKE LOWER(r.padrao) || '%')        OR
        (r.tipo_match = 'exact'       AND LOWER(t.descricao) = LOWER(r.padrao))                   OR
        (r.tipo_match = 'regex'       AND t.descricao ~* r.padrao)
      )
    WHERE t.categoria IS NULL
      AND t.status_revisao = 'pendente'
    ORDER BY t.id, r.confianca DESC, LENGTH(r.padrao) DESC
  )
  UPDATE transacoes t
  SET
    categoria    = matched.categoria,
    centro_custo = COALESCE(matched.centro_custo, t.centro_custo)
  FROM matched
  WHERE t.id = matched.id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.calcular_origem(p_utm_source text, p_utm_medium text)
 RETURNS origem_venda
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  s TEXT := LOWER(COALESCE(TRIM(p_utm_source), ''));
  m TEXT := LOWER(COALESCE(TRIM(p_utm_medium), ''));
BEGIN
  IF s = ''                                          THEN RETURN 'organico';    END IF;
  IF s LIKE 'fb%' OR s LIKE 'ig%'                    THEN RETURN 'pago';        END IF;
  IF s IN ('facebook','instagram','meta')            THEN RETURN 'pago';        END IF;
  IF m IN ('email','newsletter','email_mkt')         THEN RETURN 'email';       END IF;
  IF s IN ('organic','(organic)')                    THEN RETURN 'organico';    END IF;
  IF s IN ('(direct)','direct')                      THEN RETURN 'direto';      END IF;
  RETURN 'desconhecido';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.clean_utm(raw text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  RETURN SPLIT_PART(SPLIT_PART(raw, '::', 1), '|', 1);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_alerta_conta_sem_venda()
 RETURNS TABLE(codigo text, severidade text, titulo text, detalhe text)
 LANGUAGE sql
 STABLE
AS $function$
  WITH janela AS (
    SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date - 7) AS de,
           (now() AT TIME ZONE 'America/Sao_Paulo')::date       AS ate
  ),
  contas AS (
    SELECT a.id, a.nome,
           sum(m.investimento) AS gasto,
           sum(m.compras_meta) AS compras_meta
      FROM metricas_meta m
      JOIN ad_accounts a ON a.id = m.ad_account_id
      CROSS JOIN janela j
     WHERE m.nivel = 'campanha' AND m.data BETWEEN j.de AND j.ate
     GROUP BY a.id, a.nome
    HAVING sum(m.investimento) > 0 AND sum(m.compras_meta) > 0
  ),
  orfas AS (
    SELECT c.*
      FROM contas c
     WHERE NOT EXISTS (
       SELECT 1 FROM vendas v CROSS JOIN janela j
        WHERE v.ad_account_id = c.id
          AND v.status = 'aprovada'
          AND (v.data_venda AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN j.de AND j.ate
     )
  )
  SELECT 'conta_sem_venda'::text,
         'critico'::text,
         count(*)::text || ' conta(s) gastando sem nenhuma venda atribuída',
         (fn_brl(sum(gasto)) || ' nos últimos 7 dias, com ' || sum(compras_meta)::text ||
          ' compras reportadas pelo Meta: ' || string_agg(nome, ', ') ||
          '. Provável UTM sem ad_id no checkout — a conta pode estar vendendo bem e aparecer como prejuízo.')
    FROM orfas
   HAVING count(*) > 0;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_alerta_cron_falhando()
 RETURNS TABLE(codigo text, severidade text, titulo text, detalhe text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'cron', 'pg_temp'
AS $function$
  WITH ultima AS (
    SELECT DISTINCT ON (j.jobname)
           j.jobname, d.status, d.return_message, d.start_time
      FROM cron.job j
      JOIN cron.job_run_details d ON d.jobid = j.jobid
     WHERE j.active
     ORDER BY j.jobname, d.start_time DESC
  )
  SELECT 'cron_falhando'::text,
         'critico'::text,
         count(*)::text || ' tarefa(s) agendada(s) falhando',
         string_agg(jobname, ', ') || ' — último erro: ' ||
           left(regexp_replace(coalesce(max(return_message), 'sem mensagem'), '\s+', ' ', 'g'), 140)
    FROM ultima
   WHERE status = 'failed'
  HAVING count(*) > 0;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_alerta_remendo_utm_resolvido()
 RETURNS TABLE(codigo text, severidade text, titulo text, detalhe text)
 LANGUAGE sql
 STABLE
AS $function$
  WITH recentes AS (
    SELECT l.link_titulo,
           count(*)            AS vendas,
           count(v.ad_id_meta) AS com_ad_id,
           round(100.0 * count(v.ad_id_meta) / nullif(count(*), 0), 1) AS pct
      FROM links_trafego_sem_utm l
      JOIN vendas v ON v.link_titulo = l.link_titulo
     WHERE v.status = 'aprovada'
       AND (v.data_venda AT TIME ZONE 'America/Sao_Paulo')::date
             >= ((now() AT TIME ZONE 'America/Sao_Paulo')::date - 3)
     GROUP BY l.link_titulo
    HAVING count(*) >= 5 AND count(v.ad_id_meta) > 0
  )
  SELECT 'remendo_utm_resolvido'::text,
         'atencao'::text,
         CASE WHEN bool_and(pct >= 80)
              THEN 'UTM restabelecida em ' || count(*)::text || ' link(s): o remendo pode sair'
              ELSE 'UTM voltando parcialmente em ' || count(*)::text || ' link(s)'
         END,
         string_agg(link_titulo || ' — ' || pct::text || '% rastreado ('
                    || com_ad_id || ' de ' || vendas || ' nos últimos 3 dias)', '; ')
           || CASE WHEN bool_and(pct >= 80)
                   THEN '. Já dá para esvaziar links_trafego_sem_utm.'
                   ELSE '. Ainda cedo para remover o remendo — parte das vendas segue sem ad_id.'
              END
    FROM recentes
  HAVING count(*) > 0;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_alerta_venda_sem_categoria()
 RETURNS TABLE(codigo text, severidade text, titulo text, detalhe text)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT 'venda_sem_categoria'::text,
         'atencao'::text,
         count(*)::text || ' venda(s) sem categoria de produto',
         fn_brl(sum(valor_sem_juros)) || ' nos últimos 7 dias aparecem normalmente pelo '
           || 'nome do produto, mas caem em "Outros" no agrupamento por categoria da '
           || 'página de Vendas.'
    FROM vendas
   WHERE status = 'aprovada'::status_venda
     AND produto IS NULL
     AND (data_venda AT TIME ZONE 'America/Sao_Paulo')::date >= ((now() AT TIME ZONE 'America/Sao_Paulo')::date - 7)
  HAVING count(*) > 0;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_atualizar_taxa_plataforma(p_venda_id uuid, p_payload jsonb, p_total numeric)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_produtor  numeric;
  v_sem_juros numeric;
  v_parcelas  integer;
  v_juros     numeric;
  v_taxa      numeric;
BEGIN
  IF p_total IS NULL OR p_total <= 0 THEN
    RETURN;
  END IF;

  v_sem_juros := COALESCE(
    NULLIF(p_payload->'transaction'->>'price_without_installments', '')::numeric / 100,
    p_total);
  v_parcelas := COALESCE(NULLIF(p_payload->'transaction'->>'installments', '')::int, 1);
  v_juros    := GREATEST(p_total - v_sem_juros, 0);

  -- Sempre gravável: vem direto da transação, não da comissão.
  UPDATE vendas
     SET valor_sem_juros        = v_sem_juros,
         juros_parcelamento     = v_juros,
         parcelas               = v_parcelas,
         valor_oferta_principal = GREATEST(v_sem_juros - COALESCE(valor_obs, 0), 0)
   WHERE id = p_venda_id;

  IF jsonb_typeof(p_payload->'commission') <> 'array' THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(NULLIF(c.v->>'amount', '')::numeric) / 100, 0)
    INTO v_produtor
    FROM jsonb_array_elements(p_payload->'commission') AS c(v)
   WHERE c.v->>'type' = 'producer';

  -- Comissão zerada acontece quando a Payt ainda não a calculou no momento do
  -- postback. Deixa nulo em vez de gravar zero: nulo é "não sei", zero seria mentira.
  IF v_produtor IS NULL OR v_produtor <= 0 THEN
    RETURN;
  END IF;

  v_taxa := GREATEST(v_sem_juros - v_produtor, 0);

  UPDATE vendas
     SET valor_liquido_produtor = v_produtor,
         taxa_plataforma_valor  = v_taxa,
         taxa_plataforma_pct    = CASE WHEN v_sem_juros > 0
                                       THEN (v_taxa / v_sem_juros) * 100 END
   WHERE id = p_venda_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_auto_produto_assinatura()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_produto produto_tipo;
BEGIN
  IF NEW.produto IS NULL THEN
    -- Tenta pegar produto pela oferta via código do produto na venda
    SELECT o.produto INTO v_produto
    FROM vendas v
    JOIN ofertas o ON o.code_payt = (v.payload_webhook->'product'->>'code')
    WHERE v.assinatura_id = NEW.id
      AND o.produto IS NOT NULL
    LIMIT 1;

    IF v_produto IS NOT NULL THEN
      NEW.produto := v_produto;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_auto_produto_venda()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_produto produto_tipo;
  v_code_payt text;
BEGIN
  -- Agir sempre que produto estiver nulo ou incorreto
  IF NEW.produto IS NULL THEN
    v_code_payt := NEW.payload_webhook->'product'->>'code';

    IF v_code_payt IS NOT NULL THEN
      SELECT produto INTO v_produto
      FROM ofertas
      WHERE code_payt = v_code_payt
        AND produto IS NOT NULL
      LIMIT 1;

      IF v_produto IS NOT NULL THEN
        NEW.produto := v_produto;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_brl(v numeric)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT 'R$ ' || translate(to_char(coalesce(v, 0), 'FM999G999G999D00'), '.,', ',.');
$function$
;

CREATE OR REPLACE FUNCTION public.fn_campos_data()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.data_venda IS NOT NULL THEN
    NEW.hora_venda  := EXTRACT(HOUR FROM NEW.data_venda AT TIME ZONE 'America/Sao_Paulo');
    NEW.dia_semana  := EXTRACT(DOW  FROM NEW.data_venda AT TIME ZONE 'America/Sao_Paulo');
    NEW.semana_iso  := TO_CHAR(NEW.data_venda AT TIME ZONE 'America/Sao_Paulo', 'IYYY"-W"IW');
    NEW.mes_ano     := TO_CHAR(NEW.data_venda AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM');
  END IF;

  -- Mapear placement a partir do utm_term se não veio preenchido
  IF NEW.utm_placement IS NULL AND NEW.utm_term IS NOT NULL THEN
    NEW.utm_placement := CASE
      WHEN NEW.utm_term ILIKE '%reels%'            THEN 'reels'::placement_tipo
      WHEN NEW.utm_term ILIKE '%stories%'          THEN 'stories'::placement_tipo
      WHEN NEW.utm_term ILIKE '%feed%'             THEN 'feed'::placement_tipo
      WHEN NEW.utm_term ILIKE '%marketplace%'      THEN 'marketplace'::placement_tipo
      WHEN NEW.utm_term ILIKE '%search%'           THEN 'search'::placement_tipo
      WHEN NEW.utm_term ILIKE '%audience_network%' THEN 'audience_network'::placement_tipo
      WHEN NEW.utm_term ILIKE '%messenger%'        THEN 'messenger'::placement_tipo
      ELSE 'outro'::placement_tipo
    END;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_contas_com_gasto(p_inicio date DEFAULT NULL::date, p_fim date DEFAULT NULL::date)
 RETURNS TABLE(id uuid, nome text, produto text, investimento numeric)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT a.id,
         a.nome,
         a.produto::text,
         round(sum(m.investimento), 2) AS investimento
    FROM metricas_meta m
    JOIN ad_accounts a ON a.id = m.ad_account_id
   WHERE m.nivel = 'campanha'
     AND (p_inicio IS NULL OR m.data >= p_inicio)
     AND (p_fim    IS NULL OR m.data <= p_fim)
   GROUP BY a.id, a.nome, a.produto
  HAVING sum(m.investimento) > 0
   ORDER BY sum(m.investimento) DESC;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_criativos_meta(p_ini date, p_fim date, p_conta uuid DEFAULT NULL::uuid)
 RETURNS TABLE(ad_id text, ad_nome text, conta_id uuid, conta text, estreia date, investimento numeric, impressoes bigint, cliques_link bigint, video_3s bigint, video_75pct bigint, checkouts bigint, visualizacoes bigint, vendas integer, receita numeric, vendas_meta integer, receita_meta numeric, producao_id uuid, editor_id uuid, editor text, projeto text, avaliacao text, status_veiculacao text, tipo_teste text, angulo_teste text, nivel_consciencia text, formato text, vinculo text, candidatos integer, conta_hook numeric, conta_ctr numeric, conta_conexao numeric, conta_cpa numeric, conta_roas numeric, conta_cpa_meta numeric, conta_roas_meta numeric, conta_pct_atribuido numeric)
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
begin
  return query
  with contas_ativas as (
    select m.ad_account_id from metricas_meta m
     where m.nivel = 'campanha' and m.data between p_ini and p_fim
     group by m.ad_account_id having sum(m.investimento) > 0
  ),
  ad as (
    select m.ad_id, max(m.ad_nome) as ad_nome, m.ad_account_id,
           sum(m.investimento) as investimento,
           -- `impressoes` e bigint, e sum(bigint) devolve numeric: em plpgsql isso
           -- derruba a funcao com "structure of query does not match".
           sum(m.impressoes)::bigint as impressoes,
           sum(m.cliques_link)::bigint as cliques_link,
           sum(m.video_3s)::bigint as video_3s,
           sum(m.video_75pct)::bigint as video_75pct,
           sum(m.initiate_checkout)::bigint as checkouts,
           sum(m.visualizacoes_pagina)::bigint as visualizacoes,
           sum(m.compras_meta)::integer as vendas_meta,
           sum(m.faturamento_atribuido) as receita_meta
      from metricas_meta m
      join contas_ativas c on c.ad_account_id = m.ad_account_id
     where m.nivel = 'ad' and m.data between p_ini and p_fim and m.ad_id is not null
       and (p_conta is null or m.ad_account_id = p_conta)
     group by m.ad_id, m.ad_account_id
  ),
  estreia_real as (
    select m.ad_id, min(m.data) as estreia
      from metricas_meta m
     where m.nivel = 'ad' and m.ad_id is not null
       and m.ad_id in (select a.ad_id from ad a)
     group by m.ad_id
  ),
  venda as (
    select v.ad_id_meta as ad_id, count(*)::integer as vendas,
           sum(coalesce(v.valor_sem_juros, v.valor_total)) as receita
      from vendas v
     where v.status = 'aprovada' and not coalesce(v.is_upsell, false)
       and v.ad_id_meta is not null
       and (v.data_venda at time zone 'America/Sao_Paulo')::date between p_ini and p_fim
     group by v.ad_id_meta
  ),
  atribuicao as (
    select v.ad_account_id, round(100.0 * count(v.ad_id_meta) / nullif(count(*), 0), 1) as pct
      from vendas v
     where v.status = 'aprovada' and not coalesce(v.is_upsell, false)
       and v.ad_account_id is not null
       and (v.data_venda at time zone 'America/Sao_Paulo')::date between p_ini and p_fim
     group by v.ad_account_id
  ),
  cand as (
    select a.ad_id, er.estreia, p.id, p.responsavel_id, p.criado_em::date as criado,
           (ac.projeto_id is not null) as conta_mapeada,
           (p.projeto_id is not null and p.projeto_id = ac.projeto_id) as no_projeto
      from ad a
      join ad_accounts ac  on ac.id = a.ad_account_id
      join estreia_real er on er.ad_id = a.ad_id
      join producoes p
        on public.fn_nome_criativo(p.nome) = public.fn_nome_criativo(a.ad_nome)
       and p.fase = 'postado' and p.tipo = 'criativo'
  ),
  cand_ok as (select * from cand where no_projeto or not conta_mapeada),
  resumo as (
    select c.ad_id, count(*) as cards, count(c.responsavel_id) as com_editor,
           count(distinct c.responsavel_id) as editores
      from cand_ok c group by c.ad_id
  ),
  ranqueado as (
    select c.ad_id, c.id,
           row_number() over (partition by c.ad_id
             order by (c.criado <= c.estreia) desc, abs(c.criado - c.estreia)) as pos
      from cand_ok c where c.responsavel_id is not null
  ),
  pela_data as (select r.ad_id, r.id as producao_id from ranqueado r where r.pos = 1),
  sem_dono as (
    select c.ad_id, (array_agg(c.id order by c.criado desc))[1] as producao_id
      from cand_ok c group by c.ad_id
  ),
  so_outro_projeto as (
    select c.ad_id from cand c where c.conta_mapeada
     group by c.ad_id having count(*) filter (where c.no_projeto) = 0
  ),
  fora as (
    select a.ad_id from ad a
      join producoes p on public.fn_nome_criativo(p.nome) = public.fn_nome_criativo(a.ad_nome)
     where p.fase <> 'postado' or p.tipo <> 'criativo'
     group by a.ad_id
  ),
  escolha as (
    select a.ad_id,
           coalesce(e.producao_id, d.producao_id, s.producao_id) as producao_id,
           case when e.producao_id is not null then 'confirmado'
                when op.ad_id is not null then 'outro_projeto'
                when coalesce(r.cards,0) = 0 and f.ad_id is not null then 'fora_do_recorte'
                when coalesce(r.cards,0) = 0 then 'sem_card'
                when r.com_editor = 0 then 'sem_responsavel'
                when r.editores > 1 then 'por_data'
                else 'sugerido' end as vinculo,
           coalesce(r.editores, 0)::integer as candidatos
      from ad a
      left join (select pr.ad_id_meta as ad_id, pr.id as producao_id
                   from producoes pr where pr.ad_id_meta is not null) e on e.ad_id = a.ad_id
      left join pela_data d on d.ad_id = a.ad_id
      left join sem_dono  s on s.ad_id = a.ad_id
      left join resumo    r on r.ad_id = a.ad_id
      left join fora      f on f.ad_id = a.ad_id
      left join so_outro_projeto op on op.ad_id = a.ad_id
  ),
  ref as (
    select a.ad_account_id,
           round(sum(a.video_3s)     * 100.0 / nullif(sum(a.impressoes), 0), 2)   as hook,
           round(sum(a.cliques_link) * 100.0 / nullif(sum(a.impressoes), 0), 2)   as ctr,
           round(sum(a.visualizacoes)* 100.0 / nullif(sum(a.cliques_link), 0), 2) as conexao,
           round(sum(a.investimento) / nullif(sum(v.vendas), 0), 2)               as cpa,
           round(sum(v.receita) / nullif(sum(a.investimento), 0), 2)              as roas,
           round(sum(a.investimento) / nullif(sum(a.vendas_meta), 0), 2)          as cpa_meta,
           round(sum(a.receita_meta) / nullif(sum(a.investimento), 0), 2)         as roas_meta
      from ad a left join venda v on v.ad_id = a.ad_id
     group by a.ad_account_id
  )
  select
    a.ad_id, a.ad_nome, a.ad_account_id, c.nome::text, er.estreia,
    round(a.investimento, 2), a.impressoes, a.cliques_link,
    a.video_3s, a.video_75pct, a.checkouts, a.visualizacoes,
    coalesce(v.vendas, 0), round(coalesce(v.receita, 0), 2),
    coalesce(a.vendas_meta, 0), round(coalesce(a.receita_meta, 0), 2),
    p.id, p.responsavel_id, perf.nome::text, of.nome::text,
    p.avaliacao::text, p.status_veiculacao::text,
    p.tipo_teste::text, p.angulo_teste::text, p.nivel_consciencia::text, p.formato::text,
    e.vinculo, e.candidatos,
    r.hook, r.ctr, r.conexao, r.cpa, r.roas, r.cpa_meta, r.roas_meta,
    coalesce(atr.pct, 0)
  from ad a
  join ad_accounts c    on c.id = a.ad_account_id
  join estreia_real er  on er.ad_id = a.ad_id
  join escolha e        on e.ad_id = a.ad_id
  left join venda v     on v.ad_id = a.ad_id
  left join producoes p on p.id = e.producao_id
  left join perfis perf on perf.id = p.responsavel_id
  left join ofertas_editores of on of.id = p.projeto_id
  left join ref r       on r.ad_account_id = a.ad_account_id
  left join atribuicao atr on atr.ad_account_id = a.ad_account_id
  order by a.investimento desc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_herdar_origem_do_upsell()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare
  v_afetadas integer;
begin
  with pai as (
    select cart_id,
           max(ad_account_id::text)::uuid                     as ad_account_id,
           -- Dentro de um carrinho o anúncio é um só; `max` resolve o empate teórico
           -- de forma determinística.
           max(ad_id_meta)                                    as ad_id_meta,
           max(utm_content)                                   as utm_content,
           bool_or(ad_id_meta is not null or coalesce(trafego_pago,false)) as eh_trafego
      from vendas
     where cart_id is not null
       and not coalesce(is_upsell, false)
     group by cart_id
  )
  update vendas u
     set ad_account_id = coalesce(u.ad_account_id, p.ad_account_id),
         ad_id_meta    = coalesce(u.ad_id_meta,    p.ad_id_meta),
         utm_content   = coalesce(u.utm_content,   p.utm_content),
         trafego_pago  = case when p.eh_trafego then true else u.trafego_pago end
    from pai p
   where u.cart_id = p.cart_id
     and coalesce(u.is_upsell, false)
     and (u.ad_account_id is null and p.ad_account_id is not null
          or u.ad_id_meta  is null and p.ad_id_meta  is not null
          or u.utm_content is null and p.utm_content is not null
          or (p.eh_trafego and u.trafego_pago is distinct from true));

  get diagnostics v_afetadas = row_count;
  return v_afetadas;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_marcar_upsell()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.payload_webhook->>'type' IN ('upsell','manual_upsell') THEN
    NEW.is_upsell := true;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_marcar_upsell_por_sessao(p_venda_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Mantida como no-op em vez de removida: a função é chamada por
  -- `fn_processar_venda_payt`, e apagá-la quebraria o processamento na próxima venda.
  -- O upsell agora vem de `vendas_payt.tipo_venda`.
  RETURN;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_metas_sugeridas(p_dias integer DEFAULT 30, p_margem numeric DEFAULT 0.30)
 RETURNS TABLE(conta_id uuid, conta text, ticket_medio numeric, roas_equilibrio numeric, roas_alvo numeric, roas_equilibrio_op numeric, roas_alvo_op numeric, cpa_equilibrio numeric, cpa_alvo numeric, roas_atual numeric, cpa_atual numeric, taxa_pct numeric, simples_pct numeric, imposto_meta_pct numeric, custo_fixo_periodo numeric, investimento_periodo numeric, dias integer)
 LANGUAGE sql
 STABLE
AS $function$
  WITH cfg AS (
    SELECT
      coalesce(max(valor) FILTER (WHERE chave = 'imposto_simples_nacional_pct'), 0) / 100 AS simples,
      coalesce(max(valor) FILTER (WHERE chave = 'imposto_meta_ads_pct'), 0)         / 100 AS meta_ads,
      coalesce(max(valor) FILTER (WHERE chave = 'custo_fixo_mensal'), 0)                  AS fixo_mensal
    FROM configuracoes
  ),
  periodo AS (
    SELECT
      sum(faturamento_bruto)  AS receita,
      sum(taxa_plataforma)    AS taxa,
      sum(investimento_meta)  AS investimento,
      count(DISTINCT data)    AS dias
    FROM vw_faturamento_liquido
    WHERE data >= current_date - p_dias AND data < current_date
  ),
  base AS (
    SELECT
      p.dias, p.investimento,
      p.taxa / nullif(p.receita, 0)                     AS taxa_frac,
      c.simples, c.meta_ads,
      c.fixo_mensal / 30.0 * p.dias                     AS fixo_periodo
    FROM periodo p CROSS JOIN cfg c
  ),
  economia AS (
    SELECT
      b.*,
      1 - b.taxa_frac - b.simples                       AS sobra,
      1 + b.meta_ads                                    AS custo_marginal,
      1 + b.meta_ads
        + b.fixo_periodo / nullif(b.investimento, 0)    AS custo_total
    FROM base b
  ),
  contas AS (
    SELECT a.id, a.nome::text AS nome,
           -- Receita cheia, para o ROAS
           sum(coalesce(v.valor_sem_juros, v.valor_total))                              AS receita,
           -- AOV: só a compra inicial, sobre o número de pedidos
           sum(coalesce(v.valor_sem_juros, v.valor_total))
             FILTER (WHERE NOT coalesce(v.is_upsell, false))                            AS receita_sem_upsell,
           count(*) FILTER (WHERE NOT coalesce(v.is_upsell, false))                     AS pedidos
      FROM ad_accounts a
      JOIN vendas v ON v.ad_account_id = a.id AND v.status = 'aprovada'
     WHERE v.data_venda >= current_date - p_dias AND v.data_venda < current_date
     GROUP BY a.id, a.nome
  ),
  gasto AS (
    SELECT ad_account_id, sum(investimento) AS investimento
      FROM metricas_meta
     WHERE nivel = 'campanha' AND data >= current_date - p_dias AND data < current_date
     GROUP BY ad_account_id
  )
  SELECT
    c.id, c.nome,
    round(c.receita_sem_upsell / nullif(c.pedidos, 0), 2),
    round(e.custo_marginal / nullif(e.sobra, 0), 2),
    round(e.custo_marginal / nullif(e.sobra - p_margem, 0), 2),
    round(e.custo_total    / nullif(e.sobra, 0), 2),
    round(e.custo_total    / nullif(e.sobra - p_margem, 0), 2),
    round((c.receita_sem_upsell / nullif(c.pedidos, 0))
            / nullif(e.custo_total / nullif(e.sobra, 0), 0), 2),
    round((c.receita_sem_upsell / nullif(c.pedidos, 0))
            / nullif(e.custo_total / nullif(e.sobra - p_margem, 0), 0), 2),
    round(c.receita / nullif(g.investimento, 0), 2),
    round(g.investimento / nullif(c.pedidos, 0), 2),
    round(100 * e.taxa_frac, 3), round(100 * e.simples, 2), round(100 * e.meta_ads, 2),
    round(e.fixo_periodo, 2), round(e.investimento, 2), e.dias::integer
  FROM contas c
  CROSS JOIN economia e
  LEFT JOIN gasto g ON g.ad_account_id = c.id
  WHERE g.investimento > 0
  ORDER BY g.investimento DESC;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_metricas_meta_produto()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.produto IS NULL THEN
    SELECT a.produto INTO NEW.produto FROM ad_accounts a WHERE a.id = NEW.ad_account_id;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_nome_criativo(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT nullif(trim(regexp_replace(
           regexp_replace(lower(coalesce(t,'')),
             '\s*[-–—]?\s*(c[oó]pia|copy)\s*[0-9]*\s*$', '', 'gi'),
           '\s*\([0-9]+\)\s*$', '', 'g')), '')
$function$
;

CREATE OR REPLACE FUNCTION public.fn_normalizar_venda_payt(p_vp vendas_payt)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
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
  -- `payment_status` manda quando existe; `status` é o fallback para os registros
  -- antigos de importação, que não têm o bloco `transaction`.
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

  -- 1. transaction.paid_at (BRT)  2. vendas_payt.data (import de 30/06)  3. criado_em
  v_paid_at := p_vp.payload_raw->'transaction'->>'paid_at';
  v_data_venda := CASE
    WHEN NULLIF(v_paid_at, '') IS NOT NULL THEN (v_paid_at::timestamp AT TIME ZONE 'America/Sao_Paulo')
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

  -- Cascata de recuperação do valor. `total_price` vem zerado no estorno; os outros
  -- dois sobrevivem. Conferido contra o export: `price_without_installments` bate ao
  -- centavo, e o preço do produto é aproximação para quando nem ele existe.
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
    ad_id_meta, payload_webhook, funil_id, cart_id
  ) VALUES (
    p_vp.payt_id, p_vp.payt_id, v_assinatura_id, v_produto, v_data_venda, v_status,
    v_meio, GREATEST(v_total - v_obs, 0), v_obs, v_total,
    p_vp.utm_source, p_vp.utm_medium, p_vp.utm_campaign, p_vp.utm_content, p_vp.utm_term,
    p_vp.utm_ad_id, p_vp.payload_raw, NULL,
    NULLIF(p_vp.payload_raw->>'cart_id', '')
  )
  ON CONFLICT (pedido_id) DO UPDATE SET
    assinatura_id = EXCLUDED.assinatura_id,
    produto = COALESCE(EXCLUDED.produto, vendas.produto),
    data_venda = EXCLUDED.data_venda, status = EXCLUDED.status,
    meio_pagamento = EXCLUDED.meio_pagamento,
    -- Mudança de status não pode apagar o valor: o estorno chega zerado e sobrescrevia
    -- a venda boa que já estava gravada.
    valor_oferta_principal = CASE WHEN EXCLUDED.valor_total > 0
                                  THEN EXCLUDED.valor_oferta_principal
                                  ELSE vendas.valor_oferta_principal END,
    valor_obs = CASE WHEN EXCLUDED.valor_total > 0 THEN EXCLUDED.valor_obs ELSE vendas.valor_obs END,
    valor_total = CASE WHEN EXCLUDED.valor_total > 0 THEN EXCLUDED.valor_total ELSE vendas.valor_total END,
    utm_source = EXCLUDED.utm_source, utm_medium = EXCLUDED.utm_medium,
    utm_campaign = EXCLUDED.utm_campaign, utm_content = EXCLUDED.utm_content,
    utm_term = EXCLUDED.utm_term, ad_id_meta = EXCLUDED.ad_id_meta,
    payload_webhook = EXCLUDED.payload_webhook, atualizado_em = now()
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

  -- O upsell chega depois da venda que o gerou, então a herança precisa rodar a cada
  -- evento: quando o pai chega primeiro, o filho herda na hora; quando chega depois,
  -- esta chamada corrige o filho que já estava gravado.
  PERFORM fn_herdar_origem_do_upsell();

  RETURN v_venda_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_overview(p_inicio timestamp with time zone, p_fim timestamp with time zone, p_segmento text DEFAULT 'misto'::text, p_conta uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_resultado jsonb;
  v_dia_ini date := (p_inicio AT TIME ZONE 'America/Sao_Paulo')::date;
  v_dia_fim date := (p_fim    AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  WITH periodo AS (
    SELECT v.*,
           -- Uma definição só, usada em todo o resto da função.
           (v.ad_id_meta IS NOT NULL OR coalesce(v.trafego_pago, false)) AS eh_trafego
    FROM vendas v
    WHERE v.pedido_id NOT LIKE 'TEST%'
      AND v.pedido_id NOT LIKE 'LC-%'
      AND (p_inicio IS NULL OR v.data_venda >= p_inicio)
      AND (p_fim    IS NULL OR v.data_venda <= p_fim)
  ),
  base AS (
    SELECT * FROM periodo v
    WHERE (p_conta IS NULL OR v.ad_account_id = p_conta)
      AND (
        p_segmento = 'misto'
        OR (p_segmento = 'trafego' AND v.eh_trafego)
        OR (p_segmento = 'backend' AND NOT v.eh_trafego)
      )
  ),
  aprovadas AS (
    SELECT * FROM base WHERE status = 'aprovada'
  ),
  principais AS (
    SELECT * FROM aprovadas WHERE coalesce(valor_oferta_principal, 0) > 0
  ),
  invest_conta AS (
    SELECT coalesce(sum(m.investimento), 0) AS total
    FROM metricas_meta m
    WHERE p_conta IS NOT NULL
      AND m.ad_account_id = p_conta
      AND m.nivel = 'campanha'
      AND m.data BETWEEN v_dia_ini AND v_dia_fim
  ),
  fiscal AS (
    SELECT
      coalesce(sum(f.reembolsos), 0)        AS reembolsos,
      coalesce(sum(f.imposto_simples), 0)   AS imposto_simples,
      coalesce(sum(f.imposto_meta_ads), 0)  AS imposto_meta,
      CASE WHEN p_conta IS NULL
           THEN coalesce(sum(f.investimento_meta), 0)
           ELSE (SELECT total FROM invest_conta) END AS investimento_meta,
      coalesce(max(f.simples_pct), 0)       AS simples_pct,
      coalesce(max(f.meta_pct), 0)          AS meta_pct,
      coalesce(max(f.custo_fixo), 0)        AS custo_fixo_mensal
    FROM vw_faturamento_liquido f
    WHERE (p_inicio IS NULL OR f.data >= v_dia_ini)
      AND (p_fim    IS NULL OR f.data <= v_dia_fim)
  )
  SELECT jsonb_build_object(
    'fat_bruto',   coalesce((SELECT sum(valor_total) FROM aprovadas), 0),
    'juros',       coalesce((SELECT sum(juros_parcelamento) FROM aprovadas), 0),
    'receita',     coalesce((SELECT sum(coalesce(valor_sem_juros, valor_total)) FROM aprovadas), 0),
    'receita_sem_upsell', coalesce((SELECT sum(coalesce(valor_sem_juros, valor_total))
                                      FROM aprovadas WHERE NOT coalesce(is_upsell, false)), 0),
    'taxa_plataforma', coalesce((SELECT sum(taxa_plataforma_valor) FROM aprovadas), 0),
    'qtd_aprovadas',   (SELECT count(*) FROM principais),
    'receita_backend', coalesce((SELECT sum(coalesce(valor_sem_juros, valor_total)) FROM aprovadas WHERE NOT eh_trafego), 0),
    'qtd_backend',     (SELECT count(*) FROM aprovadas WHERE NOT eh_trafego),

    'fat_bruto_total', coalesce((SELECT sum(valor_total) FROM periodo WHERE status = 'aprovada'), 0),
    'fiscal', (SELECT to_jsonb(f) FROM fiscal f),

    'sem_conta_resolvida', (SELECT count(*) FROM aprovadas WHERE eh_trafego AND ad_account_id IS NULL),

    'nao_aprovadas', coalesce((
      SELECT jsonb_object_agg(status::text, jsonb_build_object('qtd', qtd, 'valor', valor))
      FROM (
        SELECT status, count(*) AS qtd, sum(valor_total) AS valor
        FROM (
          SELECT DISTINCT ON (coalesce(cliente_id::text, pedido_id), coalesce(produto_nome, ''))
                 status, valor_total
          FROM base WHERE status IN ('pendente','cancelada','expirada')
          ORDER BY coalesce(cliente_id::text, pedido_id), coalesce(produto_nome, ''), data_venda DESC
        ) dedup
        GROUP BY status
      ) s
    ), '{}'::jsonb),

    -- Quantas das não aprovadas viraram venda depois. Mesma pessoa, mesmo produto,
    -- janela de 7 dias para os dois lados: cobre tanto quem tentou antes e pagou
    -- depois quanto quem pagou e teve uma tentativa falha registrada em seguida.
    'recuperadas', (
      SELECT coalesce(jsonb_build_object(
               'qtd',   count(*),
               'valor', coalesce(sum(n.valor_total), 0)
             ), '{}'::jsonb)
      FROM (
        SELECT DISTINCT ON (coalesce(cliente_id::text, pedido_id), coalesce(produto_nome, ''))
               cliente_id, produto_nome, valor_total, data_venda, status
        FROM base WHERE status IN ('pendente','cancelada','expirada')
        ORDER BY coalesce(cliente_id::text, pedido_id), coalesce(produto_nome, ''), data_venda DESC
      ) n
      WHERE EXISTS (
          SELECT 1 FROM vendas a
           WHERE a.status = 'aprovada'
             AND a.cliente_id IS NOT NULL
             AND a.cliente_id = n.cliente_id
             AND a.produto_nome IS NOT DISTINCT FROM n.produto_nome
             AND a.data_venda BETWEEN n.data_venda - interval '7 days'
                                  AND n.data_venda + interval '7 days'
        )
    ),

    'perdas', coalesce((
      SELECT jsonb_object_agg(status::text, jsonb_build_object('qtd', qtd, 'valor', valor))
      FROM (
        SELECT status, count(*) AS qtd,
               sum(fn_perda_da_venda(valor_total, valor_reembolsado)) AS valor
        FROM base WHERE status IN ('reembolsada','chargeback')
        GROUP BY status
      ) s
    ), '{}'::jsonb),

    'por_dia', coalesce((
      SELECT jsonb_agg(jsonb_build_object('dia', dia, 'faturamento', faturamento, 'vendas', vendas) ORDER BY dia)
      FROM (
        SELECT (data_venda AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
               sum(coalesce(valor_sem_juros, valor_total)) AS faturamento,
               count(*) AS vendas
        FROM principais GROUP BY 1
      ) d
    ), '[]'::jsonb),

    'por_produto', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'produto', produto, 'categoria', categoria,
               'vendas', vendas, 'faturamento_principal', fat_principal, 'ticket_medio', ticket
             ) ORDER BY vendas DESC)
      FROM (
        SELECT coalesce(produto_nome, produto::text, 'Sem produto') AS produto,
               coalesce(produto::text, '') AS categoria,
               count(*) AS vendas,
               sum(valor_oferta_principal) AS fat_principal,
               avg(coalesce(valor_sem_juros, valor_total)) AS ticket
        FROM principais WHERE NOT coalesce(is_upsell, false)
        GROUP BY 1, 2
      ) p
    ), '[]'::jsonb),

    'por_link', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'link', link, 'vendas', vendas, 'valor', valor, 'pct_rastreado', pct
             ) ORDER BY valor DESC)
      FROM (
        SELECT coalesce(link_titulo, '(sem link identificado)') AS link,
               count(*) AS vendas,
               sum(coalesce(valor_sem_juros, valor_total)) AS valor,
               100.0 * count(ad_id_meta) / nullif(count(*), 0) AS pct
        FROM principais WHERE NOT coalesce(is_upsell, false) GROUP BY 1
      ) l
    ), '[]'::jsonb),

    'por_origem', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'origem', origem, 'vendas', vendas, 'receita', receita
             ) ORDER BY receita DESC)
      FROM (
        SELECT CASE
                 WHEN coalesce(is_upsell, false) THEN 'Upsell (pós-checkout)'
                 ELSE coalesce(
                   nullif(regexp_replace(utm_source, 'jLj6[0-9a-f]+$', '', 'i'), ''),
                   '(sem origem)')
               END AS origem,
               count(*) AS vendas,
               sum(coalesce(valor_sem_juros, valor_total)) AS receita
        FROM aprovadas
        WHERE NOT eh_trafego
        GROUP BY 1
      ) o
    ), '[]'::jsonb),

    'upsells', coalesce((
      SELECT jsonb_agg(jsonb_build_object('nome', nome, 'qtd', qtd, 'receita', receita) ORDER BY qtd DESC)
      FROM (
        SELECT coalesce(produto_nome, 'Upsell') AS nome,
               count(*) AS qtd,
               sum(coalesce(valor_sem_juros, valor_total)) AS receita
        FROM aprovadas WHERE is_upsell
        GROUP BY 1
      ) u
    ), '[]'::jsonb),

    'qtd_upsells', (SELECT count(*) FROM aprovadas WHERE is_upsell),

    'order_bumps', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'nome', nome, 'tipo', tipo, 'qtd', qtd, 'receita', receita, 'vendas_com_ob', vendas_ob
             ) ORDER BY qtd DESC)
      FROM (
        SELECT vi.nome, vi.tipo::text AS tipo,
               count(*) AS qtd,
               sum(vi.valor) AS receita,
               count(DISTINCT vi.venda_id) AS vendas_ob
        FROM venda_itens vi
        JOIN aprovadas a ON a.id = vi.venda_id
        WHERE vi.converteu
        GROUP BY 1, 2
      ) o
    ), '[]'::jsonb),

    'vendas_com_ob', (
      SELECT count(DISTINCT vi.venda_id) FROM venda_itens vi
      JOIN aprovadas a ON a.id = vi.venda_id WHERE vi.converteu
    )
  ) INTO v_resultado;

  RETURN v_resultado;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_perda_da_venda(p_valor_total numeric, p_valor_reembolsado numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT coalesce(nullif(p_valor_reembolsado, 0), p_valor_total, 0);
$function$
;

CREATE OR REPLACE FUNCTION public.fn_preservar_produto_oferta()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Se produto novo é null mas já existe um produto cadastrado, preserva
  IF NEW.produto IS NULL AND OLD.produto IS NOT NULL THEN
    NEW.produto := OLD.produto;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_processar_venda_payt(p_vp vendas_payt)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_venda_id uuid;
  v_cliente  uuid;
  v_data     timestamptz;
  v_nome     text;
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

  v_cliente := fn_resolver_cliente(p_vp.cliente_email, p_vp.cliente_nome, NULL, v_data);
  IF v_cliente IS NOT NULL THEN
    UPDATE vendas SET cliente_id = v_cliente WHERE id = v_venda_id AND cliente_id IS DISTINCT FROM v_cliente;
    PERFORM fn_marcar_upsell_por_sessao(v_venda_id);
  END IF;

  RETURN v_venda_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_processar_windsor_staging()
 RETURNS TABLE(processados integer, erros integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
  r         windsor_meta_staging%ROWTYPE;
  v_account_id  uuid;
  v_campanha_id text;
  v_adset_id    text;
  v_updated     int;
  v_processados int := 0;
  v_erros       int := 0;

  v_cliques_link      int8;
  v_cliques           int8;
  v_video_3s          int8;
  v_video_75          int8;
  v_compras           numeric;
  v_faturamento       numeric;
  v_initiate_checkout int8;
  v_landing_page      int8;
  v_add_to_cart       int8;
  v_campaign_name     text;
BEGIN
  FOR r IN
    SELECT * FROM windsor_meta_staging WHERE processado = false
  LOOP
    BEGIN
      SELECT id INTO v_account_id
      FROM ad_accounts
      WHERE (account_id = r.account_id OR account_id = 'act_' || r.account_id)
        AND ativo = true
      LIMIT 1;

      IF v_account_id IS NULL THEN
        UPDATE windsor_meta_staging SET processado = true, erro = 'account_id não encontrado: ' || COALESCE(r.account_id,'NULL')
        WHERE date = r.date AND ad_id = r.ad_id;
        v_erros := v_erros + 1;
        CONTINUE;
      END IF;

      v_campanha_id   := COALESCE(NULLIF(r.campaign_id,''), 'windsor_sem_hierarquia');
      v_adset_id      := COALESCE(NULLIF(r.adset_id,''), 'windsor_sem_hierarquia');
      v_campaign_name := COALESCE(r.campaign, r.campaign_name);

      v_cliques_link      := COALESCE(r.unique_actions_link_click, r.unique_link_clicks);
      v_cliques           := COALESCE(r.unique_clicks, r.clicks);
      -- cast via numeric para suportar "1.0" (texto float do Windsor)
      v_video_3s          := COALESCE(r.video_p3_watched_actions_video_view::numeric::int8,
                                       r.video_3_second_views,
                                       r.actions_video_view::numeric::int8);
      v_video_75          := COALESCE(r.video_p75_watched_actions_video_view::numeric::int8,
                                       r.video_thruplay_watched_actions_video_view::numeric::int8);
      v_compras           := COALESCE(r.actions_offsite_conversion_fb_pixel_purchase::numeric,
                                       r.actions_purchase::numeric);
      v_faturamento       := COALESCE(r.action_values_omni_purchase, r.action_values_purchase);
      v_initiate_checkout := COALESCE(r.actions_offsite_conversion_fb_pixel_initiate_checkout::numeric::int8,
                                       r.actions_initiate_checkout::numeric::int8);
      v_landing_page      := r.actions_landing_page_view::numeric::int8;
      v_add_to_cart       := r.actions_add_to_cart::numeric::int8;

      UPDATE metricas_meta SET
        ad_nome               = r.ad_name,
        investimento          = COALESCE(r.spend, 0),
        impressoes            = COALESCE(r.impressions, 0),
        cliques               = COALESCE(v_cliques, 0),
        cliques_link          = COALESCE(v_cliques_link, 0),
        ctr                   = COALESCE(r.unique_link_clicks_ctr::numeric, r.ctr::numeric),
        cpm                   = COALESCE(r.cpm, 0),
        cpc                   = COALESCE(r.cpc, 0),
        video_plays           = COALESCE(r.actions_video_view::numeric::int8, 0),
        video_3s              = COALESCE(v_video_3s, 0),
        video_75pct           = COALESCE(v_video_75, 0),
        compras_meta          = COALESCE(v_compras, 0),
        faturamento_atribuido = COALESCE(v_faturamento, 0),
        visualizacoes_pagina  = COALESCE(v_landing_page, 0),
        initiate_checkout     = COALESCE(v_initiate_checkout, 0),
        add_to_cart           = COALESCE(v_add_to_cart, 0),
        campanha_id           = CASE WHEN campanha_id = 'windsor_sem_hierarquia' AND v_campanha_id != 'windsor_sem_hierarquia' THEN v_campanha_id ELSE campanha_id END,
        campanha_nome         = COALESCE(v_campaign_name, campanha_nome),
        adset_id              = CASE WHEN adset_id = 'windsor_sem_hierarquia' AND v_adset_id != 'windsor_sem_hierarquia' THEN v_adset_id ELSE adset_id END,
        adset_nome            = COALESCE(r.adset_name, adset_nome),
        atualizado_em         = now()
      WHERE data = r.date
        AND ad_account_id = v_account_id
        AND nivel = 'ad'
        AND ad_id = r.ad_id;

      GET DIAGNOSTICS v_updated = ROW_COUNT;

      IF v_updated = 0 THEN
        INSERT INTO metricas_meta (
          data, nivel, ad_account_id,
          campanha_id, campanha_nome, adset_id, adset_nome,
          ad_id, ad_nome,
          investimento, impressoes, cliques, cliques_link,
          ctr, cpm, cpc,
          video_plays, video_3s, video_75pct,
          compras_meta, faturamento_atribuido,
          visualizacoes_pagina, initiate_checkout, add_to_cart
        ) VALUES (
          r.date, 'ad', v_account_id,
          v_campanha_id, v_campaign_name, v_adset_id, r.adset_name,
          r.ad_id, r.ad_name,
          COALESCE(r.spend, 0), COALESCE(r.impressions, 0),
          COALESCE(v_cliques, 0), COALESCE(v_cliques_link, 0),
          COALESCE(r.unique_link_clicks_ctr::numeric, r.ctr::numeric),
          COALESCE(r.cpm, 0), COALESCE(r.cpc, 0),
          COALESCE(r.actions_video_view::numeric::int8, 0),
          COALESCE(v_video_3s, 0), COALESCE(v_video_75, 0),
          COALESCE(v_compras, 0), COALESCE(v_faturamento, 0),
          COALESCE(v_landing_page, 0), COALESCE(v_initiate_checkout, 0),
          COALESCE(v_add_to_cart, 0)
        );
      END IF;

      UPDATE windsor_meta_staging SET processado = true, erro = null
      WHERE date = r.date AND ad_id = r.ad_id;
      v_processados := v_processados + 1;

    EXCEPTION WHEN OTHERS THEN
      UPDATE windsor_meta_staging SET processado = true, erro = SQLERRM
      WHERE date = r.date AND ad_id = r.ad_id;
      v_erros := v_erros + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT v_processados, v_erros;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_produto_derivado(p_dias integer DEFAULT 60)
 RETURNS TABLE(conta_id uuid, produtos jsonb, total integer)
 LANGUAGE sql
 STABLE
AS $function$
  WITH por_produto AS (
    SELECT v.ad_account_id, v.produto_nome, count(*) AS n
      FROM vendas v
     WHERE v.status = 'aprovada'
       AND v.ad_account_id IS NOT NULL
       AND v.ad_id_meta IS NOT NULL
       AND coalesce(v.is_upsell, false) = false
       AND v.produto_nome IS NOT NULL AND v.produto_nome <> ''
       AND v.data_venda >= current_date - p_dias
     GROUP BY v.ad_account_id, v.produto_nome
  )
  SELECT ad_account_id,
         jsonb_agg(jsonb_build_object('produto', produto_nome, 'vendas', n) ORDER BY n DESC),
         sum(n)::integer
    FROM por_produto
   GROUP BY ad_account_id;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_resolver_cliente(p_email text, p_nome text, p_telefone text, p_data timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_id    uuid;
  v_email text := lower(nullif(trim(p_email), ''));
BEGIN
  IF v_email IS NULL THEN RETURN NULL; END IF;

  SELECT id INTO v_id
    FROM clientes
   WHERE lower(trim(email)) = v_email
   ORDER BY criado_em NULLS LAST
   LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO clientes (email, nome, telefone, primeira_compra, ultima_compra)
    VALUES (v_email, nullif(trim(p_nome), ''), nullif(trim(p_telefone), ''), p_data, p_data)
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_resolver_conta_das_vendas()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare
  v_afetadas integer;
begin
  with mapa as (
    select distinct on (ad_id) ad_id, ad_account_id
    from metricas_meta
    where nivel = 'ad' and ad_id is not null and ad_account_id is not null
  )
  update vendas v
     set ad_account_id = m.ad_account_id
    from mapa m
   where v.ad_id_meta = m.ad_id
     and v.ad_account_id is null;

  get diagnostics v_afetadas = row_count;
  return v_afetadas;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_tendencias(p_ini date, p_fim date, p_dias_ant integer DEFAULT NULL::integer)
 RETURNS TABLE(conta_id uuid, conta text, produto text, metrica text, atual numeric, anterior numeric, variacao_pct numeric, ruido_pct numeric, direcao text, dias_atual integer, dias_anterior integer, meta numeric, meta_direcao text, serie numeric[], serie_corte integer)
 LANGUAGE sql
 STABLE
AS $function$
  WITH j AS (
    SELECT p_ini AS ini_atual, p_fim AS fim_atual,
           (p_ini - coalesce(p_dias_ant, (p_fim - p_ini + 1))) AS ini_ant,
           (p_ini - 1)                                          AS fim_ant,
           least(p_fim - 60,
                 p_ini - coalesce(p_dias_ant, (p_fim - p_ini + 1))) AS ini_base
  ),
  dia AS (
    SELECT a.id AS conta_id, a.nome AS conta, a.produto::text AS produto,
           a.roas_meta, a.cpa_meta, m.data,
           sum(m.investimento)          AS gasto,
           sum(m.impressoes)            AS impressoes,
           sum(m.cliques)               AS cliques,
           sum(m.cliques_link)          AS cliques_link,
           sum(m.visualizacoes_pagina)  AS visualizacoes,
           sum(m.initiate_checkout)     AS checkouts,
           sum(m.video_3s)              AS video_3s,
           -- Receita inclui upsell: é dinheiro que a conta trouxe.
           coalesce((
             SELECT sum(coalesce(v.valor_sem_juros, v.valor_total)) FROM vendas v
              WHERE v.ad_account_id = a.id AND v.status = 'aprovada'
                AND (v.data_venda AT TIME ZONE 'America/Sao_Paulo')::date = m.data
           ), 0) AS receita,
           -- AOV olha só a compra inicial.
           coalesce((
             SELECT sum(coalesce(v.valor_sem_juros, v.valor_total)) FROM vendas v
              WHERE v.ad_account_id = a.id AND v.status = 'aprovada'
                AND NOT coalesce(v.is_upsell, false)
                AND (v.data_venda AT TIME ZONE 'America/Sao_Paulo')::date = m.data
           ), 0) AS receita_sem_upsell,
           -- Pedidos: upsell do mesmo carrinho não é cliente novo.
           coalesce((
             SELECT count(*) FROM vendas v
              WHERE v.ad_account_id = a.id AND v.status = 'aprovada'
                AND NOT coalesce(v.is_upsell, false)
                AND (v.data_venda AT TIME ZONE 'America/Sao_Paulo')::date = m.data
           ), 0) AS pedidos
      FROM metricas_meta m
      JOIN ad_accounts a ON a.id = m.ad_account_id
      CROSS JOIN j
     WHERE m.nivel = 'campanha' AND m.data BETWEEN j.ini_base AND j.fim_atual
     GROUP BY a.id, a.nome, a.produto, a.roas_meta, a.cpa_meta, m.data
    HAVING sum(m.investimento) > 0
  ),
  -- (numerador, denominador) por dia. Aditivas levam denominador 1.
  medida AS (
    SELECT conta_id, conta, produto, data, 'ROAS'::text AS metrica,
           receita AS num, gasto AS den, roas_meta AS meta, 'piso'::text AS dir FROM dia
    UNION ALL SELECT conta_id, conta, produto, data, 'AOV',          receita_sem_upsell, pedidos, NULL, NULL FROM dia
    UNION ALL SELECT conta_id, conta, produto, data, 'Receita',      receita, 1, NULL, NULL FROM dia
    UNION ALL SELECT conta_id, conta, produto, data, 'Vendas',       pedidos, 1, NULL, NULL FROM dia
    UNION ALL SELECT conta_id, conta, produto, data, 'Investimento', gasto,   1, NULL, NULL FROM dia
    UNION ALL SELECT conta_id, conta, produto, data, 'CPA',          gasto, pedidos, cpa_meta, 'teto' FROM dia
    UNION ALL SELECT conta_id, conta, produto, data, 'CPM',          gasto*1000, impressoes, NULL, NULL FROM dia
    UNION ALL SELECT conta_id, conta, produto, data, 'CPC',          gasto, cliques, NULL, NULL FROM dia
    UNION ALL SELECT conta_id, conta, produto, data, 'CTR',          cliques*100, impressoes, NULL, NULL FROM dia
    UNION ALL SELECT conta_id, conta, produto, data, 'Hook (3s)',    video_3s*100, impressoes, NULL, NULL FROM dia
    UNION ALL SELECT conta_id, conta, produto, data, 'Conexão da página',
                     visualizacoes*100, cliques_link, NULL, NULL FROM dia
    UNION ALL SELECT conta_id, conta, produto, data, 'Conversão do checkout',
                     pedidos*100, checkouts, NULL, NULL FROM dia
  ),
  agregado AS (
    SELECT m.conta_id, m.conta, m.produto, m.metrica,
           max(m.meta) AS meta, max(m.dir) AS dir,
           sum(m.num) FILTER (WHERE m.data BETWEEN j.ini_atual AND j.fim_atual)
             / nullif(sum(m.den) FILTER (WHERE m.data BETWEEN j.ini_atual AND j.fim_atual), 0) AS med_atual,
           sum(m.num) FILTER (WHERE m.data BETWEEN j.ini_ant AND j.fim_ant)
             / nullif(sum(m.den) FILTER (WHERE m.data BETWEEN j.ini_ant AND j.fim_ant), 0)     AS med_ant,
           stddev_samp(m.num / nullif(m.den, 0)) FILTER (
             WHERE m.data BETWEEN j.ini_ant AND j.fim_atual) AS desvio_janela,
           stddev_samp(m.num / nullif(m.den, 0))             AS desvio_base,
           count(m.num / nullif(m.den, 0))                   AS n_base,
           count(*) FILTER (WHERE m.data BETWEEN j.ini_atual AND j.fim_atual) AS n_atual,
           count(*) FILTER (WHERE m.data BETWEEN j.ini_ant   AND j.fim_ant)   AS n_ant,
           array_agg(round(m.num / m.den, 4) ORDER BY m.data) FILTER (
             WHERE m.data BETWEEN j.ini_ant AND j.fim_atual
               AND m.den IS NOT NULL AND m.den <> 0)          AS serie,
           count(*) FILTER (
             WHERE m.data BETWEEN j.ini_ant AND j.fim_ant
               AND m.den IS NOT NULL AND m.den <> 0)          AS serie_corte
      FROM medida m CROSS JOIN j
     GROUP BY m.conta_id, m.conta, m.produto, m.metrica
  ),
  final AS (
    SELECT *, coalesce(CASE WHEN n_atual + n_ant >= 6 THEN desvio_janela END, desvio_base) AS desvio
      FROM agregado
  )
  SELECT
    conta_id, conta, produto, metrica,
    round(med_atual, 2), round(med_ant, 2),
    round(100.0 * (med_atual - med_ant) / nullif(abs(med_ant), 0), 1),
    round(100.0 * 2 * desvio * sqrt(1.0/nullif(n_atual,0) + 1.0/nullif(n_ant,0))
          / nullif(abs(med_ant), 0), 1),
    CASE
      WHEN n_base < 8 OR n_atual < 1 OR n_ant < 1 THEN 'sem base'
      WHEN med_ant IS NULL OR med_ant = 0 OR desvio IS NULL THEN 'sem base'
      WHEN abs(med_atual - med_ant) <= 2 * desvio * sqrt(1.0/n_atual + 1.0/n_ant)
        THEN 'estável'
      WHEN med_atual > med_ant THEN 'alta'
      ELSE 'queda'
    END,
    n_atual::integer, n_ant::integer, meta, dir,
    serie, serie_corte::integer
  FROM final
  WHERE med_atual IS NOT NULL OR med_ant IS NOT NULL;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_ultima_execucao_cron(p_jobname text)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'cron', 'pg_temp'
AS $function$
  select max(d.start_time)
    from cron.job j
    join cron.job_run_details d on d.jobid = j.jobid
   where j.jobname = p_jobname and d.status = 'succeeded';
$function$
;

CREATE OR REPLACE FUNCTION public.fn_update_funis_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.perfis (id, nome, is_admin)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_current_user_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select is_admin from public.perfis where id = auth.uid()),
    false
  );
$function$
;

CREATE OR REPLACE FUNCTION public.listar_usuarios()
 RETURNS TABLE(id uuid, email text, nome text, is_admin boolean, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    au.id,
    au.email,
    coalesce(p.nome, split_part(au.email, '@', 1)) as nome,
    coalesce(p.is_admin, false) as is_admin,
    au.created_at
  from auth.users au
  left join public.perfis p on p.id = au.id
  where public.is_current_user_admin()
  order by au.created_at;
$function$
;

CREATE OR REPLACE FUNCTION public.mapear_produto_por_nome(p_nome text)
 RETURNS produto_tipo
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  n TEXT := LOWER(UNACCENT(COALESCE(p_nome, '')));
BEGIN
  IF n LIKE '%vela%'   OR n LIKE '%aromatiz%' OR n LIKE '%difusor%'  THEN RETURN 'velas';      END IF;
  IF n LIKE '%sapon%'  OR n LIKE '%sabao%'    OR n LIKE '%sabonete%' THEN RETURN 'saponaria';   END IF;
  IF n LIKE '%cosmet%' OR n LIKE '%beleza%'   OR n LIKE '%pele%'
  OR n LIKE '%skin%'   OR n LIKE '%dermato%'                          THEN RETURN 'cosmeticos';  END IF;
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_fn_assinatura()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.assinatura_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status = 'aprovada' AND (TG_OP = 'INSERT' OR OLD.status <> 'aprovada') THEN
    UPDATE assinaturas SET
      parcelas_pagas   = parcelas_pagas + 1,
      total_recebido   = total_recebido + NEW.valor_total,
      ultima_renovacao = COALESCE(NEW.data_aprovacao, NOW()),
      atualizado_em    = NOW()
    WHERE id = NEW.assinatura_id;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_fn_cliente()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.cliente_id IS NULL THEN RETURN NEW; END IF;

  -- Nova aprovação — atualiza apenas as datas (total_pedidos/gasto agora são calculados nas views)
  IF NEW.status = 'aprovada' AND (TG_OP = 'INSERT' OR OLD.status <> 'aprovada') THEN
    UPDATE clientes SET
      primeira_compra = LEAST(COALESCE(primeira_compra, NEW.data_venda), NEW.data_venda),
      ultima_compra   = GREATEST(COALESCE(ultima_compra, NEW.data_venda), NEW.data_venda),
      atualizado_em   = NOW()
    WHERE id = NEW.cliente_id;

  -- Aprovação revertida — só atualiza data
  ELSIF NEW.status IN ('reembolsada','chargeback') AND OLD.status = 'aprovada' THEN
    UPDATE clientes SET
      atualizado_em = NOW()
    WHERE id = NEW.cliente_id;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_fn_marcar_trafego_sem_utm()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.ad_id_meta is null
     and new.link_titulo is not null
     and exists (select 1 from links_trafego_sem_utm l where l.link_titulo = new.link_titulo)
  then
    new.trafego_pago := true;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_fn_normalizar_venda_payt()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  BEGIN
    PERFORM fn_processar_venda_payt(NEW);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Falha ao normalizar venda %: %', NEW.payt_id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_fn_origem()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.origem := CASE
    WHEN NEW.ad_id_meta IS NOT NULL THEN 'pago'::origem_venda
    ELSE calcular_origem(NEW.utm_source, NEW.utm_medium)
  END;
  NEW.atualizado_em := NOW();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_fn_prejuizo()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.valor_pago_plataforma IS NOT NULL AND NEW.valor_reembolsado IS NOT NULL THEN
    NEW.prejuizo_parcelamento := GREATEST(NEW.valor_pago_plataforma - NEW.valor_reembolsado, 0);
  ELSE
    NEW.prejuizo_parcelamento := 0;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_fn_resolver_conta()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  perform fn_resolver_conta_das_vendas();
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.unaccent(text)
 RETURNS text
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/unaccent', $function$unaccent_dict$function$
;

CREATE OR REPLACE FUNCTION public.unaccent(regdictionary, text)
 RETURNS text
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/unaccent', $function$unaccent_dict$function$
;

CREATE OR REPLACE FUNCTION public.unaccent_init(internal)
 RETURNS internal
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/unaccent', $function$unaccent_init$function$
;

CREATE OR REPLACE FUNCTION public.unaccent_lexize(internal, internal, internal, internal)
 RETURNS internal
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/unaccent', $function$unaccent_lexize$function$
;

CREATE OR REPLACE FUNCTION public.update_copy_rotina_atualizado_em()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END; $function$
;