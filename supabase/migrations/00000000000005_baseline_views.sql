-- BASELINE — views
--
-- Depende das tabelas e das funções (várias views chamam funções).
-- As cinco `vw_vendas_*` e a `vw_ingest_health` já refletem as correções de
-- 23 e 24/08/2026, descritas nas migrations daquelas datas.

create or replace view public.vw_alertas as
 SELECT 'fonte_parada'::text AS codigo,
        CASE
            WHEN h.horas_atras > (h.limiar_horas * 4::numeric) THEN 'critico'::text
            ELSE 'atencao'::text
        END AS severidade,
    h.rotulo || ' sem atualizar'::text AS titulo,
    'Última entrada há '::text ||
        CASE
            WHEN h.horas_atras < 48::numeric THEN round(h.horas_atras)::text || 'h'::text
            ELSE round(h.horas_atras / 24::numeric)::text || ' dias'::text
        END AS detalhe
   FROM vw_ingest_health h
  WHERE h.defasado
UNION ALL
 SELECT 'conta_sem_produto'::text AS codigo,
    'critico'::text AS severidade,
    count(*)::text || ' conta(s) de anúncio gastando sem produto definido'::text AS titulo,
    (fn_brl(sum(x.gasto)) || ' nos últimos 7 dias não entram no cálculo: '::text) || string_agg(x.nome, ', '::text) AS detalhe
   FROM ( SELECT a.nome,
            sum(m.investimento) AS gasto
           FROM metricas_meta m
             JOIN ad_accounts a ON a.id = m.ad_account_id
          WHERE m.nivel = 'campanha'::nivel_meta AND m.data >= ((now() AT TIME ZONE 'America/Sao_Paulo'::text)::date - 7) AND a.produto IS NULL
          GROUP BY a.nome
         HAVING sum(m.investimento) > 0::numeric) x
 HAVING count(*) > 0
UNION ALL
 SELECT 'receita_sem_rastreio'::text AS codigo,
        CASE
            WHEN y.pct > 40::numeric THEN 'critico'::text
            ELSE 'atencao'::text
        END AS severidade,
    round(y.pct)::text || '% da receita de origem desconhecida'::text AS titulo,
    fn_brl(y.valor) || ' nos últimos 7 dias não vieram de anúncio rastreado nem de origem já identificada'::text AS detalhe
   FROM ( SELECT 100.0 * sum(vendas.valor_sem_juros) FILTER (WHERE vendas.ad_id_meta IS NULL AND vendas.trafego_pago IS NOT TRUE) / NULLIF(sum(vendas.valor_sem_juros), 0::numeric) AS pct,
            sum(vendas.valor_sem_juros) FILTER (WHERE vendas.ad_id_meta IS NULL AND vendas.trafego_pago IS NOT TRUE) AS valor
           FROM vendas
          WHERE vendas.status = 'aprovada'::status_venda AND vendas.is_upsell IS NOT TRUE AND (vendas.data_venda AT TIME ZONE 'America/Sao_Paulo'::text)::date >= ((now() AT TIME ZONE 'America/Sao_Paulo'::text)::date - 7)) y
  WHERE y.pct > 25::numeric
UNION ALL
 SELECT 'meta_divergente'::text AS codigo,
    'critico'::text AS severidade,
    'Meta reporta mais conversões do que houve vendas'::text AS titulo,
    ((('Meta: '::text || z.meta::text) || ' conversões · Payt: '::text) || z.total::text) || ' vendas no total nos últimos 7 dias. Sinal de contagem duplicada.'::text AS detalhe
   FROM ( SELECT ( SELECT COALESCE(sum(metricas_meta.compras_meta), 0::bigint) AS "coalesce"
                   FROM metricas_meta
                  WHERE metricas_meta.nivel = 'campanha'::nivel_meta AND metricas_meta.data >= ((now() AT TIME ZONE 'America/Sao_Paulo'::text)::date - 7)) AS meta,
            ( SELECT count(*) AS count
                   FROM vendas
                  WHERE vendas.status = 'aprovada'::status_venda AND (vendas.data_venda AT TIME ZONE 'America/Sao_Paulo'::text)::date >= ((now() AT TIME ZONE 'America/Sao_Paulo'::text)::date - 7)) AS total) z
  WHERE z.total > 0 AND (z.meta::numeric / z.total::numeric) > 1.5
UNION ALL
 SELECT fn_alerta_venda_sem_categoria.codigo,
    fn_alerta_venda_sem_categoria.severidade,
    fn_alerta_venda_sem_categoria.titulo,
    fn_alerta_venda_sem_categoria.detalhe
   FROM fn_alerta_venda_sem_categoria() fn_alerta_venda_sem_categoria(codigo, severidade, titulo, detalhe)
UNION ALL
 SELECT 'webhook_nao_processado'::text AS codigo,
    'critico'::text AS severidade,
    count(*)::text || ' evento(s) da Payt recebidos e não virados venda'::text AS titulo,
    'Nas últimas 48h. Motivo mais comum: '::text || mode() WITHIN GROUP (ORDER BY (COALESCE(payt_webhook_raw.motivo, 'sem motivo registrado'::text))) AS detalhe
   FROM payt_webhook_raw
  WHERE NOT payt_webhook_raw.processado AND COALESCE(payt_webhook_raw.motivo, ''::text) <> 'pedido de teste'::text AND payt_webhook_raw.recebido_em >= (now() - '48:00:00'::interval)
 HAVING count(*) > 0
UNION ALL
 SELECT 'venda_sem_liquido'::text AS codigo,
    'atencao'::text AS severidade,
    count(*)::text || ' venda(s) sem o líquido do produtor'::text AS titulo,
    fn_brl(sum(vendas.valor_sem_juros)) || ' nos últimos 7 dias: a Payt mandou a comissão zerada, então o valor a receber fica de fora das somas'::text AS detalhe
   FROM vendas
  WHERE vendas.status = 'aprovada'::status_venda AND vendas.valor_liquido_produtor IS NULL AND (vendas.data_venda AT TIME ZONE 'America/Sao_Paulo'::text)::date >= ((now() AT TIME ZONE 'America/Sao_Paulo'::text)::date - 7)
 HAVING count(*) > 0
