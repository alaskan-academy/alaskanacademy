-- Em "Ambas", o painel cobrava a alíquota de UMA empresa sobre a soma das duas.
--
-- ── O defeito ─────────────────────────────────────────────────────────────
--
-- Duas funções leem os mesmos parâmetros fiscais, e só uma acerta:
--
--     vw_faturamento_liquido   fn_config(chave, j.empresa_id)   por linha
--     fn_overview              fn_config(chave, p_empresa)      uma vez só
--
-- Com `p_empresa` nulo — que é o filtro "Ambas" — a segunda cai na linha GERAL
-- de `configuracoes` e aplica aquele número ao total das duas operações.
--
-- Medido em agosto/2026, mês em que TODA a receita foi da Alaskan e a Aeliss
-- ainda não operava:
--
--                        Alaskan     Aeliss     Ambas (a tela)
--     alíquota Simples        9%        10%        10%  ← a geral
--     imposto Simples  17.896,65       0,00   19.885,17
--     custo fixo          23.000     25.000      25.000
--
-- São R$ 1.988,52 de imposto que não existe, e R$ 23.000 de custo fixo que
-- some — as duas somam R$ 48.000. O lucro de "Ambas" saía ~R$ 21.000 otimista.
--
-- ── Somar a alíquota não é o conserto ────────────────────────────────────
--
-- 9% + 10% não é 19%, e a média simples também não serve: ela ignoraria que
-- uma empresa faturou vinte vezes mais que a outra. O certo é aplicar a
-- alíquota de cada uma à receita DELA e somar os IMPOSTOS, que é o que a view
-- sempre fez. O percentual que a tela exibe passa a ser o EFETIVO — imposto
-- sobre base —, que com uma empresa só dá exatamente a configurada e com duas
-- dá a média ponderada pela receita.
--
-- Custo fixo é valor, não percentual: esse SOMA.
--
-- ── E a linha geral volta a ter um trabalho só ───────────────────────────
--
-- `configuracoes` com `empresa_id` nulo estava fazendo dois papéis: ser o
-- padrão de uma empresa sem linha própria (legítimo) e ser o valor de "Ambas"
-- (errado). Um campo com dois significados é a primeira armadilha do CLAUDE.md;
-- eles divergem no dia em que os dois forem usados, e este era esse dia.
--
-- Depois desta migração a linha geral só faz o primeiro papel. Se ela virasse
-- "a soma", o primeiro quebraria: empresa nova nasceria herdando R$ 48.000/mês
-- de custo fixo.
--
-- ── Dinheiro sem empresa continua entrando ───────────────────────────────
--
-- Venda ou métrica com `empresa_id` nulo entra na conta com os parâmetros
-- GERAIS, em vez de sumir. Custo fixo não se aplica a ela — custo fixo é de uma
-- operação, e "sem empresa" não é uma. A linha some sozinha quando
-- `vw_dinheiro_sem_empresa` estiver zerada, que é onde ela já é vigiada.
--
-- ── Verificado ───────────────────────────────────────────────────────────
--
-- Cada empresa sozinha não pode mudar em NADA; só "Ambas" muda. Conferido em
-- três períodos (agosto, setembro e mai–ago) antes e depois.

do $$
declare
  def text;
  antigo text;
  novo   text;
