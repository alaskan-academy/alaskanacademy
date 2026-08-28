-- ── A view perde as 15 razoes que ninguem lia ─────────────────────────────
--
-- `vw_metricas_meta_nivel` calculava CTR, CPM, CPC, ROAS, CPA, taxa de video,
-- taxa de IC, taxa de conexao e mais -- POR DIA. As mesmas quinze formulas
-- existiam no front. Primeira armadilha do CLAUDE.md: a mesma regra escrita em
-- dois lugares, esperando divergir.
--
-- E as do banco nao tinham como ser usadas. Razao de um dia nao se soma: o CPM
-- de 28 dias somados nao e o CPM do mes. Quem agrega tem que recalcular, entao
-- as duas telas que liam esta view sempre recalcularam tudo e nunca tocaram
-- nessas colunas.
--
-- Conferido antes de tirar: hoje o unico consumidor da view no banco inteiro e
-- `fn_metricas_meta_agregado`, que le so as colunas somaveis, e no front
-- nenhuma tela le a view direto -- as duas passaram a chamar a funcao.
--
-- `funil_id` sai junto, pela razao inversa: ela e nula nas quase 10 mil linhas
-- e ja fez sete paginas zerarem quando alguem filtrou por ela.
--
-- Precisa de DROP e nao de CREATE OR REPLACE porque REPLACE nao remove coluna.
-- As permissoes vao escritas: view recriada nasce sem as do original.
DROP VIEW IF EXISTS public.vw_metricas_meta_nivel;

CREATE VIEW public.vw_metricas_meta_nivel AS
  SELECT
    mm.nivel,
    mm.produto::text AS produto,
    mm.campanha_id,
    mm.campanha_nome,
    mm.adset_id,
    mm.adset_nome,
    mm.ad_id,
    mm.ad_nome,
    mm.data,
    mm.ad_account_id,
    aa.nome AS conta_nome,
    CASE mm.nivel
      WHEN 'campanha'::nivel_meta THEN mm.campanha_nome
      WHEN 'adset'::nivel_meta    THEN mm.adset_nome
      ELSE mm.ad_nome
    END AS nome,
    CASE mm.nivel
      WHEN 'campanha'::nivel_meta THEN mm.campanha_id
      WHEN 'adset'::nivel_meta    THEN mm.adset_id
      ELSE mm.ad_id
    END AS nivel_id,
    CASE mm.nivel
      WHEN 'adset'::nivel_meta THEN mm.campanha_id
      WHEN 'ad'::nivel_meta    THEN mm.adset_id
      ELSE NULL::text
    END AS parent_id,
    sum(mm.impressoes)            AS impressoes,
    sum(mm.alcance)               AS alcance,
    sum(mm.cliques)               AS cliques,
    sum(mm.cliques_link)          AS cliques_link,
    sum(mm.investimento)          AS investimento,
    sum(mm.compras_meta)          AS compras_meta,
    sum(mm.faturamento_atribuido) AS faturamento_atribuido,
    sum(mm.initiate_checkout)     AS initiate_checkout,
    sum(mm.visualizacoes_pagina)  AS visualizacoes_pagina,
    sum(mm.video_plays)           AS video_plays,
    sum(mm.video_3s)              AS video_3s,
    sum(mm.video_75pct)           AS video_75pct
  FROM metricas_meta mm
  JOIN ad_accounts aa ON aa.id = mm.ad_account_id
  GROUP BY mm.nivel, mm.produto, mm.campanha_id, mm.campanha_nome,
           mm.adset_id, mm.adset_nome, mm.ad_id, mm.ad_nome, mm.data,
           mm.ad_account_id, aa.nome;

COMMENT ON VIEW public.vw_metricas_meta_nivel IS
  'Metricas do Meta por dia e por nivel, SO com colunas somaveis. As razoes (CTR, CPM, ROAS...) nao moram aqui de proposito: razao de dia nao se soma, entao quem agrega recalcula -- e a formula existe num lugar so, no front.';

GRANT SELECT ON public.vw_metricas_meta_nivel TO anon, authenticated, service_role;
