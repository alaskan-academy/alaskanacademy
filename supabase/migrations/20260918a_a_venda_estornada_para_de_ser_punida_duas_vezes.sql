-- A VENDA ESTORNADA PARA DE SER PUNIDA DUAS VEZES
--
-- O proprio COMMENT desta view ja proibia o que ela fazia:
--
--   "venda reembolsada NAO esta em faturamento_bruto nem em receita_tributavel,
--    que so somam status aprovada: quem for descontar perda de uma dessas bases
--    esta punindo o mesmo evento duas vezes."
--
-- E `faturamento_liquido` e `margem_pct` descontavam `reembolsos` exatamente de
-- `receita_tributavel`. Nao e escolha contabil discutivel: alguem ja decidiu,
-- escreveu a regra no comentario, consertou o lado TypeScript
-- (src/lib/financeiro.ts:27 e o teste src/test/financeiro.test.ts:105, chamado
-- "nao desconta reembolso, porque a venda estornada ja saiu da receita") — e o
-- SQL ficou para tras. O teste de regressao existia e guardava so um dos dois
-- caminhos; foi por isso que este escapou por meses.
--
-- O ABSURDO NO NIVEL DA LINHA
--
-- Dois dias da base exibem prejuizo sem ter receita nenhuma, porque a subtracao
-- nao tem de onde sair:
--
--   2026-07-09  handify   receita 0,00     reembolsos 364,92   liquido -364,92
--   2026-08-30  handify   receita 297,00   reembolsos 368,64   liquido -120,64
--
-- O segundo e o caso limpo: as vendas aprovadas do dia valem R$ 297,00, o
-- estorno de uma venda de OUTRO dia vale R$ 368,64, e o dia fecha negativo.
--
-- QUANTO
--
--   soma de faturamento_liquido, historico    278.840,37  ->  291.623,73
--   agosto/2026                                27.763,55  ->   31.658,66
--   margem de agosto/2026                          14,06%  ->      16,03%
--   dias com receita 0 exibindo liquido <> 0            2  ->           0
--
-- O QUE NAO MUDA, E POR QUE CADA UM
--
--   `reembolsos`                    SettingsPage.tsx:171 le a coluna. Ela
--                                   continua existindo e continua sendo exibida
--                                   — so para de ser subtraida daqui.
--   `perda_reembolso` / `_chargeback`  FinanceiroResultadoPage.tsx:87 seleciona
--                                   as duas e as soma DE VOLTA no topo da
--                                   cascata (linhas 126-129), que e a forma
--                                   certa e ja esta certa. src/test/
--                                   resultado-do-mes.test.ts fixa 2.415,28 e
--                                   399,96 para agosto/2026.
--   `faturamento_bruto`, `base_simples`, `taxa_plataforma`, `investimento_meta`
--                                   fn_metas_sugeridas soma as quatro para os
--                                   ROAS de equilibrio da aba Contas/Anuncios.
--                                   A prova 5 abaixo congela as quatro.
--   `receita_tributavel`            JA desconta coproducao (20260902a). Mexer
--                                   subtrairia os R$ 1.254,04 duas vezes. Uma
--                                   analise anterior acusou esta view de nao
--                                   descontar coproducao; a acusacao e FALSA
--                                   sobre a view e verdadeira sobre a tela de
--                                   Configuracoes, que refaz a conta em JS a
--                                   partir de `faturamento_bruto`. O conserto
--                                   de la vai no mesmo commit.
--   `fn_perda_da_venda`             devolve o valor cheio em 137 de 141 linhas
--                                   revertidas, e e isso que as duas colunas de
--                                   perda precisam. O defeito nao e ela: e de
--                                   ONDE ela era subtraida.
--
-- O QUE NAO FOI FEITO, DE PROPOSITO
--
-- Nao trocamos os R$ 12.783,36 por uma coluna com o custo residual real (a taxa
-- da Payt que nao volta, R$ 202,60 em 90 dias). Duas razoes: a evidencia do
-- payload aponta que a Payt devolve a comissao no estorno, e `valor_reembolsado`
-- esta preenchido em 52 de 141 linhas. Criar campo sobre dado de 37% de
-- cobertura, para mover 0,045% da receita, e a segunda armadilha do CLAUDE.md.
-- Se um dia a Payt passar a reter, o lugar de tratar isso e uma coluna propria
-- com gatilho, nao este desconto.

DO $mig$
DECLARE
  v_def text;
  v_n   int;
  -- A mesma expressao serve `faturamento_liquido` e `margem_pct`: bate 2 vezes.
  de   constant text := 'receita_tributavel - taxa_plataforma - reembolsos - (receita_tributavel + juros_parc) * simples_pct / 100::numeric';
  para constant text := 'receita_tributavel - taxa_plataforma - (receita_tributavel + juros_parc) * simples_pct / 100::numeric';
