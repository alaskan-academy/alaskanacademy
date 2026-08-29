-- O número de cada AD, agregado pelo CARD de produção.
--
-- `fn_criativos_meta` já devolve tudo por `ad_id`. Falta o passo que as telas de
-- Criativos precisam: o mesmo criativo sobe como VÁRIOS anúncios no Meta, então
-- um card tem N linhas lá. Somar impressão e gasto é trivial; o problema é a
-- razão.
--
-- CTR, CPC, CPM, hook, ROAS e AOV NÃO SE SOMAM e não se tiram por média das
-- médias. O CTR de um card com dois anúncios não é a média dos dois CTRs — é o
-- total de cliques sobre o total de impressões. Média de médias dá ao anúncio
-- de 10 impressões o mesmo peso do de 100 mil.
--
-- Por isso a conta mora AQUI, e não em cada componente que precisa dela: são
-- duas telas hoje (Avaliação e Desempenho) e a terceira que vier já nasce certa.
-- Duas implementações da mesma razão divergem — é a primeira armadilha do
-- CLAUDE.md, e já aconteceu neste projeto com CTR e CPC somados.
--
-- Agregar também tira a lista do teto: eram 826 linhas por ad_id para 408 cards,
-- e 1.000 é o corte silencioso do PostgREST.
create or replace function public.fn_criativos_metricas(
  p_ini date default null,
  p_fim date default null
)
returns table (
  producao_id    uuid,
  ads            integer,
  investimento   numeric,
  impressoes     bigint,
  cliques_link   bigint,
  video_3s       bigint,
  vendas         integer,   -- Payt
  receita        numeric,   -- Payt
  vendas_meta    integer,
  receita_meta   numeric,
  hook           numeric,
  ctr            numeric,
  cpc            numeric,
  cpm            numeric,
  cpa            numeric,   -- Payt
  roas           numeric,   -- Payt
  roas_meta      numeric,
  aov            numeric,   -- Payt
  aov_meta       numeric
)
language sql
stable
as $$
  with base as (
    -- Datas nulas significam a vida inteira do anúncio: é o recorte certo para
    -- AVALIAR um criativo. Julgar uma peça pelo mês corrente reprova todo AD
    -- que estreou ontem.
    select *
    from public.fn_criativos_meta(
      coalesce(p_ini, date '2020-01-01'),
      coalesce(p_fim, current_date),
      null
    )
    where producao_id is not null
  ),
  somas as (
    select
      b.producao_id,
      count(*)::integer                     as ads,
      sum(b.investimento)                   as investimento,
      sum(b.impressoes)                     as impressoes,
      sum(b.cliques_link)                   as cliques_link,
      sum(b.video_3s)                       as video_3s,
      sum(b.vendas)::integer                as vendas,
      sum(b.receita)                        as receita,
      sum(b.vendas_meta)::integer           as vendas_meta,
      sum(b.receita_meta)                   as receita_meta
    from base b
    group by b.producao_id
  )
  select
    s.producao_id,
    s.ads,
    round(s.investimento, 2),
    s.impressoes,
    s.cliques_link,
    s.video_3s,
    s.vendas,
    round(s.receita, 2),
    s.vendas_meta,
    round(s.receita_meta, 2),
    -- Todas as razões sobre os TOTAIS. `nullif` no denominador: divisão por zero
    -- vira nulo, e nulo a tela mostra como "—" em vez de inventar 0,00.
    round(100.0 * s.video_3s     / nullif(s.impressoes, 0), 1)   as hook,
    round(100.0 * s.cliques_link / nullif(s.impressoes, 0), 2)   as ctr,
    round(s.investimento / nullif(s.cliques_link, 0), 2)         as cpc,
    round(1000.0 * s.investimento / nullif(s.impressoes, 0), 2)  as cpm,
    round(s.investimento / nullif(s.vendas, 0), 2)               as cpa,
    round(s.receita      / nullif(s.investimento, 0), 2)         as roas,
    round(s.receita_meta / nullif(s.investimento, 0), 2)         as roas_meta,
    round(s.receita      / nullif(s.vendas, 0), 2)               as aov,
    round(s.receita_meta / nullif(s.vendas_meta, 0), 2)          as aov_meta
  from somas s;
$$;

comment on function public.fn_criativos_metricas(date, date) is
  'O número de cada AD agregado pelo card de produção, com as razões (CTR, CPC, CPM, hook, ROAS, AOV) recalculadas sobre os totais — razão de anúncio não se soma nem se tira por média das médias.';

-- Função nova nasce com EXECUTE para PUBLIC e uma concessão direta ao `anon`;
-- revogar de PUBLIC não tira a do `anon`, então as duas saem explicitamente.
revoke all on function public.fn_criativos_metricas(date, date) from public;
grant execute on function public.fn_criativos_metricas(date, date) to authenticated;
