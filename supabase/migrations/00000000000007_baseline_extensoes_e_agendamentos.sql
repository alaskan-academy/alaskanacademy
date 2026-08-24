-- BASELINE — extensões e agendamentos
--
-- O que vive fora do schema `public` e por isso ficou de fora dos outros arquivos
-- do baseline. Rode este PRIMEIRO: `pgcrypto` e `uuid-ossp` fornecem o
-- `gen_random_uuid()` que quase toda tabela usa como default.

-- ---------------------------------------------------------------------------
-- Extensões
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;            -- gen_random_uuid, hash de CPF
create extension if not exists "uuid-ossp";
create extension if not exists unaccent;            -- busca sem acento
create extension if not exists pg_stat_statements;  -- diagnóstico de consulta lenta
create extension if not exists pg_cron;             -- os agendamentos abaixo
create extension if not exists pg_net;              -- o cron chama edge function por HTTP
create extension if not exists supabase_vault;      -- guarda de segredos

-- ---------------------------------------------------------------------------
-- Agendamentos
-- ---------------------------------------------------------------------------
-- Quatro tarefas. Os comandos reais chamam edge functions via `net.http_post`,
-- passando uma chave de autenticação no cabeçalho.
--
-- ATENÇÃO, e é o motivo de este arquivo não trazer os comandos completos: hoje
-- três dos quatro agendamentos guardam essa chave EM TEXTO PURO dentro de
-- `cron.job.command` — `cs-sync-daily`, `meta-sync-diario` e `meta-sync-horario`.
-- Quem tiver leitura no banco lê a chave. Copiar isso para o repositório
-- espalharia o problema em vez de resolvê-lo.
--
-- O caminho certo é o `supabase_vault`, já instalado: guardar a chave lá e o
-- comando referenciá-la. Enquanto isso não é feito, recrie os agendamentos à mão,
-- lendo os segredos de onde eles devem estar.
--
-- `pg_net` merece um aviso próprio: sem ele o `net.http_post` não existe e o cron
-- falha em silêncio. Foi o que aconteceu com `cs-sync-daily` — 52 execuções
-- seguidas com "schema net does not exist", de 30/06 a 20/08/2026, deixando julho
-- inteiro sem transações no Financeiro. Ninguém percebeu porque o alerta de cron
-- falhando também estava quebrado.

/*
select cron.schedule('atribuicao-horaria', '10 * * * *', $cmd$
  -- resolve a origem das vendas recém-chegadas; único sem segredo no comando
  select fn_resolver_conta_das_vendas();
  select fn_herdar_origem_do_upsell();
$cmd$);

select cron.schedule('meta-sync-horario', '0 * * * *', $cmd$
  select net.http_post(
    url     := '<SUPABASE_URL>/functions/v1/meta-insights-sync',
    headers := jsonb_build_object('Content-Type','application/json',
                                  'Authorization','Bearer <SERVICE_ROLE_KEY>'),
    body    := jsonb_build_object('modo','horario'));
$cmd$);

select cron.schedule('meta-sync-diario', '20 5 * * *', $cmd$
  select net.http_post(
    url     := '<SUPABASE_URL>/functions/v1/meta-insights-sync',
    headers := jsonb_build_object('Content-Type','application/json',
                                  'Authorization','Bearer <SERVICE_ROLE_KEY>'),
    body    := jsonb_build_object('modo','diario'));
$cmd$);

select cron.schedule('cs-sync-daily', '0 10 * * *', $cmd$
  select net.http_post(
    url     := '<SUPABASE_URL>/functions/v1/cs-sync',
    headers := jsonb_build_object('Content-Type','application/json',
                                  'x-sync-secret','<CS_SYNC_SECRET>'));
$cmd$);
*/

-- ---------------------------------------------------------------------------
-- Edge functions
-- ---------------------------------------------------------------------------
-- Vivem em `supabase/functions/` e sobem pelo CLI, não por migration. As oito no
-- ar em 24/08/2026, e se exigem JWT:
--
--   payt-webhook             verify_jwt=false   webhook de vendas da Payt
--   cs-sync                  verify_jwt=false   extrato da Conta Simples
--   meta-insights-sync       verify_jwt=true    métricas do Meta Ads
--   admin-users              verify_jwt=false   gestão de usuários
--   setup-admin              verify_jwt=false   cria o primeiro admin; recusa se já houver
--   sync-notion-criativos    verify_jwt=false   importação do Notion
--   radar-sheets-sync        verify_jwt=true    planilha do Radar
--   referencias-sheets-sync  verify_jwt=true    planilha de referências
--
-- `payt-webhook` e `cs-sync` são chamados de fora e por isso não exigem JWT — o
-- webhook valida a Payt pela `integration_key` no corpo. Cuidado ao reimplantar:
-- publicar com verify_jwt padrão faria a Payt receber 401 e as vendas parariam.
