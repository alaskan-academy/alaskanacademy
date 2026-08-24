-- 2026-08-24 (parte 7) — a busca de cliente lia a tabela inteira a cada venda
--
-- Diagnóstico do timeout que derrubou dois eventos da Payt às 15:20 de 24/08,
-- já com o retry no ar. Medido, não suposto:
--
--   pg_stat_statements, insert do webhook em `vendas_payt`:
--     624 chamadas · média 1.136 ms · pior caso 7.458 ms
--
-- Um insert de UMA linha levando mais de um segundo na média. O gatilho de
-- normalização chama `fn_resolver_cliente`, e o plano dela era:
--
--   Seq Scan on clientes (Rows Removed by Filter: 10086) — 51 ms, 204 buffers
--
-- Varredura completa das 10.087 linhas de `clientes` a cada venda que chega.
--
-- O índice certo JÁ EXISTIA: `clientes_email_unico`, único sobre
-- `lower(trim(email))`. Ele não era usado porque é PARCIAL, com predicado
-- `nullif(trim(email),'') is not null`, e o planejador não deduz sozinho que
-- "lower(trim(email)) = <texto não vazio>" satisfaz esse predicado. Repetir o
-- predicado na consulta resolve, sem criar índice novo:
--
--   Index Scan using clientes_email_unico — 8 ms, 3 buffers
--
-- O `ORDER BY criado_em` também saiu: o índice é ÚNICO nessa expressão, então
-- no máximo uma linha casa e o sort ordenava um resultado de uma linha só.
create or replace function public.fn_resolver_cliente(p_email text, p_nome text, p_telefone text, p_data timestamp with time zone)
 returns uuid
 language plpgsql
as $function$
DECLARE
  v_id    uuid;
  v_email text := lower(nullif(trim(p_email), ''));
BEGIN
  IF v_email IS NULL THEN RETURN NULL; END IF;

  SELECT id INTO v_id
    FROM clientes
   WHERE lower(trim(email)) = v_email
     AND nullif(trim(email), '') IS NOT NULL   -- só para o planejador ver o índice
   LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO clientes (email, nome, telefone, primeira_compra, ultima_compra)
    VALUES (v_email, nullif(trim(p_nome), ''), nullif(trim(p_telefone), ''), p_data, p_data)
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- O que ficou medido e NÃO foi mexido
-- ---------------------------------------------------------------------------
-- `vendas` tem 22 índices para 13.455 linhas (15 MB de tabela, 8,9 MB de
-- índice), e todos são mantidos a cada gravação. Em 193 dias de contadores:
--
--   idx_vendas_semana         0 usos   256 kB
--   idx_vendas_trafego_pago   0 usos    56 kB
--   idx_vendas_utm_content    1 uso   1.328 kB
--   idx_vendas_utm_camp       1 uso     344 kB
--   idx_vendas_cart_id        3 usos   176 kB
--   idx_vendas_hora           3 usos   320 kB
--   idx_vendas_origem         3 usos   352 kB
--
-- Derrubar os dois de uso zero é seguro e barato, mas mexer em índice de tabela
-- de venda pede decisão de gente, não de migration automática — e criar índice
-- sem CONCURRENTLY foi o que travou as escritas nesta mesma manhã. Fica
-- registrado para quando houver decisão.
