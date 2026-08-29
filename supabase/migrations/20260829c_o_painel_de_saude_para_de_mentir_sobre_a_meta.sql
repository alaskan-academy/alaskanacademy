-- O painel "Saúde do sistema" do Início mostrava VERDE — "Métricas de anúncios
-- (Meta), há 0 min" — enquanto duas contas estavam falhando havia uma hora e
-- meia, e o lucro do Resumo estava R$ 2.547/dia acima da realidade.
--
-- Não foi falta de alarme. O alarme mentia.
--
-- A causa estava na própria view:
--
--   (now()::date - max(metricas_meta.data)) > 2 AS defasado  FROM metricas_meta
--
-- Dois defeitos somados:
--
--   1. `max` sobre a tabela INTEIRA. São sete contas, e bastava UMA saudável
--      para a checagem ficar verde — as outras seis podiam estar mortas. É o
--      mesmo defeito de agregação que já apareceu neste projeto no CTR e no CPC
--      somados: o agregado esconde o indivíduo.
--
--   2. Mede `data` (a data da métrica) e não quando a linha foi gravada. O sync
--      pode morrer às 07:00 que `max(data)` continua sendo hoje — o painel só
--      acordaria dois dias depois.
--
-- Agora quem define a saúde é a PIOR conta, e a medida é o último sucesso de
-- sincronização.
--
-- A view de saúde também ganha o caso que o incidente revelou: `/me/adaccounts`
-- devolvia 7 contas às 02:20 e devolve 5 depois — a atribuição do usuário do
-- sistema a duas delas foi removida. "Saiu do portfólio" e "a API recusou a
-- leitura" mandam a pessoa para lugares diferentes do Business Manager, e dizer
-- só "erro 403" faz procurar no lugar errado.

drop view if exists public.vw_meta_sync_saude;

create view public.vw_meta_sync_saude as
with gasto as (
  -- Quanto a conta gasta por dia, nos 7 dias COMPLETOS anteriores. É o que
  -- transforma "falhou" em "estamos deixando de contar R$ X por dia" — sem
  -- isso o alarme é uma tarja que ninguém sabe se é urgente.
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
-- A última vez que a descoberta rodou: é o relógio contra o qual se mede se
-- uma conta sumiu da lista.
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
    -- Mesma rodada gravou sucesso e erro: a métrica passou e o ESTADO falhou.
    -- O dinheiro na tela continua certo; o que falta é saber o que está ligado.
    when s.ultimo_erro = s.ultimo_sucesso                          then 'parcial'
    -- O cron roda de hora em hora; 3 horas é folga para uma falha isolada sem
    -- virar alarme falso.
    when s.ultimo_sucesso < now() - interval '3 hours'             then 'atrasado'
    else 'ok'
  end as saude
from public.ad_accounts a
left join public.meta_sync_estado s on s.ad_account_id = a.id
left join gasto g on g.ad_account_id = a.id
cross join descoberta d
where a.ativo and a.visto_em is not null;

comment on view public.vw_meta_sync_saude is
  'O alarme do sync da Meta: quais contas pararam de sincronizar, por que (saiu do portfólio × a API recusou), há quanto tempo, e quanto de mídia por dia deixa de ser contado.';


create or replace view public.vw_ingest_health as
 SELECT 'payt'::text AS fonte,
    'Vendas (Payt)'::text AS rotulo,
    max(vendas_payt.criado_em) AS ultimo_evento,
    count(*) AS registros,
    round(EXTRACT(epoch FROM now() - max(vendas_payt.criado_em)) / 3600::numeric, 1) AS horas_atras,
    6::numeric AS limiar_horas,
    (EXTRACT(epoch FROM now() - max(vendas_payt.criado_em)) / 3600::numeric) > 6::numeric AS defasado
   FROM vendas_payt
UNION ALL
 -- A PIOR conta manda, e a medida é o último sucesso do sync.
 SELECT 'meta'::text AS fonte,
    'Métricas de anúncios (Meta)'::text AS rotulo,
    (SELECT min(s.ultimo_sucesso) FROM vw_meta_sync_saude s) AS ultimo_evento,
    (SELECT count(*) FROM metricas_meta) AS registros,
    (SELECT coalesce(max(coalesce(s.horas_sem_sucesso, 9999::numeric)), 0::numeric) FROM vw_meta_sync_saude s) AS horas_atras,
    3::numeric AS limiar_horas,
    (SELECT coalesce(bool_or(s.saude <> 'ok'), false) FROM vw_meta_sync_saude s) AS defasado
UNION ALL
 SELECT 'conta_simples'::text AS fonte,
    'Extrato (Conta Simples)'::text AS rotulo,
    max(transacoes.data)::timestamp with time zone AS ultimo_evento,
    count(*) AS registros,
    ((now()::date - max(transacoes.data)) * 24)::numeric AS horas_atras,
    96::numeric AS limiar_horas,
    (now()::date - max(transacoes.data)) > 4 AS defasado
   FROM transacoes;

comment on view public.vw_ingest_health is
  'Frescura de cada fonte. Na Meta, quem define a saúde é a PIOR conta: agregar as sete deixava uma conta saudável esconder as outras seis.';
