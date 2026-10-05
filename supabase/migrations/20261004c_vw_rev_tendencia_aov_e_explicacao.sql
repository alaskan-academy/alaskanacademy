/*
  Três alarmes, e um conjunto de métricas que explica.

  ── Por que AOV vira o terceiro gatilho ──

  CPA e ROAS já estavam. AOV entra porque NÃO é consequência deles: ele cai
  quando o mix de oferta muda, e isso acontece com o ROAS firme — vende-se mais
  barato e mais vezes, e o painel não dizia nada. É um sinal com causa própria,
  que é o critério para merecer alarme.

  ── E por que as outras NÃO viram alarme ──

  São 10 REVs e três janelas. Com oito alarmes, a chance de pelo menos um REV
  ter pelo menos uma métrica caindo três vezes seguidas vira quase certeza, e
  aviso que aparece sempre é aviso que ninguém lê.

  Mais: elas não são independentes. Se a conversão do funil cai, o CPA sobe por
  consequência — alarme de conversão seria o mesmo alarme contado duas vezes.

  Então elas entram para dizer ONDE olhar depois que um alarme disparou, cada
  uma separando uma causa diferente:

    cpv                 o tráfego ficou caro  (vs. a página piorou)
    conv_funil_pct      menos gente chega ao checkout
    conv_checkout_pct   chega e não paga
    bump_adesao_pct     o bump parou de colar   → explica AOV
    upsell_adesao_pct   o upsell parou de colar → explica AOV
    margem_pct          a que cai com o ROAS SUBINDO, quando o mix muda

  Elas entram SÓ em `pontos`. As colunas c1/c2/c3 existem porque os booleanos
  precisam delas; duplicar o que já está na série seria o mesmo número em dois
  lugares, e eles divergiriam na primeira vez que alguém mexesse em um só.

  As colunas de AOV vão no FIM da lista, e não ao lado das de ROAS:
  `CREATE OR REPLACE VIEW` recusa inserir coluna no meio (42P16). Ordem feia,
  mas trocar por DROP + CREATE derrubaria a tela de quem estivesse com ela
  aberta no instante da migração.

  ── Duas coisas que este arquivo conserta, e nasceu devendo ───────────────

  Primeira: ele junta dois replaces aplicados com um minuto de diferença em
  04/10/2026 — um que só acrescentava as métricas de explicação e este, que
  acrescenta o AOV. O segundo substitui o primeiro por inteiro, e manter os
  dois seria um arquivo que ninguém precisa reproduzir.

  Segunda, e é a que custou: os dois foram aplicados DIRETO NO BANCO, sem
  arquivo no repo. `CREATE OR REPLACE VIEW` redefine as reloptions — omitir
  `with (security_invoker = on)` APAGA a opção que a 20260925a tinha ligado —,
  e a view passou a rodar com os direitos do dono, legível por `anon`, cuja
  chave vai inlinada no bundle. Com faturamento por REV dentro.

  O teste `view-nova-nao-fura-a-rls.test.ts` existe exatamente para pegar isso,
  e não pegou: ele lê ARQUIVO. Migração sem arquivo passa por fora da catraca
  inteira. A cláusula abaixo é o que faz o conserto sobreviver ao próximo
  replace; a 20261004i varre o que já havia escapado.
*/
CREATE OR REPLACE VIEW public.vw_rev_tendencia
WITH (security_invoker = on)
AS
 WITH janelas AS (
         SELECT 1 AS n, CURRENT_DATE - 42 AS ini, CURRENT_DATE - 29 AS fim
        UNION ALL SELECT 2, CURRENT_DATE - 28, CURRENT_DATE - 15
        UNION ALL SELECT 3, CURRENT_DATE - 14, CURRENT_DATE - 1
        ), ponto AS (
         SELECT f.id AS funil_id, f.nome AS rev, f.produto, j.n, j.ini, j.fim,
            retrato.metricas IS NOT NULL AS do_retrato,
            COALESCE(retrato.metricas, vivo.m) AS bloco
           FROM funis f
             CROSS JOIN janelas j
             LEFT JOIN LATERAL ( SELECT ai.metricas
                   FROM analise_itens ai
                     JOIN analises a ON a.id = ai.analise_id
                  WHERE ai.funil_id = f.id AND a.arquivada_em IS NULL
                    AND ((ai.metricas ->> 'fim'::text)::date) >= j.ini
                    AND ((ai.metricas ->> 'fim'::text)::date) <= j.fim
                  ORDER BY a.data DESC
                 LIMIT 1) retrato ON true
             CROSS JOIN LATERAL ( SELECT
                        CASE WHEN retrato.metricas IS NULL
                             THEN fn_metricas_do_rev(f.id, j.ini, j.fim)
                             ELSE NULL::jsonb END AS m) vivo
          WHERE f.ativo
        ), serie AS (
         SELECT ponto.funil_id, ponto.rev, ponto.produto,
            jsonb_agg(jsonb_build_object(
                'n', ponto.n, 'inicio', ponto.ini, 'fim', ponto.fim,
                'fonte', CASE WHEN ponto.do_retrato THEN 'analise' ELSE 'calculado' END,
                'investimento', ((ponto.bloco -> 'atual') ->> 'investimento')::numeric,
                'vendas', ((ponto.bloco -> 'atual') ->> 'vendas')::integer,
                'cpa',  ((ponto.bloco -> 'atual') ->> 'cpa')::numeric,
                'roas', ((ponto.bloco -> 'atual') ->> 'roas')::numeric,
                'aov',  ((ponto.bloco -> 'atual') ->> 'aov')::numeric,
                'cpv',               ((ponto.bloco -> 'atual') ->> 'cpv')::numeric,
                'conv_funil_pct',    ((ponto.bloco -> 'atual') ->> 'conv_funil_pct')::numeric,
                'conv_checkout_pct', ((ponto.bloco -> 'atual') ->> 'conv_checkout_pct')::numeric,
                'bump_adesao_pct',   ((ponto.bloco -> 'atual') ->> 'bump_adesao_pct')::numeric,
                'upsell_adesao_pct', ((ponto.bloco -> 'atual') ->> 'upsell_adesao_pct')::numeric,
                'margem_pct',        ((ponto.bloco -> 'atual') ->> 'margem_pct')::numeric
              ) ORDER BY ponto.n) AS pontos,
            min(((ponto.bloco -> 'atual') ->> 'investimento')::numeric) AS menor_investimento,
            max(((ponto.bloco -> 'atual') ->> 'cpa')::numeric)  FILTER (WHERE ponto.n = 1) AS cpa1,
            max(((ponto.bloco -> 'atual') ->> 'cpa')::numeric)  FILTER (WHERE ponto.n = 2) AS cpa2,
            max(((ponto.bloco -> 'atual') ->> 'cpa')::numeric)  FILTER (WHERE ponto.n = 3) AS cpa3,
            max(((ponto.bloco -> 'atual') ->> 'roas')::numeric) FILTER (WHERE ponto.n = 1) AS roas1,
            max(((ponto.bloco -> 'atual') ->> 'roas')::numeric) FILTER (WHERE ponto.n = 2) AS roas2,
            max(((ponto.bloco -> 'atual') ->> 'roas')::numeric) FILTER (WHERE ponto.n = 3) AS roas3,
            max(((ponto.bloco -> 'atual') ->> 'aov')::numeric)  FILTER (WHERE ponto.n = 1) AS aov1,
            max(((ponto.bloco -> 'atual') ->> 'aov')::numeric)  FILTER (WHERE ponto.n = 2) AS aov2,
            max(((ponto.bloco -> 'atual') ->> 'aov')::numeric)  FILTER (WHERE ponto.n = 3) AS aov3,
            count(*) FILTER (WHERE ponto.do_retrato) AS pontos_de_analise
           FROM ponto
          GROUP BY ponto.funil_id, ponto.rev, ponto.produto
        )
 SELECT funil_id, rev, produto, pontos, pontos_de_analise,
    round(menor_investimento, 2) AS menor_investimento,
    round(cpa1, 2)  AS cpa1,  round(cpa2, 2)  AS cpa2,  round(cpa3, 2)  AS cpa3,
    round(roas1, 2) AS roas1, round(roas2, 2) AS roas2, round(roas3, 2) AS roas3,
    menor_investimento >= 1000::numeric AND cpa1  IS NOT NULL AND cpa2  > cpa1  AND cpa3  > cpa2  AS cpa_piorando,
    menor_investimento >= 1000::numeric AND roas1 IS NOT NULL AND roas2 < roas1 AND roas3 < roas2 AS roas_piorando,
    round(aov1, 2)  AS aov1,  round(aov2, 2)  AS aov2,  round(aov3, 2)  AS aov3,
    -- AOV caindo é pior, igual ao ROAS. O mesmo piso de investimento vale:
    -- ticket de um REV que gastou R$ 80 na janela é ruído, não tendência.
    menor_investimento >= 1000::numeric AND aov1  IS NOT NULL AND aov2  < aov1  AND aov3  < aov2  AS aov_piorando
   FROM serie;
