-- Os 9 cards que estavam em `fase=bloqueado` vão para `postado`.
--
-- Completa a migração anterior (20260831s). Lá a fase foi desativada para que
-- ninguém entrasse; aqui saem os que já estavam dentro.
--
-- ── O que faltava para poder mexer ─────────────────────────────────────────
--
-- Ontem eu não movi porque não conseguia PROVAR que os nove tinham sido
-- postados: zero anúncios ligados, sem vídeo, data de 2025 — antes de
-- `metricas_meta` existir. Ela confirmou a regra do negócio: um AD só chega a
-- ser bloqueado depois de postado. Com isso a inferência deixa de ser palpite.
--
-- ── Nada se perde ──────────────────────────────────────────────────────────
--
-- Os nove já tinham `status_veiculacao = 'Bloqueado'`, e esse campo não é
-- tocado. O bloqueio continua registrado; o que sai é a SEGUNDA cópia dele,
-- que morava na fase. Depois disto os 16 bloqueados da base ficam todos
-- iguais: fase=postado + status=Bloqueado.
--
-- ── O rastro vem antes da mudança ──────────────────────────────────────────
--
-- Nove cards mudando de fase sem uma linha de histórico seria a mesma falha
-- que `registrarHistorico` existe para consertar: prazo reescrito em silêncio,
-- sem como reconstruir depois. `usuario_id` fica nulo de propósito — não foi
-- pessoa nenhuma, foi correção de modelo, e o `motivo` diz isso por extenso.
--
-- `producao_fases` MANTÉM a linha de Bloqueado (inativa). Ela ainda é
-- necessária: sem ela, estas nove linhas de histórico mostrariam a chave crua
-- "bloqueado" em vez do rótulo "Bloqueado".

begin;

insert into criativo_historico
  (criativo_id, usuario_id, tipo_alteracao, campo_alterado, valor_anterior, valor_novo, motivo)
select id, null, 'fase', 'fase', 'bloqueado', 'postado',
       'Correcao de modelo: Bloqueado deixou de ser fase e virou apenas status de veiculacao. Um AD so pode ser bloqueado depois de postado, entao a fase correta e Postado. O status_veiculacao=Bloqueado nao mudou.'
from producoes where fase = 'bloqueado';

update producoes set fase = 'postado' where fase = 'bloqueado';

commit;