UNION ALL
 SELECT 'venda_nao_normalizada'::text AS codigo,
    'critico'::text AS severidade,
    count(*)::text || ' venda(s) recebidas da Payt que não viraram registro'::text AS titulo,
    fn_brl(sum(p.valor)) || ' nos últimos 7 dias estão na camada bruta mas não em vendas'::text AS detalhe
   FROM vendas_payt p
  WHERE p.status = 'paid'::text AND p.data >= ((now() AT TIME ZONE 'America/Sao_Paulo'::text)::date - 7) AND NOT (EXISTS ( SELECT 1
           FROM vendas v
          WHERE v.pedido_id = p.payt_id))
 HAVING count(*) > 0
UNION ALL
 SELECT fn_alerta_conta_sem_venda.codigo,
    fn_alerta_conta_sem_venda.severidade,
    fn_alerta_conta_sem_venda.titulo,
    fn_alerta_conta_sem_venda.detalhe
   FROM fn_alerta_conta_sem_venda() fn_alerta_conta_sem_venda(codigo, severidade, titulo, detalhe)
UNION ALL
 SELECT fn_alerta_cron_falhando.codigo,
    fn_alerta_cron_falhando.severidade,
    fn_alerta_cron_falhando.titulo,
    fn_alerta_cron_falhando.detalhe
   FROM fn_alerta_cron_falhando() fn_alerta_cron_falhando(codigo, severidade, titulo, detalhe)
UNION ALL
 SELECT fn_alerta_remendo_utm_resolvido.codigo,
    fn_alerta_remendo_utm_resolvido.severidade,
    fn_alerta_remendo_utm_resolvido.titulo,
    fn_alerta_remendo_utm_resolvido.detalhe
   FROM fn_alerta_remendo_utm_resolvido() fn_alerta_remendo_utm_resolvido(codigo, severidade, titulo, detalhe);

create or replace view public.vw_assinaturas_resumo as
 SELECT produto,
    plano_nome,
    utm_source,
    utm_campaign,
    count(*) FILTER (WHERE status = 'ativa'::status_assinatura) AS ativas,
    count(*) FILTER (WHERE status = 'cancelada'::status_assinatura) AS canceladas,
    count(*) FILTER (WHERE status = 'inadimplente'::status_assinatura) AS inadimplentes,
    count(*) FILTER (WHERE status = 'trial'::status_assinatura) AS em_trial,
    count(*) AS total,
    round(count(*) FILTER (WHERE status = 'cancelada'::status_assinatura)::numeric / NULLIF(count(*), 0)::numeric * 100::numeric, 2) AS churn_rate_pct,
    round(sum(plano_preco) FILTER (WHERE status = 'ativa'::status_assinatura) * 30.0 / NULLIF(avg(ciclo_dias) FILTER (WHERE status = 'ativa'::status_assinatura), 0::numeric), 2) AS mrr_estimado,
    round(avg(parcelas_pagas), 1) AS media_parcelas_pagas,
    sum(total_recebido) AS total_recebido
   FROM assinaturas
  GROUP BY produto, plano_nome, utm_source, utm_campaign;

create or replace view public.vw_churn_mensal as
 SELECT to_char(data_cancelamento, 'YYYY-MM'::text) AS mes,
    produto,
    plano_nome,
    motivo_cancelamento,
    count(*) AS cancelamentos,
    sum(total_recebido) AS receita_gerada
   FROM assinaturas
  WHERE data_cancelamento IS NOT NULL
  GROUP BY (to_char(data_cancelamento, 'YYYY-MM'::text)), produto, plano_nome, motivo_cancelamento;

create or replace view public.vw_clientes_listagem as
 SELECT c.id,
    c.cpf_hash,
    c.nome,
    c.email,
    c.telefone,
    c.fake_email,
    c.primeira_compra,
    c.ultima_compra,
    c.cohort_semana,
    c.cohort_mes,
    count(v.id) FILTER (WHERE v.status = 'aprovada'::status_venda) AS total_pedidos,
    COALESCE(sum(v.valor_total) FILTER (WHERE v.status = 'aprovada'::status_venda), 0::numeric) AS total_gasto,
    c.criado_em
   FROM clientes c
     LEFT JOIN vendas v ON v.cliente_id = c.id
  GROUP BY c.id;

create or replace view public.vw_cohort_retencao as
 SELECT c.cohort_mes,
    count(DISTINCT c.id) AS total_clientes,
    count(DISTINCT v.cliente_id) FILTER (WHERE v.status = 'aprovada'::status_venda) AS clientes_com_compra
   FROM clientes c
     LEFT JOIN vendas v ON v.cliente_id = c.id
  GROUP BY c.cohort_mes
  ORDER BY c.cohort_mes;

create or replace view public.vw_comparativo_periodos as
 SELECT semana_iso,
    mes_ano,
    produto,
    origem,
    count(*) FILTER (WHERE status = 'aprovada'::status_venda) AS vendas,
    sum(valor_total) FILTER (WHERE status = 'aprovada'::status_venda) AS faturamento,
    avg(valor_total) FILTER (WHERE status = 'aprovada'::status_venda) AS ticket_medio,
    count(*) FILTER (WHERE status = 'pendente'::status_venda) AS pendentes,
    count(*) FILTER (WHERE status = ANY (ARRAY['reembolsada'::status_venda, 'chargeback'::status_venda])) AS reembolsos
   FROM vendas
  GROUP BY semana_iso, mes_ano, produto, origem;

