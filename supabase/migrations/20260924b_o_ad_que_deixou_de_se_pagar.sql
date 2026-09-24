-- O AD QUE DEIXOU DE SE PAGAR — "acusar AD morrendo"
--
-- Pedido dela. A palavra e "morrendo", e a primeira tentacao e medir queda de
-- ROAS: caiu X%, acusa. Os dados dizem que isso erraria nos dois sentidos.
--
-- ── O QUE OS DADOS MOSTRARAM (medido em 24/09/2026) ────────────────────────
--
-- 102 anuncios gastaram nos ultimos 7 dias, e os 102 tambem gastaram nos 7
-- anteriores — entao comparar cada um consigo mesmo e possivel. Mas so 28
-- tinham 3+ vendas na janela anterior e so 20 tinham as 6 que o crivo exige.
-- Fora dessa base, "caiu" e ruido: 2 vendas viram 1 e o ROAS despenca 50%.
--
-- Tres formas aparecem nos dados, e so uma e noticia:
--
--   AD 083 H06 V01   R$ 337 -> R$ 298   ROAS 3,80 -> 0,65   <- MORRENDO
--   AD 045 H05 V01   R$ 347 -> R$ 1.571 ROAS 2,30 -> 0,58   <- MORRENDO (escalou e quebrou)
--   AD 006 H01 V01   R$ 763 -> R$ 99    ROAS 2,26 -> 0,00   <- ela JA MATOU
--   AD 010 H01 V05   R$ 108 -> R$ 824   ROAS 4,09 -> 2,24   <- so decaiu na escala, ainda paga
--
-- O terceiro e o que condena a regra ingenua: o ROAS caiu 100%, mas o gasto caiu
-- 87% junto — ela ja cortou. Acusar seria dar noticia velha, e noticia velha
-- todo dia e como o aviso morre. O quarto mostra que cair NAO basta: 4,09 para
-- 2,24 e decaimento normal de escala, e 2,24 continua acima do empate.
--
-- ── A REGRA, E DE ONDE CADA NUMERO VEM ─────────────────────────────────────
--
--   inv_7 >= 100              tem dinheiro em jogo; abaixo disso nao vale acordar
--                             ninguem (a mediana de quem gasta e ~R$ 200/semana)
--   inv_7 >= 0.40 * inv_ant   ela ainda NAO cortou. Os 5 casos "ja matei" do
--                             periodo estavam todos abaixo de 25%
--   vd_ant >= 6               a base do CRIVO: com 6 vendas a decisao acerta 86%,
--                             com 4 acerta 71%, que e quase cara-ou-coroa
--   roas_7 < 1.6              o EMPATE medido em 06/09/2026 (taxa Payt 6,1% +
--                             reembolso 1,7% + Simples 9% + 14% sobre a midia +
--                             R$ 25.000/mes de custo fixo). Mora em `CRIVO` na
--                             AvaliacaoView, e ha teste ligando os dois
--   roas_7 <= 0.70 * roas_ant caiu de verdade. Sem isto, um anuncio que sempre
--                             rendeu 0,5 apareceria todo dia sem nunca ter morrido
--
-- Resultado hoje: 6 anuncios de 102, somando R$ 7.214 gastos em 7 dias sem se
-- pagar. Seis e alerta; sessenta seria papel de parede.
--
-- ── POR QUE NAO E UMA `situacao` ───────────────────────────────────────────
--
-- `vw_meta_status.situacao` responde "este anuncio esta entregando?". Isto
-- responde "este anuncio esta se pagando?". Sao duas perguntas, e enfiar a
-- segunda no vocabulario da primeira faria um anuncio ter de escolher entre
-- dizer "Rodando" e dizer "morrendo" — sendo que o caso que importa e
-- exatamente o que e as duas coisas. Primeira armadilha do CLAUDE.md. Por isso
-- view propria, e bloco proprio na tela.

