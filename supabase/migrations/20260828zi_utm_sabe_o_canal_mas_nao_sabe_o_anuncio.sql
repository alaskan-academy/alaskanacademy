-- ── UTM: saber o canal e saber o anúncio são duas perguntas ───────────────
--
-- A tela já dizia quanto do faturamento chega sem `utm_source` — 36,26% em
-- agosto. Falta a pergunta seguinte, que é a que paga a conta do tráfego:
-- destas que TÊM canal, quantas dizem de qual anúncio vieram?
--
-- Medido em agosto/2026, aprovadas e sem upsell:
--
--   faturamento                      R$ 166.605,98   1.809 vendas
--   sem `ad_id_meta`                 R$  73.958,87     819   (44,4%)
--     ├─ sem `utm_source` nenhum     R$  60.395,04     675
--     └─ com canal, sem anúncio      R$  13.563,83     144
--
-- Os dois números são encaixados, não somados: "sem origem" é o miolo de "sem
-- anúncio". Separá-los importa porque a causa é diferente — um é o link que
-- não leva UTM nenhuma, o outro é a UTM que chega sem o id do anúncio. A
-- primeira se conserta no link; a segunda, no parâmetro da campanha.
--
-- A função passa a devolver, por tupla, as aprovadas e o faturamento COM
-- `ad_id_meta`. O complemento se faz no front, subtraindo do total -- que é a
-- mesma regra usada no resto do arquivo: manda-se o cru, a razão se calcula
-- uma vez, sobre os totais.
CREATE OR REPLACE FUNCTION public.fn_utm_agregado(
  p_inicio timestamptz DEFAULT NULL,
  p_fim    timestamptz DEFAULT NULL,
  p_contas uuid[]      DEFAULT NULL::uuid[]
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
  WITH base AS (
    SELECT v.utm_source, v.utm_medium, v.utm_campaign, v.utm_content, v.utm_term,
           v.utm_placement::text AS utm_placement,
           v.produto::text AS produto,
           v.status::text  AS status,
           v.ad_id_meta,
           coalesce(v.valor_total, 0) AS valor
      FROM vendas v
     WHERE v.pedido_id NOT LIKE 'TEST%'
       AND v.pedido_id NOT LIKE 'LC-%'
       AND v.is_upsell IS NOT TRUE
       AND (p_inicio IS NULL OR v.data_venda >= p_inicio)
       AND (p_fim    IS NULL OR v.data_venda <= p_fim)
       AND (p_contas IS NULL OR cardinality(p_contas) = 0
            OR v.ad_account_id = ANY(p_contas))
  ),
  agregado AS (
    SELECT utm_source, utm_medium, utm_campaign, utm_content, utm_term,
           utm_placement, produto,
           count(*) FILTER (WHERE status = 'aprovada')                        AS vendas_aprovadas,
           count(*) FILTER (WHERE status = 'pendente')                        AS vendas_pendentes,
           count(*) FILTER (WHERE status IN ('cancelada','expirada'))         AS vendas_canceladas,
           coalesce(sum(valor) FILTER (WHERE status = 'aprovada'), 0)         AS faturamento,
           count(*) FILTER (WHERE status = 'aprovada' AND ad_id_meta IS NOT NULL)
             AS vendas_com_anuncio,
           coalesce(sum(valor) FILTER (WHERE status = 'aprovada' AND ad_id_meta IS NOT NULL), 0)
             AS faturamento_com_anuncio
      FROM base
     GROUP BY 1,2,3,4,5,6,7
  )
  SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.faturamento DESC), '[]'::jsonb)
    FROM agregado a;
$function$;
