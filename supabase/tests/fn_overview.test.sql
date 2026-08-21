-- Testes de `fn_overview()`, a função onde mora a regra de negócio do dashboard.
--
-- Existe porque a lógica migrou para o SQL e os testes ficaram no JavaScript: os 31
-- de `financeiro.ts` cobrem cinco continhas, enquanto esta função decide segmentação,
-- rateio, deduplicação de tentativa, herança de upsell e agrupamento por origem —
-- e não tinha nenhum. Cada correção de um dia inteiro foi verificada à mão, uma vez.
--
-- Os casos abaixo são exatamente os defeitos que apareceram nesse dia. Se algum
-- voltar, um deles falha.
--
-- Como rodar:
--   psql "$DATABASE_URL" -f supabase/tests/fn_overview.test.sql
--
-- Roda inteiro dentro de uma transação que é revertida no fim, então não suja o banco.

BEGIN;

-- ── Cenário ───────────────────────────────────────────────────────────────────
--
-- Um período de um dia, com dados montados para exercitar cada regra. Os ids são
-- fixos para o teste ser determinístico.

CREATE TEMP TABLE _esperado (caso text, obtido numeric, esperado numeric);

DO $cenario$
DECLARE
  v_conta   uuid := '11111111-1111-1111-1111-111111111111';
  v_cliente uuid := '22222222-2222-2222-2222-222222222222';
  v_outro   uuid := '33333333-3333-3333-3333-333333333333';
  v_dia     timestamptz := '2099-01-15 10:00:00-03';
BEGIN
  -- Uma conta de anúncio de mentira, para o recorte por CA
  INSERT INTO ad_accounts (id, account_id, nome, ativo)
  VALUES (v_conta, 'act_teste', 'Conta de Teste', true);

  INSERT INTO clientes (id, email) VALUES
    (v_cliente, 'teste-a@exemplo.com'),
    (v_outro,   'teste-b@exemplo.com');

  -- 1. Venda de tráfego, com ad_id e conta
  INSERT INTO vendas (pedido_id, produto_nome, data_venda, status, valor_total,
                      valor_sem_juros, valor_oferta_principal, ad_id_meta,
                      ad_account_id, cliente_id, cart_id)
  VALUES ('T-TRAFEGO', 'Curso X', v_dia, 'aprovada', 100, 100, 100,
          '999', v_conta, v_cliente, 'CART-1');

  -- 2. Upsell no mesmo carrinho: sem ad_id próprio, deve herdar o tráfego do pai
  INSERT INTO vendas (pedido_id, produto_nome, data_venda, status, valor_total,
                      valor_sem_juros, valor_oferta_principal, is_upsell,
                      cliente_id, cart_id)
  VALUES ('T-UPSELL', 'Upsell Y', v_dia + interval '2 min', 'aprovada', 300, 300, 300,
          true, v_cliente, 'CART-1');

  -- 3. Venda de back-end, com origem colada no token da Payt
  INSERT INTO vendas (pedido_id, produto_nome, data_venda, status, valor_total,
                      valor_sem_juros, valor_oferta_principal, utm_source, cliente_id)
  VALUES ('T-BACKEND', 'Curso Z', v_dia, 'aprovada', 50, 50, 50,
          'whatsappjLj6aabcdef0123456789abcdef', v_outro);

  -- 4. Venda estornada: sai da receita por perder o status, não por dedução
  INSERT INTO vendas (pedido_id, produto_nome, data_venda, status, valor_total,
                      valor_sem_juros, valor_oferta_principal, valor_reembolsado, cliente_id)
  VALUES ('T-REEMB', 'Curso X', v_dia, 'reembolsada', 70, 70, 70, 0, v_outro);

  -- 5. Três tentativas da mesma pessoa no mesmo produto, nenhuma paga
  INSERT INTO vendas (pedido_id, produto_nome, data_venda, status, valor_total,
                      valor_oferta_principal, cliente_id)
  VALUES ('T-PIX-1', 'Curso W', v_dia,                    'expirada', 60, 60, v_outro),
         ('T-PIX-2', 'Curso W', v_dia + interval '5 min', 'expirada', 60, 60, v_outro),
         ('T-PIX-3', 'Curso W', v_dia + interval '9 min', 'expirada', 60, 60, v_outro);

  PERFORM fn_herdar_origem_do_upsell();
END
$cenario$;

-- ── Verificações ──────────────────────────────────────────────────────────────

