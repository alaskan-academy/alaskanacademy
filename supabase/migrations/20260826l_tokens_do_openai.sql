-- Por que um token do ChatGPT ainda aparecia como "IAs".
--
-- Ela perguntou. A resposta são dois defeitos, e o primeiro é meu.
--
-- ── 1. A categoria nunca foi aplicada a todos ──────────────────────────────
-- O fornecedor "OpenAI (Token)" tinha 26 lançamentos e só 13 estavam em
-- "Tokens". Os outros 13 seguiam em "IAs" -- 7 confirmados e 6 automáticos.
--
-- A separação de FORNECEDOR foi feita e está certa: `OPENAI *CHATGPT SUBSCR` na
-- prioridade 10 pega a mensalidade, e o resto do OPENAI cai em Token. A regra
-- de CATEGORIA foi criada. O que ficou faltando foi passar a categoria nova nos
-- lançamentos que já existiam -- regra nova não recategoriza linha antiga.
--
-- ── 2. Duas regras empatadas em 1.00 ───────────────────────────────────────
-- Havia:
--
--   OPENAI                 -> Tokens   confiança 1.00
--   OPENAI *CHATGPT SUBSCR -> IAs      confiança 1.00
--
-- O descritor da mensalidade contém "OPENAI", então AS DUAS casam com ela. As
-- regras são percorridas por `confianca desc` e, no empate, quem vence depende
-- da ordem que o banco devolver: a mensalidade podia cair em Tokens a qualquer
-- momento, sem nada mudar.
--
-- A regra genérica desce para 0.98 e a específica passa a ganhar sempre.
-- Conferido simulando descritores novos: `OPENAI *CHATGPT SUBSCR ...` recebe
-- IAs, `OPENAI ...` recebe Tokens.
update public.regras_categoria
   set confianca = 0.98
 where padrao = 'OPENAI' and tipo_match = 'contains' and categoria = 'Tokens';

update public.transacoes t
   set categoria = 'Tokens',
       status_revisao = 'confirmado'
  from public.vw_transacoes_revisao v
 where v.id = t.id
   and v.fornecedor = 'OpenAI (Token)'
   and t.valor < 0;
