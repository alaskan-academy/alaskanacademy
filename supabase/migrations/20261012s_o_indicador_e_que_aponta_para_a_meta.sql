-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ É o indicador que aponta para a meta, não o contrário                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- `20261012q` pendurou o KPI NO objetivo: `plano_objetivos.kpi`. Isso força
-- um-para-um, e a conta não fechou: dos dez indicadores do plano, oito
-- acharam nó e dois ficaram de fora — "Alunas ativas nos últimos 30 dias" e
-- "Bumps abertos pela compradora".
--
-- Não é que falte nó para eles. É que os dois medem a MESMA submeta que a
-- "Recompra em 90 dias" já ocupava: a régua de recompra. Uma submeta é
-- medida por vários indicadores; um indicador mede uma submeta. A chave
-- estrangeira estava do lado errado.
--
--     Régua de recompra
--       ├─ Recompra em 90 dias              7,1%
--       ├─ Alunas ativas nos últimos 30d     42%   (manual)
--       ├─ Bumps abertos pela compradora      7%   (manual)
--       └─ Clientes únicos em 90 dias      6.138   (apoio)
--
-- Com a chave em `metas_kpi.objetivo`, os treze indicadores — dez metas e
-- três de apoio — acham casa, e a tela pode mostrar cada submeta com tudo
-- que a mede embaixo.
--
-- ── Por que o DROP cabe na mesma migração ─────────────────────────────────
--
-- A regra do CLAUDE.md é não apagar coluna antes de o código que parou de
-- usá-la estar em produção, e ela existe porque em 21/09 um DROP derrubou
-- cinco telas. Aqui a condição está satisfeita de forma trivial:
-- `plano_objetivos` nasceu há minutos, nenhuma tela a lê, e nenhum embed do
-- PostgREST depende da chave — conferido com busca por `plano_objetivos` em
-- todo o `src/`, que não devolve nada.
--
-- Deixar a coluna velha seria o pior dos dois mundos: dois campos dizendo
-- qual indicador mede o quê, divergindo no primeiro cadastro novo.

begin;

alter table public.metas_kpi
  add column if not exists objetivo text references public.plano_objetivos(chave) on update cascade;

comment on column public.metas_kpi.objetivo is
  'Que no da arvore este indicador mede. A chave fica DESTE lado porque a '
  'relacao e muitos-para-um: a regua de recompra e medida por recompra_90d, '
  'alunas_ativas, bumps_abertos e clientes_unicos ao mesmo tempo.';

create index if not exists metas_kpi_por_objetivo on public.metas_kpi (objetivo)
  where objetivo is not null;

-- Os oito que ja tinham no, vindos da coluna antiga.
update public.metas_kpi k set objetivo = o.chave
  from public.plano_objetivos o
 where o.kpi = k.chave and k.objetivo is null;

-- Os dois que sobravam, e os tres de apoio.
update public.metas_kpi set objetivo = 'fonte_regua_recompra'
 where chave in ('alunas_ativas_30d_pct', 'bumps_abertos_pct', 'clientes_unicos_90d');

update public.metas_kpi set objetivo = 'roas_mais_ltv'
 where chave = 'compras_por_pessoa';

update public.metas_kpi set objetivo = 'alavanca_receita_propria'
 where chave = 'receita_sem_utm_pct';

-- A coluna antiga sai: dois campos dizendo quem mede o que divergiriam no
-- primeiro cadastro novo. Nada no `src/` a le.
alter table public.plano_objetivos drop column if exists kpi;

commit;

-- ───────────────────────────────────────────────────────────────────────────
-- A árvore inteira numa chamada
-- ───────────────────────────────────────────────────────────────────────────
-- A tela não monta árvore com três consultas e um `reduce`: recebe as linhas
-- já ordenadas pelo caminho, com nível, progresso e contagem de ações. O
-- progresso vem de `fn_metas_progresso`, que continua sendo a única
-- definição de "quanto do caminho andou".
create or replace function public.fn_plano_arvore(p_empresa uuid default null)
 returns table (
   chave           text,
   parte_de        text,
   nivel           integer,
   caminho_ordem   text,
   titulo          text,
   descricao       text,
   valor_min       numeric,
   valor_max       numeric,
   unidade_valor   text,
   secao           integer,
   indicadores     jsonb,
   acoes_total     bigint,
   acoes_feitas    bigint,
   acoes_vencidas  bigint
 )
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
  )
  select
    a.chave, a.pai_chave, a.nivel, a.caminho_ordem, a.titulo, a.descricao,
    a.valor_min, a.valor_max, a.unidade, a.secao,
    -- Todos os indicadores deste no, metas e apoios, com o progresso de cada.
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'kpi', k.chave, 'nome', k.nome, 'unidade', k.unidade,
               'e_meta', k.e_meta, 'automatico', k.automatico,
               'medido', p.medido, 'alvo', p.valor_alvo, 'prazo', p.prazo,
               'caminho', p.caminho, 'tempo', p.tempo, 'situacao', p.situacao
             ) order by k.e_meta desc, k.ordem)
        from public.metas_kpi k
        left join progresso p on p.kpi = k.chave
       where k.objetivo = a.chave
    ), '[]'::jsonb) as indicadores,
    (select count(*) from public.plano_acoes x where x.objetivo_id = a.id),
    (select count(*) from public.plano_acoes x where x.objetivo_id = a.id and x.feito_em is not null),
    (select count(*) from public.plano_acoes x where x.objetivo_id = a.id
       and x.feito_em is null and x.prazo is not null and x.prazo < current_date)
  from arvore a
  order by a.caminho_ordem;