create or replace view public.vw_conversao_obs as
 WITH vendas_por_produto AS (
         SELECT vendas.produto::text AS produto,
            count(*) AS total_vendas_produto
           FROM vendas
          WHERE vendas.status = 'aprovada'::status_venda AND vendas.upsell_de IS NULL AND vendas.pedido_id !~~ 'TEST%'::text AND vendas.pedido_id !~~ 'LC-%'::text
          GROUP BY vendas.produto
        )
 SELECT o.code_payt,
    o.nome AS nome_ob,
    o.produto::text AS produto,
    o.tipo AS tipo_ob,
    count(vi.id) AS total_convertidos,
    count(DISTINCT vi.venda_id) AS vendas_com_ob,
    COALESCE(sum(vi.valor), 0::numeric) AS receita_total_ob,
    round(avg(vi.valor), 2) AS ticket_medio_ob,
    round(count(DISTINCT vi.venda_id)::numeric / NULLIF(vpp.total_vendas_produto, 0)::numeric * 100::numeric, 2) AS taxa_conversao_pct
   FROM ofertas o
     JOIN venda_itens vi ON vi.code_payt = o.code_payt AND vi.converteu = true
     LEFT JOIN vendas_por_produto vpp ON vpp.produto = o.produto::text
  WHERE o.tipo = ANY (ARRAY['orderbump_1'::tipo_item_venda, 'orderbump_2'::tipo_item_venda, 'orderbump_3'::tipo_item_venda, 'orderbump_4'::tipo_item_venda])
  GROUP BY o.id, o.code_payt, o.nome, o.produto, o.tipo, vpp.total_vendas_produto
 HAVING count(vi.id) > 0;

create or replace view public.vw_conversao_upsell as
 WITH vendas_por_produto AS (
         SELECT vendas.produto::text AS produto,
            count(*) AS total_vendas_produto
           FROM vendas
          WHERE vendas.status = 'aprovada'::status_venda AND (vendas.is_upsell IS NULL OR vendas.is_upsell = false) AND vendas.pedido_id !~~ 'TEST%'::text AND vendas.pedido_id !~~ 'LC-%'::text
          GROUP BY vendas.produto
        ), upsells_reais AS (
         SELECT v.produto::text AS produto,
            o.nome AS nome_upsell,
            o.code_payt,
            count(
                CASE
                    WHEN v.status = 'aprovada'::status_venda THEN 1
                    ELSE NULL::integer
                END) AS total_upsells,
            sum(
                CASE
                    WHEN v.status = 'aprovada'::status_venda THEN v.valor_total
                    ELSE 0::numeric
                END) AS receita_total,
            avg(
                CASE
                    WHEN v.status = 'aprovada'::status_venda THEN v.valor_total
                    ELSE NULL::numeric
                END) AS ticket_medio
           FROM vendas v
             LEFT JOIN ofertas o ON o.code_payt = ((v.payload_webhook -> 'product'::text) ->> 'code'::text)
          WHERE v.is_upsell = true AND v.pedido_id !~~ 'TEST%'::text AND v.pedido_id !~~ 'LC-%'::text AND o.tipo = 'upsell'::tipo_item_venda
          GROUP BY v.produto, o.nome, o.code_payt
        )
 SELECT u.code_payt,
    COALESCE(u.nome_upsell, 'Upsell '::text || u.produto) AS nome_upsell,
    u.produto,
    u.total_upsells,
    u.receita_total,
    round(u.ticket_medio, 2) AS ticket_medio,
    round(u.total_upsells::numeric / NULLIF(vpp.total_vendas_produto, 0)::numeric * 100::numeric, 2) AS taxa_conversao_pct
   FROM upsells_reais u
     LEFT JOIN vendas_por_produto vpp ON vpp.produto = u.produto
  WHERE u.total_upsells > 0;

create or replace view public.vw_faturamento_liquido as
 WITH cfg AS (
         SELECT max(
                CASE
                    WHEN configuracoes.chave = 'imposto_simples_nacional_pct'::text THEN configuracoes.valor::numeric
                    ELSE 0::numeric
                END) AS simples_pct,
            max(
                CASE
                    WHEN configuracoes.chave = 'imposto_meta_ads_pct'::text THEN configuracoes.valor::numeric
                    ELSE 0::numeric
                END) AS meta_pct,
            max(
                CASE
                    WHEN configuracoes.chave = 'custo_fixo_mensal'::text THEN configuracoes.valor::numeric
                    ELSE 0::numeric
                END) AS custo_fixo
           FROM configuracoes
        ), vendas_base AS (
         SELECT vendas.produto,
            (vendas.data_venda AT TIME ZONE 'America/Sao_Paulo'::text)::date AS data,
            sum(
                CASE
                    WHEN vendas.status = 'aprovada'::status_venda THEN vendas.valor_total
                    ELSE 0::numeric
                END) AS faturamento_bruto,
            sum(
                CASE
                    WHEN vendas.status = 'aprovada'::status_venda THEN COALESCE(vendas.valor_sem_juros, vendas.valor_total)
                    ELSE 0::numeric
                END) AS receita_tributavel,
            sum(
                CASE
                    WHEN vendas.status = 'aprovada'::status_venda THEN COALESCE(vendas.juros_parcelamento, 0::numeric)
                    ELSE 0::numeric
                END) AS juros_parc,
            sum(
                CASE
                    WHEN vendas.status = 'aprovada'::status_venda THEN COALESCE(vendas.taxa_plataforma_valor, 0::numeric)
                    ELSE 0::numeric
                END) AS taxa_plataforma,
            sum(
                CASE
                    WHEN vendas.status = ANY (ARRAY['reembolsada'::status_venda, 'chargeback'::status_venda]) THEN fn_perda_da_venda(vendas.valor_total, vendas.valor_reembolsado)
                    ELSE 0::numeric
                END) AS reembolsos,
            count(
                CASE
                    WHEN vendas.status = 'aprovada'::status_venda AND (vendas.is_upsell IS NULL OR vendas.is_upsell = false) THEN 1
                    ELSE NULL::integer
                END) AS vendas_aprovadas,
            count(
                CASE
                    WHEN vendas.status = 'pendente'::status_venda AND (vendas.is_upsell IS NULL OR vendas.is_upsell = false) THEN 1
                    ELSE NULL::integer
                END) AS vendas_pendentes,
            sum(
                CASE
                    WHEN vendas.status = 'pendente'::status_venda THEN vendas.valor_total
                    ELSE 0::numeric
                END) AS montante_pendente
           FROM vendas
          WHERE vendas.pedido_id !~~ 'TEST%'::text AND vendas.pedido_id !~~ 'LC-%'::text
          GROUP BY vendas.produto, ((vendas.data_venda AT TIME ZONE 'America/Sao_Paulo'::text)::date)
        ), meta_base AS (
         SELECT metricas_meta.produto,
            metricas_meta.data,
            sum(metricas_meta.investimento) AS investimento
           FROM metricas_meta
          WHERE metricas_meta.nivel = 'campanha'::nivel_meta
          GROUP BY metricas_meta.produto, metricas_meta.data
        )
 SELECT v.data,
    v.produto,
    v.faturamento_bruto,
    v.taxa_plataforma,
        CASE
            WHEN v.receita_tributavel > 0::numeric THEN round(v.taxa_plataforma / v.receita_tributavel * 100::numeric, 2)
            ELSE 0::numeric
        END AS taxa_plataforma_pct,
    v.reembolsos,
    v.vendas_aprovadas,
    v.vendas_pendentes,
    v.montante_pendente,
    COALESCE(m.investimento, 0::numeric) AS investimento_meta,
    round(v.receita_tributavel * cfg.simples_pct / 100::numeric, 2) AS imposto_simples,
    round(COALESCE(m.investimento, 0::numeric) * cfg.meta_pct / 100::numeric, 2) AS imposto_meta_ads,
    round(v.receita_tributavel - v.taxa_plataforma - v.reembolsos - v.receita_tributavel * cfg.simples_pct / 100::numeric - COALESCE(m.investimento, 0::numeric) * cfg.meta_pct / 100::numeric - COALESCE(m.investimento, 0::numeric), 2) AS faturamento_liquido,
        CASE
            WHEN v.receita_tributavel > 0::numeric THEN round((v.receita_tributavel - v.taxa_plataforma - v.reembolsos - v.receita_tributavel * cfg.simples_pct / 100::numeric - COALESCE(m.investimento, 0::numeric) * cfg.meta_pct / 100::numeric - COALESCE(m.investimento, 0::numeric)) / v.receita_tributavel * 100::numeric, 2)
            ELSE 0::numeric
        END AS margem_pct,
        CASE
            WHEN COALESCE(m.investimento, 0::numeric) > 0::numeric THEN round(v.receita_tributavel / m.investimento, 2)
            ELSE NULL::numeric
        END AS roas,
    cfg.simples_pct,
    cfg.meta_pct,
    cfg.custo_fixo,
    v.receita_tributavel,
    v.juros_parc AS juros_parcelamento
   FROM vendas_base v
     LEFT JOIN meta_base m ON m.data = v.data AND m.produto::text = v.produto::text
     CROSS JOIN cfg;

