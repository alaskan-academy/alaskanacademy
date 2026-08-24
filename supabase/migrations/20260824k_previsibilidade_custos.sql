-- Previsibilidade de custos e mapa de onde o dinheiro sai.
--
-- Motivação: a planilha "Fluxo de Caixa Alaskan 2026" tem duas abas mantidas à
-- mão que o extrato já sabe responder sozinho:
--
--   - "Dashboard": matriz categoria x mês, o retrato de onde os custos estão.
--   - "Pagamentos": lista de recorrências com dia do mês e valor esperado.
--
-- A segunda é a que mais custava: 24 linhas digitadas e atualizadas todo mês.
-- Comparando a lista dela com o que o extrato revela, os números batem — Google
-- Workspace R$ 98 no dia 1, VTurb R$ 297 no dia 10, Endereço Fiscal R$ 129,20
-- no dia 17. Não é preciso manter a lista: basta ler o histórico.

-- ── Chave de recorrência ────────────────────────────────────────────────────
-- Agrupa lançamentos do mesmo fornecedor apesar do ruído do descritor. O extrato
-- entrega "DM*hostingercomb SAO PAULO BR" e "PG*VTURB 12/04 BR": o prefixo da
-- adquirente, a praça e os dígitos mudam, o fornecedor não.
create or replace function public.fn_chave_recorrencia(descricao text)
returns text
language sql
immutable
as $fn$
  select nullif(trim(regexp_replace(
    regexp_replace(
      regexp_replace(lower(coalesce(descricao, '')), '^(dm\*|pg\*|pag\*|ec\*|mp\*)', ''),
      '\s+(sao paulo|s paulo|barueri|osasco|internet|br|us)\s*$', ''),
    '[0-9\*\.\-/]+', '', 'g')), '');
$fn$;

comment on function public.fn_chave_recorrencia(text) is
  'Normaliza o descritor do extrato para agrupar o mesmo fornecedor entre meses.';

-- ── Matriz categoria x mês ──────────────────────────────────────────────────
-- Só saídas, e só o que é custo operacional: sócio e reserva de caixa são
-- movimentação de dinheiro, não custo, e inflavam o retrato quando entravam.
-- Mesma regra do `ehCustoOperacional` no front — se as duas divergirem, a tela
-- mostra um total que a matriz não explica.
create or replace view public.vw_custos_categoria_mes as
select
  date_trunc('month', t.data)::date as mes,
  coalesce(nullif(trim(t.categoria), ''), 'Sem categoria') as categoria,
  sum(-t.valor)::numeric(14,2) as gasto,
  count(*)::int as lancamentos
from public.transacoes t
where t.valor < 0
  and coalesce(t.categoria, '') not in
      ('Pró-labore', 'Retirada de Lucro', 'Sócios', 'Reserva de Caixa')
group by 1, 2;

comment on view public.vw_custos_categoria_mes is
  'Custo operacional por categoria e mês. Exclui sócio e reserva, que são movimentação e não custo.';

-- ── Previsão por categoria ──────────────────────────────────────────────────
-- Mediana, não média: um mês atípico (a antecipação de R$ 12.000 para a reserva
-- em agosto, o imposto que veio dobrado) puxa a média e não deveria mudar a
-- expectativa do mês seguinte. A mediana ignora o susto.
--
-- O mês corrente nunca entra na base de cálculo — está incompleto por definição
-- e faria a previsão perseguir o próprio rabo.
create or replace function public.fn_previsao_custos(
  p_mes date default date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date,
  p_meses_base int default 3
)
returns table (
  categoria       text,
  previsto        numeric,
  realizado       numeric,
  meses_com_dados int,
  minimo          numeric,
  maximo          numeric
)
language sql
stable
as $fn$
  with base as (
    select v.categoria, v.mes, v.gasto
      from public.vw_custos_categoria_mes v
     where v.mes <  p_mes
       and v.mes >= (p_mes - (p_meses_base || ' months')::interval)::date
  ),
  previsao as (
    select b.categoria,
           percentile_cont(0.5) within group (order by b.gasto)::numeric(14,2) as previsto,
           count(*)::int as meses_com_dados,
           min(b.gasto)::numeric(14,2) as minimo,
           max(b.gasto)::numeric(14,2) as maximo
      from base b
     group by b.categoria
  ),
  realizado as (
    select v.categoria, v.gasto
      from public.vw_custos_categoria_mes v
     where v.mes = p_mes
  )
  -- `full join` porque as duas pontas contam histórias diferentes e as duas
  -- importam: categoria prevista que ainda não gastou é dinheiro a sair, e
  -- categoria que gastou sem previsão é gasto novo — o caso que mais interessa.
  select coalesce(p.categoria, r.categoria)   as categoria,
         coalesce(p.previsto, 0)              as previsto,
         coalesce(r.gasto, 0)                 as realizado,
         coalesce(p.meses_com_dados, 0)       as meses_com_dados,
         coalesce(p.minimo, 0)                as minimo,
         coalesce(p.maximo, 0)                as maximo
    from previsao p
    full join realizado r on r.categoria = p.categoria
   order by greatest(coalesce(p.previsto, 0), coalesce(r.gasto, 0)) desc;
