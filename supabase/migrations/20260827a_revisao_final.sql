-- Revisão final da área de Funis. Quatro correções.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Usar `link_url` e `link_titulo` em vez de cavar no JSON.
--
-- Construí todo o vínculo venda↔REV lendo `payload_webhook->'link'->>'url'` sem
-- reparar que `vendas` JÁ TEM as colunas normalizadas, preenchidas pelo gatilho
-- que normaliza `vendas_payt`. O resto do schema já as usa — o gatilho
-- `trg_marcar_trafego_sem_utm` dispara em `link_titulo`.
--
-- Conferido antes de trocar: as duas fontes discordam em 3 linhas de 13.556, e
-- nas três o JSON traz string vazia onde a coluna traz null. A coluna é igual
-- ou melhor. A view saiu de 74ms para 13ms.
--
-- A query string continua no `link_url` (1.281 linhas com `?cart=`), então o
-- `split_part` permanece — é o que reduz 1.346 URLs a 95.

create or replace function public.fn_funil_da_venda(p_url text, p_titulo text)
returns uuid language sql stable security definer set search_path = public as $$
  select c.funil_id from public.funil_checkouts c
  where c.url = split_part(p_url, '?', 1)
    and c.titulo is not distinct from p_titulo
  limit 1;
$$;

create or replace function public.fn_venda_resolve_funil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.funil_id is null and new.link_url is not null then
    new.funil_id := public.fn_funil_da_venda(new.link_url, new.link_titulo);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_venda_resolve_funil on public.vendas;
create trigger trg_venda_resolve_funil
  before insert or update of link_url, link_titulo on public.vendas
  for each row execute function public.fn_venda_resolve_funil();

create or replace function public.fn_backfill_funil_das_vendas()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.vendas v set funil_id = c.funil_id
    from public.funil_checkouts c
   where c.url = split_part(v.link_url, '?', 1)
     and c.titulo is not distinct from v.link_titulo
     and v.funil_id is distinct from c.funil_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace view public.vw_checkouts_a_confirmar as
select c.id, c.url, c.titulo, c.funil_id, c.eh_funil,
       f.nome as rev_nome, p.nome as projeto_nome,
       s.vendas, s.primeira_venda, s.ultima_venda,
       (regexp_match(c.titulo, '(?i)rev\s*0*(\d+)'))[1] as rev_no_titulo
from public.funil_checkouts c
left join public.funis f            on f.id = c.funil_id
left join public.ofertas_editores p on p.id = f.projeto_id
left join lateral (
  select count(*) as vendas, min(v.data_venda)::date as primeira_venda,
         max(v.data_venda)::date as ultima_venda
  from public.vendas v
  where split_part(v.link_url, '?', 1) = c.url
    and v.link_titulo is not distinct from c.titulo
) s on true;

alter view public.vw_checkouts_a_confirmar set (security_invoker = on);

drop index if exists public.idx_vendas_checkout_link;
create index idx_vendas_checkout_link
  on public.vendas ((split_part(link_url, '?', 1)), link_titulo)
  where link_url is not null;

drop function if exists public.fn_funil_da_venda(jsonb);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Função de gatilho não deve ser chamável via REST.
--
-- Revogar de `public` não bastou: o Supabase concede a `authenticated`
-- separadamente, e as duas continuavam expostas em /rest/v1/rpc/. Chamar direto
-- só devolveria erro, mas são `security definer` e a regra do projeto é fechar.
--
-- `fn_backfill_funil_das_vendas` fica aberta de propósito: é ela que o botão
-- "Aplicar nas vendas" chama.
revoke execute on function public.fn_funil_campos_derivados() from public, anon, authenticated;
revoke execute on function public.fn_funil_da_venda(text, text) from public, anon, authenticated;
revoke execute on function public.fn_backfill_funil_das_vendas() from public, anon;
grant  execute on function public.fn_backfill_funil_das_vendas() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. `payt_key` sai.
--
-- Nove funis a preenchem com o MESMO valor: é a chave da conta na Payt, não do
-- funil. Nenhum arquivo do `src` a lê, e o vínculo venda↔REV agora é feito por
-- `funil_checkouts` — não sobra nem um uso futuro plausível.
alter table public.funis drop column if exists payt_key;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. `testes_funis.funil_id` e `funil_ids` não podem divergir.
--
-- Dois campos dizendo a mesma coisa. Hoje concordam nos 21 testes que têm
-- ambos — mas foi exatamente assim que `ativo` e `status` começaram, e quando
-- divergiram, quatro REVs sumiram de Produção sem ninguém entender por quê.
--
-- Não removo `funil_id`: ele carrega a chave estrangeira e o CHECK que exige
-- funil para teste que não é de anúncio. E `funil_ids` cobre o caso de teste que
-- toca mais de um REV (2 testes hoje). O gatilho só torna a divergência
-- impossível.
create or replace function public.fn_teste_sincroniza_funis()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(array_length(new.funil_ids, 1), 0) > 0 then
    -- A lista manda: é ela que representa o caso completo.
    new.funil_id := new.funil_ids[1]::uuid;
  elsif new.funil_id is not null then
    new.funil_ids := array[new.funil_id::text];
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_teste_sincroniza_funis() from public, anon, authenticated;

drop trigger if exists trg_teste_sincroniza_funis on public.testes_funis;
create trigger trg_teste_sincroniza_funis
  before insert or update on public.testes_funis
  for each row execute function public.fn_teste_sincroniza_funis();

update public.testes_funis set funil_ids = funil_ids;
