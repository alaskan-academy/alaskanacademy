-- PAGAMENTO DE FATURA VIRA CATEGORIA PROPRIA
--
-- O cartao do C6 e credito com fatura, ao contrario do da Conta Simples. Isso
-- cria um movimento que nao existia no plano de contas: dinheiro que SAI da
-- conta sem ser custo, porque o custo ja foi contado na COMPRA.
--
-- Contar a fatura tambem cobraria o mesmo gasto duas vezes — a mesma armadilha
-- da fatura da Meta que ja esta escrita no CLAUDE.md do modulo, e que la fez o
-- anuncio aparecer em dois meses diferentes.
--
-- O pagamento estava provisoriamente em 'Reserva de Caixa', que e neutra mas
-- mente sobre o que aconteceu: ninguem reservou nada, pagou-se uma fatura.
--
-- `tipo = 'reserva'` nao e sobre reserva de caixa: e a classe "movimento que
-- nao e resultado" — dinheiro trocando de lugar sem virar custo nem receita.
-- Cabe 'Investimentos Futuros', cabe transferencia entre contas, cabe isto.
-- `ehCustoOperacional` e `ehReceita` excluem a classe inteira, e o rotulo do
-- DRE passou de "Movimentos de Reserva" para "Movimentos entre Contas".

INSERT INTO categorias_centro (categoria, centro_custo, tipo, ordem, ativo)
VALUES ('Pagamento de Fatura', 'Outros', 'reserva', 90, true)
ON CONFLICT (categoria) DO UPDATE SET tipo = 'reserva', ativo = true;

UPDATE transacoes SET categoria = 'Pagamento de Fatura'
 WHERE referencia_externa = 'c6_2026-08-fatura' AND fonte = 'c6';
