-- ── Meta Ads para de somar no navegador ───────────────────────────────────
--
-- A tela pedia `vw_metricas_meta_nivel` inteira, linha por dia e por nivel, e
-- somava no JavaScript. O PostgREST corta em 1.000 linhas por padrao e nao
-- avisa: devolve 200 com mil linhas.
--
-- Agosto tem 3.285 linhas nessa view. Medido na tela, com o filtro "Este mes":
--
--   na tela   6 campanhas    R$  25.082,09 de gasto
--   no banco  16 campanhas   R$ 102.541,16
--
-- Um quarto do gasto, dez campanhas sumidas, sem erro nenhum. E o proprio
-- cartao de conciliacao logo abaixo, na MESMA tela, mostrava R$ 102.541,16 --
-- a segunda fonte estava a um palmo de distancia.
--
-- E o mesmo defeito que ja tinha custado caro no Resumo ("o faturamento passou
-- de 120 mil e aqui nem chega a isso"). A correcao la foi esta: agregar no
-- banco e devolver UMA linha de jsonb, que nao tem teto de linhas para cortar.
--
-- Por que as razoes (CTR, CPM, ROAS...) NAO vem daqui, mesmo a view ja
-- calculando todas: razao de um dia nao se soma. Somar CPM de 28 dias nao da o
-- CPM do mes. Quem agrega tem que recalcular depois, e por isso a conta mora
-- num lugar so, no front, aplicada sobre os totais.
CREATE OR REPLACE FUNCTION public.fn_metricas_meta_agregado(
  p_inicio date   DEFAULT NULL,
  p_fim    date   DEFAULT NULL,
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
  )
  SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.investimento DESC), '[]'::jsonb)
    FROM agregado a;
$function$;

COMMENT ON FUNCTION public.fn_metricas_meta_agregado(date, date, uuid[]) IS
  'Metricas do Meta ja somadas por campanha, conjunto e anuncio. Uma linha de jsonb: sem teto de 1.000 linhas do PostgREST. As razoes (CTR, ROAS...) sao recalculadas no front sobre os totais, porque razao de dia nao se soma.';

REVOKE ALL ON FUNCTION public.fn_metricas_meta_agregado(date, date, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_metricas_meta_agregado(date, date, uuid[]) TO authenticated, service_role;
