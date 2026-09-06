-- O SALDO DIZ ATE QUANDO FOI LIDO
--
-- A Conta Simples da Alaskan aparecia com -R$ 3.208,94 e o banco mostrava
-- R$ 4.615,74. A conta estava certa; o dado e que era velho:
--
--   conta_simples          lido ate 04/09  (2 dias atras)
--   conta_simples_cartao   lido ate 05/09  (1 dia atras)
--
-- A entrada media da Payt na conta e R$ 5.519,60/dia. Dois dias de entrada que
-- faltam menos um dia de cartao que falta dao ~R$ 7.800 — exatamente a
-- diferenca de R$ 7.824,68.
--
-- O PROBLEMA NAO ERA O NUMERO, ERA NAO DAR PARA DESCONFIAR DELE
--
-- O bloco dizia "foto de 02/09" — a data do saldo inicial — e nada sobre ate
-- quando os movimentos foram lidos. Quem olhava via um saldo com cara de atual.
--
-- E pior: uma conta com duas fontes soma pedacos de DIAS DIFERENTES. O saldo
-- exibido misturava uma conta de 04/09 com um cartao de 05/09. Um saldo assim
-- esta sempre errado, e a unica pergunta e por quanto.
--
-- Por isso as duas colunas nascem AQUI, junto do calculo, e nao na tela: quem
-- soma e quem sabe ate onde somou. Se amanha outra tela ler esta view, ela
-- herda o aviso de graca em vez de reinventar a checagem — ou esquecer dela.
--
--   lido_ate                 o dia da fonte MAIS VELHA da conta. E o limite de
--                            confianca do saldo inteiro: de nada adianta o
--                            cartao estar em dia se a conta parou dois dias
--                            atras.
--   fontes_em_dias_diferentes  true quando as fontes da conta nao terminam no
--                            mesmo dia. Conta com uma fonte so nunca acende.
--
-- Nulo em `lido_ate` quer dizer conta sem movimento nenhum depois da foto —
-- nao ha o que envelhecer, e a tela nao deve acusar atraso.

CREATE OR REPLACE VIEW vw_saldo_contas AS
 SELECT c.id,
    c.empresa_id,
    c.nome,
    c.tipo,
    c.saldo_inicial,
    c.data_referencia,
    c.ordem,
    c.ativo,
    COALESCE(m.movimento, 0::numeric) AS movimento,
    COALESCE(m.qtd, 0::bigint) AS qtd_movimentos,
    c.saldo_inicial + COALESCE(m.movimento, 0::numeric) AS saldo,
    e.nome AS empresa_nome,
    e.slug AS empresa_slug,
    f.lido_ate,
    COALESCE(f.dias_distintos, 0) > 1 AS fontes_em_dias_diferentes
   FROM contas c
     JOIN empresas e ON e.id = c.empresa_id
     LEFT JOIN LATERAL ( SELECT sum(t.valor) AS movimento,
            count(*) AS qtd
           FROM transacoes t
             JOIN conta_fontes cf ON cf.empresa_id = t.empresa_id AND cf.fonte = t.fonte
          WHERE cf.conta_id = c.id AND t.data > c.data_referencia) m ON true
     LEFT JOIN LATERAL ( SELECT min(u.ate)                AS lido_ate,
            count(DISTINCT u.ate)                          AS dias_distintos
           FROM ( SELECT t.fonte, max(t.data) AS ate
                    FROM transacoes t
                      JOIN conta_fontes cf ON cf.empresa_id = t.empresa_id AND cf.fonte = t.fonte
                   WHERE cf.conta_id = c.id AND t.data > c.data_referencia
                   GROUP BY t.fonte) u) f ON true;

COMMENT ON VIEW vw_saldo_contas IS
  'Saldo de cada conta a partir da foto (saldo_inicial em data_referencia) mais '
  'os movimentos das fontes dela. `lido_ate` e o dia da fonte MAIS VELHA — o '
  'limite de confianca do saldo. `fontes_em_dias_diferentes` acende quando conta '
  'e cartao terminam em dias distintos, caso em que o saldo mistura datas e esta '
  'errado por construcao.';
