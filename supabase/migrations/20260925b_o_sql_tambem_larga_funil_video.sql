-- FASE 3, PARTE 1: O SQL TAMBÉM LARGA `funil_video`
--
-- A fase 2 trocou 40 ocorrências em 9 arquivos de TypeScript e eu dei o rename
-- por feito. Não estava: o BANCO continuava lendo a coluna em quatro lugares, e
-- eu só descobri ao ir apagar a coluna.
--
--   vw_gestor_fila        ← o painel do Gestor de Tráfego, a tela que ela abre
--   vw_pedidos_variacao
--   vw_esteira_lotes
--   fn_esteira_defasagem
--
-- Um `grep` no `src/` nunca ia achar isso — é a mesma lição da terça, quando o
-- DROP de `producoes.funil_id` derrubou cinco telas: a busca precisa cobrir o
-- SQL também, e o CLAUDE.md diz isso com todas as letras.
--
-- ── POR QUE ESTA PARTE NÃO ESPERA O DEPLOY ─────────────────────────────────
--
-- Porque ela é invisível para quem consome. As views continuam devolvendo as
-- MESMAS colunas com os MESMOS valores: `metodo_video` e `funil_video` estão
-- sincronizadas pelo gatilho desde 21/09 e divergem em 0 de 4.103 linhas.
-- Trocar de qual das duas a view lê não muda uma célula — e o `md5` do conteúdo
-- antes e depois prova isso, view por view.
--
-- O que espera o deploy é a parte 2: derrubar o gatilho espelho e a coluna.
-- Essa sim quebra código antigo que ainda faça `select funil_video`.
--
-- ── A FUNÇÃO TINHA NOME DE COLUNA, E ISSO ATRAPALHOU DUAS VEZES ────────────
--
-- `fn_funil_video_norm(text)` não lê a coluna: normaliza texto qualquer
-- ("TSL, VSL" → "TSL+VSL"). Mas o NOME dela contém `funil_video`, e isso
-- estragou duas tentativas desta migração:
--
--   1. Um `replace` cego na definição da view transformou a CHAMADA em
--      `fn_metodo_video_norm`, que não existia — o Postgres recusou. Se por
--      acaso existisse, a view passaria a chamar outra coisa em silêncio.
--   2. A prova, procurando `funil_video` nas definições, casou com o nome da
--      função e acusou as quatro de ainda lerem a coluna. Falso positivo na
--      própria verificação.
--
-- Então a função é renomeada junto. Some o nome que fala de uma coluna que está
-- para morrer, a substituição cega passa a ser a correta, e a prova fica sem
-- ambiguidade: depois desta migração, a string `funil_video` só pode aparecer
-- no espelho, que é a ponte e cai na parte 2.
--
-- ── A ARMADILHA DE RECRIAR VIEW ────────────────────────────────────────────
--
-- `CREATE OR REPLACE VIEW` a partir de `pg_get_viewdef` PERDE as reloptions — e
-- entre elas está o `security_invoker` que a 20260925a pôs hoje de manhã.
-- Recriar sem devolver a opção reabriria o buraco de RLS, calado. O bloco
-- guarda as reloptions antes e as devolve depois; a prova 5 confere.

