-- Medicao manual ganha onde morar
-- ============================================================================
--
-- "Todos acima tem como medir." Tem mesmo, e a tela dizia "sem medicao" para
-- seis indicadores por DOIS motivos diferentes, que so pareciam o mesmo.
--
-- Os quatro de APOIO a 20261012zc resolveu: o numero existia e a arvore o
-- buscava na tabela errada.
--
-- Os dois MANUAIS sao outra coisa, e pior:
--
--     alunas_ativas_30d_pct    automatico = false
--     bumps_abertos_pct        automatico = false
--
-- `metas_kpi.automatico` marca quem o banco nao consegue calcular sozinho,
-- porque o dado mora no Supabase da Area de Membros, que e outro projeto. Mas
-- nao havia NENHUM lugar para guardar o numero medido a mao: nem coluna, nem
-- tabela. A bandeira existia e o campo atras dela nao.
--
-- Entao "manual" nao significava "alguem digita": significava "nunca mostra
-- nada, para sempre". Um indicador que nasceu para ser lido e que era
-- estruturalmente impossivel de preencher.
--
-- E a segunda armadilha do CLAUDE.md na forma mais limpa que ja apareceu
-- aqui: cadastro sem a coluna de resultado ao lado. So que invertida — aqui a
-- tela de resultado existe e e o cadastro que nao tem onde escrever.
--
-- -- Um dono por indicador, decidido pela bandeira --------------------------
--
-- A tabela nova NAO pode virar um segundo numero para quem o banco ja calcula
-- — seria a primeira armadilha, e dois campos dizendo a mesma coisa sempre
-- divergem. A regra e exclusiva e sai da propria bandeira:
--
--     automatico = true    `fn_metas_medir` calcula. A tabela e ignorada.
--     automatico = false   a tabela manda. `fn_metas_medir` nem tenta.
--
-- Um gatilho recusa gravacao para indicador automatico, entao a regra nao
-- depende de ninguem lembrar dela.
--
-- -- Por que leva DATA, e nao so valor --------------------------------------
--
-- Duas razoes, e a segunda e urgente.
--
-- A primeira: numero digitado a mao envelhece, e sem data ninguem sabe se o
-- "42%" na tela e de hoje ou de agosto. A tela passa a mostrar quando foi
-- medido, e um numero velho se denuncia sozinho.
--
-- A segunda: `lesson_progress`, na Area de Membros, tem `updated_at` e NAO
-- tem historico. Cada dia que passa sem carimbar e um dia que nao volta —
-- quando a conexao existir, a serie so comeca do dia em que alguem a ligar.
-- Esta tabela e onde essa serie vai cair, com `origem = 'area_membros'`, sem
-- precisar de mudanca nenhuma depois.
--
-- -- O que esta migracao NAO faz --------------------------------------------
--
-- Nao preenche os dois numeros. Medi `alunas_ativas_30d_pct` hoje de manha
-- (42%, que se abre em 82,3% para quem entrou ha pouco e 23,5% para as
-- maduras), mas carimbar um numero que eu nao consigo reproduzir agora, numa
-- tabela que vai virar serie historica, e pior do que o campo vazio. E o de
-- bumps eu ainda nao remedi o denominador.
--
-- Os dois entram quando a leitura da Area de Membros for decidida — e a
-- recomendacao, que esta no chat, e nao criar credencial nova: uma funcao
-- `security definer` so de agregado la, chamada com a chave publicavel que o
-- painel ja usa.

create table if not exists public.metas_medicao (
  id          uuid primary key default gen_random_uuid(),
  kpi         text not null references public.metas_kpi(chave) on update cascade,
  empresa_id  uuid references public.empresas(id),
  medido_em   date not null default current_date,
  valor       numeric not null,
  origem      text not null default 'manual',
  observacao  text,
  criado_em   timestamptz not null default now(),
  -- Uma medicao por indicador, empresa e dia. Remedir o mesmo dia sobrescreve
  -- em vez de empilhar dois numeros que discordam.
  constraint metas_medicao_unica unique nulls not distinct (kpi, empresa_id, medido_em),
  constraint metas_medicao_origem_conhecida check (origem in ('manual', 'area_membros'))
);

