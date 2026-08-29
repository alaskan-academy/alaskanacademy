-- `ad_accounts.status_meta` guarda o `account_status` da Meta e é atualizado a
-- cada descoberta, desde sempre. Nenhuma tela do app lia essa coluna — o mesmo
-- defeito de `meta_sync_estado`: o registro existe, a tela não.
--
-- E hoje ele mudou: "Workshop Buquê - TSL" saiu de 1 para 9 entre 08:31 e 08:47.
-- Nove é IN_GRACE_PERIOD — cobrança recusada, conta em carência antes de ser
-- desativada. A conta gasta ~R$ 285/dia.
--
-- O status de cobrança entra como COLUNA, e não dentro de `saude`. São dois
-- eixos independentes: uma conta pode sincronizar perfeitamente e estar com o
-- cartão recusado, e misturar as duas coisas num campo só faria uma esconder a
-- outra — primeira armadilha do CLAUDE.md em forma de enum.
--
-- Sem lista de códigos aqui: qualquer valor diferente de '1' é problema, e o
-- código cru vai para a tela. Uma lista fechada no banco envelheceria calada no
-- dia em que a Meta criasse um status novo.
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
descoberta as (select max(visto_em) as em from public.ad_accounts where ativo)
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
  -- Eixo separado: o estado da CONTA na Meta, que não tem nada a ver com o
  -- sync. 1 é ativa; qualquer outra coisa merece olhar.
  a.status_meta,
  (a.status_meta is not null and a.status_meta <> '' and a.status_meta <> '1') as cobranca_com_problema
from public.ad_accounts a
left join public.meta_sync_estado s on s.ad_account_id = a.id
left join gasto g on g.ad_account_id = a.id
cross join descoberta d
where a.ativo and a.visto_em is not null;

comment on view public.vw_meta_sync_saude is
  'O alarme do sync da Meta, em dois eixos independentes: `saude` (o sync consegue ler?) e `status_meta` (a conta está ativa na Meta, ou com cobrança pendente?).';
