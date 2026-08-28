-- ── Na pizza, "produto" passa a ser o produto -- e nao a categoria ─────────
--
-- A pizza "Por Produto" tinha sete fatias: velas, saponaria, cosmeticos,
-- velaroma, handify, outros. Isso e `vendas.produto`, que e a CATEGORIA. As
-- 12.467 vendas se distribuem em:
--
--   produto (categoria)    6 valores distintos
--   produto_nome          46 valores distintos, 0 em branco
--
-- Ou seja: existe o nome do produto em toda linha, e a tela escolhia o campo
-- que agrupava 46 coisas em 6. "Velas R$ 47 mil" nao responde nada -- e a
-- categoria inteira. "Fabrica das Velas de Lembrancinha R$ 28.831,01" responde.
--
-- Os dois campos ficam, e aqui nao ha divergencia a temer: `produto` e
-- derivavel de `produto_nome`, nao o contrario. A pizza usa o especifico.
--
-- A CAUDA VIRA UMA FATIA SO
--
-- 46 nomes em uma pizza sao 46 fatias ilegiveis. Ficam os 6 maiores e o resto
-- vira "Outros (N)" -- com o N no rotulo, para a tela nao esconder quantos.
-- Medido em agosto: Curso Saponaria Brasil R$ 112.584,92 - Fabrica das Velas de
-- Lembrancinha R$ 28.831,01 - Workshop Buque de Velas R$ 15.240,37 - Handify
-- R$ 2.690,51 - Workshop Desafios R$ 2.638,42 - Kit Completo R$ 814,53 -
-- Outros (12) R$ 446,11. Soma R$ 163.245,87, o mesmo total de antes.
--
-- O corte e por POSICAO (as 6 primeiras) e nao por um piso em reais: piso em
-- reais envelhece junto com o faturamento e um dia engole a pizza inteira, sem
-- nada na tela avisando.
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
           coalesce(nullif(btrim(v.produto_nome), ''),
                    initcap(v.produto::text),
                    'Sem produto')                           AS produto,
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
  normais AS (SELECT * FROM base WHERE NOT eh_upsell),
  -- Produto por produto, e a cauda junta. O corte e por POSICAO e nao por
  -- valor: um piso em reais envelheceria junto com o faturamento.
  produtos AS (
    SELECT produto, sum(valor_total) AS valor,
           row_number() OVER (ORDER BY sum(valor_total) DESC) AS posicao
      FROM normais WHERE status = 'aprovada' GROUP BY 1
  )
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
      SELECT jsonb_agg(jsonb_build_object('name', nome, 'value', valor) ORDER BY ordem, valor DESC)
      FROM (
        SELECT produto AS nome, valor, 0 AS ordem FROM produtos WHERE posicao <= 6
        UNION ALL
        SELECT 'Outros (' || count(*)::text || ')', sum(valor), 1
          FROM produtos WHERE posicao > 6
         HAVING count(*) > 0
      ) p
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

    'horas_sem_relogio', (
      SELECT count(*) FROM normais
       WHERE momento_brt::time = '00:00:00' AND status = 'aprovada'
    ),

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
