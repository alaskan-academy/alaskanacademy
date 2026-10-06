-- `fn_metas_sugeridas` ficou com DUAS receitas, uma bruta e uma liquida
-- ============================================================================
--
-- Defeito INTRODUZIDO pela 20261006c, achado na revisao do mesmo dia.
--
-- A funcao tem duas somas chamadas `receita`, em CTEs diferentes:
--
--   periodo.receita   sum(faturamento_bruto) de vw_faturamento_liquido
--   contas.receita    sum(valor_sem_juros - coproducao) direto de vendas
--
-- `faturamento_bruto` e, por definicao da view, BRUTO de coproducao — a coluna
-- liquida la se chama `receita_tributavel`. Antes da 20261006c as duas eram
-- brutas e concordavam; a migracao trocou so a de baixo, e as duas passaram a
-- medir coisas diferentes.
--
-- Isso importa porque elas se encontram no mesmo numero da tela:
--
--   sobra           = 1 - taxa/periodo.receita - simples * (base/periodo.receita)
--   roas_equilibrio = custo_marginal / sobra
--   roas_atual      = contas.receita / investimento
--
-- Denominador maior devolve sobra maior, e sobra maior devolve
-- `roas_equilibrio` MENOR. Ou seja: a barra desce e o painel diz que o anuncio
-- se paga antes de se pagar — com o ROAS atual ja medido na base menor. A aba
-- "Contas de Anuncios" (`ContasAnunciosTab.tsx`) imprime `roas_atual` na MESMA
-- linha da tabela em que mostra a barra, e e esse alvo que vai para
-- `roas_meta`. As duas pontas da comparacao estavam em bases diferentes.
--
-- Medido em 06/10/2026, janela de 30 dias, global:
--
--   receita bruta    R$ 203.999,37
--   receita liquida  R$ 202.414,59   (coproducao R$ 1.584,78, 0,78%)
--   sobra hoje       0,847798        -> roas_equilibrio otimista
--   sobra coerente   0,846607
--
-- O desvio global e pequeno porque a coproducao e 0,78% do total; na Aeliss ela
-- e 9,42%, e o alvo de ROAS e o que decide escalar. O erro nao e de tamanho, e
-- de par: comparar um numerador liquido com uma barra construida no bruto.
--
-- -- O que isto diz sobre a catraca da 20261006c -----------------------------
--
-- A prova n2 daquela migracao se dizia "derivado, nao listado": varria as cinco
-- funcoes atras de soma de dinheiro sem desconto de coproducao. Mas o filtro
-- era `linha LIKE '%valor_sem_juros%' OR '%valor_total%'`, e uma soma lida de
-- uma VIEW nao casa com nenhum dos dois. O guarda-corpo passou verde justo
-- sobre o defeito que a migracao criou — a terceira armadilha dentro da
-- ferramenta que existe para pegar a terceira armadilha.
--
-- A prova aqui embaixo cobre o buraco pelo lado do catalogo INTEIRO, nao das
-- cinco funcoes: nenhum objeto do schema pode somar `faturamento_bruto`. Hoje
-- so havia um, e e este.

DO $mig$
DECLARE
  v_def text;
  v_n   int;
  de    constant text := '      sum(faturamento_bruto)  AS receita,';
  para  constant text := E'      /* LIQUIDA de coproducao, igual a `contas.receita` ali embaixo.\n         Era `faturamento_bruto` e as duas se encontram no mesmo numero da\n         tela: esta e o denominador da sobra, aquela e o numerador do ROAS.\n         Em bases diferentes, a barra desce e o anuncio parece se pagar antes\n         de se pagar. Ver 20261006e. */\n      sum(receita_tributavel) AS receita,';
BEGIN
  v_def := pg_get_functiondef('fn_metas_sugeridas'::regproc);

  IF position(para IN v_def) = 0 THEN
    v_n := (length(v_def) - length(replace(v_def, de, ''))) / length(de);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'fn_metas_sugeridas: a ancora bate % vezes, esperava 1 -- a definicao mudou', v_n;
    END IF;
    EXECUTE replace(v_def, de, para);
  END IF;
END
$mig$;

-- -- As provas ---------------------------------------------------------------
DO $prova$
DECLARE
  v_n        int;
  v_taxa_pct numeric;
  v_esperado numeric;
  v_bruto    numeric;
  v_copro    numeric;
BEGIN
  -- 1. DERIVADA, e sobre o catalogo INTEIRO: ninguem soma a coluna bruta da
  --    view. E esta a varredura que faltava na 20261006c — ela olhava cinco
  --    funcoes e so os nomes de coluna de `vendas`.
  SELECT count(*) INTO v_n
  FROM (
    SELECT regexp_split_to_table(pg_get_functiondef(p.oid), E'\n') AS linha
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
    UNION ALL
    SELECT regexp_split_to_table(pg_get_viewdef(c.oid, true), E'\n')
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v','m')
  ) l
  WHERE linha ~ 'sum\s*\(\s*faturamento_bruto';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'ainda ha % soma(s) de faturamento_bruto no schema', v_n;
  END IF;

  -- 2. COMPORTAMENTAL: `taxa_pct` e `100 * taxa / periodo.receita`, e a funcao
  --    devolve ele. Entao da para conferir o DENOMINADOR por fora, contra a
  --    mesma view e a mesma janela. Sem numero cravado: a janela anda com o
  --    calendario e um numero fixo apodreceria em um dia.
  SELECT taxa_pct INTO v_taxa_pct FROM fn_metas_sugeridas(30) LIMIT 1;

  SELECT round(100 * sum(taxa_plataforma) / nullif(sum(receita_tributavel), 0), 3),
         round(100 * sum(taxa_plataforma) / nullif(sum(faturamento_bruto), 0), 3),
         sum(coproducao)
    INTO v_esperado, v_bruto, v_copro
  FROM vw_faturamento_liquido
  WHERE data >= current_date - 30 AND data < current_date;

  IF v_taxa_pct IS DISTINCT FROM v_esperado THEN
    RAISE EXCEPTION 'taxa_pct veio % e a conta pela receita liquida da %',
                    v_taxa_pct, v_esperado;
  END IF;

  -- 3. A troca MOVEU algo. Sem isto, a prova 2 passaria verde numa janela sem
  --    coproducao nenhuma, onde as duas bases coincidem e nada foi provado.
  IF coalesce(v_copro, 0) <= 0 THEN
    RAISE EXCEPTION 'janela de 30 dias sem coproducao: a prova 2 virou tautologia';
  END IF;
  IF v_esperado = v_bruto THEN
    RAISE EXCEPTION 'a base bruta e a liquida dao o mesmo taxa_pct: nada foi provado';
  END IF;

  RAISE NOTICE 'taxa_pct = % (pela liquida); pela bruta daria % — coproducao % na janela',
               v_taxa_pct, v_bruto, v_copro;
END
$prova$;
