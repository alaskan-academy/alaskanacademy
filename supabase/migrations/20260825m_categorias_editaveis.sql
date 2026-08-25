-- A lista de categorias sai do código e vira dado.
--
-- Estava fixa em `constants.ts`, o que significava que criar um subtópico exigia
-- deploy. Ela quer "Editores de vídeo" dentro de Funcionários, e amanhã vai
-- querer outro — isso é operação, não programação.
--
-- `categorias_centro` já existia e já era a hierarquia; ganha aqui o que faltava
-- para ser a fonte única: as categorias de receita e as que só viviam no código.

-- Centro de custo passa a ser tabela também, para o campo poder oferecer a lista
-- e para um centro novo não exigir deploy.
create table if not exists public.centros_custo (
  nome      text primary key,
  ordem     int  not null default 100,
  criado_em timestamptz not null default now()
);

-- "Funcionários" e não "Departamento Pessoal" para o centro: é o nome que a
-- Conta Simples já preenche, e é de lá que vêm 945 das 975 saídas. Renomear
-- quebraria isso e não ganharia nada. "Departamento Pessoal" segue existindo
-- como categoria dentro dele — o balde de quem não é editor.
insert into public.centros_custo (nome, ordem) values
  ('Receitas', 5), ('Anúncios', 10), ('Funcionários', 20),
  ('Softwares e Ferramentas', 30), ('Impostos', 40), ('Jurídico', 50),
  ('Cursos e Formações', 60), ('Outros', 70), ('Sócios', 80),
  ('Reserva de Caixa', 90)
on conflict (nome) do nothing;

alter table public.categorias_centro add column if not exists tipo text
  not null default 'custo';
alter table public.categorias_centro add column if not exists ativo boolean
  not null default true;

comment on column public.categorias_centro.tipo is
  'receita | custo | socio | reserva — decide de que lado do DRE a categoria entra.';

insert into public.categorias_centro (categoria, centro_custo, ordem, tipo) values
  ('Produtos',              'Receitas',           1,  'receita'),
  ('Coprodução',            'Receitas',           2,  'receita'),
  ('Serviços',              'Receitas',           3,  'receita'),
  ('Marketplace',           'Receitas',           4,  'receita'),
  ('Receita Financeira',    'Receitas',           5,  'receita'),
  ('WhatsApp',              'Anúncios',           20, 'custo'),
  ('Meios de Pagamento',    'Outros',             83, 'custo'),
  ('Eventos',               'Cursos e Formações', 74, 'custo'),
  ('Investimentos Futuros', 'Reserva de Caixa',   96, 'reserva'),
  ('Edição de Vídeo',       'Funcionários',       31, 'custo')
on conflict (categoria) do nothing;

update public.categorias_centro set tipo = 'socio'
 where categoria in ('Pró-labore', 'Retirada de Lucro', 'Sócios');
update public.categorias_centro set tipo = 'reserva'
 where categoria in ('Reserva de Caixa', 'Investimentos Futuros');

alter table public.centros_custo enable row level security;
drop policy if exists centros_custo_rw on public.centros_custo;
create policy centros_custo_rw on public.centros_custo
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.centros_custo     to authenticated;
grant select, insert, update, delete on public.categorias_centro to authenticated;

-- Uma categoria em uso não some por engano. Sem esta checagem, apagar
-- "Anúncios (Facebook ADs)" deixaria 571 lançamentos apontando para o nada e
-- sumiria R$ 522 mil do DRE sem aviso.
create or replace function public.fn_categoria_em_uso(p_categoria text)
returns int
language sql stable as $fn$
  select count(*)::int from public.transacoes where categoria = p_categoria;
$fn$;

grant execute on function public.fn_categoria_em_uso(text) to authenticated;
