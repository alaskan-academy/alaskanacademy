-- ── UTM: um faturamento só, e o placement que o banco já derivou ──────────
--
-- Duas correções na fonte da tela de UTM, as duas da primeira armadilha da
-- CLAUDE.md: dois campos dizendo a mesma coisa.
--
-- 1. "FATURAMENTO" QUERIA DIZER DUAS COISAS
--
-- A função somava `valor_oferta_principal`; Vendas, Resumo e Financeiro somam
-- `valor_total`. Agosto/2026, mesmo recorte, mesma palavra na tela:
--
--   valor_total             R$ 166.473,32
--   valor_oferta_principal  R$ 123.147,01
--
-- R$ 43.326,31 de diferença (26%) entre duas colunas chamadas "Faturamento" em
-- telas vizinhas. A diferença são os order bumps (R$ 39.210,76 medidos em
-- agosto) mais os juros -- e o bump foi comprado no mesmo checkout que o
-- anúncio entregou, então ele É receita daquela origem.
--
-- Passa a somar `valor_total`. Quem quiser a receita só da oferta de frente
-- tem esse número no Análises, com o nome certo (`oferta_principal_valor`) --
-- que é a diferença entre ter dois números e ter dois NOMES.
--
-- 2. O PLACEMENT ESTAVA SENDO DERIVADO DUAS VEZES
--
-- `vendas.utm_placement` já existe, é enum (`placement_tipo`) e é preenchido
-- pelo gatilho `fn_campos_data`, que faz a escada de ILIKE sobre `utm_term`:
-- reels, stories, feed, marketplace, search, audience_network, senão `outro`.
--
-- E o front refazia a MESMA escada em JavaScript (`cleanPlacementValue`), a
-- partir do `utm_term` cru. As duas cópias já divergiam na cauda, porque só
-- uma tem o `outro`:
--
--   utm_term                   banco    tela
--   Whatsapp_Status            outro    whatsapp_status
--   Facebook_Instream_Video    outro    facebook_instream_video
--   an                         outro    an
--
-- Ou seja: a aba "Por Placement" inventava categorias que o detalhe da venda,
-- lendo a coluna, não reconhecia. A função passa a devolver `utm_placement`
-- pronto e a cópia em JavaScript sai.
--
-- `utm_term` continua vindo: ele é o valor cru, útil quando se quer ver o que
-- a Meta mandou de fato. O que sai é a segunda REGRA, não o segundo dado.
--
-- E o nulo fica nulo. A primeira versão desta função fazia
-- `coalesce(utm_placement, 'outro')`, e isso juntava duas coisas diferentes:
--
--   sem placement nenhum   804 vendas   R$ 72.606,20   (não veio utm_term)
--   'outro' de verdade      51 vendas   R$  5.222,01   (veio e não classificou)
--
-- Somados davam um "Outro" de 46,7% na aba de placement, que se lê como "a
-- Meta entregou num lugar estranho" quando quase tudo é "não temos o dado".
-- São duas respostas diferentes e por isso duas linhas.
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
           coalesce(sum(valor) FILTER (WHERE status = 'aprovada'), 0)         AS faturamento
      FROM base
     GROUP BY 1,2,3,4,5,6,7
  )
  SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.faturamento DESC), '[]'::jsonb)
    FROM agregado a;
$function$;

COMMENT ON FUNCTION public.fn_utm_agregado(timestamptz, timestamptz, uuid[]) IS
  'Vendas agrupadas pelas tuplas CRUAS de UTM, com o placement ja classificado pelo gatilho. Faturamento e `valor_total`, a mesma definicao do resto do dashboard. A limpeza de source/medium/campaign/content fica no front, num lugar so -- aqui so a soma, que e o que estourava o teto de 1.000 linhas do PostgREST.';

REVOKE ALL ON FUNCTION public.fn_utm_agregado(timestamptz, timestamptz, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_utm_agregado(timestamptz, timestamptz, uuid[]) TO authenticated, service_role;
