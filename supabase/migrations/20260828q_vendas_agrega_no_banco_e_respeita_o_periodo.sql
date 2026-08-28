-- ── A tela de Vendas passa a respeitar o proprio filtro ───────────────────
--
-- QUATRO DAS SEIS ABAS IGNORAVAM O PERIODO. `vw_vendas_por_pagamento`,
-- `_por_horario`, `_por_dia_semana` e `_por_mes` nao tem coluna de data --
-- agregam o historico inteiro por (produto, conta). A pagina filtrava por
-- conta e mais nada, entao com "Hoje" selecionado (1 venda) a aba de horario
-- mostrava 4.410 vendas e a de pagamento, 9.105. Sem nenhum sinal na tela.
--
-- E A ABA DE PRODUTOS estourava o teto: lia linhas cruas de `vendas`, 2.462 em
-- agosto, e o PostgREST corta em 1.000.
--
-- TRES DEFINICOES DE "VENDA" CONVIVIAM. Entre as cinco views:
--
--   * `temporal`, `pagamento` e `mes` excluiam `LC-%`; `horario` e
--     `dia_semana` nao;
--   * quatro descontavam upsell por `upsell_de`, a heuristica APOSENTADA, e
--     `pagamento` nao descontava nada.
--
-- `upsell_de` tem 69 linhas; o campo atual, `is_upsell`, tem 403. Ou seja,
-- 358 upsells eram contados como venda normal nessa tela e em nenhuma outra.
--
-- E o ticket medio somava dinheiro COM upsell e dividia por vendas SEM upsell.
-- Em agosto: R$ 99,66 pela conta antiga contra R$ 92,07 com as duas pontas na
-- mesma base -- R$ 7,59 de ticket que nao existia.
--
-- Uma funcao so, com as regras escritas uma vez: exclui TEST% e LC-%, desconta
-- upsell pelo campo atual, e conta e dinheiro sempre na mesma base.
--
-- `horas_sem_relogio` existe para a tela poder dizer o que esta faltando:
-- 4.288 vendas aprovadas tem hora 00:00:00 -- vieram da carga inicial, que so
-- trouxe a data. Sao 100% ate abril/26 e 0% desde julho, quando a ingestao
-- pela Payt passou a trazer a hora. A view antiga descartava essas linhas em
-- silencio; aqui elas saem do recorte por hora do mesmo jeito, mas o numero
-- vem junto para a tela avisar.
--
-- O numero conta APROVADAS, da mesma moeda das barras. Na primeira versao eu
-- contei todos os status e agosto deu 573 -- pendentes e canceladas, que o
-- grafico nem desenha. Um aviso com numero de outra moeda assusta a toa.
--
-- Conferido depois: os cinco recortes dao 1.773 vendas e R$ 163.245,87 em
-- agosto, iguais entre si e ao SQL direto. Antes davam 1.788, 4.410 ou 9.105,
-- dependendo da aba.
CREATE OR REPLACE FUNCTION public.fn_vendas_agregado(
  p_inicio timestamptz DEFAULT NULL,
  p_fim    timestamptz DEFAULT NULL,
  p_contas uuid[]      DEFAULT NULL::uuid[]
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
  WITH base AS (
    SELECT v.status::text AS status,
           coalesce(v.is_upsell, false)                      AS eh_upsell,
           coalesce(v.meio_pagamento::text, 'desconhecido')  AS meio,
           coalesce(v.produto::text, 'Outros')               AS produto,
           v.valor_total,
           (v.data_venda AT TIME ZONE 'America/Sao_Paulo')        AS momento_brt,
           (v.data_venda AT TIME ZONE 'America/Sao_Paulo')::date  AS dia
      FROM vendas v
     WHERE v.pedido_id NOT LIKE 'TEST%'
       AND v.pedido_id NOT LIKE 'LC-%'
       AND (p_inicio IS NULL OR v.data_venda >= p_inicio)
       AND (p_fim    IS NULL OR v.data_venda <= p_fim)
       AND (p_contas IS NULL OR cardinality(p_contas) = 0
            OR v.ad_account_id = ANY(p_contas))
  ),
  -- Conta e dinheiro sempre sobre o mesmo conjunto: sem upsell nos dois.
  normais AS (SELECT * FROM base WHERE NOT eh_upsell)
  SELECT jsonb_build_object(

    'temporal', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'data', dia, 'vendas_aprovadas', aprovadas,
               'vendas_pendentes', pendentes, 'faturamento', faturamento) ORDER BY dia)
      FROM (SELECT dia,
                   count(*) FILTER (WHERE status = 'aprovada') AS aprovadas,
                   count(*) FILTER (WHERE status = 'pendente') AS pendentes,
                   coalesce(sum(valor_total) FILTER (WHERE status = 'aprovada'), 0) AS faturamento
              FROM normais GROUP BY 1) t
    ), '[]'::jsonb),

    'por_produto', coalesce((
      SELECT jsonb_agg(jsonb_build_object('name', produto, 'value', valor) ORDER BY valor DESC)
      FROM (SELECT produto, coalesce(sum(valor_total), 0) AS valor
              FROM normais WHERE status = 'aprovada' GROUP BY 1) p
    ), '[]'::jsonb),

    'por_pagamento', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'meio_pagamento', meio, 'total_tentativas', tentativas,
               'aprovadas', aprovadas, 'canceladas', canceladas,
               'expiradas', expiradas, 'faturamento', faturamento) ORDER BY faturamento DESC)
      FROM (SELECT meio,
                   count(*)                                    AS tentativas,
                   count(*) FILTER (WHERE status = 'aprovada') AS aprovadas,
                   count(*) FILTER (WHERE status = 'cancelada') AS canceladas,
                   count(*) FILTER (WHERE status = 'expirada')  AS expiradas,
                   coalesce(sum(valor_total) FILTER (WHERE status = 'aprovada'), 0) AS faturamento
              FROM normais GROUP BY 1) g
    ), '[]'::jsonb),

    -- Hora 00:00:00 fica de fora: e a marca da carga inicial, que so trouxe a
    -- data. Manter essas linhas empilharia metade do historico na meia-noite e
    -- inventaria um pico que nunca existiu.
    'por_hora', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'hora', hora, 'vendas_aprovadas', aprovadas, 'vendas_pendentes', pendentes,
               'base_taxa', base_taxa, 'faturamento', faturamento) ORDER BY hora)
      FROM (SELECT extract(hour FROM momento_brt)::int AS hora,
                   count(*) FILTER (WHERE status = 'aprovada') AS aprovadas,
                   count(*) FILTER (WHERE status = 'pendente') AS pendentes,
                   count(*)                                    AS base_taxa,
                   coalesce(sum(valor_total) FILTER (WHERE status = 'aprovada'), 0) AS faturamento
              FROM normais WHERE momento_brt::time <> '00:00:00' GROUP BY 1) h
    ), '[]'::jsonb),

    -- Da mesma moeda das barras: vendas aprovadas.
    'horas_sem_relogio', (
      SELECT count(*) FROM normais
       WHERE momento_brt::time = '00:00:00' AND status = 'aprovada'
    ),

    'por_dia_semana', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'dia_semana', dow, 'dia_nome', nome,
               'vendas_aprovadas', aprovadas, 'faturamento', faturamento) ORDER BY dow)
      FROM (SELECT extract(dow FROM momento_brt)::int AS dow,
                   (ARRAY['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'])[extract(dow FROM momento_brt)::int + 1] AS nome,
                   count(*) FILTER (WHERE status = 'aprovada') AS aprovadas,
                   coalesce(sum(valor_total) FILTER (WHERE status = 'aprovada'), 0) AS faturamento
              FROM normais GROUP BY 1, 2) d
    ), '[]'::jsonb),

    'por_mes', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'mes_ano', mes, 'vendas_aprovadas', aprovadas, 'faturamento', faturamento) ORDER BY mes)
      FROM (SELECT to_char(momento_brt, 'YYYY-MM') AS mes,
                   count(*) FILTER (WHERE status = 'aprovada') AS aprovadas,
                   coalesce(sum(valor_total) FILTER (WHERE status = 'aprovada'), 0) AS faturamento
              FROM normais GROUP BY 1) m
    ), '[]'::jsonb)
  );
$function$;

COMMENT ON FUNCTION public.fn_vendas_agregado(timestamptz, timestamptz, uuid[]) IS
  'Todos os recortes da tela de Vendas numa chamada e com o MESMO filtro de periodo -- que quatro das views antigas nem tinham como aplicar. Upsell pelo campo atual (is_upsell), conta e dinheiro na mesma base.';

REVOKE ALL ON FUNCTION public.fn_vendas_agregado(timestamptz, timestamptz, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_vendas_agregado(timestamptz, timestamptz, uuid[]) TO authenticated, service_role;