-- ── 1. A função, com o nome certo ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_metodo_video_norm(t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT nullif((
    SELECT string_agg(v, '+' ORDER BY v)
      FROM (SELECT DISTINCT upper(trim(p)) AS v
              FROM unnest(string_to_array(coalesce(t,''), ',')) AS p
             WHERE trim(p) <> '') s
  ), '')
$fn$;

COMMENT ON FUNCTION public.fn_metodo_video_norm(text) IS
  'Normaliza o metodo do video: "TSL, VSL" e "VSL,TSL" viram "TSL+VSL". Sucede fn_funil_video_norm, que tinha nome de coluna. Ver 20260925b.';

DO $fase3$
DECLARE
  v_def text; v_opts text[];
  v_md5_antes text; v_md5_depois text;
  v_n_antes int; v_n_depois int;
  v_trocadas int := 0;
  v_alvos text[] := ARRAY['vw_gestor_fila', 'vw_pedidos_variacao', 'vw_esteira_lotes'];
  v_view text;
BEGIN
  -- ── 2. As views: troca a coluna E a chamada da função, e confere o conteúdo
  FOREACH v_view IN ARRAY v_alvos LOOP
    SELECT pg_get_viewdef(('public.' || v_view)::regclass, true), c.reloptions
      INTO v_def, v_opts
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = v_view;

    IF v_def NOT ILIKE '%funil_video%' THEN
      RAISE NOTICE '% ja nao cita funil_video — pulando', v_view;
      CONTINUE;
    END IF;

    /* Retrato do ANTES: contagem E conteúdo. Só contar não bastaria — trocar a
       coluna errada manteria o número de linhas e mudaria os valores. */
    EXECUTE format('select count(*), md5(coalesce(string_agg(t::text, E''\n'' order by t::text), ''''))
                      from public.%I t', v_view) INTO v_n_antes, v_md5_antes;

    EXECUTE format('create or replace view public.%I as %s',
                   v_view, replace(v_def, 'funil_video', 'metodo_video'));

    IF v_opts IS NOT NULL THEN
      EXECUTE format('alter view public.%I set (%s)', v_view, array_to_string(v_opts, ', '));
    END IF;

    EXECUTE format('select count(*), md5(coalesce(string_agg(t::text, E''\n'' order by t::text), ''''))
                      from public.%I t', v_view) INTO v_n_depois, v_md5_depois;

    IF v_n_antes <> v_n_depois OR v_md5_antes IS DISTINCT FROM v_md5_depois THEN
      RAISE EXCEPTION '% mudou de conteudo: % linhas/% -> % linhas/% — a troca nao era inocua',
        v_view, v_n_antes, left(v_md5_antes,8), v_n_depois, left(v_md5_depois,8);
    END IF;

    v_trocadas := v_trocadas + 1;
  END LOOP;

  -- ── 3. A função da esteira ────────────────────────────────────────────────
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_esteira_defasagem';

  IF v_def ILIKE '%funil_video%' THEN
    EXECUTE replace(v_def, 'funil_video', 'metodo_video');
    v_trocadas := v_trocadas + 1;
  END IF;

  -- ── As provas ─────────────────────────────────────────────────────────────
  --
  -- A ORDEM AQUI É PARTE DA PROVA. A comparação entre a função nova e a velha
  -- precisa da velha VIVA; a varredura por `funil_video` precisa dela MORTA,
  -- senão casa com o próprio nome dela — foi o que derrubou a tentativa
  -- anterior. Então: compara, derruba, varre.

  -- 1. A função nova responde igual à velha, no dado real — senão a troca
  --    mudaria em silêncio o agrupamento da fila do gestor.
  SELECT count(*) INTO v_n_antes FROM producoes
   WHERE public.fn_metodo_video_norm(metodo_video)
         IS DISTINCT FROM public.fn_funil_video_norm(funil_video);
  IF v_n_antes <> 0 THEN
    RAISE EXCEPTION 'a funcao nova diverge da velha em % linhas', v_n_antes;
  END IF;

  -- 2. Agora a velha pode sair: nada mais a chama.
  DROP FUNCTION IF EXISTS public.fn_funil_video_norm(text);

  -- 3. E aí sim: ninguém mais cita `funil_video`, exceto o espelho — que É a
  --    ponte entre as duas colunas e cai na parte 2, junto com a coluna.
  SELECT string_agg(nome, ', ') INTO v_def FROM (
    SELECT c.relname::text AS nome
      FROM pg_rewrite r JOIN pg_class c ON c.oid = r.ev_class
     WHERE pg_get_ruledef(r.oid) ILIKE '%funil_video%' AND c.relname <> 'producoes'
    UNION
    SELECT p.proname::text
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND pg_get_functiondef(p.oid) ILIKE '%funil_video%'
       AND p.proname <> 'fn_espelha_metodo_video'
  ) x;
  IF v_def IS NOT NULL THEN
    RAISE EXCEPTION 'ainda citam funil_video: %', v_def;
  END IF;

  -- 4. As duas colunas continuam idênticas. Se tivessem divergido, o md5 já
  --    teria gritado — isto é o cinto além do suspensório.
  SELECT count(*) INTO v_n_antes FROM producoes
   WHERE metodo_video IS DISTINCT FROM funil_video;
  IF v_n_antes <> 0 THEN
    RAISE EXCEPTION '% linhas com metodo_video <> funil_video', v_n_antes;
  END IF;

  -- 5. Nenhuma view recriada perdeu o `security_invoker`.
  SELECT string_agg(c.relname, ', ') INTO v_def
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = ANY (v_alvos)
     AND NOT coalesce(c.reloptions::text[] && ARRAY['security_invoker=on','security_invoker=true'], false);
  IF v_def IS NOT NULL THEN
    RAISE EXCEPTION 'o replace comeu o security_invoker de: % — o buraco de RLS voltaria calado', v_def;
  END IF;

  RAISE NOTICE 'fase 3 parte 1: % objetos trocados, conteudo identico, invoker preservado', v_trocadas;
END
$fase3$;

NOTIFY pgrst, 'reload schema';
