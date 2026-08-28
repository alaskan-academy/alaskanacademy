-- ── A tela de UTM para de somar no navegador ──────────────────────────────
--
-- Mesmo defeito do Meta Ads, na quarta tela: ela pedia as linhas cruas de
-- `vendas` e agrupava no JavaScript. Agosto tem 2.462 vendas no recorte dela e
-- o PostgREST corta em 1.000 sem avisar -- entao a analise de atribuicao, que
-- existe para dizer de onde vem a venda, respondia sobre 40% delas.
--
-- Aqui a agregacao para nas TUPLAS CRUAS de UTM, e nao no valor ja limpo. As
-- 2.462 vendas de agosto viram 406 linhas, e a limpeza continua num lugar so:
-- `cleanUtmValue`, no front, com as regras que ela tem -- "FBjLj6a8..." vira
-- "meta ads", placement vira rotulo legivel. Reescrever isso em SQL seria a
-- primeira armadilha do CLAUDE.md: duas versoes da mesma regra, esperando
-- divergir na primeira mudanca.
--
-- Funciona porque limpar e uma funcao pura do valor cru: duas tuplas que
-- limpam para a mesma chave sao somadas no front, e soma de soma da a mesma
-- soma. O que nao daria certo era o contrario -- agregar depois de limpar, no
-- banco, e ter a regra em dois lugares.
--
-- Conferido na tela: 1.773 vendas e R$ 120.876,08, iguais ao SQL. E com o teto
-- fora do caminho a tela passou a mostrar o tamanho real do buraco de origem:
-- "(vazio)" com 674 vendas e R$ 44.156,01, 36,5% do faturamento.
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
           v.produto::text AS produto,
           v.status::text  AS status,
           coalesce(v.valor_oferta_principal, 0) AS valor
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
    SELECT utm_source, utm_medium, utm_campaign, utm_content, utm_term, produto,
           count(*) FILTER (WHERE status = 'aprovada')                        AS vendas_aprovadas,
           count(*) FILTER (WHERE status = 'pendente')                        AS vendas_pendentes,
           count(*) FILTER (WHERE status IN ('cancelada','expirada'))         AS vendas_canceladas,
           coalesce(sum(valor) FILTER (WHERE status = 'aprovada'), 0)         AS faturamento
      FROM base
     GROUP BY 1,2,3,4,5,6
  )
  SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.faturamento DESC), '[]'::jsonb)
    FROM agregado a;
$function$;

COMMENT ON FUNCTION public.fn_utm_agregado(timestamptz, timestamptz, uuid[]) IS
  'Vendas agrupadas pelas tuplas CRUAS de UTM. A limpeza dos valores fica no front, num lugar so -- aqui so a soma, que e o que estourava o teto de 1.000 linhas do PostgREST.';

REVOKE ALL ON FUNCTION public.fn_utm_agregado(timestamptz, timestamptz, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_utm_agregado(timestamptz, timestamptz, uuid[]) TO authenticated, service_role;
