/*
  `fn_overview` ganha `p_empresa`, e com ela o Resumo passa a saber separar.

  Três filtros entram, e é importante que sejam três e não um:

    vendas          →  v.empresa_id     (carimbado pela Payt que recebeu)
    mídia           →  m.empresa_id     (carimbado pela conta de anúncio)
    alíquota/custo  →  fn_config(chave, p_empresa)

  Cada um vem de uma fonte diferente porque cada um NASCE em lugar diferente. O
  desenho errado — e o tentador — seria derivar tudo do projeto: aí o passado
  mudaria de dono junto com o projeto, e o faturamento de agosto da Alaskan
  viraria da Aeliss em setembro.

  O TERCEIRO É O QUE QUASE PASSOU BATIDO

  Faturamento e mídia separados, mas alíquota global, produziria o pior tipo de
  erro: o DRE da Aeliss com a receita dela e o imposto da Alaskan. Certo nos dois
  números grandes e errado no que fecha a conta.

  `p_empresa` nulo devolve tudo somado, exatamente como hoje. Nada quebra
  enquanto as telas ainda não passam empresa — e "Ambas" continua sendo uma
  resposta legítima para produção e criativos, só não para dinheiro somado.

  POR QUE DROP E NÃO CREATE OR REPLACE

  Parâmetro novo muda a assinatura: um CREATE OR REPLACE criaria uma SEGUNDA
  função de quatro argumentos ao lado da de cinco, e toda chamada existente
  viraria "function is not unique". A troca acontece dentro de uma transação, e
  o Resumo nunca vê o intervalo.
*/

do $migracao$
DECLARE
  def  text;
  novo text;
BEGIN
  def := pg_get_functiondef(
    'public.fn_overview(timestamptz, timestamptz, text, uuid[])'::regprocedure);

  -- ── 1. A assinatura ────────────────────────────────────────────────────────
  novo := replace(def,
    'p_contas uuid[] DEFAULT NULL::uuid[])',
    'p_contas uuid[] DEFAULT NULL::uuid[], p_empresa uuid DEFAULT NULL::uuid)');
  IF novo = def THEN RAISE EXCEPTION 'fn_overview: assinatura nao encontrada'; END IF;

  -- ── 2. As vendas ───────────────────────────────────────────────────────────
  def  := novo;
  novo := replace(def,
    '    WHERE (v_todas OR v.ad_account_id = ANY(p_contas))',
    '    WHERE (v_todas OR v.ad_account_id = ANY(p_contas))'      || E'\n' ||
    '      AND (p_empresa IS NULL OR v.empresa_id = p_empresa)');
  IF novo = def THEN RAISE EXCEPTION 'fn_overview: filtro de vendas nao encontrado'; END IF;

  -- ── 3. A midia ─────────────────────────────────────────────────────────────
  def  := novo;
  novo := replace(def,
    '       AND (v_todas OR m.ad_account_id = ANY(p_contas))'     || E'\n' ||
    '     GROUP BY 1',
    '       AND (v_todas OR m.ad_account_id = ANY(p_contas))'     || E'\n' ||
    '       AND (p_empresa IS NULL OR m.empresa_id = p_empresa)'  || E'\n' ||
    '     GROUP BY 1');
  IF novo = def THEN RAISE EXCEPTION 'fn_overview: filtro de midia nao encontrado'; END IF;

  -- ── 4. A aliquota e o custo fixo ───────────────────────────────────────────
  def  := novo;
  novo := replace(def,
    '  cfg AS ('                                                                                  || E'\n' ||
    '    SELECT'                                                                                  || E'\n' ||
    '      coalesce(max(valor) FILTER (WHERE chave = ''imposto_simples_nacional_pct''), 0) AS simples_pct,' || E'\n' ||
    '      coalesce(max(valor) FILTER (WHERE chave = ''imposto_meta_ads_pct''),         0) AS meta_pct,'    || E'\n' ||
    '      coalesce(max(valor) FILTER (WHERE chave = ''custo_fixo_mensal''),            0) AS custo_fixo'   || E'\n' ||
    '    FROM configuracoes'                                                                      || E'\n' ||
    '  ),',
    '  cfg AS ('                                                                                  || E'\n' ||
    '    SELECT'                                                                                  || E'\n' ||
    '      coalesce(fn_config(''imposto_simples_nacional_pct'', p_empresa), 0) AS simples_pct,'    || E'\n' ||
    '      coalesce(fn_config(''imposto_meta_ads_pct'',         p_empresa), 0) AS meta_pct,'       || E'\n' ||
    '      coalesce(fn_config(''custo_fixo_mensal'',            p_empresa), 0) AS custo_fixo'      || E'\n' ||
    '  ),');
  IF novo = def THEN RAISE EXCEPTION 'fn_overview: bloco cfg nao encontrado'; END IF;

  DROP FUNCTION public.fn_overview(timestamptz, timestamptz, text, uuid[]);
  EXECUTE novo;
END
$migracao$;

COMMENT ON FUNCTION public.fn_overview(timestamptz, timestamptz, text, uuid[], uuid) IS
  'KPIs do Resumo. `p_empresa` recorta as tres pontas pela fonte certa: venda pelo '
  'carimbo da Payt, midia pelo carimbo da conta, aliquota e custo fixo por '
  'fn_config. Nulo = tudo somado.';
