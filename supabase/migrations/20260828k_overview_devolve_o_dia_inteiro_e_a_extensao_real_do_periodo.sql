-- ── O dia passa a ter gasto e taxa, e o periodo passa a saber quanto dura ──
--
-- Duas coisas que a tela nao tinha como saber, e por isso inventava.
--
-- 1. LUCRO POR DIA. A pagina desenhava uma linha de "lucro estimado" que era o
--    faturamento do dia vezes a margem do periodo inteiro -- a mesma curva
--    multiplicada por uma constante, incapaz de mostrar um dia no vermelho.
--    Agora o dado para fazer a de verdade vem daqui: `metricas_meta` tem gasto
--    por dia e por conta, e a taxa da Payt esta em cada venda.
--
--    O FULL JOIN e o ponto: dia com gasto e sem venda TEM que aparecer. E
--    justamente o dia que interessa ver, e ele nao existe na lista de vendas.
--
-- 2. QUANTO O PERIODO DURA. Com o filtro "Todos", a tela nao recebia datas e
--    caia num literal de 30 dias para ratear o custo fixo -- um comentario no
--    codigo ja admitia que "todo o historico custaria varios meses, nao um".
--    `dia_min` e `dia_max` saem do proprio dado.
--
-- `por_dia` passa a sair de `aprovadas` e nao de `principais`. Hoje os dois
-- conjuntos sao identicos (as 1.836 vendas de agosto tem todas oferta
-- principal), mas `receita` do periodo sai de `aprovadas` -- e a soma dos dias
-- precisa fechar com o total, senao o grafico e o card do topo discordam no dia
-- em que alguma venda entrar sem oferta principal.
--
-- Conferido depois de aplicar, para os tres campos novos: a soma dos dias bate
-- com o total do periodo em receita (R$ 173.777,54), taxa (R$ 10.728,39) e
-- investimento (R$ 102.150,97), e o lucro somado dia a dia da exatamente o
-- lucro operacional da tela (R$ 30.312,59).
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
  v_todas boolean := p_contas IS NULL OR cardinality(p_contas) = 0;
BEGIN
  WITH periodo AS (
    SELECT v.*,
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
  -- Gasto por dia, ja respeitando a conta escolhida. Sem periodo definido
  -- (filtro "Todos") a janela de datas some e entra o historico inteiro.
  gasto_dia AS (
    SELECT m.data AS dia, sum(m.investimento) AS investimento
      FROM metricas_meta m
     WHERE m.nivel = 'campanha'
       AND (p_inicio IS NULL OR m.data >= v_dia_ini)
       AND (p_fim    IS NULL OR m.data <= v_dia_fim)
       AND (v_todas OR m.ad_account_id = ANY(p_contas))
     GROUP BY 1
  ),
  venda_dia AS (
    SELECT (data_venda AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
           sum(coalesce(valor_sem_juros, valor_total)) AS faturamento,
           sum(coalesce(taxa_plataforma_valor, 0))     AS taxa,
           count(*)                                    AS vendas
      FROM aprovadas GROUP BY 1
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

    -- Quanto o periodo dura de verdade, para o custo fixo nao depender de um
    -- numero redondo escrito no codigo quando nao ha filtro de data.
    'dia_min', (SELECT min((data_venda AT TIME ZONE 'America/Sao_Paulo')::date) FROM base),
    'dia_max', (SELECT max((data_venda AT TIME ZONE 'America/Sao_Paulo')::date) FROM base),

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

    -- O dia agora carrega o que precisa para um lucro de verdade: receita, a
    -- taxa que a Payt cobrou nele e o gasto de anuncio daquele dia. FULL JOIN
    -- porque dia com gasto e sem venda e exatamente o dia que se quer ver.
    'por_dia', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'dia', dia, 'faturamento', faturamento, 'vendas', vendas,
               'taxa', taxa, 'investimento', investimento
             ) ORDER BY dia)
      FROM (
        SELECT coalesce(v.dia, g.dia)          AS dia,
               coalesce(v.faturamento, 0)      AS faturamento,
               coalesce(v.vendas, 0)           AS vendas,
               coalesce(v.taxa, 0)             AS taxa,
               coalesce(g.investimento, 0)     AS investimento
          FROM venda_dia v
          FULL JOIN gasto_dia g ON g.dia = v.dia
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
