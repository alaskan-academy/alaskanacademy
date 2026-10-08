-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ De qual empresa é a nota do editor                                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Até agora a aba de NF tirava a empresa do seletor do cabeçalho, que é "qual
-- operação estou olhando" — e nota fiscal é emitida PARA um CNPJ, que está
-- escrito nela. A decisão (08/10/2026) é que **quem define é a administração**,
-- não o editor: é um fato do contrato, e o editor não tem que escolher todo mês
-- entre duas opções das quais uma só está certa.
--
-- ── Por que VIGÊNCIA, e não um campo em `editores` ─────────────────────────
--
-- Porque um campo só não consegue dizer a verdade. A regra real, dita por ela:
--
--   todos os editores são da Alaskan, exceto a Jessica Maihato, que passa para
--   a Aeliss — mas a comissão que ela emite agora ainda é da Alaskan.
--
-- A comissão atrasa um mês em relação ao serviço (`fn_nfs_do_editor`: serviço é
-- do mês trabalhado, comissão é do mês anterior). Então em outubro ela deve
-- `pagamento/2026-10` e `comissao/2026-09` ao mesmo tempo, e as duas são de
-- empresas diferentes. Com `editores.empresa_id` a comissão de setembro sairia
-- carimbada Aeliss — erro fiscal com sucesso na tela.
--
-- Com vigência por COMPETÊNCIA a regra inteira cabe numa linha, e a diferença
-- entre serviço e comissão sai de graça:
--
--   competência >= 2026-10 -> Aeliss
--
--     serviço   2026-10  -> Aeliss   (ela emite agora)
--     comissão  2026-09  -> Alaskan  (ela emite agora)
--     serviço   2026-11  -> Aeliss   (mês que vem)
--     comissão  2026-10  -> Aeliss   (mês que vem)
--
-- Conferido contra o que a tela cobra de verdade, não contra o que eu imaginei
-- que ela cobrava: as quatro linhas acima são as que `fn_nfs_do_editor` gera.
--
-- Não há dimensão de SUBTIPO aqui de propósito. Ela não é necessária para
-- expressar a regra, e dimensão que ninguém precisa é campo que envelhece
-- dizendo o que outro já diz.

create table if not exists public.editor_empresa (
  id          uuid primary key default gen_random_uuid(),
  editor_id   uuid not null references public.editores(id) on delete cascade,
  empresa_id  uuid not null references public.empresas(id),
  /** A PRIMEIRA competência que vale para esta empresa, sempre dia 1. A linha
   *  anterior vale até o mês anterior a esta. */
  desde       date not null,
  criado_em   timestamptz not null default now(),

  -- Duas empresas valendo na mesma competência para o mesmo editor é a pergunta
  -- sem resposta: o banco recusa em vez de deixar a função escolher sozinha.
  unique (editor_id, desde),
  constraint editor_empresa_desde_dia_1 check (date_trunc('month', desde)::date = desde)
);

comment on table public.editor_empresa is
  'Para qual empresa cada editor emite nota, a partir de qual competência. '
  'Vigência e não campo único porque serviço e comissão de um mesmo envio são '
  'de competências diferentes, e podem cair em lados diferentes da virada.';

create index if not exists ix_editor_empresa_busca
  on public.editor_empresa (editor_id, desde desc);

alter table public.editor_empresa enable row level security;

-- Leitura para `authenticated`: o editor precisa ver de qual empresa é a nota
-- que ele está emitindo — é o CNPJ que ele vai digitar. Não há valor nem
-- extrato aqui, só a identidade da empresa.
drop policy if exists editor_empresa_leitura on public.editor_empresa;
create policy editor_empresa_leitura on public.editor_empresa
  for select to authenticated using (true);

-- Escrita só para admin: é a administração que conhece o contrato.
drop policy if exists editor_empresa_admin on public.editor_empresa;
create policy editor_empresa_admin on public.editor_empresa
  for all to authenticated
  using (exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_admin));

