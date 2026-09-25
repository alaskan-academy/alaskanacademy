-- FASE 3, PARTE 2: `funil_video` SAI, NA ORDEM CERTA
--
-- A coluna guardava TSL / VSL / QUIZ — o MÉTODO do vídeo, não o funil. O nome
-- era dívida antiga, e ele convivia com `producoes.funil_id`, que era outra
-- coisa. Duas colunas com "funil" no nome significando coisas diferentes é como
-- a primeira armadilha do CLAUDE.md começa.
--
-- A ORDEM QUE ESTA MIGRAÇÃO FECHA
--
--   fase 1 (20260921g)  `metodo_video` nasce ao lado, preenchida, com gatilho
--                        mantendo as duas em sincronia nos dois sentidos
--   fase 2 (21/09)       o código TypeScript passa a ler e escrever a nova
--   fase 2½ (20260925b)  o SQL também — 3 views e 1 função que um grep no src/
--                        nunca acharia, e que eu só vi ao tentar apagar
--   fase 3 (esta)        o gatilho, o espelho e a coluna saem
--
-- Entre a fase 1 e agora as duas colunas coexistiram SEM poder divergir, porque
-- nenhuma era editável sozinha: o gatilho derivava uma da outra. É a forma que
-- o CLAUDE.md pede quando dois campos precisam conviver por compatibilidade.
--
-- ── POR QUE SÓ AGORA ───────────────────────────────────────────────────────
--
-- "Nunca apagar coluna antes de o código que parou de usá-la estar em
-- produção." Em 21/09 essa regra foi quebrada e a Produção caiu DUAS VEZES no
-- mesmo dia, com colunas provadamente vazias — porque o código que ainda as
-- usava estava no ar e o conserto estava na máquina de quem apagou.
--
-- O deploy do código novo subiu hoje, 25/09, e ela confirmou.
--
-- ── A VERIFICAÇÃO QUE VALE ─────────────────────────────────────────────────
--
-- Não é listar o que eu lembro de ter trocado: é conferir, contra o banco, que
-- TODA consulta que o código de `origin/main` faz sobre `producoes` continua
-- possível depois do DROP. Levantei as 23 chamadas `from('producoes')` no
-- código e as duas formas de quebra que o CLAUDE.md nomeia:
--
--   · as COLUNAS que os `select(...)` pedem — a prova 2 confere uma a uma;
--   · os EMBEDS do PostgREST, que são resolvidos pela RELAÇÃO e não pela
--     coluna, e por isso um grep pelo nome da coluna não encontra. São quatro
--     (`responsavel_id`, `copy_id`, `gestor_id`, `projeto_id`) e nenhum passa
--     por `funil_video`, que nunca teve chave estrangeira. A prova 3 confere
--     que as quatro chaves seguem de pé.
--
-- Há também um `select('*')` em `CriativoDrawer`. Esse é o caso benigno: com
-- `*`, a coluna a menos simplesmente não vem — não há nome a resolver.

-- ── 1. O espelho sai primeiro ───────────────────────────────────────────────
-- Antes da coluna, senão o gatilho dispara sobre um campo que não existe mais.
DROP TRIGGER IF EXISTS trg_espelha_metodo_video ON producoes;
DROP FUNCTION IF EXISTS public.fn_espelha_metodo_video();

-- ── 2. E então a coluna ─────────────────────────────────────────────────────
ALTER TABLE producoes DROP COLUMN IF EXISTS funil_video;

-- ── 3. As opções velhas do seletor ──────────────────────────────────────────
-- `criativo_campos_opcoes` guardava as mesmas quatro opções sob os dois nomes.
-- As de `metodo_video` ficam; as de `funil_video` seguem a coluna.
DELETE FROM criativo_campos_opcoes WHERE campo = 'funil_video';

-- ── As provas ───────────────────────────────────────────────────────────────
DO $prova$
DECLARE
  v_n int;
  v_falta text;
BEGIN
  -- 1. A coluna morreu mesmo, e a que fica está inteira.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'producoes' AND column_name = 'funil_video') THEN
    RAISE EXCEPTION 'funil_video continua de pe';
  END IF;

  SELECT count(*) INTO v_n FROM producoes WHERE metodo_video IS NOT NULL;
  IF v_n < 2000 THEN
    RAISE EXCEPTION 'metodo_video ficou com so % linhas — o dado foi junto', v_n;
  END IF;

  -- 2. TODA coluna que algum `select(...)` do código pede sobre `producoes`
  --    continua existindo. A lista saiu das 23 chamadas `from('producoes')`.
  SELECT string_agg(c, ', ') INTO v_falta
    FROM unnest(ARRAY[
      'id','nome','tipo','fase','tipo_teste','projeto_id','criado_em','avaliacao',
      'metodo_video','formato','data_inicio','status_veiculacao','responsavel_id',
      'copy_id','gestor_id','angulo_teste','nivel_consciencia','funil_alvo_id'
    ]) AS c
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'producoes' AND column_name = c);
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'o DROP levou junto colunas que o codigo pede: %', v_falta;
  END IF;

  -- 3. Os EMBEDS do PostgREST dependem da CHAVE ESTRANGEIRA, não do nome da
  --    coluna — foi assim que o DROP da terça derrubou cinco telas sem que
  --    nenhum grep denunciasse. As quatro relações que o código embute:
  SELECT string_agg(k, ', ') INTO v_falta
    FROM unnest(ARRAY['responsavel_id','copy_id','gestor_id','projeto_id']) AS k
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'producoes' AND c.contype = 'f'
       AND pg_get_constraintdef(c.oid) ILIKE '%(' || k || ')%');
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'chave estrangeira ausente, o embed do PostgREST quebra: %', v_falta;
  END IF;

  -- 4. Ninguém no banco cita mais a coluna. Depois da 20260925b só o espelho
  --    citava, e o espelho acabou de sair.
  SELECT string_agg(nome, ', ') INTO v_falta FROM (
    SELECT c.relname::text AS nome
      FROM pg_rewrite r JOIN pg_class c ON c.oid = r.ev_class
     WHERE pg_get_ruledef(r.oid) ILIKE '%funil_video%'
    UNION
    SELECT p.proname::text
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND pg_get_functiondef(p.oid) ILIKE '%funil_video%'
  ) x;
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'ainda citam funil_video: %', v_falta;
  END IF;

  -- 5. As telas que liam a coluna continuam devolvendo linha. Consulta vazia
  --    aqui seria o estrago da terça repetido, e ele não dá erro: some.
  SELECT count(*) INTO v_n FROM vw_gestor_fila;
  IF v_n = 0 THEN RAISE EXCEPTION 'vw_gestor_fila secou'; END IF;
  SELECT count(*) INTO v_n FROM vw_esteira_lotes;
  IF v_n = 0 THEN RAISE EXCEPTION 'vw_esteira_lotes secou'; END IF;

  -- 6. E o seletor do formulário continua com o que mostrar.
  SELECT count(*) INTO v_n FROM criativo_campos_opcoes WHERE campo = 'metodo_video';
  IF v_n < 4 THEN
    RAISE EXCEPTION 'sobraram so % opcoes de metodo_video — o seletor abre vazio', v_n;
  END IF;

  RAISE NOTICE 'funil_video saiu · metodo_video com % linhas · gestor_fila e esteira de pe',
    (SELECT count(*) FROM producoes WHERE metodo_video IS NOT NULL);
END
$prova$;

NOTIFY pgrst, 'reload schema';
