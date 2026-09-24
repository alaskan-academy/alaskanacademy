-- A MÉTRICA QUE PIORA HÁ TRÊS JANELAS SEGUIDAS
--
-- Pedido dela: "acusar tendências de aumento no decorrer das análises, como o
-- CPA aumentando nas últimas 3 análises".
--
-- ── O QUE NÃO DAVA PARA FAZER, E POR QUÊ ───────────────────────────────────
--
-- Ler as três últimas ANÁLISES é impossível hoje: há 2 rodadas (26/08 e 08/09),
-- nenhuma fechada, 7 itens e 7 REVs distintos — cada REV foi analisado
-- exatamente UMA vez, e a rodada de 26/08 está vazia. Nenhum REV tem duas
-- análises, quanto mais três. No ritmo quinzenal seriam ~6 semanas até a
-- primeira série existir.
--
-- Ela escolheu, sabendo do risco: a série usa o RETRATO quando ele existe e a
-- janela RECALCULADA quando não. São duas fontes alimentando o mesmo número —
-- a primeira armadilha do CLAUDE.md — e a mitigação é que cada ponto carrega
-- `fonte`, para a tela nunca esconder qual verdade é qual.
--
-- ── A JANELA É FIXA, E ISSO NÃO É DETALHE ──────────────────────────────────
--
-- Três janelas de 14 dias andando para trás a partir de ontem. Fixas porque o
-- módulo já tem a regra: "comparar sempre com o período anterior de mesmo
-- tamanho". Um retrato de 15 dias comparado a um de 14 distorceria qualquer
-- valor absoluto — e ainda que CPA e ROAS sejam razões e aguentem melhor, a
-- comparação deixaria de ser entre iguais.
--
-- O retrato entra na janela em que o `fim` dele cai. O da rodada de 08/09
-- (24/08 a 07/09) cai na janela do meio, então a série de hoje já mistura as
-- duas fontes de verdade — e dá para conferir as duas na tela.
--
-- ── O PISO DE GASTO, MEDIDO ────────────────────────────────────────────────
--
-- Ela pediu para acusar só quando o dinheiro for relevante. R$ 1.000 por
-- janela, e o número saiu dos dados de 24/09/2026:
--
--   REV3 · Guia          1.639 -> 316     CPA 71 -> 316   <- "quadruplicou" sobre 1 venda
--   REV9 · Saponaria       213 -> 3.337   CPA 53 -> 98    <- estava subindo, não piorando
--   REV5-VSL · Velas       489 -> 1.294   CPA 244 -> 216
--   REV1-Orig · Velas    7.736 -> 10.736 -> 16.426  CPA 65 -> 70 -> 75  <- ESTE
--
-- Abaixo de mil reais por quinzena a razão vira ruído: o CPA do REV3 multiplicou
-- por quatro porque o denominador caiu de 23 vendas para 1. Com o piso, sobram
-- 4 REVs com série completa e apenas 1 acusado.
--
-- ── POR QUE MONOTÔNICO, E NÃO "CAIU X%" ────────────────────────────────────
--
-- Porque é o que ela descreveu: piorando A CADA análise, não "pior do que
-- antes". Três pioras seguidas é raro por acaso e fácil de explicar; um limiar
-- percentual precisaria ser defendido, e acusaria o REV3-VSL (60 -> 70 -> 65),
-- que subiu, desceu e não está morrendo.
--
-- Hoje, de 8 REVs com gasto: 1 acusado — REV1 - Original · Velas Lembrancinhas,
-- CPA subindo enquanto o investimento dobra. Escalar o que piora é o erro caro.
--
-- ── O NOME DO REV NÃO IDENTIFICA O REV ─────────────────────────────────────
--
-- Há CINCO funis chamados "REV1 - Original", um por produto. A primeira medição
-- que fiz agrupou por nome e somou funis diferentes; o resultado parecia certo
-- e estava errado. A view devolve `produto` junto, e a tela tem de mostrar os
-- dois — "REV1 - Original" sozinho é ambíguo em 5 lugares.

