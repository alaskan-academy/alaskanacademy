/*
  Sete views públicas estavam sem `security_invoker` em 04/10/2026, três delas
  legíveis por `anon` — e a chave `anon` vai inlinada no bundle, então está no
  navegador de qualquer visitante.

      vw_alertas            anon      ← a 20260925a tinha ligado; um
                                        `create or replace` meu apagou hoje
      vw_rev_tendencia      anon      ← faturamento por REV; mesma causa, na
                                        migração do AOV de hoje
      vw_alertas_por_area   anon
      vw_config_por_empresa      autenticado
      vw_dinheiro_sem_empresa    autenticado
      vw_ingest_health           autenticado
      vw_saude_agendamentos      autenticado

  ── A causa, que não é esquecimento ───────────────────────────────────────

  `CREATE OR REPLACE VIEW` REDEFINE as reloptions da view. Omitir
  `with (security_invoker = on)` não preserva o que estava lá: APAGA. A
  20260925a consertou 40 views com `alter view ... set`, e qualquer replace
  posterior sem a cláusula desfaz aquele conserto em silêncio — sem erro, sem
  aviso, e a view volta a rodar com os direitos do dono.

  É a quarta armadilha em forma de permissão: a 20260925a foi carga inicial
  sem nada mantendo o presente. O que mantém o presente é a cláusula escrita
  na própria instrução de cada view, e o teste
  `view-nova-nao-fura-a-rls.test.ts`, que lê as migrações novas.

  Só que o teste lê ARQUIVO. Migração aplicada direto no banco, sem arquivo no
  repo, passa por fora da catraca inteira — foi exatamente o que aconteceu com
  a `vw_rev_tendencia` hoje. Por isso as migrações de hoje foram escritas como
  arquivo junto desta.

  A varredura deriva de `pg_class` em vez de listar as sete: lista no código
  envelhece, e a oitava view que perdesse a opção não entraria.
*/
do $$
declare v record; n int := 0;
begin
  for v in
    select c.relname
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public'
       and c.relkind = 'v'
       and not coalesce(
             c.reloptions::text[] && array['security_invoker=on','security_invoker=true'],
             false)
     order by c.relname
  loop
    execute format('alter view public.%I set (security_invoker = on)', v.relname);
    n := n + 1;
    raise notice 'invoker ligado em %', v.relname;
  end loop;
  raise notice '% view(s) corrigida(s)', n;
end $$;
