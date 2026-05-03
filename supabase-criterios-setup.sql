-- ============================================================
-- Configuração dinâmica de critérios para Avaliações Mensais
-- Rode este SQL no SQL Editor do Supabase
-- ============================================================

-- 1) Tabela de critérios (perguntas)
create table if not exists public.criterios_avaliacao (
  id uuid primary key default gen_random_uuid(),
  chave text unique not null,                 -- ex: 'responsabilidade'
  label text not null,                        -- ex: 'Responsabilidade e cumprimento de prazos'
  tipo text not null default 'single' check (tipo in ('single','multi','number')),
  ordem int not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.criterios_avaliacao enable row level security;
drop policy if exists "all access" on public.criterios_avaliacao;
create policy "all access" on public.criterios_avaliacao for all using (true) with check (true);

-- 2) Opções por critério
create table if not exists public.criterio_opcoes (
  id uuid primary key default gen_random_uuid(),
  criterio_id uuid not null references public.criterios_avaliacao(id) on delete cascade,
  label text not null,
  valor numeric not null default 0,
  ordem int not null default 0,
  ativo boolean not null default true
);
create index if not exists idx_criterio_opcoes_criterio on public.criterio_opcoes(criterio_id);

alter table public.criterio_opcoes enable row level security;
drop policy if exists "all access" on public.criterio_opcoes;
create policy "all access" on public.criterio_opcoes for all using (true) with check (true);

-- 3) Coluna JSONB nas avaliações (snapshot das respostas)
alter table public.avaliacoes_mensais
  add column if not exists respostas jsonb default '{}'::jsonb;

-- 4) Seed inicial dos critérios (com base no CSV enviado)
insert into public.criterios_avaliacao (chave, label, tipo, ordem) values
  ('responsabilidade', 'Responsabilidade e cumprimento de prazos', 'single', 1),
  ('refacoes', 'Refações por erro técnico', 'single', 2),
  ('aderencia_briefing', 'Aderência ao briefing', 'single', 3),
  ('performance_criativos', 'Performance dos criativos', 'multi', 4),
  ('proatividade', 'Proatividade e evolução técnica', 'multi', 5),
  ('performance_grupo', 'Performance em grupo', 'single', 6),
  ('evolucao', 'Evolução e assertividade', 'single', 7),
  ('meta_time', 'Meta de time mensal', 'single', 8)
on conflict (chave) do nothing;

-- 5) Seed das opções
with c as (select chave, id from public.criterios_avaliacao)
insert into public.criterio_opcoes (criterio_id, label, valor, ordem)
select c.id, x.label, x.valor, x.ordem from c join (values
  -- responsabilidade
  ('responsabilidade','Cumpriu 100% dos prazos, comunicou antecipadamente qualquer imprevisto e ajudou o time a manter o fluxo estável',40,1),
  ('responsabilidade','Cumpriu prazos com pequenos ajustes',20,2),
  ('responsabilidade','Atrasos pontuais',0,3),

  -- refacoes
  ('refacoes','4 semanas sem refações',60,1),
  ('refacoes','3 semanas',30,2),
  ('refacoes','2 semanas',20,3),
  ('refacoes','1 semana+',0,4),

  -- aderencia_briefing
  ('aderencia_briefing','4 semanas sem refação',80,1),
  ('aderencia_briefing','3 semanas',40,2),
  ('aderencia_briefing','2 semanas',20,3),
  ('aderencia_briefing','1 semana+',0,4),

  -- performance_criativos (multi)
  ('performance_criativos','1+ criativo com CTR/ROAS acima da média',60,1),
  ('performance_criativos','Criativo citado em reunião/chat',40,2),
  ('performance_criativos','Nenhum destaque',0,3),

  -- proatividade (multi)
  ('proatividade','Comunicação e autonomia',20,1),
  ('proatividade','Compartilhamento de aprendizados',20,2),
  ('proatividade','Aprendizado ativo e aplicação prática',20,3),

  -- performance_grupo
  ('performance_grupo','Entregas consistentes, sem atrasos e com qualidade estável',30,1),
  ('performance_grupo','Algumas falhas pontuais, mas a maioria das metas foi mantida',20,2),
  ('performance_grupo','Falhas frequentes',0,3),

  -- evolucao
  ('evolucao','Aumentou taxa de assertividade em +5%',50,1),
  ('evolucao','Mantém média estável, sem evolução significativa',0,2),

  -- meta_time
  ('meta_time','Média geral de assertividade do time subiu +5%',35,1),
  ('meta_time','Nenhuma refação de briefing no mês em toda a equipe (1 folga)',0,2),
  ('meta_time','Nenhuma meta batida',0,3)
) as x(chave,label,valor,ordem) on x.chave = c.chave
on conflict do nothing;
