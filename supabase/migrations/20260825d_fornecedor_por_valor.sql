-- Regra de fornecedor que também olha o valor.
--
-- Hostinger vende domínio e n8n, no mesmo descritor e no mesmo cartão. Nada no
-- texto separa — as adquirentes DM e EBN processam as mesmas cobranças. Mas ela
-- reconhece pelos preços: R$ 51,08 e R$ 39,99 são domínio; R$ 81,08 e R$ 87,99
-- são n8n. É o único sinal que existe, e só quem conhece o negócio o tem.
--
-- `valores` é lista de preços exatos, não faixa. Faixa juntaria R$ 51,08 com
-- R$ 52,99 e R$ 54,99, que são outra coisa que ela não soube dizer o que é — e
-- que seguem pendentes de propósito, em "Hostinger (a definir)".
alter table public.fornecedores add column if not exists valores numeric[];

comment on column public.fornecedores.valores is
  'Preços exatos que esta regra cobre. Nulo = a regra vale para qualquer valor.';

-- A assinatura muda para receber o valor. Precisa cair a versão antiga e quem
-- depende dela.
drop function if exists public.fn_recorrencias(date, int, int);
drop function if exists public.fn_fornecedor(text);
drop function if exists public.fn_fornecedor_info(text);

create function public.fn_fornecedor_info(p_descricao text, p_valor numeric default null)
returns table (nome text, definido boolean)
language sql stable as $fn$
  select f.nome, f.definido
    from public.fornecedores f
   where f.ativo
     and ( (f.tipo_match = 'contains' and upper(p_descricao) like '%' || upper(f.padrao) || '%')
        or (f.tipo_match = 'regex'    and p_descricao ~* f.padrao) )
     and ( f.valores is null
        or (p_valor is not null and round(abs(p_valor), 2) = any (f.valores)) )
   -- Regra com valor ganha da genérica: mais específica primeiro.
   order by (f.valores is null), f.prioridade, length(f.padrao) desc
   limit 1;
$fn$;

create function public.fn_fornecedor(p_descricao text, p_valor numeric default null)
returns text
language sql stable as $fn$
  select coalesce(
    (select i.nome from public.fn_fornecedor_info(p_descricao, p_valor) i),
    public.fn_chave_recorrencia(p_descricao)
  );
$fn$;

comment on function public.fn_fornecedor(text, numeric) is
  'Nome do fornecedor por apelido; usa o valor quando a regra o exige. Cai na normalização do descritor sem apelido.';

delete from public.fornecedores where padrao like '%HOSTINGER%';

insert into public.fornecedores (nome, padrao, tipo_match, prioridade, definido, valores, nota) values
  ('Hostinger (domínio)', 'HOSTINGER', 'contains', 40, true,
   array[51.08, 39.99]::numeric[], null),
  ('Hostinger (n8n)',     'HOSTINGER', 'contains', 40, true,
   array[81.08, 87.99]::numeric[], null),
  ('Hostinger (a definir)', 'HOSTINGER', 'contains', 80, false, null,
   'Sobrou o que não é nem domínio nem n8n pelos preços conhecidos: R$ 7,08 (2x), R$ 46,74, R$ 52,99, R$ 54,99.');

create or replace function public.fn_recorrencias(
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
    -- O valor entra na resolução: é ele que separa domínio de n8n na Hostinger,
    -- onde o descritor e o cartão são idênticos nos dois.
    select public.fn_fornecedor(t.descricao, -t.valor) as chave,
           t.descricao, t.categoria,
           date_trunc('month', t.data)::date as mes,
           extract(day from t.data)::int as dia,
           -t.valor as gasto
      from public.transacoes t
     where t.valor < 0
       and t.data <  p_mes
       and t.data >= (p_mes - (p_meses_base || ' months')::interval)::date
       and public.fn_fornecedor(t.descricao, -t.valor) is not null
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
    select public.fn_fornecedor(t.descricao, -t.valor) as chave,
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
    -- `lateral` com limit 1: um apelido pode ter vários padrões. Com join
    -- simples, a recorrência aparecia uma vez por padrão.
    left join lateral (
      select ff.nome, ff.definido, ff.nota
        from public.fornecedores ff
       where ff.ativo and ff.nome = a.chave
       order by ff.definido, ff.prioridade
       limit 1
    ) f on true
   order by (e.chave is not null), coalesce(f.definido, true), a.valor_tipico desc;
$fn$;

grant execute on function public.fn_fornecedor(text, numeric)      to authenticated;
grant execute on function public.fn_fornecedor_info(text, numeric) to authenticated;
grant execute on function public.fn_recorrencias(date, int, int)   to authenticated;
