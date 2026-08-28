-- ── `fn_overview` aceita varias contas ────────────────────────────────────
--
-- O Resumo estava MORTO, com "invalid input syntax for type uuid: []" na tela.
--
-- O commit que transformou a conta de anuncio em multiselect (d7d634a, 27/08)
-- trocou `contaId` por `contaIds: string[]` em todo o dashboard. As paginas que
-- filtram por consulta acompanharam (`.in('ad_account_id', contaIds)`), e
-- `fn_criativos_meta` foi migrada para `uuid[]` na mesma leva. A `fn_overview`
-- ficou para tras: continuou com `p_conta uuid`, escalar, recebendo o array.
--
-- E o array VAZIO -- "todas as contas", o estado padrao -- e o que chegava
-- aqui, virava a string "[]" no PostgREST e explodia. Ou seja: a pagina nao
-- quebrava so com conta escolhida, quebrava SEMPRE.
--
-- O `p_conta: contaIds ?? null` do front parecia um cuidado e nao era: `??` so
-- pega null e undefined, e `[]` nao e nenhum dos dois. Uma protecao que nunca
-- rodou -- e que fez o defeito parecer tratado.
--
-- A regra que faltava esta escrita de proposito na variavel `v_todas`: NULO e
-- VAZIO significam a mesma coisa aqui, "sem filtro de conta". Sem isso, "todas
-- as contas" filtraria por nenhuma e o Resumo mostraria zeros -- que e pior do
-- que o erro, porque nao denuncia.
DROP FUNCTION IF EXISTS public.fn_overview(timestamptz, timestamptz, text, uuid);

