-- A CONTA SIMPLES TEM DOIS BOLSOS, E A FOTO PRECISA SOMAR OS DOIS
--
-- Em 06/09/2026 a tela mostrava -R$ 3.208,94 e o aplicativo do banco mostrava
-- R$ 4.615,74. A conta da view estava certa. A FOTO e que era meia foto.
--
-- COMO A CONTA SIMPLES FUNCIONA
--
-- Ela nao e uma conta corrente com cartao pendurado. Sao dois bolsos:
--
--   Saldo Conta PJ        o dinheiro que chega (PIX da Payt, rendimento CDI)
--   Limite dos cartoes    para onde esse dinheiro e EMPURRADO antes de gastar
--
-- O extrato mostra isso com todas as letras: entra PIX da Payt, e logo em
-- seguida sai uma "Transferencia de limite" que zera a conta. Em 05/09 o saldo
-- da conta terminou em R$ 0,00 — nao porque acabou o dinheiro, mas porque ele
-- todo virou limite de cartao.
--
-- Por isso a compra no cartao NAO sai da conta: sai do limite. E por isso a
-- foto tem de ser `Saldo Conta PJ + Limite dos cartoes`. A foto de 02/09 era
-- R$ 7.647,70, que era so o primeiro bolso — faltavam R$ 7.824,68 do segundo,
-- exatamente a diferenca que apareceu na tela.
--
-- O QUE O IMPORTADOR JA FAZ CERTO, E NAO DEVE MUDAR
--
-- Ele IGNORA as linhas de "Transferencia de limite". Certissimo: elas movem
-- dinheiro entre os dois bolsos e nao mudam o total. Conta-las seria contar a
-- mesma saida duas vezes — uma na transferencia, outra na compra.
--
-- Ele tambem traz os ESTORNOS. Conferido no par de 02/09: -R$ 5,22 na compra
-- cancelada e +R$ 5,22 no estorno, que se anulam. Sem o estorno o saldo cairia
-- um pouco a cada compra cancelada, e ninguem veria.
--
-- O QUE FOI FEITO
--
-- A foto da Conta Simples da Alaskan passou a ser R$ 4.615,74 em 06/09/2026
-- (era R$ 7.647,70 em 02/09). Nenhuma transacao foi apagada nem inserida: a
-- view so conta o que veio DEPOIS da data da foto, entao os lancamentos de 01
-- a 05/09 saem do calculo sem sumir do historico.

COMMENT ON COLUMN contas.saldo_inicial IS
  'A foto: quanto a conta TINHA em data_referencia. O saldo exibido e esta foto '
  'mais tudo que se moveu depois. Numa conta com cartao pre-pago (Conta Simples) '
  'a foto tem de somar OS DOIS BOLSOS — Saldo Conta PJ + Limite dos cartoes —, '
  'porque a compra sai do limite e nao da conta. Fotografar so o saldo da conta '
  'subestima o caixa pelo tanto que estiver alocado nos cartoes: em 02/09/2026 '
  'isso foram R$ 7.824,68.';

COMMENT ON COLUMN contas.data_referencia IS
  'O dia da foto. A view soma apenas transacoes com data > este dia, entao '
  'refazer a foto com a data de hoje descarta o historico do calculo sem apagar '
  'nada — e a forma de consertar um saldo torto sem mexer em lancamento.';
