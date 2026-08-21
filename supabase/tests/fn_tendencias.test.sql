-- Testes de `fn_tendencias()`.
--
-- Existe porque esta é a função que mais errou em silêncio. Em 21/08 ela teve dois
-- defeitos no mesmo dia, e os dois devolviam número plausível:
--
--   * média das razões diárias em vez de razão dos totais — na "Desafios na Sala" dava
--     ROAS 1,63 onde o real era 0,85, porque um dia de R$ 30 pesava igual a um de R$ 3.000
--   * denominador contando linha de venda em vez de pedido, com o upsell inflando a
--     contagem e barateando o CPA
--
-- Nenhum dos dois foi pego por alerta. Os dois foram pegos pela usuária olhando a tela.
--
-- Como rodar:
--   psql "$DATABASE_URL" -f supabase/tests/fn_tendencias.test.sql
--
-- Roda dentro de uma transação revertida no fim. A limpeza também é explícita, porque
-- nem todo cliente honra a transação: o MCP do Supabase ignora o ROLLBACK, e numa
-- sessão anterior sete linhas de teste ficaram em produção por causa disso.

BEGIN;

CREATE TEMP TABLE _res (caso text, obtido numeric, esperado numeric);

-- ── Cenário ───────────────────────────────────────────────────────────────────
--
-- Janela atual 11–20/03/2099, anterior 01–10/03/2099. Ano distante de propósito:
-- nenhuma linha real cai aqui.

DO $cenario$
DECLARE
  v_conta_a uuid := 'aaaaaaaa-0000-4000-8000-000000000001';  -- upsell e denominadores
  v_conta_b uuid := 'bbbbbbbb-0000-4000-8000-000000000002';  -- razão dos totais
  v_conta_c uuid := 'cccccccc-0000-4000-8000-000000000003';  -- venda sem gasto
  v_cli     uuid := 'dddddddd-0000-4000-8000-000000000004';
  d date;
  i integer;
BEGIN
  INSERT INTO ad_accounts (id, account_id, nome, ativo, roas_meta, cpa_meta) VALUES
    (v_conta_a, 'act_test_a', 'Teste A - denominadores', true, 1.20, 45.00),
    (v_conta_b, 'act_test_b', 'Teste B - razao de totais', true, NULL, NULL),
    (v_conta_c, 'act_test_c', 'Teste C - sem gasto',      true, NULL, NULL);

  INSERT INTO clientes (id, email) VALUES (v_cli, 'teste-tendencias@exemplo.com');

  FOR i IN 0..19 LOOP
    d := DATE '2099-03-01' + i;

    -- Conta A: gasto e vendas uniformes nos 20 dias.
    INSERT INTO metricas_meta (ad_account_id, nivel, campanha_id, data,
                               investimento, impressoes, cliques, cliques_link,
                               visualizacoes_pagina, initiate_checkout, video_3s)
    VALUES (v_conta_a, 'campanha', 'camp_a', d, 100, 10000, 200, 180, 150, 20, 3000);

    -- Dois pedidos de R$ 50 por dia: receita 100/dia, AOV 50, CPA 50.
    INSERT INTO vendas (pedido_id, produto_nome, data_venda, status,
                        valor_total, valor_sem_juros, valor_oferta_principal,
                        ad_account_id, cliente_id)
    VALUES ('T-A-' || i || '-1', 'Produto A', d + TIME '10:00', 'aprovada', 50, 50, 50, v_conta_a, v_cli),
           ('T-A-' || i || '-2', 'Produto A', d + TIME '11:00', 'aprovada', 50, 50, 50, v_conta_a, v_cli);

    -- Conta B: o gasto muda de escala dentro da janela atual.
    --   01–10/03  gasto 100, receita 100  → razão diária 1,00
    --   11–19/03  gasto  10, receita  40  → razão diária 4,00
    --   20/03     gasto 910, receita 100  → razão diária 0,11
    INSERT INTO metricas_meta (ad_account_id, nivel, campanha_id, data, investimento,
                               impressoes, cliques, cliques_link, visualizacoes_pagina,
                               initiate_checkout, video_3s)
    VALUES (v_conta_b, 'campanha', 'camp_b', d,
            CASE WHEN i < 10 THEN 100 WHEN i < 19 THEN 10 ELSE 910 END,
            10000, 200, 180, 150, 20, 3000);

    INSERT INTO vendas (pedido_id, produto_nome, data_venda, status,
                        valor_total, valor_sem_juros, valor_oferta_principal,
                        ad_account_id, cliente_id)
    VALUES ('T-B-' || i, 'Produto B', d + TIME '10:00', 'aprovada',
            CASE WHEN i < 10 THEN 100 WHEN i < 19 THEN 40 ELSE 100 END,
            CASE WHEN i < 10 THEN 100 WHEN i < 19 THEN 40 ELSE 100 END,
            CASE WHEN i < 10 THEN 100 WHEN i < 19 THEN 40 ELSE 100 END,
            v_conta_b, v_cli);
  END LOOP;

  -- Um upsell de R$ 300 no último dia da conta A. Ele é receita, mas não é pedido novo.
  INSERT INTO vendas (pedido_id, produto_nome, data_venda, status,
                      valor_total, valor_sem_juros, valor_oferta_principal,
                      is_upsell, ad_account_id, cliente_id)
  VALUES ('T-A-UPSELL', 'Upsell A', DATE '2099-03-20' + TIME '12:00', 'aprovada',
          300, 300, 300, true, v_conta_a, v_cli);

  -- Conta C vende e não gasta: não tem tendência a mostrar.
  INSERT INTO vendas (pedido_id, produto_nome, data_venda, status,
                      valor_total, valor_sem_juros, valor_oferta_principal,
                      ad_account_id, cliente_id)
  VALUES ('T-C-1', 'Produto C', DATE '2099-03-15' + TIME '10:00', 'aprovada',
          999, 999, 999, v_conta_c, v_cli);