CREATE OR REPLACE FUNCTION public.fn_overview(
  p_inicio   timestamp with time zone,
  p_fim      timestamp with time zone,
  p_segmento text     DEFAULT 'misto'::text,
  p_contas   uuid[]   DEFAULT NULL::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_resultado jsonb;
  v_dia_ini date := (p_inicio AT TIME ZONE 'America/Sao_Paulo')::date;
  v_dia_fim date := (p_fim    AT TIME ZONE 'America/Sao_Paulo')::date;
  -- Nulo e vazio sao a mesma coisa: "todas as contas". Calculado uma vez, para
  -- as tres condicoes nao poderem divergir.
  v_todas boolean := p_contas IS NULL OR cardinality(p_contas) = 0;
BEGIN
  WITH periodo AS (
    SELECT v.*,
           -- Uma definição só, usada em todo o resto da função.
           (v.ad_id_meta IS NOT NULL OR coalesce(v.trafego_pago, false)) AS eh_trafego
    FROM vendas v
    WHERE v.pedido_id NOT LIKE 'TEST%'
      AND v.pedido_id NOT LIKE 'LC-%'
      AND (p_inicio IS NULL OR v.data_venda >= p_inicio)
      AND (p_fim    IS NULL OR v.data_venda <= p_fim)
  ),
  base AS (
    SELECT * FROM periodo v
    WHERE (v_todas OR v.ad_account_id = ANY(p_contas))
      AND (
        p_segmento = 'misto'
        OR (p_segmento = 'trafego' AND v.eh_trafego)
        OR (p_segmento = 'backend' AND NOT v.eh_trafego)
      )
  ),
  aprovadas AS (
    SELECT * FROM base WHERE status = 'aprovada'
  ),
  principais AS (
    SELECT * FROM aprovadas WHERE coalesce(valor_oferta_principal, 0) > 0
  ),
  invest_conta AS (
    SELECT coalesce(sum(m.investimento), 0) AS total
    FROM metricas_meta m
    WHERE NOT v_todas
      AND m.ad_account_id = ANY(p_contas)
      AND m.nivel = 'campanha'
      AND m.data BETWEEN v_dia_ini AND v_dia_fim
  ),
  fiscal AS (
    SELECT
      coalesce(sum(f.reembolsos), 0)        AS reembolsos,
      coalesce(sum(f.imposto_simples), 0)   AS imposto_simples,
      coalesce(sum(f.imposto_meta_ads), 0)  AS imposto_meta,
      CASE WHEN v_todas
           THEN coalesce(sum(f.investimento_meta), 0)
           ELSE (SELECT total FROM invest_conta) END AS investimento_meta,
      coalesce(max(f.simples_pct), 0)       AS simples_pct,
      coalesce(max(f.meta_pct), 0)          AS meta_pct,
      coalesce(max(f.custo_fixo), 0)        AS custo_fixo_mensal
    FROM vw_faturamento_liquido f
    WHERE (p_inicio IS NULL OR f.data >= v_dia_ini)
      AND (p_fim    IS NULL OR f.data <= v_dia_fim)
  )
  SELECT jsonb_build_object(
    'fat_bruto',   coalesce((SELECT sum(valor_total) FROM aprovadas), 0),
    'juros',       coalesce((SELECT sum(juros_parcelamento) FROM aprovadas), 0),
    'receita',     coalesce((SELECT sum(coalesce(valor_sem_juros, valor_total)) FROM aprovadas), 0),
    'receita_sem_upsell', coalesce((SELECT sum(coalesce(valor_sem_juros, valor_total))
                                      FROM aprovadas WHERE NOT coalesce(is_upsell, false)), 0),
    'taxa_plataforma', coalesce((SELECT sum(taxa_plataforma_valor) FROM aprovadas), 0),
    'qtd_aprovadas',   (SELECT count(*) FROM principais),
    'receita_backend', coalesce((SELECT sum(coalesce(valor_sem_juros, valor_total)) FROM aprovadas WHERE NOT eh_trafego), 0),
    'qtd_backend',     (SELECT count(*) FROM aprovadas WHERE NOT eh_trafego),

    'fat_bruto_total', coalesce((SELECT sum(valor_total) FROM periodo WHERE status = 'aprovada'), 0),
    'fiscal', (SELECT to_jsonb(f) FROM fiscal f),

    'sem_conta_resolvida', (SELECT count(*) FROM aprovadas WHERE eh_trafego AND ad_account_id IS NULL),

    'nao_aprovadas', coalesce((
      SELECT jsonb_object_agg(status::text, jsonb_build_object('qtd', qtd, 'valor', valor))
      FROM (
        SELECT status, count(*) AS qtd, sum(valor_total) AS valor
        FROM (
          SELECT DISTINCT ON (coalesce(cliente_id::text, pedido_id), coalesce(produto_nome, ''))
                 status, valor_total
          FROM base WHERE status IN ('pendente','cancelada','expirada')
          ORDER BY coalesce(cliente_id::text, pedido_id), coalesce(produto_nome, ''), data_venda DESC
        ) dedup
        GROUP BY status
      ) s
    ), '{}'::jsonb),

    -- Quantas das não aprovadas viraram venda depois. Mesma pessoa, mesmo produto,
    -- janela de 7 dias para os dois lados: cobre tanto quem tentou antes e pagou
    -- depois quanto quem pagou e teve uma tentativa falha registrada em seguida.
    'recuperadas', (
      SELECT coalesce(jsonb_build_object(
               'qtd',   count(*),
               'valor', coalesce(sum(n.valor_total), 0)
             ), '{}'::jsonb)
      FROM (
        SELECT DISTINCT ON (coalesce(cliente_id::text, pedido_id), coalesce(produto_nome, ''))
               cliente_id, produto_nome, valor_total, data_venda, status
        FROM base WHERE status IN ('pendente','cancelada','expirada')
        ORDER BY coalesce(cliente_id::text, pedido_id), coalesce(produto_nome, ''), data_venda DESC
      ) n
      WHERE EXISTS (
          SELECT 1 FROM vendas a
           WHERE a.status = 'aprovada'
             AND a.cliente_id IS NOT NULL
             AND a.cliente_id = n.cliente_id
             AND a.produto_nome IS NOT DISTINCT FROM n.produto_nome
             AND a.data_venda BETWEEN n.data_venda - interval '7 days'
                                  AND n.data_venda + interval '7 days'
        )
    ),

    'perdas', coalesce((
      SELECT jsonb_object_agg(status::text, jsonb_build_object('qtd', qtd, 'valor', valor))
      FROM (
        SELECT status, count(*) AS qtd,
               sum(fn_perda_da_venda(valor_total, valor_reembolsado)) AS valor
        FROM base WHERE status IN ('reembolsada','chargeback')
        GROUP BY status
      ) s
    ), '{}'::jsonb),

    'por_dia', coalesce((
      SELECT jsonb_agg(jsonb_build_object('dia', dia, 'faturamento', faturamento, 'vendas', vendas) ORDER BY dia)
      FROM (
        SELECT (data_venda AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
               sum(coalesce(valor_sem_juros, valor_total)) AS faturamento,
               count(*) AS vendas
        FROM principais GROUP BY 1
      ) d
    ), '[]'::jsonb),

    'por_produto', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'produto', produto, 'categoria', categoria,
               'vendas', vendas, 'faturamento_principal', fat_principal, 'ticket_medio', ticket
             ) ORDER BY vendas DESC)
      FROM (
        SELECT coalesce(produto_nome, produto::text, 'Sem produto') AS produto,
               coalesce(produto::text, '') AS categoria,
               count(*) AS vendas,
               sum(valor_oferta_principal) AS fat_principal,
               avg(coalesce(valor_sem_juros, valor_total)) AS ticket
        FROM principais WHERE NOT coalesce(is_upsell, false)
        GROUP BY 1, 2
      ) p
    ), '[]'::jsonb),

    'por_link', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'link', link, 'vendas', vendas, 'valor', valor, 'pct_rastreado', pct
             ) ORDER BY valor DESC)
      FROM (
        SELECT coalesce(link_titulo, '(sem link identificado)') AS link,
               count(*) AS vendas,
               sum(coalesce(valor_sem_juros, valor_total)) AS valor,
               100.0 * count(ad_id_meta) / nullif(count(*), 0) AS pct
        FROM principais WHERE NOT coalesce(is_upsell, false) GROUP BY 1
      ) l
    ), '[]'::jsonb),

    'por_origem', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'origem', origem, 'vendas', vendas, 'receita', receita
             ) ORDER BY receita DESC)
      FROM (
        SELECT CASE
                 WHEN coalesce(is_upsell, false) THEN 'Upsell (pós-checkout)'
                 ELSE coalesce(
                   nullif(regexp_replace(utm_source, 'jLj6[0-9a-f]+$', '', 'i'), ''),
                   '(sem origem)')
               END AS origem,
               count(*) AS vendas,
               sum(coalesce(valor_sem_juros, valor_total)) AS receita
        FROM aprovadas
        WHERE NOT eh_trafego
        GROUP BY 1
      ) o
    ), '[]'::jsonb),

    'upsells', coalesce((
      SELECT jsonb_agg(jsonb_build_object('nome', nome, 'qtd', qtd, 'receita', receita) ORDER BY qtd DESC)
      FROM (
        SELECT coalesce(produto_nome, 'Upsell') AS nome,
               count(*) AS qtd,
               sum(coalesce(valor_sem_juros, valor_total)) AS receita
        FROM aprovadas WHERE is_upsell
        GROUP BY 1
      ) u
    ), '[]'::jsonb),

    'qtd_upsells', (SELECT count(*) FROM aprovadas WHERE is_upsell),

    'order_bumps', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'nome', nome, 'tipo', tipo, 'qtd', qtd, 'receita', receita, 'vendas_com_ob', vendas_ob
             ) ORDER BY qtd DESC)
      FROM (
        SELECT vi.nome, vi.tipo::text AS tipo,
               count(*) AS qtd,
               sum(vi.valor) AS receita,
               count(DISTINCT vi.venda_id) AS vendas_ob
        FROM venda_itens vi
        JOIN aprovadas a ON a.id = vi.venda_id
        WHERE vi.converteu
        GROUP BY 1, 2
      ) o
    ), '[]'::jsonb),

    'vendas_com_ob', (
      SELECT count(DISTINCT vi.venda_id) FROM venda_itens vi
      JOIN aprovadas a ON a.id = vi.venda_id WHERE vi.converteu
    )
  ) INTO v_resultado;

  RETURN v_resultado;
END;
$function$;

COMMENT ON FUNCTION public.fn_overview(timestamptz, timestamptz, text, uuid[]) IS
  'Numeros do Resumo, agregados no banco. p_contas nulo ou vazio = todas as contas.';

-- Funcao recriada nasce com EXECUTE para PUBLIC e, pelo default do Supabase,
-- para `anon`. Permissao se escreve, nao se herda -- foi o mesmo tropeco de
-- horas atras em `fn_devolver_criativo`.
REVOKE ALL ON FUNCTION public.fn_overview(timestamptz, timestamptz, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_overview(timestamptz, timestamptz, text, uuid[]) TO authenticated, service_role;
