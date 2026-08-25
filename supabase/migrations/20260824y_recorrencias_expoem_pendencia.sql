-- A tela precisa saber se o agrupamento é definitivo ou provisório, e por quê.
-- Sem isso "Hostinger (DM)" passaria por nome de verdade e ninguém saberia que
-- ainda falta decidir se é domínio ou n8n.
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
  encerrada boolean, encerrada_em date, reativada boolean,
  apelidado boolean, definido boolean, nota text
)
language sql stable as $fn$
  with hist as (
    select public.fn_fornecedor(t.descricao) as chave,
           t.descricao, t.categoria,
           date_trunc('month', t.data)::date as mes,
           extract(day from t.data)::int as dia,
           -t.valor as gasto
      from public.transacoes t
     where t.valor < 0
       and t.data <  p_mes
       and t.data >= (p_mes - (p_meses_base || ' months')::interval)::date
       and public.fn_fornecedor(t.descricao) is not null
       and coalesce(t.categoria, '') not in
           ('Pró-labore', 'Retirada de Lucro', 'Sócios', 'Reserva de Caixa')
  ),
  -- Um fornecedor pode cobrar mais de uma vez no mesmo mês (Hostinger cobra por
  -- domínio). O valor típico é do MÊS, então soma dentro do mês antes da
  -- mediana — senão a mediana seria de uma cobrança avulsa e a previsão sairia
  -- baixa.
  por_mes as (
    select chave,
           (array_agg(descricao order by mes desc))[1] as descricao,
           mode() within group (order by categoria)    as categoria,
           mes, min(dia)::int as dia,
           sum(gasto)::numeric(14,2) as gasto
      from hist group by chave, mes
  ),
  agrupado as (
    select p.chave,
           (array_agg(p.descricao order by p.mes desc))[1] as descricao,
           mode() within group (order by p.categoria) as categoria,
           percentile_cont(0.5) within group (order by p.gasto)::numeric(14,2) as valor_tipico,
           coalesce(stddev_pop(p.gasto), 0)::numeric(14,2) as desvio,
           mode() within group (order by p.dia)::int as dia_tipico,
           count(*)::int as meses_vistos
      from por_mes p group by p.chave
    having count(*) >= p_min_meses
  ),
  no_mes as (
    select public.fn_fornecedor(t.descricao) as chave,
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
         (e.chave is not null and n.data_no_mes is not null
          and n.data_no_mes > e.encerrada_em),
         (f.nome is not null),
         coalesce(f.definido, true),
         f.nota
    from agrupado a
    left join no_mes n on n.chave = a.chave
    left join public.recorrencias_encerradas e on e.chave = a.chave
    -- `lateral` com limit 1: um apelido pode ter vários padrões (Claude tem dois
    -- descritores, Supabase também). Com join simples, a recorrência aparecia
    -- uma vez por padrão — Claude saía duplicado na tela.
    left join lateral (
      select ff.nome, ff.definido, ff.nota
        from public.fornecedores ff
       where ff.ativo and ff.nome = a.chave
       order by ff.definido, ff.prioridade
       limit 1
    ) f on true
   order by (e.chave is not null), coalesce(f.definido, true), a.valor_tipico desc;
$fn$;

comment on function public.fn_recorrencias(date, int, int) is
  'Custos que se repetem, por fornecedor. definido = false significa agrupamento provisório.';

grant execute on function public.fn_recorrencias(date, int, int) to authenticated;
