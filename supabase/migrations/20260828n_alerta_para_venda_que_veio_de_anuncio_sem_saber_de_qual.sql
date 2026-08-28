-- ── O alerta que faltava: veio de anuncio, mas de qual? ───────────────────
--
-- Em 01/07/2026 o checkout "Saponaria Brasil - Desconto de Aula" parou de
-- receber UTM. Junho fechou com 0% das vendas da conta Saponaria sem UTM;
-- julho fechou com 99,7%. Sao R$ 36.928,99 em julho e R$ 51.580,61 em agosto
-- que entraram sem dizer de que anuncio vieram.
--
-- Existia um alerta para isso -- `receita_sem_rastreio` -- e ele NAO disparou
-- uma vez sequer em oito semanas. Ele mede
--
--   ad_id_meta IS NULL AND trafego_pago IS NOT TRUE
--
-- e as 565 vendas cegas de agosto estao todas com `trafego_pago = true`, posto
-- pelo gatilho `trg_fn_marcar_trafego_sem_utm`. O remendo que fez o Resumo
-- classificar essas vendas como trafego pago -- para o segmento nao parecer
-- deficitario -- desligou junto o unico sensor que denunciaria a falta de
-- rastreio. Tratou-se o sintoma e o termometro foi no mesmo saco.
--
-- Semana a semana, o que o alerta viu e o que estava acontecendo:
--
--   janela ate   alerta   sem anuncio identificado
--   07/07         7,6%    54,1%
--   14/07         7,3%    39,3%
--   28/07         5,2%    42,0%
--   11/08        11,6%    56,1%
--   18/08         9,0%    54,8%
--
-- Este alerta novo mede a contradicao diretamente: venda marcada como trafego
-- pago E sem `ad_id_meta`. Sao coisas diferentes -- "veio de anuncio" e "sei
-- qual anuncio" --, e tratar a primeira como se respondesse a segunda foi o
-- que criou o silencio.
--
-- O limiar de 10% teria disparado em TODAS as oito semanas: o menor valor do
-- periodo foi 19,5% e o maior 46,5%. Hoje a janela esta em 6,3%, porque em
-- 21/08 alguem restabeleceu a marcacao de uma das campanhas -- entao o alerta
-- nasce em silencio por merito, e nao por cegueira.
--
-- O `receita_sem_rastreio` fica como esta, de proposito: ele responde outra
-- pergunta -- "receita de origem totalmente desconhecida" -- e mudar a conta
-- dele faria os dois medirem a mesma coisa.
CREATE OR REPLACE FUNCTION public.fn_alerta_trafego_sem_anuncio()
RETURNS TABLE(codigo text, severidade text, titulo text, detalhe text)
LANGUAGE sql
STABLE
AS $function$
  WITH j AS (
    SELECT
      100.0 * sum(valor_sem_juros) FILTER (WHERE ad_id_meta IS NULL AND trafego_pago)
        / nullif(sum(valor_sem_juros), 0)                              AS pct,
      sum(valor_sem_juros) FILTER (WHERE ad_id_meta IS NULL AND trafego_pago) AS valor,
      count(*) FILTER (WHERE ad_id_meta IS NULL AND trafego_pago)      AS vendas
    FROM vendas
    WHERE status = 'aprovada'
      AND is_upsell IS NOT TRUE
      AND (data_venda AT TIME ZONE 'America/Sao_Paulo')::date
            >= ((now() AT TIME ZONE 'America/Sao_Paulo')::date - 7)
  )
  SELECT 'trafego_sem_anuncio'::text,
         (CASE WHEN j.pct > 25 THEN 'critico' ELSE 'atencao' END)::text,
         round(j.pct)::text || '% da receita veio de anúncio sem dizer de qual',
         fn_brl(j.valor) || ' em ' || j.vendas::text
           || ' venda(s) nos últimos 7 dias estão marcadas como tráfego pago e sem ad_id. '
           || 'O checkout não recebeu os parâmetros do anúncio — sem eles, não dá para saber '
           || 'qual campanha pagou por essa venda.'
    FROM j
   WHERE j.pct > 10;
$function$;

COMMENT ON FUNCTION public.fn_alerta_trafego_sem_anuncio() IS
  'Venda marcada como trafego pago e sem ad_id_meta: veio de anuncio e nao se sabe de qual. Cobre o buraco que deixava receita_sem_rastreio em silencio.';

REVOKE ALL ON FUNCTION public.fn_alerta_trafego_sem_anuncio() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_alerta_trafego_sem_anuncio() TO authenticated, service_role;

-- A view ganha o ramo novo sem ser transcrita a mao: o texto atual vira base e
-- o UNION e acrescentado. Transcrever 120 linhas de UNION para acrescentar uma
-- e o tipo de operacao em que se perde um ramo sem perceber.
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_viewdef('public.vw_alertas'::regclass, true) INTO v_def;

  IF v_def LIKE '%fn_alerta_trafego_sem_anuncio%' THEN
    RAISE NOTICE 'ramo ja presente, nada a fazer';
    RETURN;
  END IF;

  v_def := rtrim(btrim(v_def), ';');

  EXECUTE 'CREATE OR REPLACE VIEW public.vw_alertas AS ' || v_def ||
          ' UNION ALL SELECT t.codigo, t.severidade, t.titulo, t.detalhe' ||
          '   FROM fn_alerta_trafego_sem_anuncio() t(codigo, severidade, titulo, detalhe)';
END $$;
