-- ── A lista devolve o resumo do que está filtrado ─────────────────────────
--
-- A faixa de KPI do topo fala do PERÍODO. Abaixo do filtro da lista a pergunta
-- é outra: "e desta seleção, quanto é?" -- filtrei por expirada, quanto ficou
-- na mesa; busquei um cliente, quanto ele já comprou.
--
-- Isso não dava para fazer no front: a tela tem 50 linhas na mão e a seleção
-- pode ter 2.449. Somar o que está na página daria um número que muda quando
-- se vira a página -- o pior tipo de número, porque parece certo.
--
-- Então `fn_vendas_lista` passa a devolver `resumo`:
--
--   quantidade     linhas da seleção (o mesmo que `total`, repetido aqui para
--                  o resumo se bastar sozinho)
--   valor          soma de `valor_total` da seleção
--   base_periodo   linhas do período SEM o filtro de status e sem a busca
--
-- `base_periodo` é o denominador do "% do período", e ele é calculado aqui
-- dentro de propósito: o `resumo` da tela de agregados exclui upsell (senão a
-- mesma pessoa entra duas vezes nos gráficos) e a lista não exclui. Usar um
-- como denominador do outro daria um percentual que passa de 100% num período
-- só de upsell -- dois numeradores, duas bases, um número errado.
CREATE OR REPLACE FUNCTION public.fn_vendas_lista(
  p_inicio  timestamptz DEFAULT NULL,
  p_fim     timestamptz DEFAULT NULL,
  p_contas  uuid[]      DEFAULT NULL::uuid[],
  p_status  text        DEFAULT NULL,
  p_busca   text        DEFAULT NULL,
  p_pagina  int         DEFAULT 0,
  p_tamanho int         DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
  WITH termo AS (SELECT nullif(btrim(coalesce(p_busca, '')), '') AS t),
  -- O período e as contas, sem status e sem busca: é a base do percentual.
  todas AS (
    SELECT v.id, v.pedido_id, v.data_venda,
           v.produto::text        AS produto,
           v.produto_nome,
           v.valor_total,
           v.status::text         AS status,
           v.meio_pagamento::text AS meio_pagamento,
           v.utm_source, v.utm_placement,
           coalesce(v.is_upsell, false) AS is_upsell,
           c.nome AS cliente_nome, c.email AS cliente_email, c.telefone AS cliente_telefone
      FROM vendas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
     WHERE v.pedido_id NOT LIKE 'TEST%'
       AND v.pedido_id NOT LIKE 'LC-%'
       AND (p_inicio IS NULL OR v.data_venda >= p_inicio)
       AND (p_fim    IS NULL OR v.data_venda <= p_fim)
       AND (p_contas IS NULL OR cardinality(p_contas) = 0
            OR v.ad_account_id = ANY(p_contas))
  ),
  filtradas AS (
    SELECT todas.* FROM todas CROSS JOIN termo
     WHERE (p_status IS NULL OR p_status = 'todos' OR todas.status = p_status)
       AND (termo.t IS NULL
            OR todas.pedido_id ILIKE '%' || termo.t || '%'
            OR coalesce(todas.cliente_email, '') ILIKE '%' || termo.t || '%'
            OR public.unaccent(coalesce(todas.cliente_nome, ''))
                 ILIKE public.unaccent('%' || termo.t || '%')
            OR public.unaccent(coalesce(todas.produto_nome, ''))
                 ILIKE public.unaccent('%' || termo.t || '%'))
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtradas),
    'resumo', jsonb_build_object(
      'quantidade',   (SELECT count(*) FROM filtradas),
      'valor',        coalesce((SELECT sum(valor_total) FROM filtradas), 0),
      'base_periodo', (SELECT count(*) FROM todas)
    ),
    'linhas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', id, 'pedido_id', pedido_id, 'data_venda', data_venda,
               'produto', produto, 'produto_nome', produto_nome,
               'valor_total', valor_total, 'status', status,
               'meio_pagamento', meio_pagamento,
               'utm_source', utm_source, 'utm_placement', utm_placement,
               'is_upsell', is_upsell,
               'clientes', jsonb_build_object(
                 'nome', cliente_nome, 'email', cliente_email, 'telefone', cliente_telefone)
             ) ORDER BY data_venda DESC)
        FROM (SELECT * FROM filtradas
               ORDER BY data_venda DESC
              OFFSET greatest(coalesce(p_pagina, 0), 0) * greatest(coalesce(p_tamanho, 50), 1)
               LIMIT greatest(coalesce(p_tamanho, 50), 1)) pagina
    ), '[]'::jsonb)
  );
$function$;