-- DROP e nao CREATE OR REPLACE: `empresa_id` entra no MEIO da lista de colunas,
-- e o REPLACE so aceita coluna nova no fim. A view nasceu nesta mesma migracao
-- e nada depende dela, entao derrubar e recriar nao alcanca ninguem.
DROP VIEW IF EXISTS public.vw_ad_morrendo;
CREATE VIEW public.vw_ad_morrendo
  WITH (security_invoker = on) AS
WITH midia AS (
  SELECT m.ad_id,
         sum(m.investimento) FILTER (WHERE m.data >= CURRENT_DATE - 7) AS inv_7,
         sum(m.investimento) FILTER (WHERE m.data >= CURRENT_DATE - 14
                                       AND m.data <  CURRENT_DATE - 7)  AS inv_ant
    FROM metricas_meta m
   WHERE m.nivel = 'ad'::nivel_meta AND m.data >= CURRENT_DATE - 14
   GROUP BY m.ad_id
), receita AS (
  /* A venda vem da PAYT, nunca do Meta: a janela de atribuicao de 7 dias da
     Meta credita venda de backend ao anuncio de topo e infla o ROAS de quem
     esta no comeco do funil. Mesma razao pela qual o CRIVO foi calibrado na
     Payt. E `valor_sem_juros` porque juros de parcelamento nao sao resultado
     do anuncio — ver a conferencia dos relatorios em 24/09/2026. */
  SELECT v.ad_id_meta AS ad_id,
         count(*)                FILTER (WHERE v.data_venda >= CURRENT_DATE - 7) AS vd_7,
         sum(v.valor_sem_juros)  FILTER (WHERE v.data_venda >= CURRENT_DATE - 7) AS rec_7,
         count(*)                FILTER (WHERE v.data_venda >= CURRENT_DATE - 14
                                           AND v.data_venda <  CURRENT_DATE - 7) AS vd_ant,
         sum(v.valor_sem_juros)  FILTER (WHERE v.data_venda >= CURRENT_DATE - 14
                                           AND v.data_venda <  CURRENT_DATE - 7) AS rec_ant
    FROM vendas v
   WHERE v.ad_id_meta IS NOT NULL
     AND v.status = 'aprovada'
     AND v.data_venda >= CURRENT_DATE - 14
   GROUP BY v.ad_id_meta
), calc AS (
  SELECT mi.ad_id,
         o.nome,
         o.ad_account_id,
         c.nome AS conta,
         /* A empresa DERIVA do projeto da conta, lida agora — e o mecanismo que o
            CLAUDE.md manda usar para trabalho, ao contrario do dinheiro, que
            carimba. Sem isto o bloco mostraria anuncio da Alaskan com a Aeliss
            escolhida no cabecalho. */
         oe.empresa_id,
         pa.producao_id,
         mi.inv_7, mi.inv_ant,
         coalesce(r.vd_7, 0)   AS vd_7,
         coalesce(r.vd_ant, 0) AS vd_ant,
         coalesce(r.rec_7, 0)   / nullif(mi.inv_7, 0)   AS roas_7,
         coalesce(r.rec_ant, 0) / nullif(mi.inv_ant, 0) AS roas_ant
    FROM midia mi
    LEFT JOIN receita r      ON r.ad_id = mi.ad_id
    LEFT JOIN meta_objetos o ON o.objeto_id = mi.ad_id AND o.nivel = 'ad'::nivel_meta
    LEFT JOIN ad_accounts c  ON c.id = o.ad_account_id
    LEFT JOIN ofertas_editores oe ON oe.id = c.projeto_id
    LEFT JOIN producao_ads pa ON pa.ad_id = mi.ad_id
   WHERE mi.inv_7 > 0
)
SELECT ad_id,
       nome,
       ad_account_id,
       conta,
       empresa_id,
       producao_id,
       round(inv_ant, 2)  AS gasto_antes,
       vd_ant             AS vendas_antes,
       round(roas_ant, 2) AS roas_antes,
       round(inv_7, 2)    AS gasto_agora,
       vd_7               AS vendas_agora,
       round(roas_7, 2)   AS roas_agora,
       round(100 * (roas_7 - roas_ant) / nullif(roas_ant, 0), 0)::int AS queda_pct
  FROM calc
 WHERE inv_7   >= 100
   AND inv_7   >= 0.40 * inv_ant
   AND vd_ant  >= 6
   AND roas_7  <  1.6
   AND roas_7  <= 0.70 * roas_ant;

