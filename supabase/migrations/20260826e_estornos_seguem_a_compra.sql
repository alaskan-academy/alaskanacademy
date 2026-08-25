-- Estorno pertence à categoria da compra que ele desfaz.
--
-- Ela perguntou "considerou o cartão?" sobre a reclassificação do WhatsApp. Eu
-- não tinha considerado, e a pergunta expôs dois erros meus.
--
-- O cartão CONFIRMOU o agrupamento: os `650-5434800` vivem em exatamente dois
-- cartões (•••• 7488 e •••• 4353), e esses dois cartões não têm mais nada
-- dentro. São cartões dedicados ao WhatsApp. Descritor e cartão dizem o mesmo.
--
-- Mas o •••• 7488 tinha 26 lançamentos e só 25 eram compras. O 26º era um
-- ESTORNO de R$ 129,77, com valor positivo -- e meu update dizia `valor < 0`,
-- então pulou. Ficou como Anúncios: o estorno de uma cobrança de WhatsApp
-- creditando a categoria errada. Já corrigido junto com os demais.
--
-- Ao conferir se o mesmo descuido tinha atingido o resto do dia, achei algo bem
-- maior na Sellflux:
--
--   28/01  -1.745,88  compra   (consultoria parte 1)
--   04/03  -1.750,00  compra   (consultoria parte 2)
--   17/04  +1.750,00  ESTORNO
--   18/04  +1.655,98  ESTORNO com ajuste
--
-- A consultoria foi devolvida. Pagou R$ 3.495,88, recebeu R$ 3.405,98 de volta.
-- E os estornos estavam em "Aplicativos e Ferramentas" enquanto as compras
-- estavam em "Consultorias e Mentorias" -- o DRE mostrava uma consultoria que
-- não aconteceu E creditava software que não era software.
--
-- Custo real da consultoria: R$ 151,01, não os R$ 3.556,99 que eu havia
-- relatado ontem.
update public.transacoes
   set categoria = 'Consultorias e Mentorias'
 where descricao ilike '%SELLFLUX%' and valor > 0 and abs(valor) > 1000;

-- O fornecedor casa por valor, então o valor do estorno precisa estar na lista.
update public.fornecedores
   set valores = array[1745.88, 1750.00, 61.11, 1655.98]::numeric[]
 where nome = 'Sellflux (consultoria)';
