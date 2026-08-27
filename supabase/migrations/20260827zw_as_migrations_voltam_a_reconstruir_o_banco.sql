-- As migrations voltam a reconstruir o banco.
--
-- Tres mudancas de schema foram aplicadas direto no banco durante a construcao
-- do painel do Gestor de Trafego e nao viraram arquivo aqui:
--
--   20260827174548  vw_gestor_fila_cobre_as_duas_fases
--   20260827181152  fila_do_gestor_so_criativo
--   20260827181416  esteira_lotes_carrega_um_card_para_abrir
--
-- O sintoma: rodar as migrations num ambiente limpo produzia uma
-- `vw_gestor_fila` que ainda derivava os tipos de `producao_fases_tipo` -- ou
-- seja, os 11 cards `vsl` voltariam para a fila do gestor, exatamente o que ela
-- pediu para tirar. Ninguem perceberia ate alguem levantar o banco do zero.
--
-- E a quarta armadilha do CLAUDE.md numa forma nova: o retrato (as migrations)
-- parou de acompanhar o presente (o banco). Este arquivo grava as definicoes
-- FINAIS das duas views, como estao no banco hoje.

-- ── A fila do gestor: as duas fases, so criativo ───────────────────────────
--
-- `p.tipo = 'criativo'` escrito aqui, e nao derivado de `producao_fases_tipo`.
-- Derivar de tabela costuma ser o certo (terceira armadilha), mas aquela tabela
-- responde "que tipos PODEM estar nesta fase" -- e inclui `vsl`. A pergunta
-- deste painel e outra: "o que o gestor manda para teste". VSL nao e anuncio,
-- nao tem numero de AD, e os 11 cards entravam como "0 ADs" estragando a
-- contagem de cada grupo.
CREATE OR REPLACE VIEW public.vw_gestor_fila
WITH (security_invoker = true) AS
SELECT p.id,
       p.nome,
       p.fase,
       p.tipo,
       p.tipo_teste,
       coalesce(t.familia,
                CASE WHEN p.tipo_teste IS NULL THEN 'sem_tipo' ELSE 'outro' END) AS familia,
       fn_funil_video_norm(p.funil_video) AS funil,
       fn_ad_numero(p.nome)               AS ad_num,
       fn_ad_hook(p.nome)                 AS hook,
       p.projeto_id,
       o.nome                             AS projeto,
       coalesce(o.ativo, false)           AS projeto_ativo,
       p.data_inicio,
       p.data_prazo,
       resp.nome                          AS editor,
       p.video_editado_url,
       -- Desde quando esta parado. Sai do HISTORICO da entrada na fase, e nao
       -- de `atualizado_em` -- aquele campo foi reescrito por tres cargas em
       -- massa e nao distingue nada antes de 27/08/2026.
       entrou.em::date                    AS entrou_na_fase_em,
       greatest(current_date - coalesce(entrou.em::date, p.data_inicio), 0) AS dias_na_fase
  FROM public.producoes p
  LEFT JOIN public.criativo_tipos_teste t ON t.nome = p.tipo_teste
  LEFT JOIN public.ofertas_editores o    ON o.id = p.projeto_id
  LEFT JOIN public.perfis resp           ON resp.id = p.responsavel_id
  LEFT JOIN LATERAL (
    SELECT min(h.criado_em) AS em FROM public.criativo_historico h
     WHERE h.criativo_id = p.id AND h.campo_alterado = 'fase' AND h.valor_novo = p.fase
  ) entrou ON true
 WHERE p.fase IN ('aprovado', 'esteira_teste')
   AND p.tipo = 'criativo';

COMMENT ON VIEW public.vw_gestor_fila IS
  'As duas fases do Gestor de Trafego -- aprovado (esperando) e esteira_teste (em teste). So tipo criativo: VSL nao e anuncio e nao tem numero de AD.';