COMMENT ON VIEW public.vw_ad_morrendo IS
  'Anuncio que ainda come verba e deixou de se pagar: gasto mantido, base de 6+ vendas na semana anterior, ROAS agora abaixo do empate 1,6 e ao menos 30% menor que o proprio. Ver 20260924b.';

-- ── As provas ───────────────────────────────────────────────────────────────
DO $prova$
DECLARE
  v_n int; v_gastando int; v_ruim int;
BEGIN
  SELECT count(*) INTO v_n FROM public.vw_ad_morrendo;

  -- 1. Nem morto nem parede. Zero significa regra que nunca casa; muitos
  --    significam aviso que fica sempre aceso, e aviso sempre aceso o olho
  --    para de ver — foi o erro que a migracao 20260924a evitou no `parado`.
  SELECT count(*) INTO v_gastando
    FROM metricas_meta m
   WHERE m.nivel = 'ad'::nivel_meta AND m.data >= CURRENT_DATE - 7 AND m.investimento > 0;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'vw_ad_morrendo nao acusa ninguem — a regra nasceu morta';
  END IF;

  SELECT count(DISTINCT m.ad_id) INTO v_gastando
    FROM metricas_meta m
   WHERE m.nivel = 'ad'::nivel_meta AND m.data >= CURRENT_DATE - 7 AND m.investimento > 0;
  IF v_n > greatest(25, v_gastando / 4) THEN
    RAISE EXCEPTION '% de % anuncios que gastam — ambar demais para ser aviso', v_n, v_gastando;
  END IF;

  -- 2. Ninguem que ela JA cortou pode aparecer. Nao e tautologia do `where`:
  --    guarda contra alguem afrouxar o 0.40 sem perceber que isso devolve a
  --    noticia velha para a tela.
  SELECT count(*) INTO v_ruim
    FROM public.vw_ad_morrendo WHERE gasto_agora < 0.40 * gasto_antes;
  IF v_ruim <> 0 THEN
    RAISE EXCEPTION '% anuncios acusados que ela ja tinha cortado', v_ruim;
  END IF;

  -- 3. Nenhum acusado pode estar acima do empate: o aviso diz "deixou de se
  --    pagar", e 1,6 e onde se paga.
  SELECT count(*) INTO v_ruim FROM public.vw_ad_morrendo WHERE roas_agora >= 1.6;
  IF v_ruim <> 0 THEN
    RAISE EXCEPTION '% anuncios acusados que ainda se pagam', v_ruim;
  END IF;

  -- 4. Um anuncio so pode aparecer uma vez. `producao_ads` e um-para-um por
  --    ad_id (ha unique la), mas se isso mudar a tela contaria o mesmo anuncio
  --    duas vezes e o total em reais sairia dobrado.
  SELECT count(*) INTO v_ruim FROM (
    SELECT ad_id FROM public.vw_ad_morrendo GROUP BY ad_id HAVING count(*) > 1
  ) d;
  IF v_ruim <> 0 THEN
    RAISE EXCEPTION '% anuncios duplicados na view', v_ruim;
  END IF;

  -- 5. A aritmetica fecha: quem tem queda registrada caiu mesmo.
  SELECT count(*) INTO v_ruim
    FROM public.vw_ad_morrendo WHERE queda_pct IS NOT NULL AND queda_pct >= 0;
  IF v_ruim <> 0 THEN
    RAISE EXCEPTION '% anuncios com queda_pct nao-negativa entre os acusados', v_ruim;
  END IF;

  RAISE NOTICE 'vw_ad_morrendo: % anuncios de % que gastaram na semana', v_n, v_gastando;
END
$prova$;

NOTIFY pgrst, 'reload schema';
