-- AS TRÊS VIEWS QUE EU CRIEI HOJE ESTAVAM FURANDO A RLS
--
-- Erro meu, achado por uma revisão adversarial e conferido por mim antes deste
-- conserto. Uma view em Postgres roda, por padrão, com os direitos do DONO —
-- `postgres` —, e não de quem consulta. Então ela passa POR FORA da RLS das
-- tabelas que lê.
--
-- Medido como `anon` no projeto, antes do conserto:
--
--   select count(*) from producoes                → 0      (a RLS funciona)
--   select count(*) from vendas                   → 0      (a RLS funciona)
--   select count(*) from vw_criativo_por_angulo   → 3.794  ← passou por fora
--   select count(*) from vw_ad_morrendo           → 6      ← passou por fora
--   select count(*) from vw_rev_tendencia         → 10     ← passou por fora
--
-- `anon` não é hipotético: `VITE_SUPABASE_ANON_KEY` é inlinada no bundle pelo
-- Vite, então a chave está no navegador de qualquer visitante. Um GET em
-- /rest/v1/vw_ad_morrendo devolvia verba e ROAS por anúncio; em
-- /rest/v1/vw_rev_tendencia, faturamento por REV; em
-- /rest/v1/vw_criativo_por_angulo, os 3.794 cards com nome do criativo, projeto
-- e o NOME DA EDITORA responsável — dado pessoal de funcionária.
--
-- O projeto já conhece o remédio: 16 migrações usam `security_invoker`, e a
-- 20260827zm escreve o motivo com todas as letras — "security_invoker para a
-- view NÃO virar um caminho por fora da RLS". Eu não usei em nenhuma das cinco
-- migrações de hoje.
--
-- ── O QUE ESTA MIGRAÇÃO FAZ, E O QUE NÃO FAZ ───────────────────────────────
--
-- Fecha as TRÊS que nasceram hoje. `vw_meta_status` e `vw_producao_estado_ads`
-- também estão abertas, mas já estavam antes de mim (20260829b e 20260916a não
-- usam o invoker), e o linter da Supabase conta 45 views assim no projeto
-- inteiro. Isso é uma varredura própria, com a decisão dela — não um efeito
-- colateral de um conserto de criativo.
--
-- ── ALTER, E NÃO CREATE OR REPLACE ─────────────────────────────────────────
--
-- `CREATE OR REPLACE VIEW` sem a cláusula `WITH` RESETA as reloptions. Se o
-- conserto virasse um replace sem `WITH (security_invoker = true)`, ele mesmo
-- desfaria o que veio fazer. E pelo mesmo motivo as migrações 20260924b/c/d
-- ganharam a cláusula no arquivo: rodar aquele arquivo de novo, num banco novo,
-- tem de produzir a view já fechada — senão o buraco volta na próxima
-- reconstrução, calado.

ALTER VIEW public.vw_criativo_por_angulo SET (security_invoker = on);
ALTER VIEW public.vw_ad_morrendo         SET (security_invoker = on);
ALTER VIEW public.vw_rev_tendencia       SET (security_invoker = on);

-- ── As provas ───────────────────────────────────────────────────────────────
--
-- HÁ DUAS FORMAS DE ESTAR FECHADA, e a primeira versão desta prova só conhecia
-- uma. Ela exigia "anon lê 0 linhas", e a migração explodiu com
-- `permission denied for table ofertas_editores` — que é um desfecho MELHOR:
-- com o invoker ligado, `anon` nem chega às linhas, porque lhe falta o próprio
-- GRANT sobre a tabela de baixo. Negado é mais forte que vazio.
--
-- Uma prova que só aceita um dos dois jeitos de acertar reprova o acerto.
DO $prova$
DECLARE
  v_sem text;
  v_estado text := '';
  v_producoes int;
  v_view text;
  v_n int;
BEGIN
  -- 1. As três carregam a opção. Lê de `pg_class.reloptions`, que é o fato —
  --    não de ter rodado o ALTER, que é a intenção. Aceita `on` e `true`
  --    porque o Postgres guarda o booleano como foi escrito, e o projeto usa
  --    `on` (ver `vw_criativo_funil`).
  SELECT string_agg(c.relname, ', ') INTO v_sem
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('vw_criativo_por_angulo', 'vw_ad_morrendo', 'vw_rev_tendencia')
     AND NOT coalesce(
           c.reloptions::text[] && ARRAY['security_invoker=on', 'security_invoker=true'],
           false);
  IF v_sem IS NOT NULL THEN
    RAISE EXCEPTION 'ainda sem security_invoker: %', v_sem;
  END IF;

  -- 2. A PROVA QUE VALE: o que o visitante consegue ler. Contar a opção não
  --    basta — ela poderia estar posta e a view continuar devolvendo linha.
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_producoes FROM public.producoes;

  FOREACH v_view IN ARRAY ARRAY['vw_criativo_por_angulo', 'vw_ad_morrendo', 'vw_rev_tendencia']
  LOOP
    BEGIN
      EXECUTE format('select count(*) from public.%I', v_view) INTO v_n;
      v_estado := concat_ws(' · ', nullif(v_estado, ''),
        v_view || '=' || CASE WHEN v_n = 0 THEN 'vazia' ELSE v_n::text || ' LINHAS' END);
    EXCEPTION WHEN insufficient_privilege THEN
      v_estado := concat_ws(' · ', nullif(v_estado, ''), v_view || '=negada');
    END;
  END LOOP;
  RESET ROLE;

  IF v_producoes <> 0 THEN
    RAISE EXCEPTION 'anon le % linhas de producoes direto — a RLS da tabela mudou e esta prova perdeu a referencia', v_producoes;
  END IF;
  IF v_estado LIKE '%LINHAS%' THEN
    RAISE EXCEPTION 'anon ainda le pelas views: %', v_estado;
  END IF;

  RAISE NOTICE 'fechadas — anon: producoes=0, %', v_estado;
END
$prova$;

NOTIFY pgrst, 'reload schema';
