-- DEVOLVE producoes.funil_id PARA DESTRAVAR A PRODUCAO
--
-- URGENTE, E TEMPORARIO. A 20260921c apagou `producoes.funil_id` e, com ela, a
-- chave estrangeira criativos_funil_id_fkey. Cinco telas embutem
-- `funil:funis(id,nome,produto)` no select, e o PostgREST resolve embed pela
-- RELACAO: sem a chave ele recusa a consulta inteira em vez de devolver nulo.
--
-- O ERRO QUE A EQUIPE VE:
--   "Nao consegui carregar o calendario · Could not find a relationship between
--    'producoes' and 'funis' in the schema cache"
--
-- Caem junto: Calendario Geral, Meu Painel, Painel de Aprovacao, Kanban e o
-- CriativoDrawer.
--
-- POR QUE ISSO CHEGOU NA EQUIPE
--
-- O banco e COMPARTILHADO e a migracao vale na hora para todo mundo. O conserto
-- do codigo (commit aed70f3, que remove os cinco embeds) esta em commits LOCAIS
-- e nao foi empurrado — a aplicacao que a equipe usa roda o codigo antigo
-- contra o banco novo. Um DROP de coluna so e seguro quando o codigo que parou
-- de usa-la JA esta em producao; eu inverti a ordem.
--
-- O QUE ESTA MIGRACAO FAZ
--
-- Devolve a coluna VAZIA e a chave estrangeira, e so isso. Nenhum dado volta
-- porque nenhum dado existia: ela estava em 0 de 4.098 linhas, e o embed sempre
-- devolveu nulo. A tela volta a funcionar exatamente como funcionava ontem.
--
-- `funil_ids` NAO volta: nenhum embed dependia dela, so os filtros que ja foram
-- limpos no codigo — e aqueles filtros esvaziavam a tela, entao a ausencia
-- deles nao quebra nada em producao.
--
-- COMO ISTO SAI DAQUI
--
-- Quando o commit aed70f3 estiver em producao, esta coluna pode ser apagada de
-- novo, e ai sem quebrar nada. A ordem certa e: deploy do codigo primeiro, DROP
-- depois. Enquanto ela existir, `funil_id` continua sendo campo morto — nao
-- escrever nele, nao ler dele, nao criar filtro em cima dele.

ALTER TABLE producoes
  ADD COLUMN IF NOT EXISTS funil_id uuid REFERENCES funis(id);

COMMENT ON COLUMN producoes.funil_id IS
  'CAMPO MORTO, de volta so para destravar a producao. Estava em 0 de 4.098 '
  'linhas e foi apagado pela 20260921c; o DROP levou junto a chave estrangeira '
  'e derrubou cinco telas que embutem funil:funis(...) — o PostgREST resolve '
  'embed pela RELACAO, nao pela coluna. Volta VAZIO e assim deve ficar: de qual '
  'REV o criativo veio sai de vw_criativo_funil, derivado da venda. Apagar de '
  'novo so DEPOIS que o commit aed70f3 estiver em producao.';

-- ── As provas ───────────────────────────────────────────────────────────────
DO $prova$
DECLARE
  v_n int;
BEGIN
  -- 1. a coluna existe de novo
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'producoes' AND column_name = 'funil_id';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'funil_id nao voltou';
  END IF;

  -- 2. e a CHAVE ESTRANGEIRA tambem, que e o que o PostgREST precisa para o embed
  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE conrelid = 'producoes'::regclass AND contype = 'f'
     AND pg_get_constraintdef(oid) ILIKE '%funil_id%REFERENCES funis%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'a chave estrangeira para funis nao existe — o embed continua quebrado';
  END IF;

  -- 3. ela volta VAZIA: nenhum dado foi inventado
  SELECT count(*) INTO v_n FROM producoes WHERE funil_id IS NOT NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'funil_id voltou com % linhas preenchidas', v_n;
  END IF;

  -- 4. funil_ids continua fora, e deve continuar
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'producoes' AND column_name = 'funil_ids';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'funil_ids voltou sem ninguem pedir';
  END IF;

  -- 5. e o que substitui o campo morto continua de pe
  SELECT count(DISTINCT producao_id) INTO v_n FROM vw_criativo_funil;
  IF v_n < 300 THEN
    RAISE EXCEPTION 'vw_criativo_funil ligou so % cards', v_n;
  END IF;
END
$prova$;

-- O PostgREST guarda a relacao num cache de schema; sem isto ele so a enxerga
-- no proximo reload dele.
NOTIFY pgrst, 'reload schema';