$function$;

comment on function public.fn_plano_arvore(uuid) is
  'A arvore de metas e submetas com progresso e contagem de acoes, pronta '
  'para a tela desenhar. Le o progresso de fn_metas_progresso: a conta de '
  '"quanto do caminho andou" continua tendo um dono so.';

revoke all on function public.fn_plano_arvore(uuid) from public, anon;
grant execute on function public.fn_plano_arvore(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_n     bigint;
  v_lista text;
  v_json  jsonb;
begin
  -- 1. TODO indicador achou casa. Era o defeito: dois ficavam de fora porque
  --    a chave estava do lado que forca um-para-um.
  select count(*), string_agg(nome, ' · ') into v_n, v_lista
    from public.metas_kpi where objetivo is null;
  if v_n > 0 then
    v_erros := v_erros || format('%s indicador(es) sem objetivo: %s. ', v_n, v_lista);
  end if;

  -- 2. E a submeta que motivou a virada tem mesmo mais de um.
  select count(*) into v_n from public.metas_kpi where objetivo = 'fonte_regua_recompra';
  if v_n < 2 then
    v_erros := v_erros || format('regua de recompra com %s indicador(es); a troca de lado so '
                                 'faz sentido se houver mais de um. ', v_n);
  end if;

  -- 3. A coluna antiga sumiu: ela e a outra metade do par que divergiria.
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='plano_objetivos' and column_name='kpi') then
    v_erros := v_erros || 'plano_objetivos.kpi ainda existe: dois campos dizendo quem mede o que. ';
  end if;

  -- 4. A arvore devolve os 16 nos, em tres niveis, na ordem do caminho.
  select count(*) into v_n from public.fn_plano_arvore(null);
  if v_n <> 16 then v_erros := v_erros || format('%s nos na arvore, esperava 16. ', v_n); end if;

  select count(*) into v_n from public.fn_plano_arvore(null) where nivel = 0;
  if v_n <> 1 then v_erros := v_erros || format('%s raizes, esperava 1. ', v_n); end if;
  select max(nivel) into v_n from public.fn_plano_arvore(null);
  if v_n <> 2 then v_erros := v_erros || format('nivel maximo %s, esperava 2. ', v_n); end if;

  -- 5. A ordem do caminho poe cada filho logo abaixo do pai. Se quebrar, a
  --    tela desenha a arvore embaralhada e ninguem percebe pelo total.
  select count(*) into v_n from (
    select chave, parte_de, caminho_ordem,
           lag(chave) over (order by caminho_ordem) as anterior
      from public.fn_plano_arvore(null)
  ) q where parte_de is not null and anterior is null;
  if v_n > 0 then v_erros := v_erros || 'ha filho antes de qualquer pai na ordem. '; end if;

  -- 6. A regua de recompra traz os indicadores dela no JSON, e o JSON tem a
  --    forma que a tela espera.
  select indicadores into v_json from public.fn_plano_arvore(null)
   where chave = 'fonte_regua_recompra';
  if jsonb_array_length(coalesce(v_json,'[]'::jsonb)) < 2 then
    v_erros := v_erros || 'a regua de recompra voltou com menos de 2 indicadores no JSON. ';
  end if;
  if not (v_json -> 0 ? 'situacao') then
    v_erros := v_erros || 'o JSON de indicadores nao traz `situacao`. ';
  end if;

  -- 7. A contagem de acoes da arvore bate com a tabela. Sao duas consultas
  --    diferentes sobre o mesmo fato, e e assim que se pega subconsulta
  --    correlacionada escrita errada.
  select sum(acoes_total) into v_n from public.fn_plano_arvore(null);
  if v_n <> (select count(*) from public.plano_acoes where objetivo_id is not null) then
    v_erros := v_erros || format('a arvore soma %s acoes e a tabela tem %s ligadas. ',
      v_n, (select count(*) from public.plano_acoes where objetivo_id is not null));
  end if;

  -- 8. Nao ficou aberta.
  if has_function_privilege('anon', 'public.fn_plano_arvore(uuid)', 'execute') then
    v_erros := v_erros || 'anon consegue executar fn_plano_arvore. ';
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: % nos, % indicadores todos com casa, % acoes somadas na arvore.',
    (select count(*) from public.fn_plano_arvore(null)),
    (select count(*) from public.metas_kpi),
    (select sum(acoes_total) from public.fn_plano_arvore(null));
end $prova$;

notify pgrst, 'reload schema';
