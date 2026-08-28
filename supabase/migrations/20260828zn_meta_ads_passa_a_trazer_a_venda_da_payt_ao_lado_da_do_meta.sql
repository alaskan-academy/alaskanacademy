-- ── Meta Ads passa a trazer a venda da Payt ao lado da do Meta ────────────
--
-- POR QUE
--
-- Comparando o anúncio "AD 002 H01 V01" em agosto contra outra ferramenta,
-- sete métricas bateram ao centavo -- gasto R$ 867,76, 16.014 impressões, CPM
-- R$ 54,19, hook 39,56%, 15 ICs, CPI R$ 57,85, ICR 3,79%. As duas leem a mesma
-- API.
--
-- O que divergia era a venda:
--
--   Meta (pixel)      14 vendas   R$ 1.573,81
--   Payt (registrada) 12 vendas   R$ 1.326,63
--
-- Conferido no payload cru: os 14 e o R$ 1.573,81 são LITERALMENTE o
-- `actions.purchase` e o `action_values.purchase` do Meta. Não calculamos nada
-- -- reportamos o que ele afirma. E ele afirma 2 vendas a mais do que
-- existiram, porque credita janela de visualização e deduplica mal.
--
-- Ter só a versão do Meta obriga a sair do dashboard para saber se o anúncio se
-- paga. Com as duas lado a lado, a diferença entre "reivindicada" e
-- "registrada" vira uma coluna em vez de uma investigação.
--
-- A DEFINIÇÃO DA RECEITA DA PAYT É A MESMA DE `fn_criativos_meta`
--
-- `coalesce(valor_sem_juros, valor_total)`, aprovadas, sem upsell. É de
-- propósito igual à da tela de Criativos: as duas respondem "o que ESTE
-- anúncio vendeu", e duas respostas diferentes para a mesma pergunta seria a
-- primeira armadilha da CLAUDE.md.
--
-- Ela difere da tela de Vendas, que soma `valor_total` -- e difere com motivo:
-- lá a pergunta é "quanto a empresa faturou", e o juro do parcelamento é
-- faturamento; aqui é "quanto este anúncio trouxe", e o juro não é mérito dele.
--
-- COMO A VENDA SOBE DE NÍVEL
--
-- A venda só conhece o `ad_id`. Conjunto e campanha recebem a soma dos
-- anúncios que pertencem a eles, pelo mapa `ad -> parent` que a própria view de
-- métricas já carrega. Não há como uma venda pertencer a um conjunto sem
-- pertencer a um anúncio, então nada se perde no caminho.
CREATE OR REPLACE FUNCTION public.fn_metricas_meta_agregado(
  p_inicio date DEFAULT NULL::date,
  p_fim    date DEFAULT NULL::date,
  p_contas uuid[] DEFAULT NULL::uuid[]
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
  WITH filtrado AS (
    SELECT v.*
      FROM vw_metricas_meta_nivel v
     WHERE (p_inicio IS NULL OR v.data >= p_inicio)
       AND (p_fim    IS NULL OR v.data <= p_fim)
       AND (p_contas IS NULL OR cardinality(p_contas) = 0
            OR v.ad_account_id = ANY(p_contas))
  ),
  -- De qual conjunto e de qual campanha é cada anúncio.
  mapa AS (
    SELECT DISTINCT a.nivel_id AS ad_id, a.parent_id AS adset_id, s.parent_id AS campanha_id
      FROM filtrado a
      LEFT JOIN (SELECT DISTINCT nivel_id, parent_id FROM filtrado WHERE nivel::text = 'adset') s
             ON s.nivel_id = a.parent_id
     WHERE a.nivel::text = 'ad'
  ),
  payt_ad AS (
    SELECT v.ad_id_meta AS ad_id,
           count(*)::bigint                                      AS vendas_payt,
           sum(coalesce(v.valor_sem_juros, v.valor_total))       AS receita_payt
      FROM vendas v
     WHERE v.status = 'aprovada'
       AND NOT coalesce(v.is_upsell, false)
       AND v.ad_id_meta IS NOT NULL
       AND v.pedido_id NOT LIKE 'TEST%'
       AND v.pedido_id NOT LIKE 'LC-%'
       AND (p_inicio IS NULL OR (v.data_venda AT TIME ZONE 'America/Sao_Paulo')::date >= p_inicio)
       AND (p_fim    IS NULL OR (v.data_venda AT TIME ZONE 'America/Sao_Paulo')::date <= p_fim)
       AND (p_contas IS NULL OR cardinality(p_contas) = 0
            OR v.ad_account_id = ANY(p_contas))
     GROUP BY 1
  ),
  payt_nivel AS (
    SELECT 'ad'::text AS nivel, m.ad_id AS nivel_id,
           p.vendas_payt, p.receita_payt
      FROM mapa m JOIN payt_ad p ON p.ad_id = m.ad_id
    UNION ALL
    SELECT 'adset', m.adset_id, sum(p.vendas_payt), sum(p.receita_payt)
      FROM mapa m JOIN payt_ad p ON p.ad_id = m.ad_id
     WHERE m.adset_id IS NOT NULL GROUP BY 2
    UNION ALL
    SELECT 'campanha', m.campanha_id, sum(p.vendas_payt), sum(p.receita_payt)
      FROM mapa m JOIN payt_ad p ON p.ad_id = m.ad_id
     WHERE m.campanha_id IS NOT NULL GROUP BY 2
  ),
  agregado AS (
    SELECT
      f.nivel::text AS nivel,
      f.nivel_id,
      f.parent_id,
      -- Nome pode mudar com o tempo para o mesmo id; vale o mais recente, que e
      -- o que a pessoa ve hoje no gerenciador.
      (array_agg(f.nome ORDER BY f.data DESC))[1]           AS nome,
      (array_agg(f.produto ORDER BY f.data DESC))[1]        AS produto,
      (array_agg(f.campanha_nome ORDER BY f.data DESC))[1]  AS campanha_nome,
      (array_agg(f.adset_nome ORDER BY f.data DESC))[1]     AS adset_nome,
      sum(f.impressoes)            AS impressoes,
      sum(f.alcance)               AS alcance,
      sum(f.cliques)               AS cliques,
      sum(f.cliques_link)          AS cliques_link,
      sum(f.investimento)          AS investimento,
      sum(f.compras_meta)          AS compras_meta,
      sum(f.faturamento_atribuido) AS faturamento_atribuido,
      sum(f.initiate_checkout)     AS initiate_checkout,
      sum(f.visualizacoes_pagina)  AS visualizacoes_pagina,
      sum(f.video_plays)           AS video_plays,
      sum(f.video_3s)              AS video_3s,
      sum(f.video_75pct)           AS video_75pct
    FROM filtrado f
    GROUP BY f.nivel, f.nivel_id, f.parent_id
  ),
  -- Zero e nao nulo: "nenhuma venda casada" e um numero, e a tela precisa
  -- poder somar a coluna sem tratar ausencia caso a caso.
  com_payt AS (
    SELECT a.*,
           coalesce(pn.vendas_payt, 0)  AS vendas_payt,
           coalesce(pn.receita_payt, 0) AS receita_payt
      FROM agregado a
      LEFT JOIN payt_nivel pn ON pn.nivel = a.nivel AND pn.nivel_id = a.nivel_id
  )
  SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.investimento DESC), '[]'::jsonb)
    FROM com_payt c;
$function$;
