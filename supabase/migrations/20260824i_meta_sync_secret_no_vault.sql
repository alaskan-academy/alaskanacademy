-- 2026-08-24 (parte 9) — a service_role sai do texto puro dos agendamentos
--
-- Fecha o que sobrou de 20260824h. `meta-sync-diario` e `meta-sync-horario`
-- carregavam a chave `service_role` inteira no header `Authorization`, dentro
-- de `cron.job.command`. É exposição maior que a do `cs-sync`: a service_role
-- ignora RLS por completo, então quem a tem lê e escreve tudo — as 10.087
-- linhas de clientes, as 13.455 de vendas, qualquer coisa.
--
-- ---------------------------------------------------------------------------
-- Por que aqui NÃO houve rotação
-- ---------------------------------------------------------------------------
-- No `cs-sync` o segredo era um valor arbitrário que havia vazado, então foi
-- gerado outro. Aqui é diferente em duas coisas:
--
--   1. A `service_role` é emitida pelo Supabase. Rotacioná-la significa trocar
--      o JWT secret do projeto, o que invalida também a `anon` e derruba app,
--      edge functions e integrações de uma vez.
--   2. Esta chave não vazou. O comando nunca foi impresso em lugar nenhum — a
--      inspeção foi feita com o JWT mascarado por regex antes de sair do banco.
--
-- Então o certo era mover, não trocar. Se um dia ela vazar, aí sim o caminho é
-- rotacionar o JWT secret do projeto, e é um evento de manutenção programada.
--
-- ---------------------------------------------------------------------------
-- Como a chave foi para o vault sem passar por tela nenhuma
-- ---------------------------------------------------------------------------
--   do $$
--   declare cmd text; chave text;
--   begin
--     select command into cmd from cron.job where jobname = 'meta-sync-horario';
--     chave := (regexp_match(cmd, 'Bearer ([A-Za-z0-9._-]{20,})'))[1];
--     if chave is null then
--       raise exception 'nao encontrei a chave no comando — nada foi gravado';
--     end if;
--     perform vault.create_secret(chave, 'service_role_key', '...');
--   end $$;
--
-- Extraída do próprio comando, dentro de um bloco, direto para o vault.
--
-- ---------------------------------------------------------------------------
-- Os agendamentos
-- ---------------------------------------------------------------------------
-- Antes de trocar, a mesma chamada foi disparada à mão lendo do vault e voltou
-- HTTP 200 — se a chave não servisse, viria 401 e os agendamentos teriam
-- ficado intactos. `cron.schedule` com nome existente substitui.
--
-- Modo e timeout de cada um foram preservados: eles não são detalhe. O diário
-- varre um período maior e precisa dos 480 s; o horário fecha em 240 s.
select cron.schedule('meta-sync-horario', '0 * * * *', $cmd$
  select net.http_post(
    url     := 'https://prtkfwwqpcziexgipoqk.supabase.co/functions/v1/meta-insights-sync?modo=hoje',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret
                                                  from vault.decrypted_secrets
                                                 where name = 'service_role_key')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 240000);
$cmd$);

select cron.schedule('meta-sync-diario', '20 5 * * *', $cmd$
  select net.http_post(
    url     := 'https://prtkfwwqpcziexgipoqk.supabase.co/functions/v1/meta-insights-sync?modo=recente',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret
                                                  from vault.decrypted_secrets
                                                 where name = 'service_role_key')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 480000);
$cmd$);

-- ---------------------------------------------------------------------------
-- Conferido em 24/08
-- ---------------------------------------------------------------------------
-- Os quatro agendamentos, depois desta migration:
--
--   atribuicao-horaria   sem segredo (nunca teve)
--   cs-sync-daily        lê do vault · x-sync-secret · 120 s
--   meta-sync-diario     lê do vault · modo=recente   · 480 s
--   meta-sync-horario    lê do vault · modo=hoje      · 240 s
--
-- Nenhum com JWT no texto. A varredura por `eyJ[A-Za-z0-9._-]{20,}` em
-- `cron.job.command`, no corpo de todas as funções de `public`, na definição
-- das views, em `configuracoes` e em `configuracoes_texto` não devolveu nada.