-- ── A empresa de uma (editor, competência) ─────────────────────────────────
-- A linha vigente é a de maior `desde` que não passou da competência. Devolve
-- nulo quando não há nenhuma: "ninguém declarou ainda" é diferente de "é da
-- Alaskan", e a tela precisa poder dizer a diferença em vez de adivinhar.

create or replace function public.fn_empresa_do_editor(
  p_editor_id uuid,
  p_competencia date
) returns uuid
language sql
stable
set search_path to 'public'
as $function$
  select ee.empresa_id
    from public.editor_empresa ee
   where ee.editor_id = p_editor_id
     and ee.desde <= date_trunc('month', p_competencia)::date
   order by ee.desde desc
   limit 1;
$function$;

comment on function public.fn_empresa_do_editor(uuid, date) is
  'A empresa vigente para a nota daquele editor naquela competência. Nulo = '
  'ninguém declarou ainda, que a tela mostra em vez de adivinhar.';

-- ── O estado de hoje ───────────────────────────────────────────────────────
-- Semeado a partir do que ela disse, e com piso em `data_inicio` para a linha
-- cobrir toda a vida de cada um. Derivado da tabela de editores, não digitado:
-- editor novo entra sem linha e a tela pede, em vez de herdar um palpite.

insert into public.editor_empresa (editor_id, empresa_id, desde)
select ed.id,
       (select id from public.empresas where slug = 'alaskan'),
       date_trunc('month', coalesce(ed.data_inicio, '2025-01-01'::date))::date
  from public.editores ed
on conflict (editor_id, desde) do nothing;

-- A virada da Jessica Maihato. Nomeada porque é um fato do negócio e não um
-- padrão: a competência 2026-10 em diante é Aeliss.
insert into public.editor_empresa (editor_id, empresa_id, desde)
select ed.id, (select id from public.empresas where slug = 'aeliss'), '2026-10-01'
  from public.editores ed
 where ed.nome = 'Jessica Maihato'
on conflict (editor_id, desde) do nothing;

-- ── A prova ────────────────────────────────────────────────────────────────
-- As quatro notas que a virada decide, conferidas uma por uma. Não "a tabela
-- tem linhas", que é ler o insert de volta.

do $$
declare
  v_jessica uuid;
  v_alaskan uuid;
  v_aeliss  uuid;
  v_erros   text := '';
  v_achado  uuid;
  v_caso    record;
begin
  select id into v_jessica from public.editores where nome = 'Jessica Maihato';
  select id into v_alaskan from public.empresas where slug = 'alaskan';
  select id into v_aeliss  from public.empresas where slug = 'aeliss';

  if v_jessica is null then
    raise notice 'Sem a Jessica Maihato para provar a virada.';
    return;
  end if;

  for v_caso in
    select * from (values
      ('servico  2026-09', '2026-09-01'::date, v_alaskan),
      ('comissao 2026-09', '2026-09-01'::date, v_alaskan),
      ('servico  2026-10', '2026-10-01'::date, v_aeliss),
      ('comissao 2026-10', '2026-10-01'::date, v_aeliss),
      ('servico  2026-11', '2026-11-01'::date, v_aeliss)
    ) as t(rotulo, competencia, esperada)
  loop
    v_achado := public.fn_empresa_do_editor(v_jessica, v_caso.competencia);
    if v_achado is distinct from v_caso.esperada then
      v_erros := v_erros || format('%s: esperava %s, veio %s. ',
        v_caso.rotulo, v_caso.esperada, v_achado);
    end if;
  end loop;

  -- E os outros continuam Alaskan em toda competência que importa.
  if exists (
    select 1 from public.editores ed
    where ed.nome <> 'Jessica Maihato'
      and ed.ativo
      and public.fn_empresa_do_editor(ed.id, '2026-11-01') is distinct from v_alaskan
  ) then
    v_erros := v_erros || 'algum editor que nao e a Jessica saiu da Alaskan. ';
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: a virada da Jessica cai entre a comissao de setembro (Alaskan) e o servico de outubro (Aeliss), e os outros seguem Alaskan.';
end $$;