END
$cenario$;

-- ── Verificações ──────────────────────────────────────────────────────────────

WITH t AS (
  SELECT * FROM fn_tendencias(DATE '2099-03-11', DATE '2099-03-20')
),
a AS (SELECT * FROM t WHERE conta = 'Teste A - denominadores'),
b AS (SELECT * FROM t WHERE conta = 'Teste B - razao de totais')
INSERT INTO _res (caso, obtido, esperado)
SELECT * FROM (
  -- O defeito mais caro: 9 dias de razão 4,00 e um de 0,11 dão média 3,61, mas a
  -- razão dos totais é 460/1000. Um dia de R$ 10 não pode pesar como um de R$ 910.
  SELECT 'ROAS e a razao dos totais, nao a media das razoes',
         (SELECT atual FROM b WHERE metrica = 'ROAS'), 0.46
  UNION ALL
  -- Receita 1300 (com o upsell de 300) sobre 20 pedidos daria 65. O AOV olha só a
  -- compra inicial: 1000 / 20.
  SELECT 'AOV ignora o upsell no numerador',
         (SELECT atual FROM a WHERE metrica = 'AOV'), 50.00
  UNION ALL
  -- Se o upsell contasse como pedido, o divisor seria 21 e o CPA cairia para 47,62.
  SELECT 'CPA divide por pedido, nao por linha de venda',
         (SELECT atual FROM a WHERE metrica = 'CPA'), 50.00
  UNION ALL
  SELECT 'Vendas conta pedidos por dia, sem o upsell',
         (SELECT atual FROM a WHERE metrica = 'Vendas'), 2.00
  UNION ALL
  -- Receita e ROAS somam o upsell: e dinheiro que a conta trouxe.
  SELECT 'Receita inclui o upsell (1300 / 10 dias)',
         (SELECT atual FROM a WHERE metrica = 'Receita'), 130.00
  UNION ALL
  SELECT 'ROAS inclui o upsell (1300 / 1000)',
         (SELECT atual FROM a WHERE metrica = 'ROAS'), 1.30
  UNION ALL
  SELECT 'janela anterior nao ve o upsell (1000 / 1000)',
         (SELECT anterior FROM a WHERE metrica = 'ROAS'), 1.00
  UNION ALL
  -- 30% de alta cabendo dentro do ruido do proprio historico: e o ponto da tela.
  SELECT 'alta de 30% dentro do ruido nao vira tendencia',
         (SELECT CASE WHEN direcao = 'estável' THEN 1 ELSE 0 END FROM a WHERE metrica = 'ROAS'), 1
  UNION ALL
  SELECT 'serie cobre as duas janelas',
         (SELECT array_length(serie, 1) FROM a WHERE metrica = 'ROAS'), 20
  UNION ALL
  SELECT 'corte marca onde a janela anterior termina',
         (SELECT serie_corte FROM a WHERE metrica = 'ROAS'), 10
  UNION ALL
  SELECT 'dias contados sao os com gasto',
         (SELECT dias_atual FROM a WHERE metrica = 'ROAS'), 10
  UNION ALL
  -- Meta vem da conta e a direcao diz de que lado se quer estar.
  SELECT 'meta de ROAS sai da conta',
         (SELECT meta FROM a WHERE metrica = 'ROAS'), 1.20
  UNION ALL
  SELECT 'meta de CPA e teto, nao piso',
         (SELECT CASE WHEN meta_direcao = 'teto' THEN 1 ELSE 0 END FROM a WHERE metrica = 'CPA'), 1
  UNION ALL
  -- Conta que vendeu e nao investiu nao esta piorando: nao aparece.
  SELECT 'conta sem gasto fica de fora',
         (SELECT count(*) FROM t WHERE conta = 'Teste C - sem gasto'), 0
) v;