create or replace view public.vw_frequencia_clientes as
 SELECT c.id,
    c.nome,
    c.email,
    count(v.id) FILTER (WHERE v.status = 'aprovada'::status_venda) AS total_pedidos,
    sum(v.valor_total) FILTER (WHERE v.status = 'aprovada'::status_venda) AS total_gasto,
    min(v.data_venda) AS primeira_compra,
    max(v.data_venda) AS ultima_compra,
        CASE
            WHEN count(v.id) FILTER (WHERE v.status = 'aprovada'::status_venda) = 1 THEN 'unico'::text
            WHEN count(v.id) FILTER (WHERE v.status = 'aprovada'::status_venda) >= 2 AND count(v.id) FILTER (WHERE v.status = 'aprovada'::status_venda) <= 3 THEN 'recorrente'::text
            ELSE 'fiel'::text
        END AS segmento
   FROM clientes c
     LEFT JOIN vendas v ON v.cliente_id = c.id
  GROUP BY c.id, c.nome, c.email;

create or replace view public.vw_funil as
 WITH meta AS (
         SELECT metricas_meta.produto::text AS produto,
            metricas_meta.data,
            sum(metricas_meta.impressoes) AS impressoes,
            sum(metricas_meta.cliques) AS cliques,
            sum(metricas_meta.cliques_link) AS cliques_link,
            sum(metricas_meta.visualizacoes_pagina) AS visualizacoes_pagina,
            sum(metricas_meta.initiate_checkout) AS initiate_checkout,
            sum(metricas_meta.compras_meta) AS compras_meta,
            sum(metricas_meta.investimento) AS investimento,
            sum(metricas_meta.faturamento_atribuido) AS faturamento_atribuido,
            sum(metricas_meta.video_plays) AS video_plays,
            sum(metricas_meta.video_3s) AS video_3s,
            sum(metricas_meta.video_75pct) AS video_75pct
           FROM metricas_meta
          WHERE metricas_meta.nivel = 'campanha'::nivel_meta
          GROUP BY metricas_meta.produto, metricas_meta.data
        ), vendas_agg AS (
         SELECT vendas.produto::text AS produto,
            date(vendas.data_venda) AS data,
            count(
                CASE
                    WHEN vendas.status = 'aprovada'::status_venda AND vendas.upsell_de IS NULL THEN 1
                    ELSE NULL::integer
                END) AS vendas_aprovadas,
            sum(
                CASE
                    WHEN vendas.status = 'aprovada'::status_venda THEN vendas.valor_oferta_principal
                    ELSE 0::numeric
                END) AS faturamento_principal,
            sum(
                CASE
                    WHEN vendas.status = 'aprovada'::status_venda THEN vendas.valor_obs
                    ELSE 0::numeric
                END) AS faturamento_obs,
            sum(
                CASE
                    WHEN vendas.status = 'aprovada'::status_venda THEN vendas.valor_total
                    ELSE 0::numeric
                END) AS faturamento_total
           FROM vendas
          WHERE vendas.pedido_id !~~ 'TEST%'::text AND vendas.pedido_id !~~ 'LC-%'::text
          GROUP BY vendas.produto, (date(vendas.data_venda))
        ), obs_agg AS (
         SELECT v_1.produto::text AS produto,
            date(v_1.data_venda) AS data,
            count(vi.id) AS obs_convertidos,
            sum(vi.valor) AS receita_obs
           FROM venda_itens vi
             JOIN vendas v_1 ON v_1.id = vi.venda_id
          WHERE v_1.pedido_id !~~ 'TEST%'::text AND vi.converteu = true
          GROUP BY v_1.produto, (date(v_1.data_venda))
        )
 SELECT m.data,
    m.produto,
    m.impressoes,
    m.cliques,
    m.cliques_link,
    m.visualizacoes_pagina,
    m.initiate_checkout,
    m.compras_meta,
    m.investimento,
    m.faturamento_atribuido,
    m.video_plays,
    m.video_3s,
    m.video_75pct,
    COALESCE(v.vendas_aprovadas, 0::bigint) AS vendas_aprovadas,
    COALESCE(v.faturamento_principal, 0::numeric) AS faturamento_principal,
    COALESCE(v.faturamento_obs, 0::numeric) AS faturamento_obs,
    COALESCE(v.faturamento_total, 0::numeric) AS faturamento_total,
    COALESCE(o.obs_convertidos, 0::bigint) AS obs_convertidos,
    COALESCE(o.receita_obs, 0::numeric) AS receita_obs
   FROM meta m
     LEFT JOIN vendas_agg v ON v.data = m.data AND v.produto = m.produto
     LEFT JOIN obs_agg o ON o.data = m.data AND o.produto = m.produto
  WHERE m.impressoes > 0::numeric;

