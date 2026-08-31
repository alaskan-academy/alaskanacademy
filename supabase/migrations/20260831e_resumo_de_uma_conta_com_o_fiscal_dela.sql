/*
  O Resumo de uma conta mostrava o imposto e o reembolso da empresa inteira.

  O bloco `fiscal` de `fn_overview` lia `vw_faturamento_liquido` filtrando só por
  DATA — nunca por conta. O faturamento e o investimento respeitavam a conta
  escolhida; o imposto e o reembolso, não. O resultado era um prejuízo que não
  existe.

  Medido em 31/08/2026, filtrando "Desafios na Sala - TSL" nos últimos 30 dias:

      faturamento      R$  3.599,29   correto
      investimento     R$  3.285,86   correto
      imposto Simples  R$ 19.712,66   deveria ser R$   343,41   (57x)
      reembolsos       R$  2.815,24   deveria ser R$     0,00

  R$ 22.184 de perda inventada sobre R$ 3.599 de receita. Quem olhasse o Resumo
  de uma conta sozinha concluiria que ela dá prejuízo — qualquer uma delas.

  A CORREÇÃO

  O fiscal passa a sair da MESMA base que o resto: `base`/`aprovadas`, que já
  respeitam conta, período e segmento. A alíquota continua vindo de
  `configuracoes`, que é o único lugar onde ela é escrita.

  De quebra, `fn_overview` deixa de depender de `vw_faturamento_liquido`. A view
  casa gasto com venda por `produto`, e `produto` está prestes a deixar de
  identificar uma empresa só — o Resumo sai dessa armadilha antes de cair nela.

  `invest_conta` some junto: `gasto_dia` já soma o mesmo investimento com o mesmo
  filtro, e dois campos dizendo a mesma coisa sempre acabam discordando.

  POR QUE A MIGRAÇÃO REESCREVE O TEXTO DA FUNÇÃO

  Trocar dois blocos de uma função de 10 KB redigitando o resto convida a um erro
  de transcrição em cima de dinheiro. Aqui os blocos são localizados por âncora e
  substituídos; se qualquer um não for encontrado, a migração levanta exceção e
  não aplica nada.
*/

do $migracao$
DECLARE
  def  text;
  novo text;

  fiscal_novo constant text :=
'  cfg AS (
    SELECT
      coalesce(max(valor) FILTER (WHERE chave = ''imposto_simples_nacional_pct''), 0) AS simples_pct,
      coalesce(max(valor) FILTER (WHERE chave = ''imposto_meta_ads_pct''),         0) AS meta_pct,
      coalesce(max(valor) FILTER (WHERE chave = ''custo_fixo_mensal''),            0) AS custo_fixo
    FROM configuracoes
  ),
  -- O fiscal sai da base filtrada, e nao da view: conta escolhida, periodo e
  -- segmento ja estao aplicados em `base` e `aprovadas`.
  fiscal AS (
    SELECT
      (SELECT coalesce(sum(fn_perda_da_venda(valor_total, valor_reembolsado)), 0)
         FROM base WHERE status IN (''reembolsada'',''chargeback''))  AS reembolsos,
      round((SELECT coalesce(sum(coalesce(valor_sem_juros, valor_total)), 0)
               FROM aprovadas) * c.simples_pct / 100, 2)              AS imposto_simples,
      round(g.gasto * c.meta_pct / 100, 2)                            AS imposto_meta,
      g.gasto                                                         AS investimento_meta,
      c.simples_pct                                                   AS simples_pct,
      c.meta_pct                                                      AS meta_pct,
      c.custo_fixo                                                    AS custo_fixo_mensal
    FROM cfg c,
         (SELECT coalesce(sum(investimento), 0) AS gasto FROM gasto_dia) g
  )
';
BEGIN
  def := pg_get_functiondef(
    'public.fn_overview(timestamptz, timestamptz, text, uuid[])'::regprocedure);

  -- 1. O bloco fiscal, da abertura ate o primeiro fechamento na coluna 2.
  novo := regexp_replace(def, '  fiscal AS \(\n.*?\n  \)\n', fiscal_novo);
  IF novo = def THEN
    RAISE EXCEPTION 'fn_overview: bloco `fiscal` nao encontrado — a funcao mudou desde 31/08/2026';
  END IF;
  IF position('vw_faturamento_liquido' in novo) > 0 THEN
    RAISE EXCEPTION 'fn_overview: ainda restou referencia a vw_faturamento_liquido';
  END IF;

  -- 2. invest_conta, que virou duplicata de gasto_dia.
  def  := novo;
  novo := regexp_replace(def, '  invest_conta AS \(\n.*?\n  \),\n', '');
  IF novo = def THEN
    RAISE EXCEPTION 'fn_overview: bloco `invest_conta` nao encontrado';
  END IF;

  EXECUTE novo;
END
$migracao$;

COMMENT ON FUNCTION public.fn_overview(timestamptz, timestamptz, text, uuid[]) IS
  'KPIs do Resumo. Imposto, reembolso e investimento saem da MESMA base filtrada '
  'que o faturamento (conta, periodo e segmento) — ate 31/08/2026 o fiscal vinha '
  'de vw_faturamento_liquido sem filtro de conta e inflava o imposto em ate 57x.';
