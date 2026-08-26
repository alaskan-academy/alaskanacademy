-- Onde a leitura da rodada quinzenal fica gravada.
--
-- Substitui a planilha por funil e o PDF do Obsidian. Duas tabelas: a rodada
-- (uma data, um autor) e um item por REV analisado.
--
-- POR QUE `metricas` É JSONB E NÃO UM JOIN
--
-- A análise é documento histórico. Se uma venda for recategorizada depois, ou
-- um checkout mudar de REV, os números mudariam embaixo de um texto escrito com
-- base nos números antigos — e a leitura passaria a não fazer sentido ao lado
-- deles. O retrato preserva o contexto da decisão.
--
-- Isto é o oposto do que fiz no resto da semana, onde tirei retrato atrás de
-- retrato em favor de dado vivo. A diferença: lá o retrato era um ESPELHO que
-- devia acompanhar a fonte; aqui ele é a PROVA do que se via quando se decidiu.

create table if not exists public.analises (
  id           uuid primary key default gen_random_uuid(),
  data         date not null default current_date,
  autor_id     uuid references auth.users(id),
  observacoes  text,
  fechada_em   timestamptz,
  criada_em    timestamptz not null default now()
);

comment on table public.analises is
  'Uma rodada de análise: uma data, um autor, vários REVs. `fechada_em` marca '
  'quando ela foi encerrada — só então valem as exportações.';

create table if not exists public.analise_itens (
  id          uuid primary key default gen_random_uuid(),
  analise_id  uuid not null references public.analises(id) on delete cascade,
  funil_id    uuid not null references public.funis(id) on delete cascade,

  -- Retrato do que `fn_metricas_do_rev` devolveu no momento da análise.
  metricas    jsonb,
  -- Retenção da VSL no momento, vinda da API do VTurb. Fica separada porque tem
  -- outra origem e pode faltar — REV sem VSL escolhida simplesmente não tem.
  retencao    jsonb,

  leitura        text,
  proximas_acoes text,

  criado_em   timestamptz not null default now(),

  -- Um REV só aparece uma vez por rodada. Sem isto, recarregar a tela no meio
  -- criaria um segundo item e a rodada passaria a ter duas leituras do mesmo
  -- REV, sem ninguém saber qual vale.
  constraint uq_analise_item unique (analise_id, funil_id)
);

comment on table public.analise_itens is
  'Um REV dentro de uma rodada, com o RETRATO das métricas ao lado da leitura '
  'escrita. Retrato e não recálculo: a leitura precisa continuar fazendo '
  'sentido ao lado dos números que a motivaram.';

create index if not exists idx_analise_itens_analise on public.analise_itens (analise_id);
create index if not exists idx_analise_itens_funil   on public.analise_itens (funil_id);

alter table public.analises      enable row level security;
alter table public.analise_itens enable row level security;

-- Sócios e admins apenas: aqui se discute preço, margem e o que não funcionou.
-- A restrição vive no BANCO, e não em esconder o item da sidebar — esconder
-- botão não impede ninguém de chamar a API.
drop policy if exists analises_admin on public.analises;
create policy analises_admin on public.analises
  for all to authenticated
  using (exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_admin));

drop policy if exists analise_itens_admin on public.analise_itens;
create policy analise_itens_admin on public.analise_itens
  for all to authenticated
  using (exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_admin));