WITH r AS (
  SELECT fn_overview('2099-01-15 00:00:00-03'::timestamptz,
                     '2099-01-15 23:59:59-03'::timestamptz) AS j
)
INSERT INTO _esperado (caso, obtido, esperado)
SELECT * FROM (
  SELECT 'receita soma só aprovadas (100 + 300 + 50)',
         (j->>'receita')::numeric, 450 FROM r
  UNION ALL
  -- Foi o defeito mais caro do dia: a venda estornada perde o status `aprovada` e já
  -- sai da receita; descontá-la de novo contava a mesma perda duas vezes.
  SELECT 'estorno não entra na receita',
         (j->>'receita')::numeric, 450 FROM r
  UNION ALL
  SELECT 'estorno aparece em perdas com o valor da venda',
         (j->'perdas'->'reembolsada'->>'valor')::numeric, 70 FROM r
  UNION ALL
  -- `valor_reembolsado` tem default 0 e quase nunca é preenchido; o `coalesce` antigo
  -- devolvia zero e a perda sumia.
  SELECT 'perda cai para valor_total quando valor_reembolsado é zero',
         (j->'perdas'->'reembolsada'->>'valor')::numeric, 70 FROM r
  UNION ALL
  SELECT 'três PIX da mesma pessoa contam uma vez',
         (j->'nao_aprovadas'->'expirada'->>'qtd')::numeric, 1 FROM r
  UNION ALL
  SELECT 'e valem 60, não 180',
         (j->'nao_aprovadas'->'expirada'->>'valor')::numeric, 60 FROM r
  UNION ALL
  SELECT 'receita sem upsell exclui os 300',
         (j->>'receita_sem_upsell')::numeric, 150 FROM r
  UNION ALL
  SELECT 'back-end conta só a venda sem origem de anúncio',
         (j->>'receita_backend')::numeric, 50 FROM r
) v;

-- Segmentos: misto tem que fechar como tráfego + back-end
WITH t AS (SELECT fn_overview('2099-01-15 00:00:00-03'::timestamptz,
                              '2099-01-15 23:59:59-03'::timestamptz, 'trafego') AS j),
     b AS (SELECT fn_overview('2099-01-15 00:00:00-03'::timestamptz,
                              '2099-01-15 23:59:59-03'::timestamptz, 'backend') AS j)
INSERT INTO _esperado (caso, obtido, esperado)
SELECT * FROM (
  -- O upsell herdou o carrinho do pai, então entra em tráfego apesar de não ter ad_id.
  SELECT 'tráfego inclui o upsell herdado (100 + 300)',
         (t.j->>'receita')::numeric, 400 FROM t
  UNION ALL
  SELECT 'back-end fica só com a venda de whatsapp',
         (b.j->>'receita')::numeric, 50 FROM b
  UNION ALL
  SELECT 'tráfego + back-end fecham o misto',
         (t.j->>'receita')::numeric + (b.j->>'receita')::numeric, 450 FROM t, b
) v;

-- Origem do back-end: o token da Payt precisa sair do utm_source
WITH r AS (
  SELECT fn_overview('2099-01-15 00:00:00-03'::timestamptz,
                     '2099-01-15 23:59:59-03'::timestamptz) AS j
)
INSERT INTO _esperado (caso, obtido, esperado)
SELECT 'origem legível, sem o sufixo jLj6…',
       (SELECT count(*) FROM jsonb_array_elements(j->'por_origem') o
         WHERE o->>'origem' = 'whatsapp'), 1
FROM r;

-- Recorte por conta
WITH c AS (
  SELECT fn_overview('2099-01-15 00:00:00-03'::timestamptz,
                     '2099-01-15 23:59:59-03'::timestamptz, 'misto',
                     '11111111-1111-1111-1111-111111111111'::uuid) AS j
)
INSERT INTO _esperado (caso, obtido, esperado)
SELECT 'filtro por conta traz a venda e o upsell que herdou a conta',
       (j->>'receita')::numeric, 400 FROM c;

-- ── Resultado ─────────────────────────────────────────────────────────────────

SELECT caso,
       obtido,
       esperado,
       CASE WHEN obtido IS NOT DISTINCT FROM esperado THEN 'ok' ELSE 'FALHOU' END AS resultado
FROM _esperado
ORDER BY (obtido IS NOT DISTINCT FROM esperado), caso;

DO $veredito$
DECLARE v_falhas integer;
BEGIN
  SELECT count(*) INTO v_falhas FROM _esperado
   WHERE obtido IS DISTINCT FROM esperado;

  IF v_falhas > 0 THEN
    RAISE EXCEPTION '% teste(s) falharam em fn_overview', v_falhas;
  END IF;
  RAISE NOTICE 'fn_overview: % testes, todos passaram', (SELECT count(*) FROM _esperado);
END
$veredito$;

ROLLBACK;
