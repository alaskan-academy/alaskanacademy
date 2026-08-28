-- ── O alerta para de cobrar rastreio de quem nunca foi anúncio ────────────
--
-- `fn_alerta_checkout_sem_rastreio` estava acusando tres checkouts que estao
-- 0% rastreados por natureza, nao por defeito:
--
--   Seguidoras - Saponaria Brasil        link da bio      13 vendas  R$ 1.206,19
--   Saponaria Brasil Suporte R$67        suporte no WhatsApp  11     R$   822,23
--   Oferta Personalizada - Saponaria     oferta individual pelo suporte  10  R$ 684,35
--
-- Nenhum deles nasceu para receber anuncio. Cobrar `ad_id_meta` deles e pedir
-- o numero da campanha para uma venda que veio do link da bio.
--
-- O DADO JA EXISTIA
--
-- `checkouts_origem` ja tem a coluna `trafego_pago`, e os tres ja estavam la
-- marcados como `false` desde 21/08, com a origem escrita ("link da bio",
-- "suporte"). O alerta e que nao lia. Nao criei campo nenhum -- e a primeira
-- armadilha da CLAUDE.md: antes de criar, procurar se algum campo existente ja
-- responde aquilo.
--
-- A POLARIDADE IMPORTA
--
-- O checkout so e ignorado quando EXISTE linha dizendo `trafego_pago = false`.
-- Checkout desconhecido continua sendo acusado -- que era o ponto do alerta:
-- "Saponaria Brasil - Desconto de Aula" nasceu cego em 20/05 e cresceu assim
-- por tres meses porque nada perguntou por ele. Se a regra fosse "ignora quem
-- nao esta marcado como trafego pago", o proximo nasceria cego igual.
--
-- E o que foi ignorado aparece no texto. Descartar em silencio e o defeito que
-- esta revisao vem desfazendo -- inclusive neste mesmo arquivo de alertas, onde
-- um remendo de `trafego_pago` ja tinha deixado `receita_sem_rastreio` calado
-- por oito semanas.
--
-- EFEITO MEDIDO
--
-- Com estes tres fora, o alerta fica em silencio: "Desconto de Aula", o caso
-- que originou o sensor, esta em 30,9% desde o conserto de 21/08 e ja nao passa
-- do limiar de 20%. Silencio por merito, e nao por cegueira.
CREATE OR REPLACE FUNCTION public.fn_alerta_checkout_sem_rastreio()
RETURNS TABLE(codigo text, severidade text, titulo text, detalhe text)
LANGUAGE sql
STABLE
AS $function$
  WITH recentes AS (
    SELECT v.link_titulo,
           count(*)                                  AS vendas,
           count(v.ad_id_meta)                       AS com_ad_id,
           100.0 * count(v.ad_id_meta) / count(*)    AS pct,
           sum(v.valor_sem_juros)                    AS valor
      FROM vendas v
     WHERE v.status = 'aprovada'
       AND v.link_titulo IS NOT NULL
       AND v.pedido_id NOT LIKE 'TEST%'
       AND v.pedido_id NOT LIKE 'LC-%'
       AND (v.data_venda AT TIME ZONE 'America/Sao_Paulo')::date
             >= ((now() AT TIME ZONE 'America/Sao_Paulo')::date - 7)
     GROUP BY v.link_titulo
    HAVING count(*) >= 10
       AND 100.0 * count(v.ad_id_meta) / count(*) < 20
  ),
  -- Ignorado so quando ha linha DIZENDO que nao e trafego pago. Ausencia de
  -- linha nao ignora nada: checkout novo continua sendo acusado.
  classificados AS (
    SELECT r.*,
           EXISTS (SELECT 1 FROM checkouts_origem co
                    WHERE co.link_titulo = r.link_titulo
                      AND co.trafego_pago IS FALSE) AS origem_nao_paga
      FROM recentes r
  ),
  ignorados AS (SELECT count(*) AS n FROM classificados WHERE origem_nao_paga)
  SELECT 'checkout_sem_rastreio'::text,
         (CASE WHEN sum(c.valor) > 5000 THEN 'critico' ELSE 'atencao' END)::text,
         count(*)::text || ' checkout(s) recebendo venda sem dizer de que anúncio',
         string_agg(c.link_titulo || ' — ' || round(c.pct)::text || '% rastreado ('
                    || c.com_ad_id::text || ' de ' || c.vendas::text || ' vendas, '
                    || fn_brl(c.valor) || ')', '; ' ORDER BY c.valor DESC)
           || '. Nos últimos 7 dias. O link não repassa os parâmetros do anúncio ao checkout.'
           || CASE WHEN (SELECT n FROM ignorados) > 0
                   THEN ' (' || (SELECT n FROM ignorados)::text
                        || ' checkout(s) de origem não paga ficaram de fora, por'
                        || ' `checkouts_origem`.)'
                   ELSE '' END
    FROM classificados c
   WHERE NOT c.origem_nao_paga
  HAVING count(*) > 0;
$function$;

COMMENT ON FUNCTION public.fn_alerta_checkout_sem_rastreio() IS
  'Nomeia o checkout que recebe venda sem ad_id. Ignora os que checkouts_origem marca como trafego_pago = false (link da bio, suporte, oferta individual): esses nunca tiveram anuncio para rastrear. Checkout sem linha na tabela continua sendo acusado.';

-- A funcao recriada nasce com EXECUTE para PUBLIC e concessao direta para
-- `anon` pelas default privileges do Supabase -- e revogar de PUBLIC nao tira
-- a concessao direta. As duas linhas restauram a lista original.
REVOKE ALL ON FUNCTION public.fn_alerta_checkout_sem_rastreio() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_alerta_checkout_sem_rastreio() TO authenticated, service_role;
