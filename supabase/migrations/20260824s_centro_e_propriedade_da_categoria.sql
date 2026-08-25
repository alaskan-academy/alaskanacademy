-- Onde cada categoria mora. Uma só, para sempre.
--
-- O centro de custo estava vindo por transação, direto do que foi marcado na
-- Conta Simples na hora do pagamento. Como a marcação varia, a MESMA categoria
-- caía em centros diferentes e a matriz do relatório ficava incoerente:
-- "Anúncios (Facebook ADs)" aparecia sob "Anúncios" com R$ 62.001 e sob
-- "Softwares e Ferramentas" com R$ 173 no mesmo mês. São 10 categorias assim, e
-- "Aplicativos e Ferramentas" chegava a aparecer em quatro centros.
--
-- Estrutura de relatório não pode depender de marcação caso a caso. O centro
-- passa a ser propriedade da categoria; o que foi marcado no CS continua
-- guardado em `transacoes.centro_custo` e segue servindo para DECIDIR a
-- categoria — só não manda mais na hierarquia.
create table if not exists public.categorias_centro (
  categoria    text primary key,
  centro_custo text not null,
  ordem        int  not null default 100,
  criado_em    timestamptz not null default now()
);

comment on table public.categorias_centro is
  'Centro de custo canônico de cada categoria. Define a hierarquia dos relatórios.';

alter table public.categorias_centro enable row level security;
drop policy if exists categorias_centro_rw on public.categorias_centro;
create policy categorias_centro_rw on public.categorias_centro
  for all to authenticated using (true) with check (true);

-- "Impostos" ganha centro próprio em vez de ficar sob "Jurídico": imposto não é
-- despesa jurídica, e estava rachado entre Jurídico e Outros.
insert into public.categorias_centro (categoria, centro_custo, ordem) values
  ('Anúncios (Facebook ADs)',   'Anúncios',                 10),
  ('WhatsApp',                  'Anúncios',                 20),
  ('Departamento Pessoal',      'Funcionários',             30),
  ('Edição de Vídeo',           'Funcionários',             31),
  ('Freelancer',                'Funcionários',             32),
  ('Aplicativos e Ferramentas', 'Softwares e Ferramentas',  40),
  ('IAs',                       'Softwares e Ferramentas',  41),
  ('Impostos e Tributos',       'Impostos',                 50),
  ('Contabilidade',             'Jurídico',                 60),
  ('Endereço Fiscal',           'Jurídico',                 61),
  ('Jurídico',                  'Jurídico',                 62),
  ('Registros e Documentos',    'Jurídico',                 63),
  ('Ofertas',                   'Cursos e Formações',       70),
  ('Consultorias e Mentorias',  'Cursos e Formações',       71),
  ('Cursos e Formações',        'Cursos e Formações',       72),
  ('Treinamento e Educação',    'Cursos e Formações',       73),
  ('Recarga e Chip',            'Outros',                   80),
  ('Eletrônicos',               'Outros',                   81),
  ('Material de Escritório',    'Outros',                   82),
  ('Meios de Pagamento',        'Outros',                   83),
  ('Doações',                   'Outros',                   84),
  ('Outros',                    'Outros',                   85),
  ('Pró-labore',                'Sócios',                   90),
  ('Retirada de Lucro',         'Sócios',                   91),
  ('Sócios',                    'Sócios',                   92),
  ('Reserva de Caixa',          'Reserva de Caixa',         95)
on conflict (categoria) do nothing;

grant select, insert, update, delete on public.categorias_centro to authenticated;

-- A matriz passa a ler a hierarquia daqui.
--
-- `coalesce` com o centro da transação como rede: categoria nova que ainda não
-- foi mapeada continua aparecendo em algum lugar em vez de sumir do relatório —
-- e o total continua fechando com o extrato, que é o que importa.
drop view if exists public.vw_custos_categoria_mes;

create view public.vw_custos_categoria_mes as
select
  date_trunc('month', t.data)::date as mes,
  coalesce(cc.centro_custo, nullif(trim(t.centro_custo), ''), '(sem centro)') as centro_custo,
  coalesce(nullif(trim(t.categoria), ''), 'Sem categoria') as categoria,
  min(coalesce(cc.ordem, 999))::int as ordem,
  sum(-t.valor)::numeric(14,2) as gasto,
  count(*)::int as lancamentos
from public.transacoes t
left join public.categorias_centro cc on cc.categoria = trim(t.categoria)
where t.valor < 0
  and coalesce(t.categoria, '') not in
      ('Pró-labore', 'Retirada de Lucro', 'Sócios', 'Reserva de Caixa')
group by 1, 2, 3;

comment on view public.vw_custos_categoria_mes is
  'Custo operacional por centro de custo, categoria e mês. Hierarquia vem de categorias_centro.';

grant select on public.vw_custos_categoria_mes to authenticated;