create or replace view public.vw_ingest_health as
 SELECT 'payt'::text AS fonte,
    'Vendas (Payt)'::text AS rotulo,
    max(vendas_payt.criado_em) AS ultimo_evento,
    count(*) AS registros,
    round(EXTRACT(epoch FROM now() - max(vendas_payt.criado_em)) / 3600::numeric, 1) AS horas_atras,
    6::numeric AS limiar_horas,
    (EXTRACT(epoch FROM now() - max(vendas_payt.criado_em)) / 3600::numeric) > 6::numeric AS defasado
   FROM vendas_payt
UNION ALL
 SELECT 'meta'::text AS fonte,
    'Métricas de anúncios (Meta)'::text AS rotulo,
    fn_ultima_execucao_cron('meta-sync-horario'::text) AS ultimo_evento,
    count(*) AS registros,
    round(EXTRACT(epoch FROM now() - fn_ultima_execucao_cron('meta-sync-horario'::text)) / 3600::numeric, 1) AS horas_atras,
    3::numeric AS limiar_horas,
    (EXTRACT(epoch FROM now() - fn_ultima_execucao_cron('meta-sync-horario'::text)) / 3600::numeric) > 3::numeric AS defasado
   FROM metricas_meta;

create or replace view public.vw_ltv_por_segmento as
 SELECT produto::text AS produto,
    utm_source,
    count(DISTINCT cliente_id) AS total_clientes,
    round(sum(valor_total) / NULLIF(count(DISTINCT cliente_id), 0)::numeric, 2) AS ltv_medio,
    round(sum(valor_total), 2) AS ltv_total
   FROM vendas v
  WHERE status = 'aprovada'::status_venda
  GROUP BY produto, utm_source;

create or replace view public.vw_metricas_meta_nivel as
 WITH base AS (
         SELECT mm.nivel,
            mm.produto::text AS produto,
            mm.campanha_id,
            mm.campanha_nome,
            mm.adset_id,
            mm.adset_nome,
            mm.ad_id,
            mm.ad_nome,
            mm.data,
            aa.funil_id,
            mm.ad_account_id,
            aa.nome AS conta_nome,
                CASE mm.nivel
                    WHEN 'campanha'::nivel_meta THEN mm.campanha_nome
                    WHEN 'adset'::nivel_meta THEN mm.adset_nome
                    ELSE mm.ad_nome
                END AS nome,
                CASE mm.nivel
                    WHEN 'campanha'::nivel_meta THEN mm.campanha_id
                    WHEN 'adset'::nivel_meta THEN mm.adset_id
                    ELSE mm.ad_id
                END AS nivel_id,
                CASE mm.nivel
                    WHEN 'adset'::nivel_meta THEN mm.campanha_id
                    WHEN 'ad'::nivel_meta THEN mm.adset_id
                    ELSE NULL::text
                END AS parent_id,
            sum(mm.impressoes) AS impressoes,
            sum(mm.alcance) AS alcance,
            sum(mm.cliques) AS cliques,
            sum(mm.cliques_link) AS cliques_link,
            sum(mm.investimento) AS investimento,
            sum(mm.compras_meta) AS compras_meta,
            sum(mm.faturamento_atribuido) AS faturamento_atribuido,
            sum(mm.initiate_checkout) AS initiate_checkout,
            sum(mm.visualizacoes_pagina) AS visualizacoes_pagina,
            sum(mm.video_plays) AS video_plays,
            sum(mm.video_3s) AS video_3s,
            sum(mm.video_75pct) AS video_75pct
           FROM metricas_meta mm
             JOIN ad_accounts aa ON aa.id = mm.ad_account_id
          GROUP BY mm.nivel, mm.produto, mm.campanha_id, mm.campanha_nome, mm.adset_id, mm.adset_nome, mm.ad_id, mm.ad_nome, mm.data, aa.funil_id, mm.ad_account_id, aa.nome
        )
 SELECT nivel,
    produto,
    campanha_id,
    campanha_nome,
    adset_id,
    adset_nome,
    ad_id,
    ad_nome,
    data,
    funil_id,
    nome,
    nivel_id,
    parent_id,
    impressoes,
    alcance,
    cliques,
    cliques_link,
    investimento,
    compras_meta,
    faturamento_atribuido,
    initiate_checkout,
    visualizacoes_pagina,
    video_plays,
    video_3s,
    video_75pct,
    round(cliques::numeric / NULLIF(impressoes, 0::numeric) * 100::numeric, 2) AS ctr,
    round(investimento / NULLIF(impressoes, 0::numeric) * 1000::numeric, 2) AS cpm,
    round(investimento / NULLIF(cliques, 0)::numeric, 2) AS cpc,
    round(faturamento_atribuido / NULLIF(investimento, 0::numeric), 2) AS roas,
    round(investimento / NULLIF(compras_meta, 0)::numeric, 2) AS cpa,
    round(video_3s::numeric / NULLIF(impressoes, 0::numeric) * 100::numeric, 2) AS taxa_video_3s,
    round(video_75pct::numeric / NULLIF(video_plays, 0)::numeric * 100::numeric, 2) AS taxa_video_75pct,
    round(compras_meta::numeric / NULLIF(video_75pct, 0)::numeric * 100::numeric, 2) AS taxa_compras_video75,
    round(initiate_checkout::numeric / NULLIF(visualizacoes_pagina, 0)::numeric * 100::numeric, 2) AS taxa_ic,
    round(investimento / NULLIF(initiate_checkout, 0)::numeric, 2) AS custo_por_ic,
    round(compras_meta::numeric / NULLIF(initiate_checkout, 0)::numeric * 100::numeric, 2) AS taxa_conv_checkout,
    round(visualizacoes_pagina::numeric / NULLIF(cliques, 0)::numeric * 100::numeric, 2) AS taxa_conexao,
    round(investimento / NULLIF(visualizacoes_pagina, 0)::numeric, 2) AS custo_por_vis_pagina,
    round(compras_meta::numeric / NULLIF(visualizacoes_pagina, 0)::numeric * 100::numeric, 2) AS taxa_vendas_vis_pagina,
    ad_account_id,
    conta_nome
   FROM base;

