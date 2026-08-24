-- 2026-08-24 (parte 8) — o segredo do cs-sync sai do texto puro
--
-- Três dos quatro agendamentos guardavam a chave dentro de `cron.job.command`,
-- em texto claro. Quem tem acesso direto ao banco — a string de conexão, o
-- painel do Supabase, qualquer dump ou backup — lia a chave. Pelo dashboard
-- ninguém alcança (`authenticated` e `anon` não têm USAGE no schema `cron`),
-- mas um backup circulando basta.
--
-- O gatilho para agir agora foi pior: em 24/08 o valor do `cs-sync` apareceu em
-- texto claro numa sessão de trabalho, por uma máscara mal escrita ao inspecionar
-- o comando do cron. Então não bastava mover — tinha que rotacionar.
--
-- O `supabase_vault` já estava instalado e nunca havia sido usado (zero
-- segredos). Ele é o lugar certo: `authenticated` e `anon` não têm sequer USAGE
-- no schema `vault`; só `service_role` e o dono do agendamento leem.
--
-- ---------------------------------------------------------------------------
-- PASSO 1 — criar o segredo (JÁ FEITO em 24/08)
-- ---------------------------------------------------------------------------
-- O valor nasce dentro do banco e não passa por tela nenhuma:
--
--   select vault.create_secret(
--            encode(gen_random_bytes(32), 'hex'),
--            'cs_sync_secret',
--            'Header x-sync-secret da edge function cs-sync.');
--
-- ---------------------------------------------------------------------------
-- PASSO 2 — colar o novo valor no secret da edge function (FEITO em 24/08)
-- ---------------------------------------------------------------------------
-- No SQL editor do Supabase, ler o valor:
--
--   select decrypted_secret from vault.decrypted_secrets where name = 'cs_sync_secret';
--
-- e gravá-lo em Edge Functions > cs-sync > Secrets, na variável
-- `CS_SYNC_SECRET`. Isto não dá para fazer por SQL: o segredo da função vive
-- fora do banco.
--
-- A partir daqui a função só aceita o valor novo, e o agendamento antigo passa
-- a tomar 401 até o passo 3. A janela é segura: o `cs-sync-daily` roda às 10h.
--
-- ---------------------------------------------------------------------------
-- PASSO 3 — o agendamento passa a ler do vault (APLICADO em 24/08)
-- ---------------------------------------------------------------------------
-- O comando deixa de conter o segredo e passa a referenciá-lo. `cron.schedule`
-- com nome existente substitui, então rodar de novo é seguro.
select cron.schedule(
  'cs-sync-daily',
  '0 10 * * *',
  $cmd$
  select net.http_post(
    url     := 'https://prtkfwwqpcziexgipoqk.supabase.co/functions/v1/cs-sync',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'x-sync-secret', (select decrypted_secret
                                     from vault.decrypted_secrets
                                    where name = 'cs_sync_secret')),
    body    := '{}'::jsonb,
    -- O `cs-sync` demora mais que os 5 s padrão do pg_net. A função termina do
    -- lado do servidor mesmo se o pg_net desistir, mas com o timeout curto a
    -- resposta se perde e não dá para saber se deu certo.
    timeout_milliseconds := 120000);
  $cmd$
);

-- ---------------------------------------------------------------------------
-- PASSO 4 — conferido em 24/08
-- ---------------------------------------------------------------------------
-- Resultado da conferência:
--   * chamada de teste com o valor do vault -> HTTP 200 (401 seria segredo errado)
--   * `cron.job.command` lê do vault e não tem mais nenhum hash no texto
--   * o agendamento roda como `postgres`, que tem USAGE em `vault` e SELECT em
--     `vault.decrypted_secrets` — confirmado, não suposto
--
-- ---------------------------------------------------------------------------
-- O QUE CONTINUA EM TEXTO PURO
-- ---------------------------------------------------------------------------
-- Nada. `meta-sync-diario` e `meta-sync-horario` foram resolvidos no mesmo dia,
-- em 20260824i — sem rotação, porque a service_role não vazou e trocá-la
-- exigiria rotacionar o JWT secret do projeto inteiro.