-- Janela anterior de tamanho diferente: "hoje contra os 10 dias anteriores".
WITH t AS (
  SELECT * FROM fn_tendencias(DATE '2099-03-20', DATE '2099-03-20', 10)
)
INSERT INTO _res (caso, obtido, esperado)
SELECT * FROM (
  SELECT 'p_dias_ant encurta so a janela atual',
         (SELECT dias_atual FROM t WHERE conta = 'Teste A - denominadores' AND metrica = 'ROAS'), 1
  UNION ALL
  SELECT 'e a base vira os 10 dias anteriores',
         (SELECT dias_anterior FROM t WHERE conta = 'Teste A - denominadores' AND metrica = 'ROAS'), 10
  UNION ALL
  -- 20/03 tem receita 400 (100 + upsell 300) sobre gasto 100.
  SELECT 'ROAS de um dia so',
         (SELECT atual FROM t WHERE conta = 'Teste A - denominadores' AND metrica = 'ROAS'), 4.00
) v;

-- ── Resultado ─────────────────────────────────────────────────────────────────

SELECT caso, obtido, esperado,
       CASE WHEN obtido IS NOT DISTINCT FROM esperado THEN 'ok' ELSE 'FALHOU' END AS resultado
  FROM _res
 ORDER BY (obtido IS NOT DISTINCT FROM esperado), caso;

-- ── Limpeza ───────────────────────────────────────────────────────────────────
--
-- Redundante com o ROLLBACK, e de propósito: ver o cabeçalho.

DELETE FROM vendas        WHERE pedido_id LIKE 'T-A-%' OR pedido_id LIKE 'T-B-%' OR pedido_id LIKE 'T-C-%';
DELETE FROM metricas_meta WHERE campanha_id IN ('camp_a', 'camp_b');
DELETE FROM ad_accounts   WHERE account_id IN ('act_test_a', 'act_test_b', 'act_test_c');
DELETE FROM clientes      WHERE email = 'teste-tendencias@exemplo.com';

DO $veredito$
DECLARE v_falhas integer;
BEGIN
  SELECT count(*) INTO v_falhas FROM _res WHERE obtido IS DISTINCT FROM esperado;
  IF v_falhas > 0 THEN
    RAISE EXCEPTION '% teste(s) falharam em fn_tendencias', v_falhas;
  END IF;
  RAISE NOTICE 'fn_tendencias: % testes, todos passaram', (SELECT count(*) FROM _res);
END
$veredito$;

ROLLBACK;
