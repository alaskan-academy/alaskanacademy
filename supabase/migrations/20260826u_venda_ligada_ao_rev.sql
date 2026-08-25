-- Liga a venda ao REV pelo checkout que o webhook da Payt já grava.
--
-- `vendas.funil_id` existe desde sempre e está preenchido em 0 de 13.552 linhas.
-- É o que impede "conversão do checkout deste REV" de ser uma pergunta que o
-- banco saiba responder — e é pré-requisito do módulo de Análises.
--
-- O PLANO ORIGINAL ERA CASAR POR `funis.link_checkout`, E NÃO FUNCIONA.
-- Os dois lados falam formatos diferentes:
--
--     funis.link_checkout   →  checkout.payt.com.br/02cefc91261f5a…
--     webhook link.url      →  payt.site/qZCw56M
--
-- Pior: o mesmo link curto é REAPONTADO quando o REV troca. `payt.site/qZCw56M`
-- serviu "Saponaria Brasil Rev1" (21/05–21/06), depois "Revisão" (20/06–28/07),
-- depois "Rev5" (28/07–25/08). A URL é a vaga; o TÍTULO é o REV daquele momento.
-- Um campo fixo no funil não consegue representar isso, e é por isso que o
-- vínculo tem que morar aqui e não lá.
--
-- Como o título é gravado no instante da venda, a atribuição histórica sai certa
-- de graça: uma venda de junho continua sendo do Rev1 mesmo que o link hoje
-- sirva o Rev5.
--
-- Cobertura, que é melhor do que os 51,7% do total sugerem — é efeito de tempo,
-- não buraco: jan-fev 0%, mar 6,4%, abr 26,8%, mai 45,5%, e então jun 95,9%,
-- jul 99,9%, ago 95,9%. De junho em diante está completo.

create table if not exists public.funil_checkouts (
  id             uuid primary key default gen_random_uuid(),

  -- Sem a query string: `?cart=` é único por venda e transformaria 1.281 vendas
  -- em 1.281 checkouts diferentes. Sem ela, sobram 94.
  url            text not null,
  titulo         text,

  -- Null enquanto ninguém confirmou. A tela mostra os 94 e ela atribui — é
  -- confirmação, não digitação: a URL, o título, quantas vendas e desde quando
  -- já vêm preenchidos.
  funil_id       uuid references public.funis(id) on delete set null,

  -- Nem todo checkout é de funil. "Saponaria Brasil Suporte R$67" e "Oferta
  -- Relâmpago" são atendimento e recuperação. Marcar como não-funil evita que
  -- fiquem para sempre na fila de pendências.
  eh_funil       boolean,

  confirmado_em  timestamptz,
  criado_em      timestamptz not null default now(),

  -- O par identifica o REV-período. `nulls not distinct` porque alguns
  -- checkouts não têm título, e sem isso o Postgres deixaria duplicar cada um.
  constraint uq_funil_checkouts unique nulls not distinct (url, titulo)
);

comment on table public.funil_checkouts is
  'Checkouts vistos nas vendas, cada um ligado ao REV que ele atendia. Mora '
  'aqui e não em `funis.link_checkout` porque o mesmo link é reapontado quando '
  'o REV troca — a URL é a vaga, o título é o REV do momento.';

alter table public.funil_checkouts enable row level security;

drop policy if exists funil_checkouts_all on public.funil_checkouts;
create policy funil_checkouts_all on public.funil_checkouts
  for all to authenticated using (true) with check (true);

create index if not exists idx_funil_checkouts_busca
  on public.funil_checkouts (url, titulo);

-- Popula com o que as vendas já sabem. `on conflict do nothing` mantém isto
-- repetível: rodar de novo traz só os checkouts novos e não apaga confirmação.
insert into public.funil_checkouts (url, titulo)
select distinct
  split_part(payload_webhook->'link'->>'url', '?', 1),
  payload_webhook->'link'->>'title'
from public.vendas
where payload_webhook->'link'->>'url' is not null
on conflict on constraint uq_funil_checkouts do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- Resolver o REV de uma venda

create or replace function public.fn_funil_da_venda(p_payload jsonb)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.funil_id
  from public.funil_checkouts c
  where c.url = split_part(p_payload->'link'->>'url', '?', 1)
    and c.titulo is not distinct from (p_payload->'link'->>'title')
  limit 1;
$$;

comment on function public.fn_funil_da_venda(jsonb) is
  'Resolve o REV de uma venda pelo checkout do webhook. Devolve null quando o '
  'checkout ainda não foi atribuído — o que é estado normal, não erro.';

create or replace function public.fn_venda_resolve_funil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Não sobrescreve o que alguém já definiu à mão. O automático preenche o que
  -- está vazio; a correção humana ganha.
  if new.funil_id is null and new.payload_webhook is not null then
    new.funil_id := public.fn_funil_da_venda(new.payload_webhook);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_venda_resolve_funil on public.vendas;
create trigger trg_venda_resolve_funil
  before insert or update of payload_webhook on public.vendas
  for each row execute function public.fn_venda_resolve_funil();

-- ────────────────────────────────────────────────────────────────────────────
-- Backfill

-- Roda agora e não resolve nada, porque nenhum checkout foi atribuído ainda —
-- é assim mesmo. Vira função para poder ser chamada de novo pela tela, a cada
-- lote de checkouts que ela confirmar.
create or replace function public.fn_backfill_funil_das_vendas()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.vendas v
     set funil_id = c.funil_id
    from public.funil_checkouts c
   where v.funil_id is null
     and c.funil_id is not null
     and c.url = split_part(v.payload_webhook->'link'->>'url', '?', 1)
     and c.titulo is not distinct from (v.payload_webhook->'link'->>'title');
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.fn_backfill_funil_das_vendas() is
  'Preenche vendas.funil_id a partir dos checkouts já atribuídos. Idempotente: '
  'só toca em linhas com funil_id nulo.';

revoke execute on function public.fn_backfill_funil_das_vendas() from public, anon;
grant execute on function public.fn_backfill_funil_das_vendas() to authenticated, service_role;

revoke execute on function public.fn_funil_da_venda(jsonb) from public, anon;
grant execute on function public.fn_funil_da_venda(jsonb) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- A fila de confirmação

create or replace view public.vw_checkouts_a_confirmar as
select
  c.id,
  c.url,
  c.titulo,
  c.funil_id,
  c.eh_funil,
  f.nome        as rev_nome,
  p.nome        as projeto_nome,
  s.vendas,
  s.primeira_venda,
  s.ultima_venda,
  -- "Rev5" no título é uma pista forte, mas é só pista: a tela sugere e ela
  -- confirma. Casar automático por nome já me traiu ao ligar VSL com REV.
  (regexp_match(c.titulo, '(?i)rev\s*0*(\d+)'))[1] as rev_no_titulo
from public.funil_checkouts c
left join public.funis f            on f.id = c.funil_id
left join public.ofertas_editores p on p.id = f.projeto_id
left join lateral (
  select count(*)              as vendas,
         min(v.data_venda)::date as primeira_venda,
         max(v.data_venda)::date as ultima_venda
  from public.vendas v
  where split_part(v.payload_webhook->'link'->>'url', '?', 1) = c.url
    and (v.payload_webhook->'link'->>'title') is not distinct from c.titulo
) s on true;

comment on view public.vw_checkouts_a_confirmar is
  'Os checkouts com o volume que cada um moveu, para a tela de confirmação. '
  'Ordenar por vendas desc: confirmar os 10 primeiros já cobre a maioria.';
