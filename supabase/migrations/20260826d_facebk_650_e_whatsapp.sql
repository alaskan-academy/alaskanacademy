-- As cobranças `FACEBK ... 650-5434800 US` são WhatsApp, não mídia.
--
-- Ela apontou um lançamento e pediu "todas que seguem este padrão". Agrupando
-- pelo FINAL do descritor, existem três formatos de FACEBK:
--
--   SAO PAULO    BR   405 lanç · R$ 453.758 · média R$ 1.120,39
--   +16505434947 BR   135 lanç · R$  70.611 · média R$   523,05
--   650-5434800  US    35 lanç · R$   1.640 · média R$    46,87
--
-- A média 24 vezes menor confirma o que ela disse: é cobrança de conversa de
-- WhatsApp, não compra de mídia.
--
-- (Minha primeira tentativa de agrupar usou `ilike '%US%'` e trouxe três
-- anúncios normais de São Paulo junto -- o "US" estava DENTRO do código da
-- transação, em `5USAGYRSE2`. Por isso o corte passou a ser pelo final do
-- descritor.)
--
-- Não mexo em `transacoes.centro_custo`: `vw_custos_categoria_mes` resolve o
-- centro por `categorias_centro` e só usa a coluna como último recurso. Como
-- "WhatsApp" mora em "Anúncios", o relatório acerta sozinho -- e o sync do CS
-- sobrescreveria a coluna de qualquer jeito.
update public.transacoes
   set categoria = 'WhatsApp'
 where descricao ilike '%650-5434800%' and valor < 0;

-- ── A armadilha que estava armada ──────────────────────────────────────────
-- Havia uma regra `FACEBK` (contains) -> WhatsApp com confiança 1.00, a mais
-- alta de todas. Ela pega TODO lançamento FACEBK: os 575, R$ 525 mil de mídia,
-- viravam WhatsApp.
--
-- Só não estragou nada porque a categoria da Conta Simples tem prioridade sobre
-- as regras. Bastava chegar um FACEBK sem categoria no CS para R$ 1.120 de
-- anúncio virarem WhatsApp em silêncio -- a mesma armadilha do
-- `LUCAS DOS SANTOS VEIGA -> Aplicativos e Ferramentas` a 1.00.
--
-- Repontada em vez de apagada: a intenção era certa, o alcance é que era grosso
-- demais.
update public.regras_categoria
   set padrao = '650-5434800',
       tipo_match = 'contains',
       categoria = 'WhatsApp',
       centro_custo = 'Anúncios'
 where id = '767d61fb-2b65-428d-a272-33d8131b41cc';