begin
  def := pg_get_functiondef('fn_overview'::regproc);

  if position('empresas_no_calculo' in def) > 0
     or position('re.empresa_id IS NOT DISTINCT FROM' in def) > 0 then
    raise notice 'fn_overview ja calcula por empresa; nada a fazer';
    return;
  end if;

  antigo := E'  cfg AS (\n'
    || E'    SELECT\n'
    || E'      coalesce(fn_config(''imposto_simples_nacional_pct'', p_empresa), 0) AS simples_pct,\n'
    || E'      coalesce(fn_config(''imposto_meta_ads_pct'',         p_empresa), 0) AS meta_pct,\n'
    || E'      coalesce(fn_config(''custo_fixo_mensal'',            p_empresa), 0) AS custo_fixo\n'
    || E'  ),\n';

  if position(antigo in def) = 0 then
    raise exception 'ancora `cfg` nao encontrada em fn_overview — a forma mudou';
  end if;

  novo := E'  /* Um parametro POR EMPRESA. Em "Ambas" nao existe aliquota da soma:\n'
    || E'     9%% da Alaskan com 10%% da Aeliss nao viram 19%% nem 9,5%%. Aplica-se a de\n'
    || E'     cada uma a receita DELA e somam-se os impostos — que e o que\n'
    || E'     `vw_faturamento_liquido` sempre fez. Ver a migracao 20260901g. */\n'
    || E'  cfg AS (\n'
    || E'    SELECT e.id AS empresa_id,\n'
    || E'           coalesce(fn_config(''imposto_simples_nacional_pct'', e.id), 0) AS simples_pct,\n'
    || E'           coalesce(fn_config(''imposto_meta_ads_pct'',         e.id), 0) AS meta_pct,\n'
    || E'           coalesce(fn_config(''custo_fixo_mensal'',            e.id), 0) AS custo_fixo\n'
    || E'      FROM empresas e\n'
    || E'     WHERE e.ativo AND (p_empresa IS NULL OR e.id = p_empresa)\n'
    || E'    UNION ALL\n'
    || E'    /* Dinheiro que nasceu sem empresa entra com os parametros GERAIS em vez\n'
    || E'       de sumir. Custo fixo nao: ele e de uma operacao. */\n'
    || E'    SELECT NULL::uuid,\n'
    || E'           coalesce(fn_config(''imposto_simples_nacional_pct'', NULL), 0),\n'
    || E'           coalesce(fn_config(''imposto_meta_ads_pct'',         NULL), 0),\n'
    || E'           0\n'
    || E'  ),\n'
    || E'  receita_empresa AS (\n'
    || E'    SELECT empresa_id, sum(coalesce(valor_sem_juros, valor_total)) AS receita\n'
    || E'      FROM aprovadas GROUP BY 1\n'
    || E'  ),\n'
    || E'  gasto_empresa AS (\n'
    || E'    SELECT m.empresa_id, sum(m.investimento) AS gasto\n'
    || E'      FROM metricas_meta m\n'
    || E'     WHERE m.nivel = ''campanha''\n'
    || E'       AND (p_inicio IS NULL OR m.data >= v_dia_ini)\n'
    || E'       AND (p_fim    IS NULL OR m.data <= v_dia_fim)\n'
    || E'       AND (v_todas OR m.ad_account_id = ANY(p_contas))\n'
    || E'       AND (p_empresa IS NULL OR m.empresa_id = p_empresa)\n'
    || E'     GROUP BY 1\n'
    || E'  ),\n';

  def := replace(def, antigo, novo);

  antigo := E'      round((SELECT coalesce(sum(coalesce(valor_sem_juros, valor_total)), 0)\n'
    || E'               FROM aprovadas) * c.simples_pct / 100, 2)              AS imposto_simples,\n'
    || E'      round(g.gasto * c.meta_pct / 100, 2)                            AS imposto_meta,\n'
    || E'      g.gasto                                                         AS investimento_meta,\n'
    || E'      c.simples_pct                                                   AS simples_pct,\n'
    || E'      c.meta_pct                                                      AS meta_pct,\n'
    || E'      c.custo_fixo                                                    AS custo_fixo_mensal\n'
    || E'    FROM cfg c,\n'
    || E'         (SELECT coalesce(sum(investimento), 0) AS gasto FROM gasto_dia) g\n';

  if position(antigo in def) = 0 then
    raise exception 'ancora `fiscal` nao encontrada em fn_overview — a forma mudou';
  end if;

  novo := E'      imp.simples                                                     AS imposto_simples,\n'
    || E'      imp.meta                                                        AS imposto_meta,\n'
    || E'      g.gasto                                                         AS investimento_meta,\n'
    || E'      /* Aliquota EFETIVA: com uma empresa da exatamente a configurada; com\n'
    || E'         duas, da a ponderada pela receita — a unica leitura honesta de\n'
    || E'         "quanto por cento do faturamento virou imposto". */\n'
    || E'      CASE WHEN r.receita > 0 THEN round(imp.simples / r.receita * 100, 4) ELSE 0 END AS simples_pct,\n'
    || E'      CASE WHEN g.gasto   > 0 THEN round(imp.meta    / g.gasto   * 100, 4) ELSE 0 END AS meta_pct,\n'
    || E'      (SELECT coalesce(sum(custo_fixo), 0) FROM cfg)                   AS custo_fixo_mensal\n'
    || E'    FROM (SELECT\n'
    || E'            coalesce(sum(round(re.receita * c.simples_pct / 100, 2)), 0) AS simples,\n'
    || E'            coalesce(sum(round(ge.gasto   * c.meta_pct    / 100, 2)), 0) AS meta\n'
    || E'          FROM cfg c\n'
    || E'          LEFT JOIN receita_empresa re ON re.empresa_id IS NOT DISTINCT FROM c.empresa_id\n'
    || E'          LEFT JOIN gasto_empresa   ge ON ge.empresa_id IS NOT DISTINCT FROM c.empresa_id\n'
    || E'         ) imp,\n'
    || E'         (SELECT coalesce(sum(receita), 0) AS receita FROM receita_empresa) r,\n'
    || E'         (SELECT coalesce(sum(investimento), 0) AS gasto FROM gasto_dia) g\n';

  def := replace(def, antigo, novo);
  execute def;
end $$;
