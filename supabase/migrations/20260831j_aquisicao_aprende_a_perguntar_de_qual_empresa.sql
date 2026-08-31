/*
  As telas de Aquisição ganham o mesmo recorte que o Resumo já tem.

  Vendas, UTM, Meta Ads e Tendências leem `vendas` e `metricas_meta` — as duas
  tabelas que passaram a carregar `empresa_id` carimbado. Falta só cada função
  saber perguntar.

  A VIEW PRECISA VIR ANTES

  `fn_metricas_meta_agregado` não lê `metricas_meta` direto: lê
  `vw_metricas_meta_nivel`, que agrupa por nível e não carregava a empresa. A
  coluna entra no FIM da lista porque `CREATE OR REPLACE VIEW` só aceita coluna
  nova no fim — no meio, ele recusa.

  Podia-se ter filtrado na função por `conta → projeto → empresa` e deixado a
  view quieta. Seria a primeira armadilha do CLAUDE.md: duas formas de responder
  "de quem é esta linha de mídia", uma pelo carimbo e outra pela derivação, que
  discordam no dia em que um projeto trocar de empresa. O carimbo é a resposta,
  e ela tem de chegar inteira até quem pergunta.

  `p_empresa` nulo devolve tudo somado — o comportamento de hoje. Nenhuma
  chamada existente quebra.
*/

-- ── 1. A view leva a empresa adiante ─────────────────────────────────────────

do $migracao$
DECLARE
  def  text;
  novo text;
BEGIN
  def := 'CREATE OR REPLACE VIEW public.vw_metricas_meta_nivel AS'
      || pg_get_viewdef('public.vw_metricas_meta_nivel'::regclass, true);

  novo := replace(def,
    '    sum(mm.video_75pct) AS video_75pct' || E'\n' || '   FROM metricas_meta mm',
    '    sum(mm.video_75pct) AS video_75pct,' || E'\n' ||
    '    mm.empresa_id'                       || E'\n' || '   FROM metricas_meta mm');
  IF novo = def THEN RAISE EXCEPTION 'vw_metricas_meta_nivel: fim da lista de colunas nao encontrado'; END IF;

  def  := novo;
  novo := replace(def, '  GROUP BY mm.nivel, mm.produto', '  GROUP BY mm.empresa_id, mm.nivel, mm.produto');
  IF novo = def THEN RAISE EXCEPTION 'vw_metricas_meta_nivel: GROUP BY nao encontrado'; END IF;

  EXECUTE novo;
END
$migracao$;

-- ── 2. As quatro funções ganham p_empresa ────────────────────────────────────

do $migracao$
DECLARE
  alvo   record;
  def    text;
  passo1 text;
  novo   text;

  /*
    O bloco do filtro de contas é IDÊNTICO nas quatro, e é onde o de empresa
    entra ao lado. Em `fn_metricas_meta_agregado` ele aparece duas vezes — uma
    sobre a view, outra sobre `vendas` —, e `replace` troca as duas, que é
    exatamente o desejado: o gasto e a venda precisam do mesmo recorte.
  */
  FILTRO_VELHO constant text :=
'       AND (p_contas IS NULL OR cardinality(p_contas) = 0
            OR v.ad_account_id = ANY(p_contas))';

  FILTRO_NOVO constant text :=
'       AND (p_contas IS NULL OR cardinality(p_contas) = 0
            OR v.ad_account_id = ANY(p_contas))
       AND (p_empresa IS NULL OR v.empresa_id = p_empresa)';
BEGIN
  FOR alvo IN
    SELECT * FROM (VALUES
      -- `p_empresa` vai sempre no FIM da assinatura, para não deslocar nenhum
      -- argumento posicional de quem já chama estas funções.
      ('public.fn_utm_agregado(timestamptz,timestamptz,uuid[])',
       'p_contas uuid[] DEFAULT NULL::uuid[])',
       'p_contas uuid[] DEFAULT NULL::uuid[], p_empresa uuid DEFAULT NULL::uuid)'),
      ('public.fn_vendas_agregado(timestamptz,timestamptz,uuid[])',
       'p_contas uuid[] DEFAULT NULL::uuid[])',
       'p_contas uuid[] DEFAULT NULL::uuid[], p_empresa uuid DEFAULT NULL::uuid)'),
      ('public.fn_metricas_meta_agregado(date,date,uuid[])',
       'p_contas uuid[] DEFAULT NULL::uuid[])',
       'p_contas uuid[] DEFAULT NULL::uuid[], p_empresa uuid DEFAULT NULL::uuid)'),
      -- Esta tem argumentos DEPOIS de p_contas; a âncora é o último deles.
      ('public.fn_vendas_lista(timestamptz,timestamptz,uuid[],text,text,integer,integer)',
       'p_tamanho integer DEFAULT 50)',
       'p_tamanho integer DEFAULT 50, p_empresa uuid DEFAULT NULL::uuid)')
    ) AS t(assinatura, sig_velha, sig_nova)
  LOOP
    def := pg_get_functiondef(alvo.assinatura::regprocedure);

    passo1 := replace(def, alvo.sig_velha, alvo.sig_nova);
    IF passo1 = def THEN
      RAISE EXCEPTION '%: assinatura nao encontrada', alvo.assinatura;
    END IF;

    novo := replace(passo1, FILTRO_VELHO, FILTRO_NOVO);
    IF novo = passo1 THEN
      RAISE EXCEPTION '%: bloco do filtro de contas nao encontrado', alvo.assinatura;
    END IF;

    /* DROP e não CREATE OR REPLACE: argumento novo muda a assinatura, e as duas
       versões convivendo fariam toda chamada existente virar "function is not
       unique". Tudo dentro desta transação. */
    EXECUTE 'DROP FUNCTION ' || alvo.assinatura;
    EXECUTE novo;
  END LOOP;
END
$migracao$;

NOTIFY pgrst, 'reload schema';
