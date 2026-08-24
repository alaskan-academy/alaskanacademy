-- Recorrência que a empresa parou de pagar.
--
-- Sem este estado, assinatura cancelada fica para sempre em "não veio": o
-- detector só sabe que o histórico previa a cobrança e o extrato não tem. Ele
-- não tem como distinguir cartão recusado de contrato encerrado — essa
-- informação só existe fora do banco. Membify e Lovable foram os dois primeiros
-- casos: o alerta estava certo sobre o fato e errado sobre a conclusão.
create table if not exists public.recorrencias_encerradas (
  chave         text primary key,
  descricao     text not null,
  encerrada_em  date not null default (now() at time zone 'America/Sao_Paulo')::date,
  encerrada_por uuid references auth.users(id),
  criado_em     timestamptz not null default now()
);

comment on table public.recorrencias_encerradas is
  'Recorrências que a empresa parou de pagar. Deixam de ser cobradas na previsão.';
comment on column public.recorrencias_encerradas.encerrada_em is
  'Data do encerramento. Cobrança posterior a ela é reativação, não normalidade.';

alter table public.recorrencias_encerradas enable row level security;

drop policy if exists recorrencias_encerradas_rw on public.recorrencias_encerradas;
create policy recorrencias_encerradas_rw
  on public.recorrencias_encerradas
  for all to authenticated
  using (true) with check (true);

-- `drop` antes de recriar: a assinatura muda (três colunas novas) e
-- `create or replace` não altera tipo de retorno.
drop function if exists public.fn_recorrencias(date, int, int);

create function public.fn_recorrencias(
  p_mes date default date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date,
  p_meses_base int default 6,
  p_min_meses int default 3
)
returns table (
  chave text, descricao text, categoria text,
  valor_tipico numeric, desvio numeric, dia_tipico int,
  meses_vistos int, ja_saiu boolean, valor_no_mes numeric, data_no_mes date,
  encerrada boolean, encerrada_em date, reativada boolean
)
language sql stable as $fn$
  with hist as (
    select public.fn_chave_recorrencia(t.descricao) as chave,
           t.descricao, t.categoria,
           date_trunc('month', t.data)::date as mes,
           extract(day from t.data)::int as dia,
           -t.valor as gasto
      from public.transacoes t
     where t.valor < 0
       and t.data <  p_mes
       and t.data >= (p_mes - (p_meses_base || ' months')::interval)::date
       and public.fn_chave_recorrencia(t.descricao) is not null
       and coalesce(t.categoria, '') not in
           ('Pró-labore', 'Retirada de Lucro', 'Sócios', 'Reserva de Caixa')
  ),
  agrupado as (
    select h.chave,
           (array_agg(h.descricao order by h.mes desc))[1] as descricao,
           mode() within group (order by h.categoria) as categoria,
           percentile_cont(0.5) within group (order by h.gasto)::numeric(14,2) as valor_tipico,
           coalesce(stddev_pop(h.gasto), 0)::numeric(14,2) as desvio,
           mode() within group (order by h.dia)::int as dia_tipico,
           count(distinct h.mes)::int as meses_vistos
      from hist h group by h.chave
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
  select a.chave, a.descricao, a.categoria, a.valor_tipico, a.desvio,
         a.dia_tipico, a.meses_vistos,
         (n.chave is not null), coalesce(n.valor_no_mes, 0), n.data_no_mes,
         (e.chave is not null),
         e.encerrada_em,
         -- Voltou a cobrar depois de encerrada. É o caso que ninguém quer
         -- descobrir pela fatura três meses depois.
         (e.chave is not null and n.data_no_mes is not null
          and n.data_no_mes > e.encerrada_em)
    from agrupado a
    left join no_mes n on n.chave = a.chave
    left join public.recorrencias_encerradas e on e.chave = a.chave
   order by (e.chave is not null), a.valor_tipico desc;
$fn$;

comment on function public.fn_recorrencias(date, int, int) is
  'Custos que se repetem: valor típico, dia do mês, se já caíram no mês e se foram encerrados.';

grant execute on function public.fn_recorrencias(date, int, int) to authenticated;
grant select, insert, update, delete on public.recorrencias_encerradas to authenticated;
