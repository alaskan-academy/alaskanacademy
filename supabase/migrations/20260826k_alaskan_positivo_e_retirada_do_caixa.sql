-- ALASKAN ACADEMY: o sinal diz o sentido.
--
-- É a mesma conta e o mesmo fornecedor dos dois lados. O que muda é a direção:
--
--   saída  -> dinheiro indo PARA a reserva    -> Reserva de Caixa
--   entrada-> dinheiro VOLTANDO da reserva    -> Receitas / Retirada do Caixa
--
-- Ela criou a categoria "Retirada do Caixa" no campo e mandou classificar todos
-- os positivos assim. Eram 15, R$ 31.940,79, de 19/01 a 10/08 -- e 11 deles
-- estavam como "Reserva de Caixa", ou seja, uma entrada de dinheiro contada
-- como se fosse aplicação.
--
-- `divergencia_decidida` junto: a Conta Simples chama estes lançamentos de
-- "Retirada de Lucro", e a decisão dela é outra. Sem isto, os 15 voltariam a
-- pedir atenção assim que fossem confirmados.
update public.transacoes
   set categoria = 'Retirada do Caixa',
       status_revisao = 'confirmado',
       divergencia_decidida = true
 where descricao ilike '%ALASKAN ACADEMY%'
   and valor > 0;

-- NÃO dá para criar regra para isto, e vale registrar por quê.
--
-- `regras_categoria` casa por TEXTO do descritor -- `contains`, `exact` ou
-- `regex` sobre `descricao`. Não existe coluna de sinal, e o descritor é
-- idêntico nos dois sentidos: "ALASKAN ACADEMY". A regra que existe hoje manda
-- tudo para "Reserva de Caixa" com confiança 1.00, o que está certo para as
-- saídas e errado para as entradas.
--
-- Consequência prática: a próxima entrada vinda da reserva vai chegar
-- categorizada como Reserva de Caixa e precisará de correção à mão. Resolver de
-- verdade pede um campo de sinal em `regras_categoria` -- mudança no motor de
-- categorização, que não cabe aqui sem ela pedir.
