-- `esteira_teste` significava outra coisa no Notion.
--
-- La ela era o que `postado` e hoje: o anuncio no ar. Eu tinha lido os 80 cards
-- daquela fase como "nunca foram ao ar", porque nenhum tem anuncio ligado no
-- Meta nem jamais gastou -- e ela corrigiu: eles RODARAM, o que nunca existiu
-- foi o vinculo, porque dado importado nao tem.
--
-- O banco confirma a leitura dela: os 80 vieram da carga e nenhum tem uma linha
-- em `criativo_historico`. Nunca passaram pelo fluxo do app; sao registro, nao
-- fila pendente. E o painel do gestor os mostrava como trabalho a fazer.
--
-- ── O criterio, e por que ele e seguro ─────────────────────────────────────
--
-- So cards SEM NENHUMA linha em `criativo_historico`. Isso os separa com
-- precisao -- conferido antes: 80 na fase, 80 sem historico, 0 com. E qualquer
-- card que passe pelo fluxo do app ganha historico: `fn_enviar_para_esteira`
-- grava uma linha por card, e o Kanban tambem. Entao o que o gestor mandar
-- para a esteira de agora em diante NUNCA cai neste criterio.
--
-- `data_inicio` fica como esta: e o dia em que o anuncio foi ao ar, que e
-- justamente o que `postado` quer dizer.
--
-- O gatilho de `atualizado_em` fica DESLIGADO: estes cards nao foram editados
-- hoje, so estao recebendo o rotulo certo. Carimbar 80 com a data de hoje
-- sujaria o sinal de "parado ha X".
--
-- Conferido depois: `esteira_teste` foi a ZERO e `postado` subiu de 2.794 para
-- 2.874. Os 80 estao em `backup_producoes_20260827` se precisarem voltar.

ALTER TABLE public.producoes DISABLE TRIGGER trg_producoes_atualizado_em;

UPDATE public.producoes p
   SET fase = 'postado'
 WHERE p.fase = 'esteira_teste'
   AND NOT EXISTS (SELECT 1 FROM public.criativo_historico h WHERE h.criativo_id = p.id);

ALTER TABLE public.producoes ENABLE TRIGGER trg_producoes_atualizado_em;
