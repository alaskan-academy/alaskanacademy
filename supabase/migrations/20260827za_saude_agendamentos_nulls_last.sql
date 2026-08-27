-- O painel de saúde dizia "nunca rodou" para o agendamento que mais roda.
--
-- O pg_cron grava a linha da execução ANTES de começar, com status
-- 'connecting' e `start_time` nulo. Uma dessas ficou presa (runid 322, do
-- `atribuicao-horaria`). Como a vista pegava a última execução com
-- `ORDER BY start_time DESC`, e em Postgres o nulo vem PRIMEIRO nessa ordem,
-- a linha fantasma ganhava de todas as execuções reais — para sempre.
--
-- Conferido antes de mexer: o job tinha 57 execuções em 7 dias, zero falhas,
-- a última às 22:10. Ele nunca esteve parado; só a vista dizia que sim.
--
-- É o pior tipo de mentira num painel de saúde. Quem confia nele vai
-- investigar o que não está quebrado; quem aprende a ignorar o vermelho não
-- vai ver o próximo, que será de verdade.
--
-- `NULLS LAST`: uma execução que ainda não começou não é a última que rodou.

CREATE OR REPLACE VIEW vw_saude_agendamentos AS
SELECT j.jobname AS nome,
    j.schedule AS agenda,
    j.active AS ativo,
    u.status AS ultimo_status,
    u.start_time AS ultima_execucao,
    round(EXTRACT(epoch FROM now() - u.start_time) / 3600.0, 1) AS horas_atras,
    COALESCE(f.falhas, 0::bigint) AS falhas_7d
   FROM cron.job j
     LEFT JOIN LATERAL ( SELECT d.status,
            d.start_time
           FROM cron.job_run_details d
          WHERE d.jobid = j.jobid
          ORDER BY d.start_time DESC NULLS LAST
         LIMIT 1) u ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS falhas
           FROM cron.job_run_details d
          WHERE d.jobid = j.jobid AND d.status <> 'succeeded'::text AND d.start_time > (now() - '7 days'::interval)) f ON true;