comment on table public.metas_medicao is
  'Onde mora o numero de um indicador que o banco nao calcula (metas_kpi.automatico = false). Um por (kpi, empresa, dia). Para indicador automatico a gravacao e recusada por gatilho: quem calcula e fn_metas_medir, e dois donos divergem. Ver 20261012zd.';
comment on column public.metas_medicao.medido_em is
  'Quando o numero foi medido, nao quando foi digitado. A tela mostra esta data para que medicao velha se denuncie.';
comment on column public.metas_medicao.origem is
  'manual = alguem mediu e digitou. area_membros = carimbo diario do outro Supabase, que nao tem historico proprio.';

alter table public.metas_medicao enable row level security;

create policy metas_medicao_interno on public.metas_medicao
  for all to authenticated using (true) with check (true);

create index if not exists metas_medicao_kpi_data
  on public.metas_medicao (kpi, empresa_id, medido_em desc);

-- -- A regra do dono unico, imposta pelo banco -------------------------------
--
-- Sem isto, bastaria alguem gravar uma linha para `roas_medio` e o painel
-- passaria a ter dois ROAS. O gatilho le a bandeira na hora, entao a regra
-- acompanha quando um indicador deixa de ser manual.
create or replace function public.fn_metas_medicao_so_manual()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if (select automatico from public.metas_kpi where chave = new.kpi) then
    raise exception
      'o indicador "%" e automatico: quem o mede e fn_metas_medir, e guardar um segundo numero aqui faria os dois divergirem',
      new.kpi;
  end if;
  return new;
end
$function$;

drop trigger if exists metas_medicao_so_manual on public.metas_medicao;
create trigger metas_medicao_so_manual
  before insert or update on public.metas_medicao
  for each row execute function public.fn_metas_medicao_so_manual();

-- -- A arvore passa a enxergar a medicao manual ------------------------------
--
-- Mesma forma da 20261012zc: `coalesce(progresso, medido)`. O que muda e que
-- `medicao` agora tem duas fontes — o que o banco calcula e o que alguem
-- mediu —, e elas nunca cobrem o mesmo indicador.
create or replace function public.fn_plano_arvore(p_empresa uuid default null)
returns table(chave text, parte_de text, nivel integer, caminho_ordem text,
              titulo text, descricao text, valor_min numeric, valor_max numeric,
              unidade_valor text, secao integer, indicadores jsonb,
              acoes_total bigint, acoes_feitas bigint, acoes_vencidas bigint)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with recursive arvore as (
    select o.id, o.chave, null::text as pai_chave, 0 as nivel,
           lpad(o.ordem::text, 4, '0') as caminho_ordem,
           o.titulo, o.descricao, o.valor_min, o.valor_max, o.unidade, o.secao
      from public.plano_objetivos o
     where o.parte_de is null
    union all
    select o.id, o.chave, a.chave, a.nivel + 1,
           a.caminho_ordem || '.' || lpad(o.ordem::text, 4, '0'),
           o.titulo, o.descricao, o.valor_min, o.valor_max, o.unidade, o.secao
      from public.plano_objetivos o
      join arvore a on a.id = o.parte_de
  ),
  progresso as (
    select * from public.fn_metas_progresso(p_empresa) where e_proximo
  ),
  calculado as (
    select kpi, valor from public.fn_metas_medir(p_empresa, current_date)
  ),
  /* A ultima medicao a mao de cada indicador manual, da empresa em foco ou
     a geral. `distinct on` com a data desc: remediu, vale a mais nova. */
  a_mao as (
    select distinct on (m.kpi) m.kpi, m.valor, m.medido_em, m.origem
      from public.metas_medicao m
     where p_empresa is null or m.empresa_id is null or m.empresa_id = p_empresa
     order by m.kpi, m.medido_em desc, m.criado_em desc
  )
  select
    a.chave, a.pai_chave, a.nivel, a.caminho_ordem, a.titulo, a.descricao,
    a.valor_min, a.valor_max, a.unidade, a.secao,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'kpi', k.chave, 'nome', k.nome, 'unidade', k.unidade,
               'e_meta', k.e_meta, 'automatico', k.automatico,
               'medido', coalesce(p.medido, c.valor, h.valor),
               'medido_em', h.medido_em, 'origem', h.origem,
               'alvo', p.valor_alvo, 'prazo', p.prazo,
               'caminho', p.caminho, 'tempo', p.tempo, 'situacao', p.situacao
             ) order by k.e_meta desc, k.ordem)
        from public.metas_kpi k
        left join progresso p on p.kpi = k.chave
        left join calculado c on c.kpi = k.chave
        left join a_mao     h on h.kpi = k.chave
       where k.objetivo = a.chave
    ), '[]'::jsonb) as indicadores,
    (select count(*) from public.plano_acoes x where x.objetivo_id = a.id),
    (select count(*) from public.plano_acoes x where x.objetivo_id = a.id
       and x.feito_em is not null),
    (select count(*) from public.plano_acoes x where x.objetivo_id = a.id
       and x.feito_em is null and x.prazo is not null and x.prazo < current_date)
  from arvore a
  order by a.caminho_ordem;