$fn$;

comment on function public.fn_previsao_custos(date, int) is
  'Previsto (mediana dos meses fechados) x realizado do mês, por categoria.';

-- ── Recorrências detectadas ─────────────────────────────────────────────────
-- Substitui a aba "Pagamentos" da planilha. Devolve o que se repete, quanto
-- custa, em que dia costuma cair e se já caiu neste mês.
create or replace function public.fn_recorrencias(
  p_mes date default date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date,
  p_meses_base int default 6,
  p_min_meses int default 3
)
returns table (
  chave         text,
  descricao     text,
  categoria     text,
  valor_tipico  numeric,
  desvio        numeric,
  dia_tipico    int,
  meses_vistos  int,
  ja_saiu       boolean,
  valor_no_mes  numeric,
  data_no_mes   date
)
language sql
stable
as $fn$
  with hist as (
    select public.fn_chave_recorrencia(t.descricao) as chave,
           t.descricao,
           t.categoria,
           date_trunc('month', t.data)::date as mes,
           extract(day from t.data)::int as dia,
           -t.valor as gasto
      from public.transacoes t
     where t.valor < 0
       and t.data <  p_mes
       and t.data >= (p_mes - (p_meses_base || ' months')::interval)::date
       and public.fn_chave_recorrencia(t.descricao) is not null
       -- Sócio e reserva se repetem todo mês, mas prever "retirada de lucro"
       -- não ajuda ninguém a planejar custo.
       and coalesce(t.categoria, '') not in
           ('Pró-labore', 'Retirada de Lucro', 'Sócios', 'Reserva de Caixa')
  ),
  agrupado as (
    select h.chave,
           -- O descritor mais recente, não um qualquer: é o que ela vai
           -- reconhecer no extrato.
           (array_agg(h.descricao order by h.mes desc))[1] as descricao,
           mode() within group (order by h.categoria)      as categoria,
           percentile_cont(0.5) within group (order by h.gasto)::numeric(14,2) as valor_tipico,
           coalesce(stddev_pop(h.gasto), 0)::numeric(14,2) as desvio,
           mode() within group (order by h.dia)::int       as dia_tipico,
           count(distinct h.mes)::int                      as meses_vistos
      from hist h
     group by h.chave
    having count(distinct h.mes) >= p_min_meses
  ),
  no_mes as (
    select public.fn_chave_recorrencia(t.descricao) as chave,
           sum(-t.valor)::numeric(14,2) as valor_no_mes,
           min(t.data) as data_no_mes
      from public.transacoes t
     where t.valor < 0
       and t.data >= p_mes
       and t.data <  (p_mes + interval '1 month')::date
     group by 1
  )
  select a.chave,
         a.descricao,
         a.categoria,
         a.valor_tipico,
         a.desvio,
         a.dia_tipico,
         a.meses_vistos,
         (n.chave is not null) as ja_saiu,
         coalesce(n.valor_no_mes, 0) as valor_no_mes,
         n.data_no_mes
    from agrupado a
    left join no_mes n on n.chave = a.chave
   order by a.valor_tipico desc;
$fn$;

comment on function public.fn_recorrencias(date, int, int) is
  'Custos que se repetem: valor típico, dia do mês e se já caíram no mês corrente.';

grant select   on public.vw_custos_categoria_mes             to authenticated;
grant execute  on function public.fn_chave_recorrencia(text)    to authenticated;
grant execute  on function public.fn_previsao_custos(date, int) to authenticated;
grant execute  on function public.fn_recorrencias(date, int, int) to authenticated;
