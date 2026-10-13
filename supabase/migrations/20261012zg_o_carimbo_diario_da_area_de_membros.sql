-- O carimbo diario da Area de Membros
-- ============================================================================
--
-- Agenda a Edge Function `membros-metricas`, que todo dia mede os tres
-- indicadores que moram no Supabase da Area de Membros e os grava em
-- `metas_medicao` com `origem = 'area_membros'`.
--
--     ativacao_30d_pct      82,3% em 12/10/2026
--     retencao_30_60d_pct   29,8%
--     bumps_abertos_pct      7,3%
--
-- -- Por que diario, e por que urgente -------------------------------------
--
-- `lesson_progress` tem UNIQUE(user_id, lesson_id) e sobrescreve `updated_at`
-- a cada toque. Quem abriu uma aula em agosto e voltou nela em outubro teve o
-- carimbo de agosto APAGADO. Nao existe historico para reconstruir: a serie so
-- pode comecar no dia em que alguem passar a grava-la, e cada dia sem rodar e
-- um dia que nao volta.
--
-- Os tres primeiros pontos foram carimbados a mao em 12/10/2026. Desta
-- migracao em diante, e a funcao.
--
-- -- Por que o job nasce DESLIGADO ------------------------------------------
--
-- A funcao precisa de tres segredos que esta migracao nao pode criar, porque
-- segredo em arquivo de migracao e segredo no git:
--
--     MEMBROS_SUPABASE_URL       https://fjcdcvywdiagzovqqcpc.supabase.co
--     MEMBROS_SERVICE_ROLE_KEY   a service_role da Area de Membros
--     MEMBROS_SYNC_SECRET        o mesmo valor do vault abaixo
--
-- Job ligado antes dos segredos nao causaria estrago, mas produziria uma
-- falha 401 por dia que ninguem le -- e falha rotineira que ninguem le e como
-- se aprende a ignorar alarme. Melhor nascer desligado e ser ligado de
-- proposito.
--
-- Para ligar, depois de por os tres segredos em Edge Functions > Secrets:
--
--     select vault.create_secret(encode(gen_random_bytes(32),'hex'),
--                                'membros_sync_secret');
--     -- copie o valor para MEMBROS_SYNC_SECRET nos segredos da funcao:
--     select decrypted_secret from vault.decrypted_secrets
--      where name = 'membros_sync_secret';
--     select cron.alter_job(jobid, active := true)
--       from cron.job where jobname = 'membros-metricas-diario';
--
-- -- Por que 4h20 ------------------------------------------------------------
--
-- Fora da janela dos outros cinco crons (que rodam em :00, :10, :20, :30 e a
-- cada 5 minutos) e depois do `meta-sync-diario` das 5h20 nao ter comecado.
-- A funcao pagina ~70 requisicoes no PostgREST de outro projeto; nao convem
-- disputar com a sincronizacao do Meta.
--
-- Uma vez por dia, e nao mais: a janela dos indicadores e de 30 dias, entao
-- medir de hora em hora so produziria ruido de arredondamento. E `metas_medicao`
-- tem UNIQUE (kpi, empresa_id, medido_em), entao rodar duas vezes no mesmo dia
-- sobrescreve em vez de empilhar.

select cron.schedule(
  'membros-metricas-diario',
  '20 4 * * *',
  $cron$
  select net.http_post(
    url     := 'https://prtkfwwqpcziexgipoqk.supabase.co/functions/v1/membros-metricas',
    headers := jsonb_build_object('Content-Type','application/json',
                 'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets
                                    where name = 'membros_sync_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 180000);
  $cron$
);

-- `update cron.job` e negado ao papel da migracao: a API suportada e esta.
select cron.alter_job(jobid, active := false)
  from cron.job where jobname = 'membros-metricas-diario';

-- -- As provas ---------------------------------------------------------------
do $prova$
declare
  r record;
begin
  select * into r from cron.job where jobname = 'membros-metricas-diario';
  if not found then
    raise exception 'o job membros-metricas-diario nao foi criado';
  end if;

  if r.active then
    raise exception 'o job nasceu LIGADO; ele precisa dos tres segredos antes, senao vira uma falha 401 por dia';
  end if;

  if r.schedule <> '20 4 * * *' then
    raise exception 'horario inesperado: %', r.schedule;
  end if;

  -- O segredo tem de vir do vault, nunca escrito no comando -- que fica
  -- legivel em `cron.job` para quem puder ler o schema.
  if r.command !~ 'vault.decrypted_secrets' then
    raise exception 'o comando do cron nao le o segredo do vault';
  end if;
  if r.command ~* 'eyJ|service_role|bearer ' then
    raise exception 'ha o que parece ser uma credencial escrita no comando do cron';
  end if;

  -- O destino tem de existir, senao a funcao roda e grava no vazio.
  if not exists (select 1 from information_schema.tables
                  where table_schema='public' and table_name='metas_medicao') then
    raise exception 'metas_medicao nao existe; a funcao nao teria onde gravar';
  end if;

  -- E os tres indicadores precisam estar marcados como NAO automaticos:
  -- automatico = true faria fn_metas_progresso preferir fn_metas_medir, que
  -- nao os produz, e o carimbo diario seria ignorado em silencio.
  if exists (
    select 1 from metas_kpi
     where chave in ('ativacao_30d_pct','retencao_30_60d_pct','bumps_abertos_pct')
       and automatico
  ) then
    raise exception 'algum dos tres esta marcado automatico; o carimbo seria ignorado';
  end if;

  raise notice 'job criado e desligado, esperando os tres segredos';
end
$prova$;
