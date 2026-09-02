-- A chave de deduplicação do extrato passa a incluir a FONTE.
--
-- ── Por que, antes de existir o problema ──────────────────────────────────
--
-- Vamos ligar contas do Inter e do C6 (Alaskan) ao lado da Conta Simples. Elas
-- caem na mesma tabela `transacoes`, e a deduplicação era esta:
--
--     transacoes_referencia_externa_unique  →  (referencia_externa)
--
-- Só a referência. Mas o id de uma transação só é único DENTRO do banco que o
-- emitiu — nada impede o Inter de devolver um id que a Conta Simples já usou.
-- E as referências atuais convidam a isso:
--
--     conta_simples · Alaskan   83765041          (número puro, 8 dígitos)
--     conta_simples · Aeliss    aeliss_83765164   (prefixado)
--
-- O prefixo entrou quando a Aeliss chegou e não foi aplicado ao histórico — por
-- um bom motivo, aliás: prefixar depois faria as 1.238 linhas antigas serem
-- reimportadas como novas.
--
-- ── O que aconteceria, e por que ninguém veria ───────────────────────────
--
-- `cs-sync` grava com `ignoreDuplicates: true`, que existe para proteger
-- `status_revisao` de voltar a "pendente" numa transação já revisada. Com a
-- chave errada, uma colisão entre bancos não daria erro: a transação do Inter
-- seria simplesmente DESCARTADA. Sem exceção, sem linha, sem log — e o DRE
-- fechando com um número plausível.
--
-- É a mesma família dos defeitos que este projeto pagou hoje: o corte do
-- PostgREST, o reembolso contado duas vezes, os juros na base do imposto.
-- Nenhum deles deu erro; todos deram um número que parecia certo.
--
-- ── O que mudou ──────────────────────────────────────────────────────────
--
--   1. `fonte` e `referencia_externa` viraram NOT NULL. Sem isso o índice
--      composto não valeria nada: uma linha com `fonte` nula aceitaria
--      duplicatas sem limite. Os dois gravadores já preenchiam os dois campos
--      (`cs-sync` e o lançamento manual da Revisão), e havia zero nulos.
--
--   2. Índice único novo em (fonte, referencia_externa). Cada banco ganha o seu
--      espaço de nomes, e o formato do id deixa de importar.
--
--   3. A constraint antiga, só de `referencia_externa`, foi removida.
--
-- Nenhuma linha foi reescrita: o histórico continua com as referências que
-- sempre teve.
--
-- ── A ordem importou ─────────────────────────────────────────────────────
--
-- `cs-sync` usava `onConflict: 'referencia_externa'`, e o PostgREST exige uma
-- constraint que case com as colunas do `onConflict`. Derrubar a antiga antes
-- de publicar a função quebraria a importação diária das 10:00. A sequência foi:
--
--   1. criar o índice composto  (os dois convivem, nada quebra)
--   2. publicar `cs-sync` v41 com `onConflict: 'fonte,referencia_externa'`
--   3. INVOCAR a função e confirmar 200 — 2 contas, 19 transações
--   4. só então remover a constraint antiga
--
-- ── Testado nos dois sentidos ────────────────────────────────────────────
--
-- Mesma referência `83765041` em três fontes ao mesmo tempo:
--
--     c6             83765041   PROVA indice composto
--     conta_simples  83765041   JESSICA GAVAZZA PEISINO
--     inter          83765041   PROVA indice composto
--
-- Antes, as duas primeiras teriam sido engolidas. E a duplicata DENTRO da mesma
-- fonte continua sendo recusada com `unique_violation`, que é o que a chave
-- precisa continuar garantindo. As linhas de prova foram apagadas.

alter table transacoes
  alter column fonte set not null,
  alter column referencia_externa set not null;

create unique index if not exists transacoes_fonte_referencia_unique
  on transacoes (fonte, referencia_externa);

comment on index transacoes_fonte_referencia_unique is
  'Deduplicacao por FONTE + referencia. O id externo so e unico dentro do banco '
  'que o emitiu: um id numerico do Inter pode coincidir com um da Conta Simples, '
  'e com o indice antigo (so a referencia) o upsert descartaria a transacao em '
  'silencio. Ver a migracao 20260901j.';

-- Depois de `cs-sync` v41 estar no ar e responder 200.
alter table transacoes drop constraint if exists transacoes_referencia_externa_unique;