-- ── O lote da esteira carrega um card, para poder ser aberto ───────────────
--
-- `card_id` existe porque o lote e agregacao e nao tem id proprio; o card e que
-- e linha do banco. Sem ele, clicar num lote na Esteira do Copy nao tinha o que
-- abrir. `(array_agg(e.id ORDER BY e.hook))[1]` e deterministico -- um
-- `min(uuid)` seria o obvio e nao existe no Postgres.
CREATE OR REPLACE VIEW public.vw_esteira_lotes
WITH (security_invoker = true) AS
WITH base AS (
  SELECT p.id, p.projeto_id, p.fase, p.tipo_teste, p.data_inicio, p.responsavel_id,
         fn_ad_numero(p.nome)               AS ad_num,
         fn_ad_hook(p.nome)                 AS hook,
         fn_funil_video_norm(p.funil_video) AS funil,
         coalesce(t.familia,
                  CASE WHEN p.tipo_teste IS NULL THEN 'sem_tipo' ELSE 'outro' END) AS familia,
         CASE p.fase
           WHEN 'briefing'         THEN 1
           WHEN 'producao_copy'    THEN 2
           WHEN 'revisao_copy'     THEN 3
           WHEN 'gravacao'         THEN 4
           WHEN 'revisao_gravacao' THEN 5
           WHEN 'edicao'           THEN 6
           WHEN 'revisao_edicao'   THEN 7
           WHEN 'alteracao'        THEN 8
           WHEN 'aprovado'         THEN 9
           WHEN 'esteira_teste'    THEN 10
           ELSE 5
         END AS fase_ordem
    FROM public.producoes p
    LEFT JOIN public.criativo_tipos_teste t ON t.nome = p.tipo_teste
   WHERE p.tipo = 'criativo'
     AND p.fase IS NOT NULL
     AND p.fase <> ALL (ARRAY['postado','na_plataforma','arquivado','bloqueado'])
), totais AS (
  SELECT p.projeto_id,
         fn_ad_numero(p.nome) AS ad_num,
         p.tipo_teste,
         count(*)                             AS cards_totais,
         count(DISTINCT fn_ad_hook(p.nome))   AS hooks_totais
    FROM public.producoes p
   WHERE p.tipo = 'criativo' AND fn_ad_numero(p.nome) IS NOT NULL
   GROUP BY p.projeto_id, fn_ad_numero(p.nome), p.tipo_teste
)
SELECT e.projeto_id,
       o.nome AS projeto,
       e.ad_num,
       e.tipo_teste,
       min(e.familia)                            AS familia,
       string_agg(DISTINCT e.funil, ' / ')       AS funil,
       count(*)::integer                         AS cards,
       count(DISTINCT e.hook)::integer           AS hooks,
       max(t.cards_totais)::integer              AS cards_totais,
       max(t.hooks_totais)::integer              AS hooks_totais,
       (array_agg(e.fase ORDER BY e.fase_ordem DESC))[1] AS fase,
       array_agg(DISTINCT e.fase)                AS fases,
       min(e.data_inicio)                        AS comecou_em,
       max(e.data_inicio)                        AS mexido_em,
       greatest(current_date - max(e.data_inicio), 0) AS dias_parado,
       coalesce(o.ativo, false)                  AS projeto_ativo,
       (array_agg(e.id ORDER BY e.hook))[1]      AS card_id
  FROM base e
  JOIN totais t ON t.projeto_id IS NOT DISTINCT FROM e.projeto_id
               AND t.ad_num = e.ad_num
               AND t.tipo_teste IS NOT DISTINCT FROM e.tipo_teste
  LEFT JOIN public.ofertas_editores o ON o.id = e.projeto_id
 WHERE e.ad_num IS NOT NULL
 GROUP BY e.projeto_id, o.nome, o.ativo, e.ad_num, e.tipo_teste;

COMMENT ON VIEW public.vw_esteira_lotes IS
  'Um lote por (projeto, numero de AD, tipo de teste), com card_id para abrir o card a partir do lote.';
