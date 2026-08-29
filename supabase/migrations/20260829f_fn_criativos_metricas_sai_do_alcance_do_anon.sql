-- Funcao nova no Supabase nasce com EXECUTE para PUBLIC E com uma concessao
-- DIRETA ao papel `anon`. `revoke all ... from public` nao tira a direta -- a
-- verificacao mostrou `anon` com EXECUTE mesmo depois do revoke da migracao
-- anterior.
--
-- Esta funcao devolve verba, faturamento e ROAS por criativo: nao pode ser
-- alcancavel por quem nao esta autenticado.

revoke execute on function public.fn_criativos_metricas(date, date) from anon;
revoke execute on function public.fn_criativos_metricas(date, date) from public;