BEGIN
  v_def := rtrim(btrim(pg_get_viewdef('vw_faturamento_liquido'::regclass, true)), ';');

  -- ja aplicada? a migracao pode rodar de novo sem estragar nada
  IF position(para IN v_def) = 0 THEN
    v_n := (length(v_def) - length(replace(v_def, de, ''))) / length(de);
    IF v_n <> 2 THEN
      RAISE EXCEPTION 'a ancora bate % vezes, esperava 2 — a definicao mudou', v_n;
    END IF;
    EXECUTE 'CREATE OR REPLACE VIEW vw_faturamento_liquido AS ' || replace(v_def, de, para);
  END IF;
END
$mig$;

COMMENT ON VIEW vw_faturamento_liquido IS
  'Faturamento, taxas, impostos e investimento por dia/produto/empresa. '
  'ATENCAO: `reembolsos` e a SOMA de `perda_reembolso` e `perda_chargeback` — '
  'as tres saem da mesma expressao e somar a total com uma das partes conta '
  'duas vezes. E venda reembolsada NAO esta em `faturamento_bruto` nem em '
  '`receita_tributavel`, que so somam status `aprovada`: quem for descontar '
  'perda de uma dessas bases esta punindo o mesmo evento duas vezes. '
  'Desde 20260918a, `faturamento_liquido` e `margem_pct` obedecem a essa regra '
  '— ate entao elas mesmas subtraiam `reembolsos` de `receita_tributavel`, que '
  'e exatamente o que este comentario proibia. Quem quiser o custo de um '
  'estorno soma `perda_reembolso`/`perda_chargeback` DE VOLTA no topo, como faz '
  'FinanceiroResultadoPage, e desce cada perda uma vez so.';

-- ── As provas ───────────────────────────────────────────────────────────────
DO $prova$
DECLARE
  v_n   int;
  v_val numeric;
  v_txt text;
BEGIN
  -- 1. o liquido passa a ser receita menos taxa, imposto e anuncio — e mais nada.
  --    Tolerancia de um centavo: a view arredonda o imposto na coluna e nao
  --    arredonda dentro da expressao do liquido.
  SELECT count(*) INTO v_n FROM vw_faturamento_liquido
   WHERE abs(faturamento_liquido - (receita_tributavel - taxa_plataforma
             - imposto_simples - imposto_meta_ads - investimento_meta)) > 0.01;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'faturamento_liquido nao fecha em % linhas', v_n;
  END IF;

  -- 2. dia sem receita e sem anuncio nao pode exibir prejuizo (eram 2)
  SELECT count(*) INTO v_n FROM vw_faturamento_liquido
   WHERE receita_tributavel = 0 AND investimento_meta = 0 AND faturamento_liquido <> 0;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'ainda ha % dias-fantasma', v_n;
  END IF;

  -- 3. agosto/2026 fecha no numero medido ANTES de aplicar
  SELECT round(sum(faturamento_liquido), 2) INTO v_val FROM vw_faturamento_liquido
   WHERE data >= '2026-08-01' AND data < '2026-09-01';
  IF v_val <> 31658.66 THEN
    RAISE EXCEPTION 'agosto/2026 deu %, esperava 31658.66', v_val;
  END IF;

  -- 4. as colunas de perda NAO se moveram — sao elas que o Financeiro soma de volta
  SELECT round(sum(reembolsos), 2) INTO v_val FROM vw_faturamento_liquido;
  IF v_val <> 12783.36 THEN
    RAISE EXCEPTION 'reembolsos mudou para %, deveria seguir em 12783.36', v_val;
  END IF;
  SELECT count(*) INTO v_n FROM vw_faturamento_liquido
   WHERE reembolsos IS DISTINCT FROM perda_reembolso + perda_chargeback;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'reembolsos deixou de ser a soma das partes em % linhas', v_n;
  END IF;

  -- 5. o que fn_metas_sugeridas le fica congelado — senao o ROAS de equilibrio
  --    da aba Contas/Anuncios muda sem ninguem pedir
  SELECT round(sum(faturamento_bruto),2) || '|' || round(sum(base_simples),2) || '|'
      || round(sum(taxa_plataforma),2) || '|' || round(sum(investimento_meta),2)
    INTO v_txt FROM vw_faturamento_liquido
   WHERE data >= '2026-08-01' AND data < '2026-09-01';
  IF v_txt <> '197824.60|202752.24|11946.83|118942.02' THEN
    RAISE EXCEPTION 'colunas lidas por fn_metas_sugeridas mudaram: %', v_txt;
  END IF;

  -- 6. a expressao proibida nao existe mais na definicao
  IF position('- reembolsos - (receita_tributavel' IN
              pg_get_viewdef('vw_faturamento_liquido'::regclass, true)) > 0 THEN
    RAISE EXCEPTION 'a subtracao de reembolsos continua na definicao da view';
  END IF;
END
$prova$;
