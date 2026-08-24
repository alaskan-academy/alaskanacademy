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
-- PASSO 2 — colar o novo valor no secret da edge function (MANUAL)
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
-- PASSO 3 — o agendamento passa a ler do vault (ESTE ARQUIVO)
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
-- PASSO 4 — conferir
-- ---------------------------------------------------------------------------
--   select command ilike '%decrypted_secrets%' as usa_vault,
--          command ~ '[0-9a-f]{32}'            as ainda_tem_segredo
--     from cron.job where jobname = 'cs-sync-daily';
--
-- e disparar uma janela de um dia, checando `net._http_response` por 200 (e não
-- 401, que seria o secret da função ainda no valor antigo).
--
-- ---------------------------------------------------------------------------
-- O QUE CONTINUA EM TEXTO PURO
-- ---------------------------------------------------------------------------
-- `meta-sync-diario` e `meta-sync-horario` carregam a `service_role` no header
-- `Authorization`. É exposição maior que a do cs-sync — a service_role ignora
-- RLS por completo —, e o remédio é o mesmo padrão deste arquivo. Fica para
-- quando este ciclo estiver provado.
