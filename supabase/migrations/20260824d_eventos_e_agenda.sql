-- 2026-08-24 (parte 4) — a área comum: eventos e agenda
--
-- Hoje quem entra no dash cai no Resumo financeiro, e quem não tem permissão
-- para ele é jogado na primeira página da lista que puder acessar
-- (`PAGINAS.find(p => canAccess(p.key))`). Ninguém decidiu isso. O Início passa
-- a ser a porta de entrada, e a agenda é o que ele tem de próprio.
--
-- A aposta central: `editor_folgas` já existia no banco com zero linhas, e
-- `notificacoes` com zero não lidas. Peça que depende de alguém lembrar de
-- preencher morre — com 6 pessoas não há massa crítica para criar hábito. Por
-- isso a agenda mostra só o que é combinado — reunião, folga, feriado, marco.
--
-- Uma primeira versão puxava prazo de criativo de `producoes` para a agenda
-- nascer cheia sem ninguém digitar. O dado real derrubou a ideia: uma leva de
-- nove variações do mesmo anúncio caía toda numa segunda e virava um paredão
-- que escondia a reunião do dia. Demanda mora no Produção, e é lá que fica.

begin;

-- ---------------------------------------------------------------------------
-- 1. eventos — o que é combinado, não deduzido
-- ---------------------------------------------------------------------------
-- Uma tabela para todos os tipos, não uma por tipo: a agenda desenha todos
-- juntos e uma coluna `tipo` evita quatro consultas para montar uma semana.
create table if not exists public.eventos (
  id            uuid primary key default gen_random_uuid(),
  tipo          text not null check (tipo in ('reuniao', 'folga', 'feriado', 'marco')),
  titulo        text not null,
  data          date not null,
  hora_inicio   time,
  hora_fim      time,

  -- Reunião. `link_call` serve antes; `link_gravacao` depois — e a tela troca
  -- o destaque entre os dois conforme a data, porque link de call encerrada
  -- só atrapalha quem quer rever o que foi dito.
  link_call     text,
  link_gravacao text,
  pauta         text,          -- markdown, escrito antes
  ata           text,          -- markdown, escrito depois
  participantes uuid[] not null default '{}',

  -- Folga: de quem, e por quê.
  pessoa_id     uuid references public.perfis(id) on delete set null,
  motivo        text,

  -- Recorrência com os MESMOS nomes de `copy_rotina_cards`. Ter dois modelos
  -- de recorrência no mesmo produto é garantir que um deles esteja errado.
  -- A expansão acontece no front, como já acontece no RotinaCalendar.
  recorrencia_tipo        text check (recorrencia_tipo in ('diario', 'semanal', 'mensal')),
  recorrencia_dias_semana integer[],
  recorrencia_fim         date,
  recorrencia_pai_id      uuid references public.eventos(id) on delete cascade,

  criado_por    uuid references public.perfis(id) on delete set null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_eventos_data on public.eventos (data);
create index if not exists idx_eventos_tipo_data on public.eventos (tipo, data);
create index if not exists idx_eventos_pessoa on public.eventos (pessoa_id) where pessoa_id is not null;

alter table public.eventos enable row level security;
create policy eventos_read  on public.eventos for select to authenticated using (true);
create policy eventos_write on public.eventos for all    to authenticated using (true) with check (true);

-- `atualizado_em` no mesmo padrão do resto do schema.
create or replace function public.fn_eventos_touch()
 returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists trg_eventos_touch on public.eventos;
create trigger trg_eventos_touch before update on public.eventos
  for each row execute function public.fn_eventos_touch();

commit;