CREATE OR REPLACE VIEW public.vw_rev_tendencia
  WITH (security_invoker = on) AS
WITH janelas AS (
  /* 1 = mais antiga, 3 = a que terminou ontem. Ontem, e não hoje: dia em curso
     entra pela metade e faz toda métrica parecer pior. */
  SELECT 1 AS n, (CURRENT_DATE - 42) AS ini, (CURRENT_DATE - 29) AS fim
  UNION ALL SELECT 2, (CURRENT_DATE - 28), (CURRENT_DATE - 15)
  UNION ALL SELECT 3, (CURRENT_DATE - 14), (CURRENT_DATE - 1)
), ponto AS (
  SELECT f.id   AS funil_id,
         f.nome AS rev,
         f.produto,
         j.n,
         j.ini, j.fim,
         /* O RETRATO TEM PREFERÊNCIA. `fim` dele dentro da janela é o critério:
            é a análise daquele pedaço de tempo, ainda que os dias não batam
            exatamente. */
         retrato.metricas IS NOT NULL AS do_retrato,
         coalesce(retrato.metricas, vivo.m) AS bloco
    FROM funis f
    CROSS JOIN janelas j
    LEFT JOIN LATERAL (
      SELECT ai.metricas
        FROM analise_itens ai
        JOIN analises a ON a.id = ai.analise_id
       WHERE ai.funil_id = f.id
         AND a.arquivada_em IS NULL
         AND (ai.metricas->>'fim')::date BETWEEN j.ini AND j.fim
       ORDER BY a.data DESC
       LIMIT 1
    ) retrato ON true
    CROSS JOIN LATERAL (
      SELECT CASE WHEN retrato.metricas IS NULL
                  THEN public.fn_metricas_do_rev(f.id, j.ini, j.fim)
             END AS m
    ) vivo
   WHERE f.ativo
), serie AS (
  SELECT funil_id, rev, produto,
         jsonb_agg(
           jsonb_build_object(
             'n', n, 'inicio', ini, 'fim', fim,
             'fonte', CASE WHEN do_retrato THEN 'analise' ELSE 'calculado' END,
             'investimento', (bloco->'atual'->>'investimento')::numeric,
             'vendas',       (bloco->'atual'->>'vendas')::int,
             'cpa',          (bloco->'atual'->>'cpa')::numeric,
             'roas',         (bloco->'atual'->>'roas')::numeric
           ) ORDER BY n
         ) AS pontos,
         min((bloco->'atual'->>'investimento')::numeric) AS menor_investimento,
         max((bloco->'atual'->>'cpa')::numeric)  FILTER (WHERE n = 1) AS cpa1,
         max((bloco->'atual'->>'cpa')::numeric)  FILTER (WHERE n = 2) AS cpa2,
         max((bloco->'atual'->>'cpa')::numeric)  FILTER (WHERE n = 3) AS cpa3,
         max((bloco->'atual'->>'roas')::numeric) FILTER (WHERE n = 1) AS roas1,
         max((bloco->'atual'->>'roas')::numeric) FILTER (WHERE n = 2) AS roas2,
         max((bloco->'atual'->>'roas')::numeric) FILTER (WHERE n = 3) AS roas3,
         count(*) FILTER (WHERE do_retrato) AS pontos_de_analise
    FROM ponto
   GROUP BY funil_id, rev, produto
)
SELECT funil_id, rev, produto, pontos, pontos_de_analise,
       round(menor_investimento, 2) AS menor_investimento,
       round(cpa1, 2) AS cpa1, round(cpa2, 2) AS cpa2, round(cpa3, 2) AS cpa3,
       round(roas1, 2) AS roas1, round(roas2, 2) AS roas2, round(roas3, 2) AS roas3,
       /* CPA subindo três vezes = piorando. ROAS caindo três vezes = piorando.
          A direção de cada métrica já está declarada em `LINHAS_COMPARACAO`
          (`subirEhRuim`), e aqui ela é repetida de propósito: o banco não lê
          TypeScript. `src/test/analises-tendencia.test.ts` liga as duas pontas. */
       (menor_investimento >= 1000
        AND cpa1 IS NOT NULL AND cpa2 > cpa1 AND cpa3 > cpa2)   AS cpa_piorando,
       (menor_investimento >= 1000
        AND roas1 IS NOT NULL AND roas2 < roas1 AND roas3 < roas2) AS roas_piorando
  FROM serie;

