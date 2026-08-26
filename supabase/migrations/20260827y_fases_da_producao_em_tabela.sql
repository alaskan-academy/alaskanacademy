-- As fases da produção saem do código e viram tabela.
--
-- Hoje a fase é texto livre em `producoes` — nenhum CHECK, nenhuma FK — e a
-- única definição do que é válido é um array em TypeScript. O preço já está
-- pago: existem 2 cards na fase `briefing`, que não aparece em `FASES`, nem em
-- `FASES_MAP`, nem sequer como chave legada. Sem coluna no Kanban, sem rótulo,
-- e `getAdjacentFases` devolve -1 — eles estão INVISÍVEIS E IMÓVEIS desde
-- 29/07, e ninguém soube.
--
-- E não é só a lista. O mapa "que fases pertencem a cada setor" está escrito em
-- TRÊS lugares do frontend, e os três já discordam:
--
--   Editor  →  FASES_CALENDARIO_SETOR tem 'aprovado';  FASES_MEUPAINEL não tem
--   Copy    →  o primeiro tem 'gravacao';              o segundo não tem
--   Gestor  →  o primeiro tem 'postado';               o segundo não tem
--
-- Mais um quarto mapa, `getFieldForSetor`, decidindo qual coluna é "minha".
-- Os quatro são chaveados pelo NOME do setor: renomear "Copy" no banco quebra
-- os quatro em silêncio, e um setor novo cai no `else` sem avisar ninguém.
--
-- Com a tabela, os quatro viram uma consulta, o `briefing` aparece, e renomear
-- setor deixa de quebrar coisa alguma — a ligação passa a ser por id.

create table if not exists public.producao_fases (
  chave         text primary key,
  rotulo        text        not null,
  ordem         smallint    not null,
  -- Quem é dono do trabalho nesta fase. Nulo = fase de todo mundo (aprovado,
  -- postado). Por ID e não por nome, para renomear o setor não quebrar nada.
  setor_id      uuid        references public.setores(id) on delete set null,
  -- Qual coluna de `producoes` guarda o responsável quando a fase é deste setor.
  campo_dono    text,
  e_revisao     boolean     not null default false,
  somente_socio boolean     not null default false,
  -- Fora do fluxo novo, mas ainda válida para o que já existe. É o que impede
  -- de a `briefing` virar órfã de novo: ela EXISTE, só não é oferecida.
  ativa         boolean     not null default true,
  -- Prazo vencido nestas não conta como atraso: o trabalho terminou.
  concluida     boolean     not null default false,
  criado_em     timestamptz not null default now()
);

comment on table public.producao_fases is
  'As fases do fluxo de producao, em ordem. Fonte unica: substitui FASES, '
  'FASES_POR_TIPO, FASES_MEUPAINEL, FASES_CALENDARIO_SETOR e getFieldForSetor, '
  'que viviam no frontend e ja divergiam entre si.';

alter table public.producao_fases enable row level security;
drop policy if exists producao_fases_admin on public.producao_fases;
create policy producao_fases_admin on public.producao_fases
  for all to authenticated using (true) with check (true);

-- Quais fases valem para cada tipo de item. Aula não passa por copy nem por
-- esteira de teste; criativo e VSL não vão para a plataforma.
create table if not exists public.producao_fases_tipo (
  fase_chave text not null references public.producao_fases(chave) on delete cascade,
  tipo       text not null,
  primary key (fase_chave, tipo)
);

alter table public.producao_fases_tipo enable row level security;
drop policy if exists producao_fases_tipo_admin on public.producao_fases_tipo;
create policy producao_fases_tipo_admin on public.producao_fases_tipo
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- A carga, a partir do que o código dizia
-- ---------------------------------------------------------------------------

insert into public.producao_fases (chave, rotulo, ordem, e_revisao, somente_socio, concluida, ativa) values
  ('briefing',         'Briefing',          5,  false, false, false, false),
  ('producao_copy',    'Produção Copy',    10,  false, false, false, true ),
  ('revisao_copy',     'Revisão Copy',     20,  true,  false, false, true ),
  ('gravacao',         'Gravação',         30,  false, false, false, true ),
  ('revisao_gravacao', 'Revisão Gravação', 40,  true,  true,  false, true ),
  ('edicao',           'Edição',           50,  false, false, false, true ),
  ('revisao_edicao',   'Revisão Edição',   60,  true,  false, false, true ),
  ('alteracao',        'Alteração',        70,  false, false, false, true ),
  ('aprovado',         'Aprovado',         80,  false, false, true,  true ),
  ('esteira_teste',    'Esteira de Teste', 90,  false, false, true,  true ),
  ('postado',          'Postado',         100,  false, false, true,  true ),
  ('na_plataforma',    'Na Plataforma',   110,  false, false, true,  true ),
  ('bloqueado',        'Bloqueado',       200,  false, false, false, true ),
  ('arquivado',        'Arquivado',       210,  false, false, true,  true )
on conflict (chave) do nothing;

-- `briefing` entra com `ativa = false`: ela existe porque há 2 cards nela, mas
-- não é oferecida para trabalho novo. Assim os cards voltam a ter rótulo, a
-- aparecer numa coluna e a poder ser movidos — e você decide o que fazer com
-- eles vendo-os, em vez de eu decidir por você.

-- O dono de cada fase, ligado pelo id do setor. Feito por nome AQUI, uma vez,
-- em vez de por nome em quatro lugares do frontend para sempre.
update public.producao_fases f set
  setor_id   = s.id,
  campo_dono = m.campo
from (values
  ('producao_copy',    'Copy',              'copy_id'),
  ('revisao_copy',     'Copy',              'copy_id'),
  ('gravacao',         'Especialista',      'especialista_id'),
  ('revisao_gravacao', 'Especialista',      'especialista_id'),
  ('edicao',           'Editor',            'responsavel_id'),
  ('revisao_edicao',   'Editor',            'responsavel_id'),
  ('alteracao',        'Editor',            'responsavel_id'),
  ('esteira_teste',    'Gestor de Tráfego', 'gestor_id'),
  ('postado',          'Gestor de Tráfego', 'gestor_id')
) as m(chave, setor, campo)
join public.setores s on s.nome = m.setor
where f.chave = m.chave;

insert into public.producao_fases_tipo (fase_chave, tipo)
select f.chave, t.tipo
from public.producao_fases f
cross join (values ('criativo'), ('vsl'), ('aula')) as t(tipo)
where case
  -- Aula não tem copy nem vai para esteira/postado; ela termina na plataforma.
  when t.tipo = 'aula'
    then f.chave in ('gravacao','revisao_gravacao','edicao','revisao_edicao',
                     'alteracao','aprovado','na_plataforma','bloqueado','arquivado')
  else f.chave in ('producao_copy','revisao_copy','gravacao','revisao_gravacao',
                   'edicao','revisao_edicao','alteracao','aprovado','esteira_teste',
                   'postado','bloqueado','arquivado')
end
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- O guarda
-- ---------------------------------------------------------------------------

-- FK e não CHECK: com CHECK, acrescentar uma fase exige migration; com FK, é um
-- INSERT. E a FK recusa `fase` inventada na hora da escrita, que é justamente o
-- que deixou 2 cards presos em `briefing`.
alter table public.producoes
  drop constraint if exists producoes_fase_fkey;

alter table public.producoes
  add constraint producoes_fase_fkey
  foreign key (fase) references public.producao_fases(chave)
  on update cascade;
