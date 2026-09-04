-- O ENUM DE PRODUTO GANHA `sala_de_aula`
--
-- Em migracao propria porque `ALTER TYPE ... ADD VALUE` precisa estar comitado
-- antes de o valor ser usado: no mesmo bloco de transacao, o UPDATE da
-- `20260904b` falharia com "unsafe use of new value of enum type".
--
-- O motivo esta escrito na 20260904b: os produtos da Aeliss (Desafios na Sala
-- de Aula, Guia do Comportamento, Limites Respeitosos) nao tinham categoria e
-- caiam em NULL ou, pior, em `velas` — que e a linha de velas da ALASKAN.

ALTER TYPE produto_tipo ADD VALUE IF NOT EXISTS 'sala_de_aula';