COMMENT ON VIEW public.vw_rev_tendencia IS
  'Tres janelas de 14 dias por REV, retrato da analise quando existe e calculo quando nao. Acusa metrica que piorou nas TRES, com piso de R$ 1.000 por janela. Ver 20260924c.';

-- ── As provas ───────────────────────────────────────────────────────────────
DO $prova$
DECLARE
  v_total int; v_acusados int; v_ruim int; v_fontes int;
BEGIN
  SELECT count(*) INTO v_total FROM public.vw_rev_tendencia;
  IF v_total = 0 THEN
    RAISE EXCEPTION 'vw_rev_tendencia vazia — nenhum funil ativo entrou na serie';
  END IF;

  -- 1. Toda serie tem exatamente TRES pontos. Menos que isso e janela que nao
  --    casou, e uma serie de dois comparada com uma de tres nao e comparavel.
  SELECT count(*) INTO v_ruim
    FROM public.vw_rev_tendencia WHERE jsonb_array_length(pontos) <> 3;
  IF v_ruim <> 0 THEN
    RAISE EXCEPTION '% REVs com serie de tamanho diferente de 3', v_ruim;
  END IF;

  -- 2. Ninguem abaixo do piso pode ser acusado: e a escolha dela, e e o que
  --    separa "piorou" de "o denominador virou 1 venda".
  SELECT count(*) INTO v_ruim FROM public.vw_rev_tendencia
   WHERE (cpa_piorando OR roas_piorando) AND menor_investimento < 1000;
  IF v_ruim <> 0 THEN
    RAISE EXCEPTION '% acusados abaixo do piso de gasto', v_ruim;
  END IF;

  -- 3. Acusacao de CPA exige as tres subidas de verdade. Guarda contra alguem
  --    trocar o `>` por `>=` e passar a acusar serie parada.
  SELECT count(*) INTO v_ruim FROM public.vw_rev_tendencia
   WHERE cpa_piorando AND NOT (cpa3 > cpa2 AND cpa2 > cpa1);
  IF v_ruim <> 0 THEN
    RAISE EXCEPTION '% acusados de CPA sem as tres subidas', v_ruim;
  END IF;

  -- 4. Nem parede nem deserto. Se um dia TODOS os REVs aparecerem, o problema
  --    nao e o mundo: e a regra ter afrouxado.
  SELECT count(*) INTO v_acusados FROM public.vw_rev_tendencia
   WHERE cpa_piorando OR roas_piorando;
  IF v_acusados > greatest(3, v_total / 2) THEN
    RAISE EXCEPTION '% de % REVs acusados — a regra afrouxou', v_acusados, v_total;
  END IF;

  -- 5. As DUAS fontes aparecem hoje. Nao e decorativo: e a unica prova de que o
  --    caminho do retrato nao esta morto — se ele nunca casasse, a view seria
  --    so recalculo com um nome enganoso.
  SELECT count(*) INTO v_fontes FROM public.vw_rev_tendencia WHERE pontos_de_analise > 0;
  IF v_fontes = 0 THEN
    RAISE EXCEPTION 'nenhum ponto veio de retrato — o caminho da analise nunca casa';
  END IF;

  RAISE NOTICE 'vw_rev_tendencia: % REVs, % acusados, % com ao menos um ponto de analise',
    v_total, v_acusados, v_fontes;
END
$prova$;

NOTIFY pgrst, 'reload schema';
