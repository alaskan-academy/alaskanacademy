-- Apelido de fornecedor: junta o que é o mesmo, separa o que só parece igual.
--
-- O descritor do extrato muda conforme a adquirente que processou. Hostinger
-- aparece em 6 grafias ("DM*HOSTINGERCOMB", "EBN *HOSTINGER", "HOSTINGERCOMBR"…),
-- Claude em 3, Sellflux em 3, UTMify em 3. Fragmentado assim, nenhuma delas
-- acumula meses suficientes para ser reconhecida como recorrência, e o gasto
-- real do fornecedor nunca aparece somado.
--
-- E o inverso importa igual: "OPENAI *CHATGPT SUBSCR" e "OPENAI" são o mesmo
-- emissor e NÃO devem ser somados — um é mensalidade, outro é consumo de
-- tokens. São custos de natureza diferente e se acompanham separado. Por isso
-- isto é uma tabela de apelidos e não uma normalização mais esperta: só quem
-- conhece o negócio sabe onde juntar e onde separar.
create table if not exists public.fornecedores (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  padrao     text not null,
  tipo_match text not null default 'contains',
  -- Menor testa primeiro. É o que garante que "OPENAI *CHATGPT SUBSCR" seja
  -- reconhecido antes que o "OPENAI" genérico o engula.
  prioridade int  not null default 100,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

create index if not exists idx_fornecedores_ativo on public.fornecedores (prioridade) where ativo;

comment on table public.fornecedores is
  'Apelidos de fornecedor: unificam grafias do mesmo e separam naturezas distintas do mesmo emissor.';

alter table public.fornecedores enable row level security;
drop policy if exists fornecedores_rw on public.fornecedores;
create policy fornecedores_rw on public.fornecedores
  for all to authenticated using (true) with check (true);

insert into public.fornecedores (nome, padrao, prioridade) values
  -- Mesmo emissor, naturezas diferentes: prioridade baixa para o específico.
  ('ChatGPT (mensalidade)',  'OPENAI *CHATGPT SUBSCR',  10),
  ('Claude (mensalidade)',   'CLAUDE SUB',              10),
  ('Claude (mensalidade)',   'CLAUDE.AI SUBSCRIPTION',  10),
  ('OpenAI (API)',           'OPENAI',                  90),
  ('Claude (API)',           'ANTHROPIC',               90),

  -- Grafias que são o mesmo fornecedor.
  ('UTMify',                 'UTMIFY',                  50),
  ('CapCut',                 'CAPCUT',                  50),
  ('Sellflux',               'SELLFLUX',                50),
  ('Vercel',                 'VERCEL',                  50),
  ('VTurb',                  'VTURB',                   50),
  ('Membify',                'MEMBIFY',                 50),
  ('Voxuy',                  'VOXUY',                   50),
  ('Panda Video',            'PANDA',                   50),
  ('ElevenLabs',             'ELEVENLABS',              50),
  ('Spedy',                  'SPEDY',                   50),
  ('Google Workspace',       'GOOGLE WORKSPACE',        40),
  ('Google One',             'GOOGLE ONE',              40),
  ('WhatsApp Business',      'GOOGLE WHATSAPP BUSIN',   40),
  ('Lovable',                'LOVABLE',                 50),
  ('Resend',                 'RESEND',                  50),
  ('Glide',                  'GLIDE',                   50),
  ('Windsor.ai',             'WINDSOR',                 50),
  ('Magnific',               'MAGNIFIC',                50),
  ('DreamFace',              'DREAMFACE',               50),
  ('Gamma',                  'GAMMA',                   50),
  ('Reportana',              'REPORTANA',               50),
  ('Safepay',                'SAFEPAY',                 50),

  -- Pessoas, com o nome que ela usa.
  ('Jessica Maihato',        'JESSICA MAIHATO',         20),
  ('Jaqueline Coelho',       'JAQUELINE COELHO',        20),
  ('Bruna Leopoldo',         'BRUNA LEOPOLDO',          20),
  ('Letícia Sales',          'LETICIA SALES',           20),

  -- Nomes que ela já usa na planilha, em vez do que o banco imprime.
  ('Vibe Contabilidade',     'BATISTA JUNIOR',          30),
  ('Impostos (DARF)',        'MINISTERIO DA FAZENDA',   30)
on conflict do nothing;

grant select, insert, update, delete on public.fornecedores to authenticated;
