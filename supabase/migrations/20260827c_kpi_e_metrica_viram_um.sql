-- `kpi` e `metrica` eram o mesmo campo, duas vezes.
--
-- No formulário: "KPI principal" com o exemplo "ROAS, Conversão, AOV..." e
-- "Métrica principal" com "Taxa de conversão, CPA, AOV...". Dois rótulos para a
-- mesma pergunta, em blocos diferentes da tela.
--
-- O resultado é o esperado quando dois campos fazem a mesma pergunta: 26 testes
-- preencheram `kpi`, 11 preencheram `metrica`, só 7 preencheram os dois — e
-- quando os dois estão preenchidos, eles DISCORDAM. Há testes com kpi='AOV' e
-- metrica='Conversão', porque ninguém sabia qual campo era para quê.
--
-- `kpi` sobrevive: está preenchido em mais que o dobro dos casos.

-- Onde só um dos dois foi preenchido, o outro herda.
update public.testes_funis
   set kpi = coalesce(kpi, metrica),
       metrica = coalesce(metrica, kpi)
 where kpi is null or metrica is null;

-- Onde os dois foram preenchidos e discordam, os dois ficam registrados juntos
-- em vez de um vencer no escuro: descartar metade seria perder o que alguém
-- escreveu de propósito.
update public.testes_funis
   set kpi = kpi || ' · ' || metrica
 where kpi is not null and metrica is not null
   and lower(trim(kpi)) <> lower(trim(metrica));

update public.testes_funis set metrica = kpi where metrica is distinct from kpi;

create or replace function public.fn_teste_kpi_unico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- `kpi` é o campo do formulário; `metrica` continua existindo porque a tela de
  -- testes e o TesteModal a exibem, e some quando eles pararem de lê-la.
  new.kpi := coalesce(new.kpi, new.metrica);
  new.metrica := new.kpi;
  return new;
end;
$$;

comment on function public.fn_teste_kpi_unico() is
  'Mantém metrica igual a kpi. Os dois campos faziam a mesma pergunta e '
  'discordavam entre si em 6 dos 7 testes que tinham ambos preenchidos.';

revoke execute on function public.fn_teste_kpi_unico() from public, anon, authenticated;

drop trigger if exists trg_teste_kpi_unico on public.testes_funis;
create trigger trg_teste_kpi_unico
  before insert or update on public.testes_funis
  for each row execute function public.fn_teste_kpi_unico();
