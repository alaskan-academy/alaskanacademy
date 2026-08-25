-- A nota fiscal vem ANTES do pagamento, até o dia 20.
--
-- A política da empresa mudou: "sem NF, sem pagamento". Ela contou o porquê --
-- algumas pessoas deixavam de enviar, e a cobrança só existia depois que o
-- dinheiro já tinha saído.
--
-- A tela olhava para trás: "quem foi pago e não mandou documento". Isso é
-- justamente o que permite não enviar. Agora cada nota tem PRAZO, e o prazo vem
-- antes do pagamento:
--
--   Salário da competência M    NF até 20/M         pago em 05/(M+1)
--   Comissão da competência M   NF até 20/(M+1)     paga na semana da NF
--
-- A comissão é da assertividade do mês anterior, por isso o prazo dela cai um
-- mês depois do salário da mesma competência.
--
-- A janela é a competência atual mais a anterior, e a comissão da competência
-- atual fica de fora porque só passa a ser cobrada no mês que vem. Em agosto
-- isso devolve exatamente as três notas que ela descreveu:
--
--   Salário Jul/26    venceu 20/07   segura o pagamento de 05/08, que saiu sem NF
--   Salário Ago/26    venceu 20/08   segura o pagamento de 05/09
--   Comissão Jul/26   venceu 20/08   segura o pagamento de 08/08
--
-- `drop` antes do `create`: o retorno mudou, e o Postgres não deixa trocar o
-- tipo de retorno de uma função existente.
drop function if exists public.fn_nfs_do_editor(uuid, date);

create function public.fn_nfs_do_editor(
  p_editor_id uuid,
  p_mes date default date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date
)
returns table (
  subtipo      text,
  competencia  date,
  rotulo       text,
  prazo        date,
  pagamento_em date,
  quando_paga  text,
  situacao     text,
  dias         int,
  documento_id uuid,
  nome_arquivo text,
  drive_url    text,
  enviada_em   timestamptz
)
language sql
stable
as $fn$
  with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d),
  competencias as (
    select (p_mes - interval '1 month')::date as c
    union all select p_mes
  ),
  esperadas as (
    select 'pagamento'::text as subtipo,
           c.c as competencia,
           'Salário'::text as rotulo,
           (c.c + interval '19 days')::date as prazo,
           (c.c + interval '1 month' + interval '4 days')::date as pagamento_em,
           'pago no dia 5 do mês seguinte'::text as quando_paga
      from competencias c
    union all
    select 'comissao',
           c.c,
           'Comissão',
           (c.c + interval '1 month' + interval '19 days')::date,
           (c.c + interval '1 month' + interval '7 days')::date,
           'paga na semana em que a NF chega'
      from competencias c
  )
  select e.subtipo, e.competencia, e.rotulo, e.prazo, e.pagamento_em, e.quando_paga,
         case when d.id is not null               then 'enviada'
              when (select d from hoje) > e.prazo then 'atrasada'
              else 'a_vencer' end as situacao,
         (e.prazo - (select d from hoje))::int as dias,
         d.id, d.nome_arquivo, d.drive_url, d.criado_em
    from esperadas e
    left join public.documentos_fiscais d
           on d.editor_id   = p_editor_id
          and d.tipo        = 'servico'
          and d.subtipo     = e.subtipo
          and d.competencia = e.competencia
   where e.prazo <= (p_mes + interval '1 month' - interval '1 day')::date
   order by (d.id is not null), e.prazo;
$fn$;

comment on function public.fn_nfs_do_editor(uuid, date) is
  'As notas que o editor deve, com prazo e situação. A NF vem antes do pagamento: dia 20 da competência para o salário, dia 20 do mês seguinte para a comissão.';

revoke execute on function public.fn_nfs_do_editor(uuid, date) from public, anon;
grant  execute on function public.fn_nfs_do_editor(uuid, date) to authenticated;

-- O "Sistema de Decoração de Balões" que disparou o alerta de venda sem
-- categoria: ela disse que é venda de backend na vitrine da Handify. Bate com o
-- `utm_source` do lançamento, `area-membros-handify`.
update public.vendas set produto = 'handify'
 where produto is null and produto_nome = 'Sistema de Decoração de Balões';
