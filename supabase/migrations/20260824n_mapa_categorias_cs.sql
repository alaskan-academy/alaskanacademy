-- De/para entre os nomes da Conta Simples e os do dashboard.
--
-- As duas taxonomias já são a mesma — ela preenche centro de custo e categoria
-- no CS antes de cada transação. O que divergia era o NOME: "Facebook ADS" lá,
-- "Anúncios (Facebook ADs)" aqui. Sem este de/para, 272 lançamentos e
-- R$ 201.586 apareciam como discordância entre as duas fontes quando dizem a
-- mesma coisa.
--
-- `preciso` é a parte que importa. Nem sempre o CS é o mais específico: em 39
-- lançamentos ele diz "Software e Ferramentas" e o dashboard diz "IAs". Adotar
-- o CS cegamente PERDERIA essa distinção. Com `preciso = false`, o nome do CS
-- vale só como rede de segurança e a regra do dashboard ganha quando tem algo
-- mais fino a dizer.
create table if not exists public.categorias_mapa (
  nome_cs      text primary key,
  categoria    text not null,
  centro_custo text,
  preciso      boolean not null default true,
  observacao   text,
  criado_em    timestamptz not null default now()
);

comment on table public.categorias_mapa is
  'Traduz nomes de categoria da Conta Simples para os do dashboard.';
comment on column public.categorias_mapa.preciso is
  'true = o CS é tão ou mais específico e vence. false = é grosso; regra do dashboard vence quando houver.';

alter table public.categorias_mapa enable row level security;

drop policy if exists categorias_mapa_rw on public.categorias_mapa;
create policy categorias_mapa_rw on public.categorias_mapa
  for all to authenticated using (true) with check (true);

insert into public.categorias_mapa (nome_cs, categoria, centro_custo, preciso, observacao) values
  ('Facebook ADS',                 'Anúncios (Facebook ADs)',   'Anúncios',                 true,
   'Mesma coisa, nome diferente. 272 lançamentos, R$ 201.586.'),
  ('Retirada de Lucro',            'Retirada de Lucro',         'Sócios',                   true,  null),
  ('Pró-labore',                   'Pró-labore',                'Sócios',                   true,  null),
  ('Contabilidade',                'Contabilidade',             'Jurídico',                 true,  null),
  ('Endereço Fiscal',              'Endereço Fiscal',           'Jurídico',                 true,  null),
  ('Impostos e tributos',          'Impostos e Tributos',       'Outros',                   true,
   'Só muda a caixa alta do "t".'),
  ('Recarga e Chip',               'Recarga e Chip',            'Outros',                   true,  null),
  ('Edição de Vídeo',              'Edição de Vídeo',           'Funcionários',             true,
   'Mais específico que o "Departamento Pessoal" que o dashboard usava.'),
  ('Consultorias e Mentorias',     'Consultorias e Mentorias',  'Cursos e Formações',       true,  null),
  -- Os grossos: o CS acerta o balde e erra o detalhe.
  ('Software e Ferramentas',       'Aplicativos e Ferramentas', 'Softwares e Ferramentas',  false,
   'O dashboard separa IAs daqui — 39 lançamentos que se perderiam.'),
  ('Computação em nuvem',          'Aplicativos e Ferramentas', 'Softwares e Ferramentas',  false, null),
  ('Telefonia',                    'Aplicativos e Ferramentas', 'Softwares e Ferramentas',  false, null),
  ('Outras despesas empresariais', 'Outros',                    'Outros',                   false,
   'Balde genérico do CS: nunca deve ganhar de uma regra.'),
  ('Outros',                       'Outros',                    'Outros',                   false,
   'Idem.')
on conflict (nome_cs) do nothing;

grant select, insert, update, delete on public.categorias_mapa to authenticated;
