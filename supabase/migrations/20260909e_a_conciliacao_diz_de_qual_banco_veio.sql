-- A conciliação diz de qual banco veio
--
-- A exportação da conciliação não dizia o banco em lugar nenhum. A coluna que
-- parecia dizer, "Meio de pagamento", mistura duas coisas: nas linhas de
-- cartão traz os quatro últimos dígitos (28 cartões distintos só em agosto), e
-- nas de conta corrente traz o tipo do lançamento — "PIX Enviado",
-- "Rentabilidade CDI", "Cashback recebido". Nenhum dos dois responde se aquilo
-- é Conta Simples, C6 ou Inter.
--
-- A informação existe em `transacoes.fonte` e simplesmente não chegava na
-- view, então também não chegava no arquivo que vai para a contabilidade.
--
-- ── Por que DERIVAR o nome em vez de listar ──────────────────────────────
--
-- Um `CASE WHEN fonte = 'c6' THEN 'C6' ...` seria a armadilha 3: conta nova
-- entra e a coluna aparece vazia ou com o slug cru, sem nada denunciando.
--
-- O nome sai do próprio slug. Os sufixos `_cartao` e `_garantia` viram
-- qualificador entre parênteses, e o resto vira Título:
--
--   conta_simples          → Conta Simples
--   conta_simples_cartao   → Conta Simples (cartão)
--   c6                     → C6
--   c6_cartao              → C6 (cartão)
--   c6_garantia            → C6 (garantia)
--   inter                  → Inter
--
-- Uma fonte nova como `nubank` já sai "Nubank" sem ninguém tocar aqui. Se um
-- dia aparecer um sufixo que a regra não conhece, ele aparece no nome em vez
-- de sumir — errado e visível é melhor que ausente e silencioso.
--
-- `CREATE OR REPLACE VIEW` só aceita coluna NOVA no fim, e é onde `banco`
-- entra. O resto do corpo é o que já estava no banco.

CREATE OR REPLACE VIEW public.vw_conciliacao AS
 SELECT t.id,
    t.data,
    COALESCE(t.apelido, fn_fornecedor(t.descricao, - t.valor)) AS nome,
    t.descricao AS descricao_original,
        CASE
            WHEN ((t.payload_raw -> 'card'::text) ->> 'maskedNumber'::text) IS NOT NULL THEN 'Cartão '::text || ((t.payload_raw -> 'card'::text) ->> 'maskedNumber'::text)
            WHEN ((t.payload_raw -> 'transactionType'::text) ->> 'description'::text) IS NOT NULL THEN (t.payload_raw -> 'transactionType'::text) ->> 'description'::text
            ELSE 'Conta'::text
        END AS meio_pagamento,
    t.valor,
    t.categoria,
    COALESCE(cc.centro_custo, NULLIF(TRIM(BOTH FROM t.centro_custo), ''::text)) AS grupo,
    t.status_revisao,
    (t.payload_raw -> 'card'::text) ->> 'maskedNumber'::text AS cartao,
    t.empresa_id,
    -- O banco, derivado do slug da fonte. Ver o comentário acima.
    initcap(replace(regexp_replace(t.fonte, '_(cartao|garantia)$', ''), '_', ' '))
      || CASE
           WHEN t.fonte ~ '_cartao$'   THEN ' (cartão)'
           WHEN t.fonte ~ '_garantia$' THEN ' (garantia)'
           ELSE ''
         END AS banco
   FROM transacoes t
     LEFT JOIN categorias_centro cc ON cc.categoria = TRIM(BOTH FROM t.categoria);

COMMENT ON VIEW public.vw_conciliacao IS
  'Extrato categorizado para a tela e para a exportacao. `banco` e derivado de '
  '`transacoes.fonte`, nao listado a mao: fonte nova aparece sozinha.';
