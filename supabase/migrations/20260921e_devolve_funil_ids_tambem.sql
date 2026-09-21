-- DEVOLVE producoes.funil_ids TAMBEM
--
-- A 20260921d devolveu `funil_id` e a chave estrangeira, e destravou o embed.
-- Mas o erro mudou em vez de sumir:
--
--   "Nao consegui carregar o calendario · column producoes.funil_ids does not exist"
--
-- O codigo em producao pede as DUAS. CalendarioView seleciona `funil_ids` na
-- mesma string de colunas, e PorProjetoView e AvaliacaoView tambem. Eu devolvi
-- uma e achei que tinha acabado — conserto pela metade, sob pressao, e a equipe
-- pagou por ele com um segundo ciclo de tela quebrada.
--
-- A LICAO, QUE E A MESMA DA 20260921d COM OUTRA ROUPA
--
-- Nao basta reverter o que eu LEMBRO de ter apagado. O certo era pegar a
-- consulta que o codigo de `origin/main` faz, rodar ela contra o banco, e so
-- entao dizer que estava resolvido. Foi o que fiz agora, e e o que fecha esta
-- migracao na prova 3.
--
-- Tipo exato: uuid[] NOT NULL DEFAULT '{}'. E o mesmo de antes — o codigo faz
-- `(c.funil_ids ?? []).includes(f)` e `cardinality(...)`, entao nulo quebraria
-- de outro jeito.
--
-- Volta VAZIA, e assim deve ficar. Ela estava em 0 de 4.098 antes de ser
-- apagada, e continua em 0. De qual REV o criativo veio sai de
-- `vw_criativo_funil`, derivado da venda.
--
-- COMO AS DUAS SAEM DAQUI, NA ORDEM CERTA
--
--   1. o codigo que parou de usa-las vai para producao (commit aed70f3 e os
--      que limparam os filtros)
--   2. SO ENTAO o DROP das duas
--
-- Enquanto isso nao acontecer, as duas sao campo morto: nao escrever, nao ler,
-- nao criar filtro em cima.

ALTER TABLE producoes
  ADD COLUMN IF NOT EXISTS funil_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

COMMENT ON COLUMN producoes.funil_ids IS
  'CAMPO MORTO, de volta so para destravar a producao — ver funil_id e a '
  'migracao 20260921e. Estava em 0 de 4.098 linhas; os filtros que liam dela '
  'esvaziavam a tela sem erro. De qual REV o criativo veio sai de '
  'vw_criativo_funil, derivado da venda. Apagar as duas so DEPOIS que o codigo '
  'que parou de usa-las estiver em producao.';

-- ── As provas ───────────────────────────────────────────────────────────────
DO $prova$
DECLARE
  v_n     int;
  v_cards int;
BEGIN
  -- 1. as duas colunas existem de novo
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'producoes'
     AND column_name IN ('funil_id', 'funil_ids');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'esperava as 2 colunas de volta, achei %', v_n;
  END IF;

  -- 2. nenhum card se perdeu, que e o que ela pediu em voz alta
  SELECT count(*) INTO v_cards FROM producoes;
  IF v_cards < 4098 THEN
    RAISE EXCEPTION 'producoes tem % cards, eram 4.098', v_cards;
  END IF;

  -- 3. A PROVA QUE FALTOU DA PRIMEIRA VEZ: a consulta que o codigo de producao
  --    faz roda inteira. Nao "as colunas que eu lembro", a consulta de verdade.
  PERFORM p.id, p.nome, p.tipo, p.fase, p.funil_video, p.data_inicio,
          p.data_prazo, p.editor_nome_historico, p.funil_ids, p.tipo_teste,
          f.nome, oe.nome, pe.nome
     FROM producoes p
     LEFT JOIN funis f             ON f.id  = p.funil_id
     LEFT JOIN ofertas_editores oe ON oe.id = p.projeto_id
     LEFT JOIN perfis pe           ON pe.id = p.responsavel_id
    LIMIT 5;

  -- 4. e a chave estrangeira, que e o que o PostgREST usa para o embed
  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE conrelid = 'producoes'::regclass AND contype = 'f'
     AND pg_get_constraintdef(oid) ILIKE '%funil_id%REFERENCES funis%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'a chave estrangeira para funis sumiu de novo';
  END IF;

  -- 5. as duas voltaram VAZIAS: nada foi inventado
  SELECT count(*) INTO v_n FROM producoes
   WHERE funil_id IS NOT NULL OR cardinality(funil_ids) > 0;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% linhas voltaram com funil preenchido', v_n;
  END IF;
END
$prova$;

NOTIFY pgrst, 'reload schema';
