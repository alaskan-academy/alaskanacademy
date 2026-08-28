-- ── Três order bumps da Fábrica das Velas ganham cadastro ─────────────────
--
-- Eles vendiam desde 09/07 sem linha em `ofertas`, e por isso caíam no
-- `COALESCE(o.tipo, 'orderbump_1')` de `fn_normalizar_venda_payt`: apareciam
-- todos como OB1 no painel "Conversão de order bumps", independentemente do
-- slot real.
--
-- COMO O SLOT FOI DESCOBERTO, JÁ QUE ELE NÃO ESTÁ EM CAMPO NENHUM
--
-- O array `order_bumps` do payload lista só o que a pessoa levou, então a
-- POSIÇÃO nele não é o slot -- "Pacote Impulso" aparece da posição 1 à 4. Mas
-- a ORDEM RELATIVA entre dois bumps do mesmo checkout é estável, e isso dá o
-- slot por transitividade.
--
-- Primeiro a premissa foi testada contra os bumps que JÁ têm slot cadastrado,
-- par a par: em 4 dos 6 pares a ordem do array bate com a ordem do slot em
-- 100% das vezes; nos outros dois, 97,6% e 80,9%. Ou seja: a premissa vale
-- dentro de um mesmo checkout, e não entre checkouts diferentes -- que é
-- exatamente como ela está sendo usada aqui.
--
-- Depois, os quatro bumps do checkout "Fábrica das Velas de Lembrancinha",
-- par a par, em 83 coocorrências:
--
--   4ZKBW3 antes de LXMBWB   24 de 24
--   LXMBWB antes de R2JAJA   13 de 13
--   R2JAJA antes de RDOD6J   12 de 12
--   4ZKBW3 antes de RDOD6J   14 de 14
--   4ZKBW3 antes de R2JAJA   12 de 12
--   LXMBWB antes de RDOD6J   18 de 18
--
-- Zero contradições, ordem total: 4ZKBW3 → LXMBWB → R2JAJA → RDOD6J. E a maior
-- posição já vista no array é 4, coerente com quatro slots.
--
-- O TERCEIRO SLOT FICA VAGO DE PROPÓSITO
--
-- A terceira posição é `R2JAJA`, "Workshop Buquê de Velas" -- que já existe em
-- `ofertas` como `oferta_principal`, porque é produto de frente em outro
-- checkout. `ofertas.tipo` é um valor por PRODUTO e o papel é por CHECKOUT:
-- o mesmo item é oferta principal num lugar e bump em outro, e a tabela não
-- sabe dizer as duas coisas. Mudar o tipo dele quebraria as vendas em que ele
-- é a oferta de frente, então ele fica como está e o slot 3 fica sem linha
-- nova. É uma limitação do modelo, anotada aqui para não ser redescoberta.
INSERT INTO ofertas (code_payt, produto, tipo, nome, ativo) VALUES
  ('4ZKBW3', 'velas', 'orderbump_1', 'Difusores e Aromas para Casa - Plus', true),
  ('LXMBWB', 'velas', 'orderbump_2', 'Guia Rápido de Como Resolver Imperfeições nas Velas Plus', true),
  ('RDOD6J', 'velas', 'orderbump_4', 'Pacote Impulso Artesanal Plus', true)
ON CONFLICT DO NOTHING;

-- ── E as vendas já gravadas recebem o vínculo ─────────────────────────────
--
-- `fn_normalizar_venda_payt` liga `venda_itens.oferta_id` no momento em que a
-- venda chega. As 186 linhas que chegaram antes do cadastro continuariam com
-- `oferta_id` nulo e `tipo = 'orderbump_1'` para sempre -- a carga preenche o
-- passado, mas quem não voltar aqui deixa o passado errado.
--
-- Sem backup: o valor antigo é reconstruível, era `oferta_id = NULL` e
-- `tipo = 'orderbump_1'` para exatamente estas linhas.
UPDATE venda_itens vi
   SET oferta_id = o.id,
       tipo      = o.tipo
  FROM ofertas o
 WHERE o.code_payt = vi.code_payt
   AND vi.oferta_id IS NULL
   AND o.code_payt IN ('4ZKBW3', 'LXMBWB', 'RDOD6J');

-- ── O que continua sem cadastro, e por quê ────────────────────────────────
--
-- Dois bumps do checkout "Workshop Desafios na Sala de Aula" ficaram de fora:
--
--   R293DX   Combo Professora Preparada                        4 vendas
--   47Z7DA   28D - Desafio para uma sala de Aula mais Serena    2 vendas
--
-- Eles nunca aparecem juntos na mesma venda, então não há ordem relativa para
-- derivar -- os dois estão sempre sozinhos na posição 1. Chutar o slot seria
-- gravar como fato uma coisa que não se mediu, que é o oposto do que esta
-- migration faz com os outros três.
