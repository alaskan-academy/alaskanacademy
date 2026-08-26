-- Correções encontradas ao revisar o que acabei de entregar.
--
-- Três problemas, e os dois primeiros são meus.

-- 1 ─────────────────────────────────────────────────────────────────────────
-- A fila de checkouts levava 5,2 SEGUNDOS para abrir.
--
-- `vw_checkouts_a_confirmar` faz um lateral por checkout, e cada um varria as
-- 13.552 vendas inteiras: 97 varreduras sequenciais, 1,9 milhão de blocos lidos.
-- Funcionava no teste porque o resultado estava certo — só demorava, e demora
-- não aparece em conferência de dado.
--
-- O índice é sobre as MESMAS expressões que a view usa. Se alguém mudar o
-- `split_part` lá e não aqui, o índice para de ser usado silenciosamente e a
-- lentidão volta — por isso os dois trechos precisam continuar idênticos.
create index if not exists idx_vendas_checkout_link
  on public.vendas (
    (split_part(payload_webhook->'link'->>'url', '?', 1)),
    ((payload_webhook->'link'->>'title'))
  )
  where payload_webhook is not null;

comment on index public.idx_vendas_checkout_link is
  'Serve o lateral de vw_checkouts_a_confirmar. Sem ele a tela de checkouts '
  'leva ~5s para abrir.';

-- 2 ─────────────────────────────────────────────────────────────────────────
-- `fn_funil_campos_derivados` estava exposta ao papel `anon` via REST.
--
-- É função de gatilho: chamá-la direto falha por falta de contexto, então o
-- risco prático é baixo. Mas é `security definer` acessível sem login, e a
-- regra do projeto é não deixar isso de pé. O Postgres concede EXECUTE a PUBLIC
-- por padrão — declarar o grant para `authenticated` só ADICIONA; sem o revoke
-- explícito, o anon continua lá. Já tinha aprendido isso neste projeto e
-- esqueci ao escrever a migração.
revoke execute on function public.fn_funil_campos_derivados() from public, anon;

-- 3 ─────────────────────────────────────────────────────────────────────────
-- A view rodava como SECURITY DEFINER, que é o padrão do Postgres e ignora a
-- RLS das tabelas de baixo.
--
-- Hoje não muda nada — as políticas são `to authenticated using (true)`. Mas
-- se um dia `vendas` ganhar RLS por usuário, esta view furaria a regra sem
-- ninguém notar. Sai barato agora, caro depois.
alter view public.vw_checkouts_a_confirmar set (security_invoker = on);
