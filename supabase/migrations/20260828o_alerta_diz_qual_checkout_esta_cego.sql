-- ── O alerta passa a dizer QUAL checkout esta cego ────────────────────────
--
-- Correcao de rota, e a data que eu dei antes estava errada.
--
-- Eu disse que em 01/07/2026 o checkout "Saponaria Brasil - Desconto de Aula"
-- parou de receber UTM. Nao parou: ele NUNCA mandou. Olhando por checkout em
-- vez de por conta:
--
--   mai/26   119 vendas   R$  11.318,59   0% com ad_id   (sem conta atribuida)
--   jun/26   162 vendas   R$  14.330,01   0%             (sem conta atribuida)
--   jul/26   388 vendas   R$  36.928,99   0%             ja atribuidas a Saponaria
--   ago/26   691 vendas   R$  61.611,05   20,4%          Saponaria
--
-- O que mudou em julho nao foi o rastreio, foi a ATRIBUICAO DE CONTA: as
-- vendas desse checkout passaram a ser ligadas a conta Saponaria, e so por
-- isso apareceram no meu recorte por conta. Antes existiam igual, sem conta.
--
-- Desde 20/05, quando o checkout nasceu: 1.272 de 1.413 vendas sem ad_id,
-- R$ 116.443,13.
--
-- Isso muda o sensor certo. Um detector de QUEDA nao serviria: nao houve queda,
-- houve um checkout que entrou em producao sem rastreio nenhum e foi crescendo
-- -- que e a quarta armadilha do CLAUDE.md ao contrario, uma coisa nova que
-- entrou e ninguem conferiu.
--
-- A regra e simples e olha o presente, nao a variacao: checkout com pelo menos
-- 10 vendas em 7 dias e menos de 20% delas com `ad_id_meta`. Simulada semana a
-- semana contra o historico real, de 28/06 a 23/08:
--
--   * "Desconto de Aula" dispararia em TODAS as janelas de 28/06 a 16/08, e
--     para de disparar em 23/08 (30,9%) -- exatamente quando o conserto entrou;
--   * todos os outros checkouts ficaram entre 88% e 100%: nenhum falso
--     positivo em oito semanas;
--   * e aparece um segundo culpado que ninguem tinha visto -- "Seguidoras -
--     Saponaria Brasil", 0% com 10 a 12 vendas por semana, cego ate hoje.
--
-- Nomear o checkout e o ponto. O alerta que existia falava em porcentagem da
-- receita total; com o nome, a pessoa sabe onde mexer no mesmo dia.
CREATE OR REPLACE FUNCTION public.fn_alerta_checkout_sem_rastreio()
RETURNS TABLE(codigo text, severidade text, titulo text, detalhe text)
LANGUAGE sql
STABLE
AS $function$
  WITH por_checkout AS (
    SELECT v.link_titulo,
           count(*)                                              AS vendas,
           count(v.ad_id_meta)                                   AS com_ad_id,
           100.0 * count(v.ad_id_meta) / count(*)                AS pct,
           sum(v.valor_sem_juros)                                AS valor
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
  )
  SELECT 'checkout_sem_rastreio'::text,
         (CASE WHEN sum(valor) > 5000 THEN 'critico' ELSE 'atencao' END)::text,
         count(*)::text || ' checkout(s) recebendo venda sem dizer de que anúncio',
         string_agg(link_titulo || ' — ' || round(pct)::text || '% rastreado ('
                    || com_ad_id::text || ' de ' || vendas::text || ' vendas, '
                    || fn_brl(valor) || ')', '; ' ORDER BY valor DESC)
           || '. Nos últimos 7 dias. O link não repassa os parâmetros do anúncio ao checkout.'
    FROM por_checkout
  HAVING count(*) > 0;
$function$;

COMMENT ON FUNCTION public.fn_alerta_checkout_sem_rastreio() IS
  'Nomeia o checkout que recebe venda sem ad_id. Olha o presente e nao a variacao, porque o caso real nao foi queda: o checkout nasceu sem rastreio e cresceu assim.';

REVOKE ALL ON FUNCTION public.fn_alerta_checkout_sem_rastreio() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_alerta_checkout_sem_rastreio() TO authenticated, service_role;

DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_viewdef('public.vw_alertas'::regclass, true) INTO v_def;

  IF v_def LIKE '%fn_alerta_checkout_sem_rastreio%' THEN
    RAISE NOTICE 'ramo ja presente, nada a fazer';
    RETURN;
  END IF;

  v_def := rtrim(btrim(v_def), ';');

  EXECUTE 'CREATE OR REPLACE VIEW public.vw_alertas AS ' || v_def ||
          ' UNION ALL SELECT c.codigo, c.severidade, c.titulo, c.detalhe' ||
          '   FROM fn_alerta_checkout_sem_rastreio() c(codigo, severidade, titulo, detalhe)';
END $$;
