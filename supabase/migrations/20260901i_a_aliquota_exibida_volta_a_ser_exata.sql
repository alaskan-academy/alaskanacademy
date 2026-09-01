-- Conserto de uma regressão que eu mesmo introduzi na 20260901g.
--
-- ── O que quebrou ─────────────────────────────────────────────────────────
--
-- Ao fazer "Ambas" calcular por empresa, passei a exibir a alíquota EFETIVA —
-- imposto dividido pela base. Duas consequências, as duas ruins:
--
--   1. A Aeliss, que ainda não vendeu, aparecia com "Simples (0.00%)". Zero
--      dividido por zero virou zero, e a tela dizia que a empresa não tem
--      alíquota. Ela tem: 9%, configurada. Só não tem receita ainda.
--
--   2. Alaskan aparecia com 13,9999% e Aeliss com 14,0007% onde as duas têm
--      14% configurados. O imposto de cada empresa é arredondado a 2 casas
--      ANTES de somar — como acontece de verdade —, e dividir de volta pelo
--      total devolve o arredondamento como ruído.
--
-- ── O conserto ────────────────────────────────────────────────────────────
--
-- A alíquota exibida passa a ser a média das configuradas PONDERADA pela base,
-- e não imposto/base: `sum(receita_i × pct_i) / sum(receita_i)`. Com uma
-- empresa só devolve exatamente a configurada, sem ruído de arredondamento; com
-- duas, devolve a ponderada de verdade, que é a leitura honesta.
--
-- Sem base nenhuma, cai na alíquota configurada da empresa selecionada. A
-- alíquota existe independentemente de ter havido receita — exibir 0% é dizer
-- algo falso sobre a empresa, e não sobre o mês.
--
-- ── Conferido ─────────────────────────────────────────────────────────────
--
--   Alaskan   meta 14      simples 9
--   Aeliss    meta 14      simples 9    (sem receita: cai no configurado)
--   Ambas     meta 14      simples 9    (toda a receita e da Alaskan)
--
-- O imposto em reais não muda em nenhuma das três — só o percentual exibido.

do $$
declare def text; antigo text;
begin
  def := pg_get_functiondef('fn_overview'::regproc);
  if position('simples_peso' in def) > 0 then
    raise notice 'ja corrigido; nada a fazer';
    return;
  end if;

  antigo := E'      CASE WHEN r.receita > 0 THEN round(imp.simples / r.receita * 100, 4) ELSE 0 END AS simples_pct,\n'
    || E'      CASE WHEN g.gasto   > 0 THEN round(imp.meta    / g.gasto   * 100, 4) ELSE 0 END AS meta_pct,\n';
  if position(antigo in def) = 0 then
    raise exception 'ancora dos percentuais nao encontrada em fn_overview';
  end if;

  def := replace(def, antigo,
      E'      /* Media PONDERADA das aliquotas configuradas, e nao imposto/base: dividir\n'
   || E'         valores ja arredondados dava 14,0007%% onde o configurado e 14%%. Com uma\n'
   || E'         empresa so, isto devolve exatamente o configurado.\n'
   || E'         Sem base — empresa que ainda nao vendeu — cai no configurado dela, em vez\n'
   || E'         de exibir 0%%: a aliquota existe mesmo sem receita. Ver 20260901i. */\n'
   || E'      CASE WHEN r.receita > 0 THEN round(imp.simples_peso / r.receita, 4)\n'
   || E'           ELSE coalesce(fn_config(''imposto_simples_nacional_pct'', p_empresa), 0) END AS simples_pct,\n'
   || E'      CASE WHEN g.gasto > 0 THEN round(imp.meta_peso / g.gasto, 4)\n'
   || E'           ELSE coalesce(fn_config(''imposto_meta_ads_pct'', p_empresa), 0) END AS meta_pct,\n');

  antigo := E'            coalesce(sum(round(ge.gasto   * c.meta_pct    / 100, 2)), 0) AS meta\n';
  if position(antigo in def) = 0 then
    raise exception 'ancora do bloco `imp` nao encontrada';
  end if;
  def := replace(def, antigo,
      E'            coalesce(sum(round(ge.gasto   * c.meta_pct    / 100, 2)), 0) AS meta,\n'
   || E'            coalesce(sum(re.receita * c.simples_pct), 0) AS simples_peso,\n'
   || E'            coalesce(sum(ge.gasto   * c.meta_pct),    0) AS meta_peso\n');

  execute def;
end $$;
