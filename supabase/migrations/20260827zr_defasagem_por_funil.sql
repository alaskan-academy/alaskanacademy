-- TSL e VSL viram contas separadas.
--
-- A tela mostrava "Saponaria Brasil · TSL / TSL+VSL / VSL · 42% do estoque é
-- novo". Esse 42% não era nem o TSL nem o VSL — era a média dos dois, e a média
-- escondia justamente o que importa:
--
--   Saponaria · TSL    1 novo · 1 iteração · 1 variação    33% novo
--   Saponaria · VSL    1 novo · 2 iteração · 2 variação    20% novo, NA META
--
-- O VSL está exatamente no alvo e o TSL está magro. Agregado, os dois somem.
--
-- E apareceu uma coisa que estava completamente invisível: o Workshop Buquê de
-- Velas roda VSL e tem ZERO criativo para VSL. No agregado ele aparecia como
-- "0/0/3", que lia como "tem alguma coisa".
--
-- ── Como um lote se distribui entre funis ──────────────────────────────────
--
-- Um lote marcado "TSL+VSL" serve os DOIS e conta nos dois — por isso o unnest,
-- e não um group by na string: "TSL+VSL" não é um terceiro funil.
--
-- E um lote SEM funil não conta em nenhum, de propósito. Ninguém sabe se aquele
-- card serve o TSL ou o VSL, e distribuir por chute produziria um estoque que
-- não existe. São 19 dos 38 lotes hoje — metade — e é por isso que a tela
-- mostra esse número numa linha própria: sem ele, as contas por funil parecem
-- piores do que são, e ninguém entende por quê.
--
-- ── Quais funis cada projeto roda ──────────────────────────────────────────
--
-- Sai dos criativos vivos (validados ou na esteira) que TÊM funil preenchido. É
-- o único lugar onde essa informação existe: `funis.metodo` diria melhor, mas
-- `producoes.funil_id` e `funil_ids` estão vazios em 131 de 131 cards da
-- esteira. Enquanto for assim, `funil_video` é a fonte.

DROP FUNCTION IF EXISTS public.fn_esteira_defasagem();

CREATE OR REPLACE FUNCTION public.fn_esteira_defasagem()
 RETURNS TABLE (
   projeto_id uuid, projeto text, empresa text, funil text,
   inv_7d numeric, inv_30d numeric,
   ads_novo int, ads_iteracao int, ads_variacao int,
   cards_novo int, cards_iteracao int, cards_variacao int,
   novo_dias int, iteracao_dias int, variacao_dias int,
   falta_novo boolean, falta_iteracao boolean, falta_variacao boolean,
   pct_novo int, pct_novo_meta int, mix_estourado boolean,
   prioridade int,
   sug_ad int, sug_hook int, sug_validado_em date,
   sug_investido numeric, sug_total int,
   lotes_sem_funil int
 )
 LANGUAGE sql STABLE
 SET search_path TO 'public'