create or replace view public.vw_reembolsos as
 WITH base AS (
         SELECT count(
                CASE
                    WHEN vendas.status = 'aprovada'::status_venda AND vendas.upsell_de IS NULL AND vendas.pedido_id !~~ 'LC-%'::text THEN 1
                    ELSE NULL::integer
                END) AS total_aprovadas,
            count(
                CASE
                    WHEN vendas.status = 'pendente'::status_venda AND vendas.pedido_id !~~ 'LC-%'::text THEN 1
                    ELSE NULL::integer
                END) AS qtd_pendentes,
            sum(
                CASE
                    WHEN vendas.status = 'pendente'::status_venda AND vendas.pedido_id !~~ 'LC-%'::text THEN vendas.valor_total
                    ELSE 0::numeric
                END) AS valor_pendentes,
            count(
                CASE
                    WHEN vendas.status = 'cancelada'::status_venda AND vendas.pedido_id !~~ 'LC-%'::text THEN 1
                    ELSE NULL::integer
                END) AS qtd_canceladas,
            sum(
                CASE
                    WHEN vendas.status = 'cancelada'::status_venda AND vendas.pedido_id !~~ 'LC-%'::text THEN vendas.valor_total
                    ELSE 0::numeric
                END) AS valor_canceladas,
            count(
                CASE
                    WHEN vendas.status = 'expirada'::status_venda AND vendas.pedido_id !~~ 'LC-%'::text THEN 1
                    ELSE NULL::integer
                END) AS qtd_expiradas,
            sum(
                CASE
                    WHEN vendas.status = 'expirada'::status_venda AND vendas.pedido_id !~~ 'LC-%'::text THEN vendas.valor_total
                    ELSE 0::numeric
                END) AS valor_expiradas,
            count(
                CASE
                    WHEN vendas.status = 'reembolsada'::status_venda THEN 1
                    ELSE NULL::integer
                END) AS qtd_reembolsos,
            sum(
                CASE
                    WHEN vendas.status = 'reembolsada'::status_venda THEN COALESCE(vendas.valor_reembolsado, vendas.valor_total)
                    ELSE 0::numeric
                END) AS valor_reembolsos,
            count(
                CASE
                    WHEN vendas.status = 'chargeback'::status_venda THEN 1
                    ELSE NULL::integer
                END) AS qtd_chargeback,
            sum(
                CASE
                    WHEN vendas.status = 'chargeback'::status_venda THEN vendas.valor_total
                    ELSE 0::numeric
                END) AS valor_chargeback
           FROM vendas
          WHERE vendas.pedido_id !~~ 'TEST%'::text
        )
 SELECT total_aprovadas,
    qtd_pendentes,
    valor_pendentes,
    qtd_canceladas,
    valor_canceladas,
    qtd_expiradas,
    valor_expiradas,
    qtd_reembolsos,
    valor_reembolsos,
    qtd_chargeback,
    valor_chargeback,
    round(qtd_reembolsos::numeric / NULLIF(total_aprovadas + qtd_reembolsos, 0)::numeric * 100::numeric, 2) AS pct_reembolsos,
    round(qtd_chargeback::numeric / NULLIF(total_aprovadas + qtd_reembolsos + qtd_chargeback, 0)::numeric * 100::numeric, 2) AS pct_chargeback
   FROM base;

create or replace view public.vw_vendas_por_campanha as
 SELECT split_part(split_part(COALESCE(utm_campaign, 'organico'::text), '::'::text, 1), '|'::text, 1) AS campanha,
    produto::text AS produto,
    count(
        CASE
            WHEN status = 'aprovada'::status_venda AND upsell_de IS NULL THEN 1
            ELSE NULL::integer
        END) AS vendas_aprovadas,
    sum(
        CASE
            WHEN status = 'aprovada'::status_venda THEN valor_total
            ELSE 0::numeric
        END) AS faturamento,
    sum(
        CASE
            WHEN status = 'aprovada'::status_venda THEN valor_oferta_principal
            ELSE 0::numeric
        END) AS faturamento_principal,
    round(sum(
        CASE
            WHEN status = 'aprovada'::status_venda THEN valor_total
            ELSE 0::numeric
        END) / NULLIF(count(
        CASE
            WHEN status = 'aprovada'::status_venda AND upsell_de IS NULL THEN 1
            ELSE NULL::integer
        END), 0)::numeric, 2) AS ticket_medio
   FROM vendas
  WHERE pedido_id !~~ 'TEST%'::text AND pedido_id !~~ 'LC-%'::text
  GROUP BY (split_part(split_part(COALESCE(utm_campaign, 'organico'::text), '::'::text, 1), '|'::text, 1)), produto;

