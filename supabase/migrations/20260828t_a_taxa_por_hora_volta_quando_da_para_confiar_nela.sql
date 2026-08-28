-- ── A taxa de aprovacao por hora volta -- quando da para confiar nela ─────
--
-- Com a hora das recusas recuperada, a base da taxa deixou de ser so aprovadas.
-- Medido por mes, depois do backfill:
--
--   mes      recusas   sem hora   taxa do mes   taxa das com hora
--   ago/26     579         0         75,4%          75,4%
--   jul/26     496         0         73,1%          73,1%
--   jun/26     217         0         78,7%          78,7%
--   mai/26     616       415         70,4%          71,0%
--   abr/26     412       405         71,4%           --
--
-- De junho em diante as duas colunas sao a MESMA: nada fica de fora, e a taxa
-- por hora e fiel. Antes de maio nao ha payload para recuperar, e a taxa
-- voltaria a mentir.
--
-- Entao a funcao devolve `base_taxa` (as tentativas de cada hora) e
-- `sem_relogio_total` -- quantas linhas do periodo, de qualquer status,
-- ficaram sem hora. A tela usa esse numero para decidir: zero, mostra a taxa;
-- qualquer coisa acima, esconde a coluna inteira. E binario de proposito,
-- porque taxa parcialmente cega e o tipo de numero que parece certo e nao e.
--
-- `horas_sem_relogio` continua contando so aprovadas: ele serve ao aviso das
-- BARRAS, que sao aprovadas. Sao duas perguntas diferentes e por isso dois
-- numeros -- juntar num so seria a economia que faz o aviso mentir.
--
-- Conferido na tela com "Este mes": a taxa por hora varia de 44% a 88%, contra
-- os 100% cravados de antes. Com "Todos", a coluna some e a faixa avisa das
-- 4.288 sem hora.
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

    -- Aprovadas sem hora: e o aviso das BARRAS, que sao aprovadas.
    'horas_sem_relogio', (
      SELECT count(*) FROM normais
       WHERE momento_brt::time = '00:00:00' AND status = 'aprovada'
    ),

    -- Qualquer status sem hora: e o que decide se a TAXA pode aparecer.
    'sem_relogio_total', (
      SELECT count(*) FROM normais WHERE momento_brt::time = '00:00:00'
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
