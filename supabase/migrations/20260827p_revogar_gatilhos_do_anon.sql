-- Três funções de gatilho ficaram com EXECUTE para `public` e `anon`.
--
-- O Postgres concede EXECUTE a PUBLIC por padrão em toda função nova, e o
-- CLAUDE.md do projeto manda revogar. Revoguei em `fn_metricas_do_rev`,
-- `fn_comparar_revs` e `fn_funil_do_upsell` e esqueci nestas — que são
-- justamente as que ESCREVEM: `fn_propagar_funil_ao_upsell` e
-- `fn_venda_resolve_funil` fazem UPDATE/INSERT e rodam como security definer.
--
-- Função que devolve `trigger` não é chamável por RPC do PostgREST, então o
-- risco prático é baixo. Mas a regra existe para não depender de "é baixo": a
-- próxima função copiada daqui pode não devolver trigger.
--
-- Achado na revisão de fechamento do módulo, varrendo `pg_proc.proacl` contra a
-- regra. Vale repetir a varredura ao fechar qualquer módulo:
--
--   select p.proname,
--          (select count(*) from aclexplode(p.proacl) a
--           join pg_roles r on r.oid = a.grantee
--           where r.rolname in ('anon','public')) exposta
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--   order by 2 desc;

revoke execute on function public.fn_analise_acao_carimbo()    from public, anon;
revoke execute on function public.fn_propagar_funil_ao_upsell() from public, anon;
revoke execute on function public.fn_venda_resolve_funil()      from public, anon;