AS $function$
  WITH meta AS (
    SELECT coalesce((SELECT valor FROM configuracoes WHERE chave = 'esteira_pct_novo_meta'), 20)::int AS pct
  ),
  proj AS (
    SELECT o.id, o.nome, e.nome AS empresa, i.inv_7d, i.inv_30d
      FROM ofertas_editores o
      LEFT JOIN empresas e ON e.id = o.empresa_id
      JOIN vw_projeto_investimento i ON i.projeto_id = o.id
     WHERE o.ativo AND coalesce(i.inv_7d, 0) > 0
  ),
  funis_do_projeto AS (
    SELECT DISTINCT p.projeto_id, f AS funil
      FROM producoes p,
           unnest(string_to_array(fn_funil_video_norm(p.funil_video), '+')) AS f
     WHERE p.tipo = 'criativo'
       AND fn_funil_video_norm(p.funil_video) IS NOT NULL
       AND (p.avaliacao IN ('Validado','Escalado')
            OR p.fase NOT IN ('postado','na_plataforma','arquivado','bloqueado'))
  ),
  lotes AS (
    SELECT l.projeto_id, f AS funil, l.familia, l.cards, l.dias_parado
      FROM vw_esteira_lotes l,
           unnest(string_to_array(l.funil, '+')) AS f
     WHERE l.projeto_ativo AND l.funil IS NOT NULL
  ),
  sem_funil AS (
    SELECT projeto_id, count(*)::int AS n
      FROM vw_esteira_lotes WHERE projeto_ativo AND funil IS NULL GROUP BY 1
  ),
  est AS (
    SELECT projeto_id, funil, familia,
           count(*)::int           AS ads,
           sum(cards)::int         AS cards,
           min(dias_parado)::int   AS dias
      FROM lotes GROUP BY 1,2,3
  ), val AS (
    SELECT p.id, p.projeto_id, fn_ad_numero(p.nome) AS ad, fn_ad_hook(p.nome) AS hook,
           max(p.data_inicio) AS validado_em,
           max(fn_funil_video_norm(p.funil_video)) AS funil
      FROM producoes p
     WHERE p.tipo = 'criativo' AND p.avaliacao IN ('Validado','Escalado')
       AND fn_ad_numero(p.nome) IS NOT NULL
     GROUP BY 1,2,3,4
  ), var AS (
    SELECT DISTINCT p.projeto_id, fn_ad_numero(p.nome) AS ad, fn_ad_hook(p.nome) AS hook
      FROM producoes p JOIN criativo_tipos_teste t ON t.nome = p.tipo_teste
     WHERE p.tipo = 'criativo' AND t.familia = 'variacao'
  ),
  -- Onde já existe PEDIDO humano aberto, a inferência se cala: senão o mesmo AD
  -- aparece duas vezes na tela, uma no alerta e outra na fila, com dois textos.
  pedidos AS (
    SELECT DISTINCT p.projeto_id, fn_ad_numero(p.nome) AS ad, fn_ad_hook(p.nome) AS hook
      FROM pedidos_variacao pv JOIN producoes p ON p.id = pv.producao_id
     WHERE pv.status = 'aberto'
  ), orfaos AS (
    SELECT v.projeto_id, f AS funil, v.ad, v.hook, v.validado_em, ci.inv_30d
      FROM val v
      JOIN vw_criativo_investimento ci ON ci.producao_id = v.id AND ci.inv_30d > 0,
           unnest(string_to_array(v.funil, '+')) AS f
     WHERE v.funil IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM var
          WHERE var.projeto_id IS NOT DISTINCT FROM v.projeto_id
            AND var.ad = v.ad AND var.hook IS NOT DISTINCT FROM v.hook)
       AND NOT EXISTS (
         SELECT 1 FROM pedidos pe
          WHERE pe.projeto_id IS NOT DISTINCT FROM v.projeto_id
            AND pe.ad = v.ad AND pe.hook IS NOT DISTINCT FROM v.hook)
  ), tot AS (
    SELECT fp.projeto_id, fp.funil,
           coalesce(n.ads,0) AS n, coalesce(it.ads,0) AS i, coalesce(v.ads,0) AS v
      FROM funis_do_projeto fp
      LEFT JOIN est n  ON n.projeto_id=fp.projeto_id  AND n.funil=fp.funil  AND n.familia='novo'
      LEFT JOIN est it ON it.projeto_id=fp.projeto_id AND it.funil=fp.funil AND it.familia='iteracao'
      LEFT JOIN est v  ON v.projeto_id=fp.projeto_id  AND v.funil=fp.funil  AND v.familia='variacao'
  )
  SELECT pr.id, pr.nome, pr.empresa, t.funil,
         round(pr.inv_7d, 2), round(pr.inv_30d, 2),
         t.n, t.i, t.v,
         coalesce(n.cards,0), coalesce(it.cards,0), coalesce(v.cards,0),
         n.dias, it.dias, v.dias,
         t.n = 0, t.i = 0, t.v = 0,
         CASE WHEN (t.n+t.i+t.v) = 0 THEN 0
              ELSE round(100.0 * t.n / (t.n+t.i+t.v))::int END,
         m.pct,
         (t.n+t.i+t.v) > 0 AND (100.0 * t.n / (t.n+t.i+t.v)) > m.pct,
         -- A escada de prioridade sai do 80/20: o balde de 80% é iteração +
         -- variação, e dentro dele a iteração vem primeiro. Falta de "novo" é o
         -- menos urgente — ele é só 20% da meta.
         CASE WHEN (t.n+t.i+t.v) = 0                     THEN 0
              WHEN t.i = 0                               THEN 1
              WHEN t.v = 0                               THEN 2
              WHEN (100.0 * t.n / (t.n+t.i+t.v)) > m.pct THEN 3
              WHEN t.n = 0                               THEN 4
              ELSE 5 END,
         s.ad, s.hook, s.validado_em, round(s.inv_30d, 2),
         (SELECT count(*)::int FROM orfaos o2
           WHERE o2.projeto_id = pr.id AND o2.funil = t.funil),
         coalesce(sf.n, 0)
    FROM proj pr
    CROSS JOIN meta m
    JOIN tot t ON t.projeto_id = pr.id
    LEFT JOIN est n   ON n.projeto_id=pr.id  AND n.funil=t.funil  AND n.familia='novo'
    LEFT JOIN est it  ON it.projeto_id=pr.id AND it.funil=t.funil AND it.familia='iteracao'
    LEFT JOIN est v   ON v.projeto_id=pr.id  AND v.funil=t.funil  AND v.familia='variacao'
    LEFT JOIN sem_funil sf ON sf.projeto_id = pr.id
    -- A sugestao sai ordenada por DINHEIRO, e o valor nao vai para a tela: ele
    -- decide a ordem e fica quieto.
    LEFT JOIN LATERAL (
      SELECT o.ad, o.hook, o.validado_em, o.inv_30d FROM orfaos o
       WHERE o.projeto_id = pr.id AND o.funil = t.funil
       ORDER BY o.inv_30d DESC NULLS LAST, o.validado_em DESC NULLS LAST LIMIT 1
    ) s ON true
   ORDER BY 22, pr.inv_7d DESC, t.funil;
$function$;

COMMENT ON FUNCTION public.fn_esteira_defasagem() IS
  'Uma linha por (projeto ativo com verba, funil). TSL e VSL sao contas separadas: um lote "TSL+VSL" conta nos dois, e um lote sem funil nao conta em nenhum -- ninguem sabe qual ele serve.';
