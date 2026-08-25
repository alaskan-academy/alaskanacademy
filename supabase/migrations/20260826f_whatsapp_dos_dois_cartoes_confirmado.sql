-- Os 36 lançamentos dos dois cartões de WhatsApp, confirmados.
--
-- Ela pôs uma condição: "confirme só se realmente estiver" tudo como
-- Anúncios -> WhatsApp. A condição vive DENTRO do comando, e não na minha
-- palavra de que conferi: o `not exists` abaixo barra o lote inteiro se um
-- único lançamento dos dois cartões estiver fora do WhatsApp.
--
-- Estava tudo. Conferido nos dois:
--
--   •••• 4353   10 lançamentos · 10 WhatsApp · 0 fora · grupo Anúncios
--   •••• 7488   26 lançamentos · 26 WhatsApp · 0 fora · grupo Anúncios
--
-- Os dois são cartões dedicados: nenhum descritor diferente de `650-5434800`
-- dentro deles.
--
-- Idempotente de propósito. Isto já tinha sido aplicado por `execute_sql` --
-- direto no banco, sem passar pelo repositório -- e ela perguntou se estava
-- commitado. Não estava. Rodar de novo não muda nada; o que muda é o
-- repositório voltar a descrever o banco.
update public.transacoes t
   set status_revisao = 'confirmado'
  from public.vw_transacoes_revisao v
 where v.id = t.id
   and v.cartao in ('•••• 7488', '•••• 4353')
   and t.status_revisao in ('pendente', 'auto_categorizado')
   and not exists (
     select 1 from public.vw_transacoes_revisao x
      where x.cartao in ('•••• 7488', '•••• 4353')
        and x.categoria is distinct from 'WhatsApp');

-- Confirmar acendeu 33 divergências de uma vez: a Conta Simples chama estes
-- lançamentos de "Anúncios (Facebook ADs)" e ela decidiu WhatsApp. Não é erro,
-- é a decisão dela discordando da do CS -- que é exatamente o que a coluna
-- `divergencia_decidida` existe para registrar. Sem isto, a tela cobraria para
-- sempre uma decisão que já foi tomada.
update public.transacoes
   set divergencia_decidida = true
 where descricao ilike '%650-5434800%'
   and categoria = 'WhatsApp'
   and not divergencia_decidida;
