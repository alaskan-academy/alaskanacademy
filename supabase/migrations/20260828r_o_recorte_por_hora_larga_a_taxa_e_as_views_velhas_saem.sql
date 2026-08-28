-- ── O recorte por hora larga a taxa de aprovacao ──────────────────────────
--
-- Outra correcao do que eu disse: cheguei a escrever que a taxa por hora dava
-- 100% porque "a carga inicial trouxe so vendas pagas". Errado. Medindo:
--
--   status       total   com hora 00:00:00
--   aprovada     8.702   4.288  (49,3%)
--   expirada     2.434   2.434  (100%)
--   cancelada      595     595  (100%)
--
-- TODA venda expirada e TODA cancelada esta gravada em 00:00:00 -- inclusive as
-- de hoje. Nao e historico: e a recusa que nunca traz horario.
--
-- O recorte por hora precisa descartar quem nao tem hora, entao a base da taxa
-- sobrava so com aprovadas: 96% a 100% em toda hora do dia, em qualquer
-- periodo, enquanto a taxa real do mes anda entre 73% e 75%. Um numero que so
-- sabe dizer "100%" e pior que coluna nenhuma -- e ele saiu da tela.
--
-- `base_taxa` sai junto: existia so para essa conta.
--
-- A taxa por MEIO DE PAGAMENTO fica, e essa e confiavel: la a base sao as
-- tentativas, e elas estao todas la.
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
               'hora', hora, 'vendas_aprovadas', aprovadas,
               'vendas_pendentes', pendentes, 'faturamento', faturamento) ORDER BY hora)
      FROM (SELECT extract(hour FROM momento_brt)::int AS hora,
                   count(*) FILTER (WHERE status = 'aprovada') AS aprovadas,
                   count(*) FILTER (WHERE status = 'pendente') AS pendentes,
                   coalesce(sum(valor_total) FILTER (WHERE status = 'aprovada'), 0) AS faturamento
              FROM normais WHERE momento_brt::time <> '00:00:00' GROUP BY 1) h
    ), '[]'::jsonb),

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

-- ── E as cinco views que ninguem le mais saem ─────────────────────────────
--
-- Elas eram a fonte da tela de Vendas e foram substituidas por
-- `fn_vendas_agregado`. Conferido antes de apagar: nenhuma outra view, funcao
-- ou tela do front as consulta.
--
-- Sao as mesmas que nao tinham coluna de data e por isso faziam quatro abas
-- ignorarem o filtro. Deixa-las por perto seria guardar a versao errada ao lado
-- da certa, esperando alguem escolher a errada -- e as tres definicoes
-- diferentes de "venda" que elas carregavam sao exatamente o tipo de coisa que
-- volta a divergir sozinha.
DROP VIEW IF EXISTS public.vw_vendas_por_horario;
DROP VIEW IF EXISTS public.vw_vendas_por_dia_semana;
DROP VIEW IF EXISTS public.vw_vendas_por_pagamento;
DROP VIEW IF EXISTS public.vw_vendas_por_mes;
DROP VIEW IF EXISTS public.vw_vendas_temporal;
