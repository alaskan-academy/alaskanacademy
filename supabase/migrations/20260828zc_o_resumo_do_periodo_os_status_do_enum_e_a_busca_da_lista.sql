-- ── O resumo do periodo, os status vindos do enum, e a busca da lista ─────
--
-- Tres defeitos da tela de Vendas, e os tres se resolvem no banco.
--
-- 1. NAO HAVIA LINHA DE KPI
--
-- Era a unica tela de dados do projeto sem numero nenhum no topo: para saber
-- quanto vendeu no mes era preciso ler barras. `resumo` traz os totais crus do
-- periodo; ticket medio e taxa se refazem no front, sobre esses totais.
--
-- 2. OS UPSELLS SUMIAM DA TELA INTEIRA
--
-- Todo recorte usa `normais`, que exclui `is_upsell` -- e esta certo, senao a
-- mesma pessoa entraria duas vezes. So que em agosto isso e R$ 14.954,85
-- aprovados, 8,4% da receita, que a pagina omitia sem uma palavra. Agora eles
-- vem em campo proprio (`upsell_aprovadas`, `upsell_faturamento`) e a tela os
-- mostra em separado, dizendo que estao fora dos graficos.
--
-- 3. A LISTA DE STATUS ESTAVA FIXA NO CODIGO E JA TINHA ENVELHECIDO
--
-- `SalesPage.tsx` listava 5 status; o enum `status_venda` tem 7. Faltavam
-- `chargeback` (12 vendas, inalcancaveis pela tela) e `reembolso_parcial`.
-- E a armadilha 3 da CLAUDE.md acontecendo: lista no codigo que envelhece em
-- silencio. `status_possiveis` passa a sair do proprio enum, na ordem dele.
--
-- SOBRE A TAXA DE APROVACAO
--
-- Ela e `aprovadas / tentativas`, com `aprovadas` sendo status='aprovada'. Uma
-- venda reembolsada (111 no historico) conta como tentativa que nao aprovou,
-- embora tenha sido aprovada e depois devolvida. Fica assim de proposito: e a
-- MESMA definicao que a tabela por meio de pagamento ja usava, e dois numeros
-- chamados "taxa de aprovacao" discordando na mesma tela e pior do que um
-- numero com uma imprecisao conhecida de 1%.
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

-- ── A lista de vendas ganha busca ─────────────────────────────────────────
--
-- Nao havia como procurar uma venda: 50 por pagina, 48 paginas so em agosto, e
-- a unica ordem possivel era a data. Achar um pedido pelo codigo, pelo nome ou
-- pelo e-mail era rolar ate topar com ele.
--
-- A busca precisa cruzar `vendas` e `clientes` (nome e e-mail moram la), e o
-- PostgREST nao faz OR entre a tabela e a embutida numa consulta so. Daria
-- para resolver no front buscando os `cliente_id` antes e mandando a lista --
-- e ai o limite de 1.000 do PostgREST voltaria a cortar em silencio, que e o
-- defeito que esta revisao passou a semana inteira desfazendo. Entao a lista
-- inteira desce para o banco, no mesmo formato jsonb do resto.
--
-- `unaccent` no nome e no produto porque ninguem digita "Angelica" com acento
-- na hora de procurar. O e-mail e o codigo do pedido vao no ILIKE simples.
--
-- A paginacao continua sendo OFFSET/LIMIT: com 12.467 linhas e um seq scan de
-- milissegundos, keyset seria complexidade sem ganho.
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
  filtradas AS (
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
     CROSS JOIN termo
     WHERE v.pedido_id NOT LIKE 'TEST%'
       AND v.pedido_id NOT LIKE 'LC-%'
       AND (p_inicio IS NULL OR v.data_venda >= p_inicio)
       AND (p_fim    IS NULL OR v.data_venda <= p_fim)
       AND (p_contas IS NULL OR cardinality(p_contas) = 0
            OR v.ad_account_id = ANY(p_contas))
       AND (p_status IS NULL OR p_status = 'todos' OR v.status::text = p_status)
       AND (termo.t IS NULL
            OR v.pedido_id ILIKE '%' || termo.t || '%'
            OR coalesce(c.email, '') ILIKE '%' || termo.t || '%'
            OR public.unaccent(coalesce(c.nome, ''))
                 ILIKE public.unaccent('%' || termo.t || '%')
            OR public.unaccent(coalesce(v.produto_nome, ''))
                 ILIKE public.unaccent('%' || termo.t || '%'))
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtradas),
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

-- Funcao recem-criada nasce com EXECUTE para PUBLIC e, pelas default
-- privileges do Supabase, com concessao DIRETA para `anon` -- e revogar de
-- PUBLIC nao tira a concessao direta. As duas linhas abaixo sao necessarias,
-- e a lista fica igual a de `fn_vendas_agregado` e `fn_overview`.
REVOKE ALL ON FUNCTION public.fn_vendas_lista(timestamptz, timestamptz, uuid[], text, text, int, int)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_vendas_lista(timestamptz, timestamptz, uuid[], text, text, int, int)
  TO authenticated, service_role;
