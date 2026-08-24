-- Preenche `payload_raw` em transação que já existe, sem tocar em mais nada.
--
-- O cs-sync faz upsert com `ignoreDuplicates`, e é isso que protege
-- `status_revisao` de voltar para "pendente" em transação já revisada. O efeito
-- colateral era que linha antiga nunca recebia o payload: depois do primeiro
-- sync, 1.120 transações tinham payload em exatamente uma. Trocar a estratégia
-- de upsert resolveria e levaria a revisão junto. Esta função escreve UMA
-- coluna e ignora o resto.
create or replace function public.fn_gravar_payloads(p_linhas jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n int;
begin
  with entrada as (
    select x->>'ref' as ref, x->'payload' as payload
      from jsonb_array_elements(p_linhas) x
  )
  update public.transacoes t
     set payload_raw = e.payload
    from entrada e
   where t.referencia_externa = e.ref
     and t.payload_raw is distinct from e.payload;

  get diagnostics n = row_count;
  return n;
end;
$fn$;

comment on function public.fn_gravar_payloads(jsonb) is
  'Grava payload_raw em transações existentes sem alterar status_revisao nem categoria.';

-- Só o service_role (o cs-sync) escreve. Ninguém no navegador precisa disto.
revoke execute on function public.fn_gravar_payloads(jsonb) from public, anon, authenticated;
