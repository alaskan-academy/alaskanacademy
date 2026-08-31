-- A saúde da conta ganha o saldo e o "desde quando".
--
-- "Cobrança recusada" sem valor e sem data não deixa agir: não dá para conferir
-- se o pagamento cobriu, nem para saber se isso é de hoje ou de três dias.
--
-- `saldo_conta` substitui o nome `saldo_devedor` da migração anterior pelo mesmo
-- motivo explicado lá: conta saudável também tem saldo.
create or replace view public.vw_meta_sync_saude as
with gasto as (
  select d.ad_account_id, round(avg(d.g)::numeric, 2) as media_dia
  from (
    select ad_account_id, data, sum(investimento) g
    from public.metricas_meta
    where nivel = 'campanha'
      and data between current_date - 7 and current_date - 1
    group by 1, 2
  ) d
  group by d.ad_account_id
),
descoberta as (select max(visto_em) as em from public.ad_accounts where ativo),
-- Desde quando o status atual vale. Vem do histórico, que o gatilho mantém.
desde as (
  select distinct on (h.ad_account_id)
         h.ad_account_id, h.mudou_em, h.status_anterior
  from public.meta_conta_status_historico h
  order by h.ad_account_id, h.mudou_em desc
)
select
  a.id            as ad_account_id,
  a.nome          as conta,
  a.account_id,
  s.ultimo_sucesso,
  s.ultimo_erro,
  s.mensagem_erro,
  g.media_dia     as gasto_medio_dia,
  a.visto_em,
  round(extract(epoch from (now() - s.ultimo_sucesso)) / 3600.0, 1) as horas_sem_sucesso,
  case
    when s.ad_account_id is null or s.ultimo_sucesso is null      then 'nunca_sincronizou'
    when a.visto_em < d.em - interval '1 minute'                   then 'fora_do_portfolio'
    when s.ultimo_erro > s.ultimo_sucesso                          then 'falhando'
    when s.ultimo_erro = s.ultimo_sucesso                          then 'parcial'
    when s.ultimo_sucesso < now() - interval '3 hours'             then 'atrasado'
    else 'ok'
  end as saude,
  a.status_meta,
  (a.status_meta is not null and a.status_meta <> '' and a.status_meta <> '1') as cobranca_com_problema,
  a.saldo_conta,
  a.total_gasto,
  a.motivo_desativacao,
  dd.mudou_em as status_desde,
  case when dd.mudou_em is null then null
       else greatest(0, (current_date - dd.mudou_em::date)) end as status_ha_dias
from public.ad_accounts a
left join public.meta_sync_estado s on s.ad_account_id = a.id
left join gasto g on g.ad_account_id = a.id
left join desde dd on dd.ad_account_id = a.id
cross join descoberta d
where a.ativo and a.visto_em is not null;

comment on view public.vw_meta_sync_saude is
  'O alarme do sync da Meta, em dois eixos: `saude` (o sync consegue ler?) e `status_meta` (a conta está de pé?), com o saldo da conta e há quantos dias o status é esse.';
