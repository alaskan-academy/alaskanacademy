-- ── O recado ganha prazo para sair do mural sozinho ───────────────────────
--
-- O mural é a peça mais fácil de apodrecer do produto: ninguém tira o aviso
-- velho, ele fica lá, e um mês depois a equipe lê recado vencido como se fosse
-- novidade. O componente já tratava o SINTOMA — passados sete dias o recado
-- desbota e ganha "pode estar desatualizado" ao lado. Agora ele tem cura: um
-- prazo escolhido por quem escreve.
--
-- `expira_em` NULO SIGNIFICA "SEM PRAZO", E NÃO "VENCIDO"
--
-- Nulo é o recado que fica até alguém apagar — é o que os 5 recados já
-- existentes recebem, porque preencher um prazo retroativo faria sumir da tela
-- conteúdo que ninguém mandou sumir. Recado novo nasce com prazo; recado
-- antigo continua como está até ser editado.
--
-- E VENCER NÃO É APAGAR
--
-- O recado vencido sai do mural e continua na tabela. Apagar seria perder o
-- registro de um aviso que a equipe leu — e a tela filtra por
-- `expira_em > now()`, que é reversível: mudar o prazo traz de volta.
--
-- Sem gatilho e sem rotina de limpeza de propósito. Um `DELETE` agendado seria
-- a quarta armadilha da CLAUDE.md ao contrário: um processo invisível comendo
-- linha sem ninguém para conferir. Aqui o que decide é uma comparação de data
-- no momento da leitura.
ALTER TABLE recados ADD COLUMN IF NOT EXISTS expira_em timestamptz;

COMMENT ON COLUMN recados.expira_em IS
  'Quando o recado sai do mural. NULO = sem prazo, fica ate alguem apagar. Vencer nao apaga: a tela filtra por expira_em > now(), e mudar o prazo traz de volta.';
