-- Quatro funcoes SECURITY DEFINER fecham para anonimo
-- ============================================================================
--
-- Achado pela reavaliacao de fim de dia, e este nao e teorico: foi lido com a
-- chave publica.
--
-- -- O que estava aberto ------------------------------------------------------
--
--   fn_gravar_payloads(jsonb)   DEFINER e ESCREVE em `transacoes`.
--                               Chamavel por anon. E o pior dos quatro.
--   fn_vsl_do_rev(uuid,date,date)        DEFINER, devolve faturamento por REV
--   fn_vsl_do_rev_bloco(uuid,date,date)  e a URL do checkout.
--   fn_ultima_execucao_cron(text)        DEFINER, devolve quando cada job rodou.
--
-- Medido: com a chave publica, `/rest/v1/vendas` devolve `[]` (a RLS funciona),
-- mas `/rest/v1/rpc/fn_vsl_do_rev` EXECUTA e devolve dado — inclusive
-- `candidatos: ["https://payt.site/6mC8pVn"]`, que e um checkout que anon nao
-- consegue ler da tabela. SECURITY DEFINER passa por cima da RLS por desenho;
-- o que nao podia e estar aberta a quem nao fez login.
--
-- -- De onde veio -------------------------------------------------------------
--
-- Do padrao do Postgres: funcao nova nasce com EXECUTE para PUBLIC. A
-- 20260825x_funcoes_fechadas_para_anonimo.sql foi escrita exatamente para
-- fechar isso e fechou 24 funcoes. As duas da VSL nasceram em 08 e 09/09,
-- DEPOIS da faxina, e ficaram de fora.
--
-- A `fn_gravar_payloads` e pior: ela TINHA o revoke, na
-- 20260824m_gravar_payloads.sql linha 37. A
-- 20260909c fez DROP + CREATE do corpo e nao reemitiu o revoke — e DROP apaga
-- o grant junto. E a terceira armadilha aplicada a permissao: a lista de
-- funcoes fechadas vive no passado, e quem recria uma nao sabe que precisa
-- refazer.
--
-- -- Por que so estas quatro, e nao todas as DEFINER --------------------------
--
-- Porque as outras DEFINER do schema NAO TEM ARGUMENTOS: sao gatilhos
-- (fn_comentario_notifica, fn_cargo_so_admin...) e ajudantes de RLS
-- (fn_sou_admin, fn_ve_o_time...). Gatilho nao precisa de EXECUTE para
-- disparar, e ajudante de RLS PRECISA do grant para a politica funcionar —
-- revogar ali quebraria acesso de quem esta logado, que e o oposto do que
-- esta migracao quer.
--
-- A linha que separa e util e vale escrever: **DEFINER com argumento e porta
-- de entrada; DEFINER sem argumento e engrenagem interna.**
--
-- `authenticated` CONTINUA podendo nas tres de leitura (a /analises chama a
-- fn_vsl_do_rev por usuario logado, em AnalisesPage.tsx:263). So a de escrita
-- fecha para os dois: o unico chamador legitimo e a edge function `cs-sync`,
-- que usa SERVICE_ROLE_KEY e nao depende de grant.

revoke execute on function public.fn_gravar_payloads(jsonb)                   from public, anon, authenticated;
revoke execute on function public.fn_vsl_do_rev(uuid, date, date)             from public, anon;
revoke execute on function public.fn_vsl_do_rev_bloco(uuid, date, date)       from public, anon;
revoke execute on function public.fn_ultima_execucao_cron(text)               from public, anon;

-- O revoke de PUBLIC tira de todo mundo, inclusive de quem esta logado.
-- Devolver explicitamente e o que mantem a tela de pe.
grant execute on function public.fn_vsl_do_rev(uuid, date, date)        to authenticated;
grant execute on function public.fn_vsl_do_rev_bloco(uuid, date, date)  to authenticated;
grant execute on function public.fn_ultima_execucao_cron(text)          to authenticated;

comment on function public.fn_gravar_payloads(jsonb) is
  'Grava o payload bruto das transacoes. SECURITY DEFINER e ESCREVE, entao e '
  'fechada para anon E para authenticated: o unico chamador e a edge function '
  'cs-sync, que usa service_role. Ja perdeu o revoke uma vez, num DROP+CREATE '
  '(20260909c). Se recriar, REFAZER o revoke. Ver 20261006p.';

-- ── As provas ───────────────────────────────────────────────────────────────
DO $prova$
DECLARE
  v_abertas text[];
BEGIN
  -- 1. DERIVADA: nenhuma funcao SECURITY DEFINER COM ARGUMENTO pode ser
  --    executada por anon. E a regra que faltava — a 20260825x fechou uma
  --    LISTA, e lista envelhece. Esta pergunta ao catalogo, entao pega a
  --    proxima que nascer.
  SELECT coalesce(array_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                            ORDER BY p.proname), '{}')
    INTO v_abertas
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosecdef
    AND pg_get_function_identity_arguments(p.oid) <> ''
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_abertas <> '{}'::text[] THEN
    RAISE EXCEPTION 'funcao(oes) DEFINER com argumento ainda abertas para anon: %', v_abertas;
  END IF;

  -- 2. A de ESCREVER fechou tambem para authenticated.
  IF has_function_privilege('authenticated', 'public.fn_gravar_payloads(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'fn_gravar_payloads continua chamavel por authenticated';
  END IF;

  -- 3. E a tela NAO quebrou: quem esta logado continua podendo ler a VSL.
  --    Sem isto, o revoke de PUBLIC levaria a /analises junto.
  IF NOT has_function_privilege('authenticated', 'public.fn_vsl_do_rev(uuid,date,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated perdeu a fn_vsl_do_rev -- a /analises quebraria';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.fn_vsl_do_rev_bloco(uuid,date,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated perdeu a fn_vsl_do_rev_bloco';
  END IF;

  -- 4. Os ajudantes de RLS continuam de pe para quem esta logado. Eles sao
  --    DEFINER sem argumento e NAO foram tocados de proposito: revogar ali
  --    quebraria as politicas que os chamam.
  IF NOT has_function_privilege('authenticated', 'public.fn_sou_admin()', 'EXECUTE') THEN
    RAISE EXCEPTION 'fn_sou_admin fechou para authenticated -- as politicas de RLS quebram';
  END IF;

  RAISE NOTICE 'quatro funcoes fechadas; 0 DEFINER com argumento aberta para anon';
END
$prova$;
