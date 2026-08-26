-- Checkout novo passa a entrar sozinho em `funil_checkouts`.
--
-- A tabela foi populada UMA VEZ, com um insert a partir das vendas existentes.
-- O gatilho que eu criei só RESOLVIA o `funil_id` de uma venda; nada inseria
-- checkout novo.
--
-- Consequência: um checkout criado na Payt depois daquele dia nunca apareceria
-- na fila de confirmação nem no seletor do REV, e as vendas dele ficariam sem
-- REV para sempre — com nada na tela denunciando, porque a fila continuaria
-- mostrando os 97 de sempre.
--
-- Não é hipótese: já havia 1 venda órfã quando fui conferir, de um checkout
-- criado depois do retrato inicial.
--
-- Agora o mesmo gatilho que resolve o REV também registra o checkout quando ele
-- aparece pela primeira vez.

create or replace function public.fn_venda_resolve_funil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
begin
  if new.link_url is null then
    return new;
  end if;

  v_url := split_part(new.link_url, '?', 1);

  -- Registra o checkout se for a primeira vez que ele aparece. Entra sem dono e
  -- vai para a fila de confirmação, igual aos 97 que já estavam lá.
  insert into public.funil_checkouts (url, titulo)
  values (v_url, new.link_titulo)
  on conflict on constraint uq_funil_checkouts do nothing;

  -- Não sobrescreve o que alguém já definiu à mão.
  if new.funil_id is null then
    new.funil_id := public.fn_funil_da_venda(new.link_url, new.link_titulo);
  end if;

  return new;
end;
$$;

comment on function public.fn_venda_resolve_funil() is
  'Registra o checkout da venda se for novo, e resolve o REV a partir dele. O '
  'registro existe porque a tabela nasceu de um retrato único das vendas — sem '
  'isto, checkout criado depois nunca apareceria.';

-- Recolhe os que escaparam entre o retrato inicial e esta correção.
insert into public.funil_checkouts (url, titulo)
select distinct split_part(v.link_url, '?', 1), v.link_titulo
from public.vendas v
where v.link_url is not null
on conflict on constraint uq_funil_checkouts do nothing;
