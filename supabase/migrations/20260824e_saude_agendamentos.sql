-- 2026-08-24 (parte 5) — os agendamentos ficam visíveis no Início
--
-- O `cs-sync` rodou 52 vezes seguidas com erro entre 30/06 e 20/08/2026 e
-- ninguém percebeu: julho inteiro ficou sem transações no Financeiro. O alerta
-- de cron falhando existia e não pegou, porque olhava só a última execução.
--
-- Esta view expõe o que a última execução esconde: quantas vezes cada
-- agendamento falhou nos últimos 7 dias. Hoje (24/08) isso mostra
-- `meta-sync-horario` com 6 falhas e `cs-sync-daily` com 3, ambos com a última
-- execução bem-sucedida — invisíveis por qualquer outro caminho.
--
-- `cron` não é exposto pelo PostgREST, então a leitura passa por uma view em
-- `public`, que roda com os privilégios do dono e não com os de quem consulta.
create or replace view public.vw_saude_agendamentos as
  select
    j.jobname                                   as nome,
    j.schedule                                  as agenda,
    j.active                                    as ativo,
    u.status                                    as ultimo_status,
    u.start_time                                as ultima_execucao,
    round(extract(epoch from (now() - u.start_time)) / 3600.0, 1) as horas_atras,
    coalesce(f.falhas, 0)                       as falhas_7d
  from cron.job j
  left join lateral (
    select d.status, d.start_time
      from cron.job_run_details d
     where d.jobid = j.jobid
     order by d.start_time desc
     limit 1
  ) u on true
  left join lateral (
    select count(*) as falhas
      from cron.job_run_details d
     where d.jobid = j.jobid
       and d.status <> 'succeeded'
       and d.start_time > now() - interval '7 days'
  ) f on true;

-- Só quem entrou. O `anon` recebe SELECT por privilégio padrão do schema, e
-- deixar assim entregaria o mapa dos agendamentos a quem não fez login —
-- exatamente o que foi removido de nove tabelas em 23/08.
grant select on public.vw_saude_agendamentos to authenticated;
revoke all on public.vw_saude_agendamentos from anon;

-- Mesma correção para a view de frescura das fontes, que estava aberta ao anon
-- desde que foi criada.
revoke all on public.vw_ingest_health from anon;