create or replace view public.vw_vendas_por_dia_semana as
 SELECT EXTRACT(dow FROM (data_venda AT TIME ZONE 'America/Sao_Paulo'::text))::integer AS dia_semana,
    (ARRAY['Dom'::text, 'Seg'::text, 'Ter'::text, 'Qua'::text, 'Qui'::text, 'Sex'::text, 'Sáb'::text])[EXTRACT(dow FROM (data_venda AT TIME ZONE 'America/Sao_Paulo'::text))::integer + 1] AS dia_nome,
    produto::text AS produto,
    ad_account_id,
    count(*) FILTER (WHERE status = 'aprovada'::status_venda AND upsell_de IS NULL) AS vendas_aprovadas,
    sum(
        CASE
            WHEN status = 'aprovada'::status_venda THEN valor_total
            ELSE 0::numeric
        END) AS faturamento,
    round(count(*) FILTER (WHERE status = 'aprovada'::status_venda AND upsell_de IS NULL)::numeric / NULLIF(count(*) FILTER (WHERE upsell_de IS NULL), 0)::numeric * 100::numeric, 2) AS taxa_aprovacao_pct
   FROM vendas
  WHERE pedido_id !~~ 'TEST%'::text
  GROUP BY (EXTRACT(dow FROM (data_venda AT TIME ZONE 'America/Sao_Paulo'::text))::integer), ((ARRAY['Dom'::text, 'Seg'::text, 'Ter'::text, 'Qua'::text, 'Qui'::text, 'Sex'::text, 'Sáb'::text])[EXTRACT(dow FROM (data_venda AT TIME ZONE 'America/Sao_Paulo'::text))::integer + 1]), (produto::text), ad_account_id;

create or replace view public.vw_vendas_por_horario as
 SELECT hora_venda AS hora,
    produto::text AS produto,
    ad_account_id,
    count(*) FILTER (WHERE status = 'aprovada'::status_venda AND upsell_de IS NULL) AS vendas_aprovadas,
    count(*) FILTER (WHERE status = 'pendente'::status_venda AND upsell_de IS NULL) AS vendas_pendentes,
    count(*) FILTER (WHERE upsell_de IS NULL) AS base_taxa,
    sum(
        CASE
            WHEN status = 'aprovada'::status_venda THEN valor_total
            ELSE 0::numeric
        END) AS faturamento,
    round(count(*) FILTER (WHERE status = 'aprovada'::status_venda AND upsell_de IS NULL)::numeric / NULLIF(count(*) FILTER (WHERE upsell_de IS NULL), 0)::numeric * 100::numeric, 2) AS taxa_aprovacao_pct
   FROM vendas
  WHERE pedido_id !~~ 'TEST%'::text AND (data_venda AT TIME ZONE 'America/Sao_Paulo'::text)::time without time zone <> '00:00:00'::time without time zone
  GROUP BY hora_venda, produto, ad_account_id;

create or replace view public.vw_vendas_por_mes as
 SELECT mes_ano,
    produto::text AS produto,
    ad_account_id,
    count(*) FILTER (WHERE status = 'aprovada'::status_venda AND upsell_de IS NULL) AS vendas_aprovadas,
    count(*) FILTER (WHERE status = 'pendente'::status_venda AND upsell_de IS NULL) AS vendas_pendentes,
    sum(
        CASE
            WHEN status = 'aprovada'::status_venda THEN valor_total
            ELSE 0::numeric
        END) AS faturamento,
    round(count(*) FILTER (WHERE status = 'aprovada'::status_venda AND upsell_de IS NULL)::numeric / NULLIF(count(*) FILTER (WHERE upsell_de IS NULL), 0)::numeric * 100::numeric, 2) AS taxa_aprovacao_pct,
    round(sum(
        CASE
            WHEN status = 'aprovada'::status_venda THEN valor_total
            ELSE 0::numeric
        END) / NULLIF(count(*) FILTER (WHERE status = 'aprovada'::status_venda AND upsell_de IS NULL), 0)::numeric, 2) AS ticket_medio
   FROM vendas
  WHERE pedido_id !~~ 'TEST%'::text AND pedido_id !~~ 'LC-%'::text
  GROUP BY mes_ano, produto, ad_account_id;

create or replace view public.vw_vendas_por_pagamento as
 SELECT COALESCE(meio_pagamento::text, 'desconhecido'::text) AS meio_pagamento,
    produto::text AS produto,
    ad_account_id,
    count(*) AS total_tentativas,
    count(*) FILTER (WHERE status = 'aprovada'::status_venda) AS aprovadas,
    count(*) FILTER (WHERE status = 'pendente'::status_venda) AS pendentes,
    count(*) FILTER (WHERE status = 'cancelada'::status_venda) AS canceladas,
    count(*) FILTER (WHERE status = 'expirada'::status_venda) AS expiradas,
    count(*) FILTER (WHERE status = ANY (ARRAY['reembolsada'::status_venda, 'chargeback'::status_venda])) AS reembolsadas,
    sum(
        CASE
            WHEN status = 'aprovada'::status_venda THEN valor_total
            ELSE 0::numeric
        END) AS faturamento,
    round(count(*) FILTER (WHERE status = 'aprovada'::status_venda)::numeric / NULLIF(count(*), 0)::numeric * 100::numeric, 2) AS taxa_aprovacao_pct,
    round(sum(
        CASE
            WHEN status = 'aprovada'::status_venda THEN valor_total
            ELSE 0::numeric
        END) / NULLIF(count(*) FILTER (WHERE status = 'aprovada'::status_venda), 0)::numeric, 2) AS ticket_medio
   FROM vendas
  WHERE pedido_id !~~ 'TEST%'::text AND pedido_id !~~ 'LC-%'::text
  GROUP BY (COALESCE(meio_pagamento::text, 'desconhecido'::text)), (produto::text), ad_account_id;