$function$;

revoke all on function public.fn_plano_arvore(uuid) from public, anon;
grant execute on function public.fn_plano_arvore(uuid) to authenticated, service_role;

-- -- As provas ---------------------------------------------------------------
do $prova$
declare
  v_manual int;
  v_erro   text;
  v_lido   numeric;
begin
  ---------------------------------------------------------------------------
  -- Ha indicador manual para a tabela servir. Se nao houver, ela nasceu
  -- resolvendo um problema que ninguem tem.
  ---------------------------------------------------------------------------
  select count(*) into v_manual from metas_kpi where not automatico;
  if v_manual = 0 then
    raise exception 'nenhum indicador manual: a tabela nasceu sem uso';
  end if;

  ---------------------------------------------------------------------------
  -- O gatilho recusa indicador automatico. Esta e a prova de que nao criamos
  -- um segundo numero para quem ja tem dono.
  ---------------------------------------------------------------------------
  begin
    insert into metas_medicao (kpi, valor) values ('roas_medio', 9.99);
    raise exception 'o gatilho deixou gravar medicao a mao para um indicador automatico';
  exception when others then
    v_erro := sqlerrm;
    if v_erro not like '%e automatico%' then
      raise exception 'recusou pelo motivo errado: %', v_erro;
    end if;
  end;

  ---------------------------------------------------------------------------
  -- E aceita manual, e a arvore mostra. Grava, confere, apaga: a tabela fica
  -- vazia depois desta migracao, porque numero que eu nao consigo reproduzir
  -- agora nao entra numa serie historica.
  ---------------------------------------------------------------------------
  insert into metas_medicao (kpi, valor, medido_em, observacao)
  values ('alunas_ativas_30d_pct', 42.0, current_date, 'prova da 20261012zd');

  select (i ->> 'medido')::numeric into v_lido
    from fn_plano_arvore(null) t, lateral jsonb_array_elements(t.indicadores) i
   where i ->> 'kpi' = 'alunas_ativas_30d_pct';

  if v_lido is distinct from 42.0 then
    raise exception 'a arvore nao leu a medicao a mao (achei %)', v_lido;
  end if;

  delete from metas_medicao where observacao = 'prova da 20261012zd';

  if exists (select 1 from metas_medicao) then
    raise exception 'a prova deixou lixo na tabela';
  end if;

  raise notice '% indicadores manuais agora tem onde morar; a tabela fica vazia ate alguem medir', v_manual;
end
$prova$;
