-- AS DUAS QUE EU SÓ REESCREVI TAMBÉM FECHAM
--
-- Continuação da 20260924f, que fechou as três views que nasceram hoje.
-- `vw_meta_status` e `vw_producao_estado_ads` já estavam abertas antes de mim
-- — 20260829b e 20260916a não usam `security_invoker` — e num primeiro momento
-- pensei em deixá-las para uma varredura à parte.
--
-- POR QUE ELAS ENTRARAM MESMO ASSIM
--
-- Porque a migração 20260924a, minha, passou a ser a definição MAIS RECENTE das
-- duas. Numa reconstrução do banco pelas migrações, é o meu arquivo que as cria
-- — abertas. Deixou de ser legado herdado e virou comportamento do código que
-- eu escrevi hoje.
--
-- Medido como `anon` antes: vw_producao_estado_ads devolvia 521 linhas e
-- vw_meta_status 15.391, enquanto `producoes` e `vendas` devolviam 0. A chave
-- anon está no bundle, no navegador de qualquer visitante.
--
-- O QUE ESTA MIGRAÇÃO NÃO RESOLVE
--
-- O linter da Supabase conta 45 views SECURITY DEFINER no projeto. Estas duas
-- entram porque eu as toquei hoje; as outras 43 são uma varredura própria, com
-- decisão dela. Fechar de duas em duas, sem plano, dá a sensação de resolvido
-- sem estar.
--
-- A prova abaixo confere os DOIS lados: que `anon` parou de ler, e que quem tem
-- direito continua lendo. Um conserto de permissão que seca a tela legítima não
-- é conserto, é outro defeito.

ALTER VIEW public.vw_meta_status          SET (security_invoker = on);
ALTER VIEW public.vw_producao_estado_ads  SET (security_invoker = on);

DO $prova$
DECLARE
  v_sem text; v_view text; v_n int; v_estado text := ''; v_prod int;
BEGIN
  -- 1. As duas carregam a opção, lido de `pg_class.reloptions` — o fato, não a
  --    intenção de ter rodado o ALTER.
  SELECT string_agg(c.relname, ', ') INTO v_sem
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('vw_meta_status', 'vw_producao_estado_ads')
     AND NOT coalesce(c.reloptions::text[] && ARRAY['security_invoker=on','security_invoker=true'], false);
  IF v_sem IS NOT NULL THEN RAISE EXCEPTION 'ainda sem security_invoker: %', v_sem; END IF;

  -- 2. `anon` não lê mais. "Fechada" é zero linhas OU acesso negado: negado é
  --    mais forte, e uma prova que só aceita um dos dois reprova o acerto —
  --    foi o que aconteceu na primeira tentativa da 20260924f.
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_prod FROM public.producoes;
  FOREACH v_view IN ARRAY ARRAY['vw_meta_status','vw_producao_estado_ads'] LOOP
    BEGIN
      EXECUTE format('select count(*) from public.%I', v_view) INTO v_n;
      v_estado := concat_ws(' · ', nullif(v_estado,''),
        v_view || '=' || CASE WHEN v_n = 0 THEN 'vazia' ELSE v_n::text || ' LINHAS' END);
    EXCEPTION WHEN insufficient_privilege THEN
      v_estado := concat_ws(' · ', nullif(v_estado,''), v_view || '=negada');
    END;
  END LOOP;
  RESET ROLE;

  IF v_prod <> 0 THEN
    RAISE EXCEPTION 'anon le producoes direto — a RLS da tabela mudou e esta prova perdeu a referencia';
  END IF;
  IF v_estado LIKE '%LINHAS%' THEN RAISE EXCEPTION 'anon ainda le: %', v_estado; END IF;

  -- 3. E quem PODE ler continua lendo. Sem isto, um `revoke` geral passaria
  --    nas duas provas acima e deixaria a Produção e o Meta Ads em branco.
  SELECT count(*) INTO v_n FROM public.vw_producao_estado_ads;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'a view secou para quem tem direito — o invoker quebrou o consumo legitimo';
  END IF;

  RAISE NOTICE 'fechadas — anon: %; dono le % cards', v_estado, v_n;
END
$prova$;

NOTIFY pgrst, 'reload schema';