create or replace view public.vw_vendas_por_placement as
 SELECT COALESCE(utm_placement::text, 'outro'::text) AS placement,
    produto::text AS produto,
    count(
        CASE
            WHEN status = 'aprovada'::status_venda AND upsell_de IS NULL THEN 1
            ELSE NULL::integer
        END) AS vendas_aprovadas,
    sum(
        CASE
            WHEN status = 'aprovada'::status_venda THEN valor_total
            ELSE 0::numeric
        END) AS faturamento,
    round(sum(
        CASE
            WHEN status = 'aprovada'::status_venda THEN valor_total
            ELSE 0::numeric
        END) / NULLIF(count(
        CASE
            WHEN status = 'aprovada'::status_venda AND upsell_de IS NULL THEN 1
            ELSE NULL::integer
        END), 0)::numeric, 2) AS ticket_medio,
    round(count(
        CASE
            WHEN status = 'aprovada'::status_venda AND upsell_de IS NULL THEN 1
            ELSE NULL::integer
        END)::numeric / NULLIF(count(
        CASE
            WHEN upsell_de IS NULL THEN 1
            ELSE NULL::integer
        END), 0)::numeric * 100::numeric, 2) AS taxa_aprovacao_pct
   FROM vendas
  WHERE pedido_id !~~ 'TEST%'::text
  GROUP BY (COALESCE(utm_placement::text, 'outro'::text)), produto;

create or replace view public.vw_vendas_por_produto_principal as
 SELECT produto::text AS produto,
    count(
        CASE
            WHEN status = 'aprovada'::status_venda AND (is_upsell IS NULL OR is_upsell = false) THEN 1
            ELSE NULL::integer
        END) AS vendas_aprovadas,
    sum(
        CASE
            WHEN status = 'aprovada'::status_venda AND (is_upsell IS NULL OR is_upsell = false) THEN valor_oferta_principal
            ELSE 0::numeric
        END) AS faturamento_principal,
    sum(
        CASE
            WHEN status = 'aprovada'::status_venda AND (is_upsell IS NULL OR is_upsell = false) THEN valor_total
            ELSE 0::numeric
        END) AS faturamento_total,
    round(avg(
        CASE
            WHEN status = 'aprovada'::status_venda AND (is_upsell IS NULL OR is_upsell = false) THEN valor_oferta_principal
            ELSE NULL::numeric
        END), 2) AS ticket_medio
   FROM vendas
  WHERE pedido_id !~~ 'TEST%'::text AND pedido_id !~~ 'LC-%'::text
  GROUP BY produto;

create or replace view public.vw_vendas_por_utm as
 SELECT
        CASE
            WHEN utm_source ~~* 'fb%'::text OR utm_source ~~* 'facebook%'::text THEN 'facebook'::text
            WHEN utm_source ~~* 'ig%'::text OR utm_source ~~* 'instagram%'::text THEN 'instagram'::text
            WHEN utm_source ~~* 'google%'::text THEN 'google'::text
            WHEN utm_source IS NULL THEN 'organico'::text
            ELSE clean_utm(utm_source)
        END AS utm_source,
    clean_utm(utm_medium) AS utm_medium,
    clean_utm(utm_campaign) AS utm_campaign,
    clean_utm(utm_content) AS utm_content,
    clean_utm(utm_term) AS utm_term,
    utm_placement::text AS utm_placement,
    produto::text AS produto,
    count(
        CASE
            WHEN status = 'aprovada'::status_venda AND upsell_de IS NULL THEN 1
            ELSE NULL::integer
        END) AS vendas_aprovadas,
    count(
        CASE
            WHEN status = 'pendente'::status_venda AND upsell_de IS NULL THEN 1
            ELSE NULL::integer
        END) AS vendas_pendentes,
    count(
        CASE
            WHEN status = 'cancelada'::status_venda THEN 1
            ELSE NULL::integer
        END) AS vendas_canceladas,
    count(
        CASE
            WHEN status = ANY (ARRAY['reembolsada'::status_venda, 'chargeback'::status_venda]) THEN 1
            ELSE NULL::integer
        END) AS reembolsos,
    sum(
        CASE
            WHEN status = 'aprovada'::status_venda THEN valor_total
            ELSE 0::numeric
        END) AS faturamento,
    round(count(
        CASE
            WHEN status = 'aprovada'::status_venda AND upsell_de IS NULL THEN 1
            ELSE NULL::integer
        END)::numeric / NULLIF(count(
        CASE
            WHEN upsell_de IS NULL THEN 1
            ELSE NULL::integer
        END), 0)::numeric * 100::numeric, 2) AS taxa_aprovacao_pct,
    round(sum(
        CASE
            WHEN status = 'aprovada'::status_venda THEN valor_total
            ELSE 0::numeric
        END) / NULLIF(count(
        CASE
            WHEN status = 'aprovada'::status_venda AND upsell_de IS NULL THEN 1
            ELSE NULL::integer
        END), 0)::numeric, 2) AS ticket_medio
   FROM vendas
  WHERE pedido_id !~~ 'TEST%'::text AND pedido_id !~~ 'LC-%'::text
  GROUP BY (
        CASE
            WHEN utm_source ~~* 'fb%'::text OR utm_source ~~* 'facebook%'::text THEN 'facebook'::text
            WHEN utm_source ~~* 'ig%'::text OR utm_source ~~* 'instagram%'::text THEN 'instagram'::text
            WHEN utm_source ~~* 'google%'::text THEN 'google'::text
            WHEN utm_source IS NULL THEN 'organico'::text
            ELSE clean_utm(utm_source)
        END), (clean_utm(utm_medium)), (clean_utm(utm_campaign)), (clean_utm(utm_content)), (clean_utm(utm_term)), utm_placement, produto;

create or replace view public.vw_vendas_temporal as
 SELECT (data_venda AT TIME ZONE 'America/Sao_Paulo'::text)::date AS data,
    produto::text AS produto,
    ad_account_id,
    count(*) FILTER (WHERE status = 'aprovada'::status_venda AND upsell_de IS NULL) AS vendas_aprovadas,
    count(*) FILTER (WHERE status = 'pendente'::status_venda AND upsell_de IS NULL) AS vendas_pendentes,
    sum(
        CASE
            WHEN status = 'aprovada'::status_venda THEN valor_total
            ELSE 0::numeric
        END) AS faturamento
   FROM vendas v
  WHERE pedido_id !~~ 'TEST%'::text AND pedido_id !~~ 'LC-%'::text
  GROUP BY ((data_venda AT TIME ZONE 'America/Sao_Paulo'::text)::date), (produto::text), ad_account_id;