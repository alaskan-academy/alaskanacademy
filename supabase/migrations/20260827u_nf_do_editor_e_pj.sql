-- "Salário" vira "Serviço mensal": o editor é PJ, não é empregado.
--
-- O rótulo estava errado no sentido que mais importa num documento fiscal.
-- Salário pressupõe vínculo empregatício — CLT, encargos, subordinação. Aqui é
-- prestação de serviço com nota, e a tela que cobra a NF era justamente o pior
-- lugar para chamar de salário: é a tela em que o editor lê o que precisa
-- emitir.
--
-- "Serviço mensal", e não "Fixo mensal", porque não sei se o valor é fixo —
-- afirmar que é seria trocar um erro por outro. O que se sabe é que é o serviço
-- daquele mês, em contraste com a comissão, que é do mês anterior.
--
-- O `subtipo` no banco continua 'pagamento'. Ele é chave — está em
-- `documentos_fiscais.subtipo`, na unicidade `(competencia, fornecedor, tipo,
-- subtipo, referencia_externa)` e no nome dos arquivos já no Drive. Renomear a
-- chave junto com o rótulo quebraria o vínculo com tudo o que já foi enviado,
-- para não ganhar nada: quem lê a tela lê o rótulo, não a chave.

create or replace function public.fn_nfs_do_editor(
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
           'Serviço mensal'::text as rotulo,
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
  'As notas que o editor deve, com prazo e situacao. A NF vem antes do '
  'pagamento: dia 20 da competencia para o servico mensal, dia 20 do mes '
  'seguinte para a comissao. O editor e PJ -- nao ha salario aqui.';

revoke execute on function public.fn_nfs_do_editor(uuid, date) from public, anon;
grant  execute on function public.fn_nfs_do_editor(uuid, date) to authenticated;
