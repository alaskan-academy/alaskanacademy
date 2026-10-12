-- Indicador de apoio tambem tem numero
-- ============================================================================
--
-- Achado conferindo a tela depois de mexer na recuperacao: tres indicadores
-- apareciam como "APOIO — SEM MEDIÇÃO" enquanto o banco sabia o valor deles.
--
--     checkout_recuperado_casos_pct       35,44     a tela dizia "—"
--     checkout_recuperado_automacao_pct    3,48     a tela dizia "—"
--     receita_sem_utm_pct                  2,39     a tela dizia "—"
--     clientes_unicos_90d                  5.354    a tela dizia "—"
--
-- `fn_metas_medir` devolve os quatro. Quem perdia era `fn_plano_arvore`, que
-- tirava `medido` de `fn_metas_progresso` — e progresso so existe para quem
-- tem ALVO, porque progresso e a distancia ate ele. Indicador de apoio nao
-- tem alvo de proposito: ele existe para dar contexto ao que e meta.
--
-- Entao a arvore lia o numero na tabela errada, e quatro indicadores que
-- foram criados exatamente para serem lidos nao eram lidos. E a segunda
-- armadilha do CLAUDE.md pelo avesso: aqui a medicao existe e a tela e que
-- nao mostra, o que e pior que nao medir, porque parece que nao ha o que
-- saber.
--
-- O conserto e uma linha: `coalesce(p.medido, m.valor)`. Progresso continua
-- mandando em quem tem alvo — ele mede na data da meta —, e quem nao tem cai
-- na medicao de hoje.
--
-- -- O selo de situacao some para quem e apoio -----------------------------
--
-- A outra metade esta no TSX. `situacao` e uma leitura sobre o ALVO: batida,
-- no caminho, atrasada. Indicador sem alvo nao pode estar em nenhuma delas, e
-- a tela resolvia o nulo com `?? 'sem_medicao'` — que e como "3,48%" ganhava
-- um selo dizendo que nao havia medicao, ao lado do proprio numero.
--
-- A barra ja saia para apoio pelo mesmo motivo, e o comentario que explica
-- isso esta no arquivo desde que ele nasceu. O selo passou batido.

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
  /* O numero de hoje de TODO indicador, com ou sem alvo. Quem tem alvo
     continua sendo servido por `progresso`, que mede na data da meta; quem
     nao tem cai aqui em vez de aparecer como "sem medicao" ao lado de um
     valor que o banco conhece. */
  medicao as (
    select kpi, valor from public.fn_metas_medir(p_empresa, current_date)
  )
  select
    a.chave, a.pai_chave, a.nivel, a.caminho_ordem, a.titulo, a.descricao,
    a.valor_min, a.valor_max, a.unidade, a.secao,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'kpi', k.chave, 'nome', k.nome, 'unidade', k.unidade,
               'e_meta', k.e_meta, 'automatico', k.automatico,
               'medido', coalesce(p.medido, m.valor), 'alvo', p.valor_alvo, 'prazo', p.prazo,
               'caminho', p.caminho, 'tempo', p.tempo, 'situacao', p.situacao
             ) order by k.e_meta desc, k.ordem)
        from public.metas_kpi k
        left join progresso p on p.kpi = k.chave
        left join medicao   m on m.kpi = k.chave
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
  v_apoio_com_numero int;
  v_apoio_total      int;
  v_meta_sem_alvo    int;
begin
  ---------------------------------------------------------------------------
  -- Todo indicador de apoio que `fn_metas_medir` sabe medir chega na arvore
  -- com numero. Escrito como "nenhum fica sem" e nao como "sao 4", para
  -- continuar valendo quando entrar o quinto.
  ---------------------------------------------------------------------------
  select count(*) filter (where (i ->> 'medido') is not null),
         count(*)
    into v_apoio_com_numero, v_apoio_total
    from fn_plano_arvore(null) t,
         lateral jsonb_array_elements(t.indicadores) i
   where (i ->> 'e_meta')::boolean is false
     and exists (select 1 from fn_metas_medir(null, current_date) m
                  where m.kpi = i ->> 'kpi' and m.valor is not null);

  if v_apoio_total = 0 then
    raise exception 'nenhum indicador de apoio mensuravel na arvore: a prova virou tautologia';
  end if;
  if v_apoio_com_numero <> v_apoio_total then
    raise exception '% de % indicadores de apoio continuam sem numero na arvore',
                    v_apoio_total - v_apoio_com_numero, v_apoio_total;
  end if;

  ---------------------------------------------------------------------------
  -- O que NAO pode acontecer: apoio ganhar alvo de brinde. Ele nao tem linha
  -- em `metas`, e se passar a ter alvo a tela desenha barra e situacao para
  -- uma meta que ninguem definiu.
  ---------------------------------------------------------------------------
  select count(*) into v_meta_sem_alvo
    from fn_plano_arvore(null) t, lateral jsonb_array_elements(t.indicadores) i
   where (i ->> 'e_meta')::boolean is false
     and (i ->> 'alvo') is not null;
  if v_meta_sem_alvo > 0 then
    raise exception '% indicadores de apoio apareceram com alvo', v_meta_sem_alvo;
  end if;

  raise notice '% indicadores de apoio mensuraveis, todos com numero', v_apoio_total;
end
$prova$;
