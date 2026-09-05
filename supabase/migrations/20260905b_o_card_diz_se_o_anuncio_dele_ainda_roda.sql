-- O CARD DIZ SE O ANUNCIO DELE AINDA RODA
--
-- Na tela de Avaliacao ela decide o que foi validado, e faltava a informacao
-- mais basica para essa decisao: o anuncio ainda esta no ar?
--
-- POR QUE `effective_status` E NAO `status`
--
-- Sao dois campos respondendo "esta ativo?", e divergem em 4.825 dos 8.123:
--
--   status     effective_status     anuncios
--   ACTIVE     CAMPAIGN_PAUSED        4.427
--   ACTIVE     ADSET_PAUSED             398
--   ACTIVE     WITH_ISSUES              529
--   ACTIVE     DISAPPROVED               21
--   ACTIVE     ACTIVE                    78   <- os que rodam de verdade
--
-- `status` e so o botao do anuncio. Se a CAMPANHA esta pausada, ele continua
-- ACTIVE e nao entrega nada. Usar `status` mostraria 4.825 anuncios "ativos"
-- parados — a armadilha 1 em forma de campo, e a Meta ja resolveu isso por nos
-- com `effective_status`.
--
-- E TAMBEM O ULTIMO DIA DE GASTO
--
-- `effective_status` diz o que a Meta reporta AGORA; `ultimo_gasto` diz o que
-- de fato aconteceu, e responde outra pergunta: quando parou? "Parado" sem
-- data nao distingue ontem de junho, e essa diferenca muda o que fazer com o
-- criativo.
--
-- Os dois se confirmam: dos 62 cards no ar, 54 gastaram ontem ou hoje; dos 342
-- parados, 1 (pausado hoje, gastou ontem — exatamente o esperado).
--
-- UM CARD, VARIOS ANUNCIOS
--
-- O mesmo criativo sobe como varios anuncios, entao o estado do CARD e um
-- resumo. A ordem de precedencia diz o que a pessoa precisa saber primeiro:
--
--   ativo        pelo menos um anuncio entregando
--   reprovado    nenhum ativo e algum DISAPPROVED — a Meta recusou
--   com_problema nenhum ativo e algum WITH_ISSUES
--   pausado      todos parados
--   sem_anuncio  nenhum vinculo, ou vinculo para anuncio que sumiu da API
--
-- `reprovado` vem antes de `pausado` de proposito: reprovado PARECE pausado na
-- tela e exige acao diferente.
--
-- O QUE ISSO REVELOU
--
-- A tela ja tinha `status_veiculacao`, que E O QUE ELA MARCA. Os dois divergem,
-- e a divergencia custa:
--
--   marcado "Encerrado", ativo na Meta   24 cards, 60 anuncios, R$ 5.691,62 em 7d
--   marcado "Rodando", parado na Meta    29 cards, 66 anuncios, R$   652,52 em 7d
--
-- O primeiro e dinheiro saindo num criativo que ela considera encerrado. Por
-- isso a tela nao mostra so o estado: marca com ⚠ quando a marcacao dela
-- contradiz a Meta. Os dois campos continuam existindo porque respondem coisas
-- diferentes — um e julgamento, o outro e fato — e e a CONTRADICAO entre eles
-- que vale ser vista.

CREATE OR REPLACE VIEW vw_producao_estado_ads AS
WITH gasto AS (
  SELECT m.ad_id, max(m.data) FILTER (WHERE m.investimento > 0) AS ultimo_dia
    FROM metricas_meta m WHERE m.nivel = 'ad' GROUP BY m.ad_id
), por_card AS (
  SELECT pa.producao_id,
         count(*)                                                        AS ads_ligados,
         count(o.objeto_id)                                              AS ads_conhecidos,
         count(*) FILTER (WHERE o.effective_status = 'ACTIVE')           AS ativos,
         count(*) FILTER (WHERE o.effective_status = 'DISAPPROVED')      AS reprovados,
         count(*) FILTER (WHERE o.effective_status = 'WITH_ISSUES')      AS com_problema,
         count(*) FILTER (WHERE o.effective_status IN
                          ('PAUSED','CAMPAIGN_PAUSED','ADSET_PAUSED'))   AS pausados,
         max(o.visto_em)                                                 AS visto_em,
         max(g.ultimo_dia)                                               AS ultimo_gasto
    FROM producao_ads pa
    LEFT JOIN meta_objetos o ON o.nivel = 'ad' AND o.objeto_id = pa.ad_id
    LEFT JOIN gasto g        ON g.ad_id = pa.ad_id
   GROUP BY pa.producao_id
)
SELECT c.producao_id, c.ads_ligados, c.ads_conhecidos,
       c.ativos, c.reprovados, c.com_problema, c.pausados,
       c.visto_em,
       CASE
         WHEN c.ads_conhecidos = 0 THEN 'sem_anuncio'
         WHEN c.ativos       > 0   THEN 'ativo'
         WHEN c.reprovados   > 0   THEN 'reprovado'
         WHEN c.com_problema > 0   THEN 'com_problema'
         WHEN c.pausados     > 0   THEN 'pausado'
         ELSE 'sem_anuncio'
       END AS estado,
       c.ultimo_gasto
  FROM por_card c;

COMMENT ON VIEW vw_producao_estado_ads IS
  'Estado dos anuncios de cada card, por `effective_status` da Meta — nunca '
  'por `status`, que ignora campanha/conjunto pausados e diverge em 4.825 dos '
  '8.123 anuncios. `ultimo_gasto` e o fato contra o reporte: responde "quando '
  'parou?". Um card tem varios anuncios, entao o estado e um resumo.';
