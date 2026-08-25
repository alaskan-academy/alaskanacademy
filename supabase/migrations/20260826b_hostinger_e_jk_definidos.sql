-- Hostinger e JK Workspace, definidos por ela.
--
-- Hostinger: os quatro preços que sobravam (R$ 7,08 duas vezes, R$ 46,74,
-- R$ 52,99 e R$ 54,99) são todos domínio. Eu havia especulado que os três
-- avulsos de meses seguidos fossem um plano mudando de preço -- não eram, e a
-- resposta dela era mais simples: domínio custa o que a extensão custa, e cada
-- extensão tem o seu preço.
--
-- Com isso a Hostinger fica inteira em dois: domínio e n8n. Nada sobra.
update public.fornecedores
   set valores = array[51.08, 39.99, 7.08, 46.74, 52.99, 54.99]::numeric[]
 where nome = 'Hostinger (domínio)';

-- A rede de segurança fica, vazia mas viva: se a Hostinger cobrar um valor novo
-- amanhã, ele cai aqui e aparece como "a definir" em vez de ser engolido em
-- silêncio por domínio ou n8n. Um fornecedor que some sozinho é pior do que um
-- fornecedor que pede atenção.
update public.fornecedores
   set nota = 'Rede de segurança. Hoje não pega nada: domínio e n8n cobrem todos os valores conhecidos. Um preço novo cai aqui para ser identificado.'
 where nome = 'Hostinger (a definir)';

-- JK Workspace: os R$ 40 e R$ 65 são taxa de envio de correspondência e
-- pacotes que chegam no endereço fiscal.
--
-- Fica em "Endereço Fiscal" e não numa categoria nova: a taxa existe porque o
-- endereço fiscal existe, e R$ 145 em nove meses não sustentam uma linha
-- própria no DRE. O nome do fornecedor é que passa a dizer o que é -- ela vê a
-- separação sem que o relatório ganhe uma rubrica de troco.
update public.fornecedores
   set nome = 'JK Workspace (correspondência)',
       definido = true,
       nota = 'Taxa de envio de correspondência e pacotes que chegam no endereço fiscal. Avulso, não mensal.'
 where nome = 'JK Workspace (PIX)';
