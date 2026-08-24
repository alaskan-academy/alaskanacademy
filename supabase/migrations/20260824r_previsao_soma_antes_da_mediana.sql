-- A view passou a quebrar por centro de custo, então uma categoria que aparece
-- em dois centros gera duas linhas no mesmo mês. A mediana era calculada em
-- cima das LINHAS: com 3 meses e 2 centros ela via 6 valores e devolvia a
-- mediana de meia categoria. "Anúncios (Facebook ADs)" cai exatamente nesse
-- caso — aparece sob "Anúncios" e sob "Softwares e Ferramentas".
--
-- Soma por (categoria, mês) antes de tirar a mediana. A previsão é sobre meses.
create or replace function public.fn_previsao_custos(
  p_mes date default date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date,
  p_meses_base int default 3
)
returns table (
  categoria text, previsto numeric, realizado numeric,
  meses_com_dados int, minimo numeric, maximo numeric
)
language sql stable as $fn$
  with por_mes as (
    select v.categoria, v.mes, sum(v.gasto)::numeric(14,2) as gasto
      from public.vw_custos_categoria_mes v
     where v.mes <  p_mes
       and v.mes >= (p_mes - (p_meses_base || ' months')::interval)::date
     group by v.categoria, v.mes
  ),
  previsao as (
    select b.categoria,
           percentile_cont(0.5) within group (order by b.gasto)::numeric(14,2) as previsto,
           count(*)::int as meses_com_dados,
           min(b.gasto)::numeric(14,2) as minimo,
           max(b.gasto)::numeric(14,2) as maximo
      from por_mes b group by b.categoria
  ),
  realizado as (
    select v.categoria, sum(v.gasto)::numeric(14,2) as gasto
      from public.vw_custos_categoria_mes v
     where v.mes = p_mes
     group by v.categoria
  )
  select coalesce(p.categoria, r.categoria),
         coalesce(p.previsto, 0), coalesce(r.gasto, 0),
         coalesce(p.meses_com_dados, 0), coalesce(p.minimo, 0), coalesce(p.maximo, 0)
    from previsao p
    full join realizado r on r.categoria = p.categoria
   order by greatest(coalesce(p.previsto, 0), coalesce(r.gasto, 0)) desc;
$fn$;

comment on function public.fn_previsao_custos(date, int) is
  'Previsto (mediana dos meses fechados) x realizado do mês, por categoria.';

grant execute on function public.fn_previsao_custos(date, int) to authenticated;
