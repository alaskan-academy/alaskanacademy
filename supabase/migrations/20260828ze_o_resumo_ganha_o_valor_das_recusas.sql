-- ── O resumo ganha o valor das recusas ────────────────────────────────────
--
-- A faixa de KPI tinha uma celula vazia, e o numero que faltava era o par da
-- "Taxa de aprovacao" ao lado: ela diz que 24,6% nao passaram, e nao diz
-- quanto isso e. Em agosto sao 559 vendas e R$ 57.867,43 -- um terco do que
-- entrou, parado no checkout.
--
-- "Recusada" aqui e `cancelada` + `expirada`, exatamente a mesma definicao da
-- coluna "Nao aprovadas" da tabela por meio de pagamento. Reembolsada e
-- chargeback ficam de FORA de proposito: elas foram aprovadas e devolvidas
-- depois, sao outro problema e outro numero.
--
-- Por isso aprovadas + recusadas nao fecha em `tentativas`: sobram 20 linhas em
-- agosto (pendentes, reembolsadas e chargebacks). A legenda do cartao diz
-- "canceladas e expiradas" para o leitor nao procurar a diferenca.
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

    -- Os totais do periodo. Ticket medio e taxa NAO vem daqui: eles se fazem
    -- no front, dividindo estes numeros -- a mesma regra do resto do arquivo.
    'resumo', jsonb_build_object(
      'faturamento',        coalesce((SELECT sum(valor_total) FROM normais WHERE status = 'aprovada'), 0),
      'aprovadas',          (SELECT count(*) FROM normais WHERE status = 'aprovada'),
      'tentativas',         (SELECT count(*) FROM normais),
      'recusadas',          (SELECT count(*) FROM normais WHERE status IN ('cancelada', 'expirada')),
      'recusadas_valor',    coalesce((SELECT sum(valor_total) FROM normais
                                       WHERE status IN ('cancelada', 'expirada')), 0),
      'upsell_aprovadas',   (SELECT count(*) FROM base WHERE eh_upsell AND status = 'aprovada'),
      'upsell_faturamento', coalesce((SELECT sum(valor_total) FROM base
                                       WHERE eh_upsell AND status = 'aprovada'), 0)
    ),

    -- Os status saem do enum, nao de uma lista escrita no front.
    'status_possiveis', coalesce((
      SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
        FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'status_venda'
    ), '[]'::jsonb),

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
