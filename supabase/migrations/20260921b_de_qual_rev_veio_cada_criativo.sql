-- DE QUAL REV VEIO CADA CRIATIVO
--
-- Primeiro passo da area de ADs por funil. SO VIEW: nenhuma coluna criada,
-- nenhuma apagada, nada renomeado. A ordem e proposital — a derivacao precisa
-- provar que funciona antes de qualquer DDL destrutivo, e depois disso as duas
-- colunas mortas saem com a consciencia limpa.
--
-- O PEDIDO ERA "MULTISELECT DE FUNIL", E O QUE EXISTE HOJE E UM FILTRO QUE MENTE
--
-- O multiselect ja existe em duas telas (AvaliacaoView e PorProjetoView) e
-- filtra por `producoes.funil_ids` — que esta vazio em 4.098 de 4.098 cards.
-- Selecionar qualquer funil ali esvazia a lista, sem erro nenhum na tela.
-- `producoes.funil_id` esta igualmente em 0 de 4.098. Sao dois campos mortos
-- para uma pergunta que ninguem conseguia responder.
--
-- O CAMINHO QUE EXISTE: VENDA -> CONJUNTO -> CAMPANHA
--
-- A ponte venda->REV ja funciona (`vendas.funil_id`, 4.465 vendas aprovadas
-- preenchidas), e `vendas.ad_id_meta` -> `producao_ads.ad_id` -> `producao_id`
-- fecha o caminho ate o card. Tres degraus, do mais certo ao menos certo,
-- medidos em 21/09/2026:
--
--   1. por VENDA do proprio anuncio        194 cards
--   2. por CONJUNTO dominante              199 cards
--   3. por CAMPANHA dominante              442 cards
--   cascata inteira                        457 cards em 11 REVs
--
-- Cada card fica no degrau MAIS FORTE que o alcanca — quem tem venda propria
-- nao herda da campanha. A coluna `origem` leva isso para a tela: "por venda" e
-- "por campanha" nao sao a mesma afirmacao, e a celula tem que dizer qual e.
--
-- POR QUE DOMINANCIA EXIGE PERCENTUAL **E** VOLUME
--
-- >= 80% sozinho deixa passar conjunto com 2 vendas, onde uma unica venda
-- decide o REV. Por isso tambem >= 10 vendas atribuidas. Isso importa mais aqui
-- do que pareceria: as contas Saponaria sao ~40% da verba e a Meta so casa 24%
-- e 0% das compras delas, entao uma dominancia nessas contas sai de uma
-- minoria. O selo de origem e o piso de volume sao o que impede a tela de
-- afirmar com forca o que o dado so sussurra.
--
-- O QUE A CASCATA NAO ALCANCA, E QUE PRECISA APARECER NA TELA
--
-- 2.459 dos 2.980 cards postados nunca viraram anuncio — para eles a resposta
-- certa e "nao rodou", nunca um REV chutado. E 27 dos 35 projetos nao tem REV
-- nenhum cadastrado: os 33 REVs cobrem 8 projetos. Uma tela cujo eixo fosse so
-- REV esconderia a maior parte do estoque, e foi por isso que o desenho virou
-- "projeto na linha, REV na coluna, mais uma coluna obrigatoria sem REV".
--
-- A SEGUNDA VIEW: "DESCARTADO" DERIVADO, NUNCA DIGITADO
--
-- Campo digitado repetiria a primeira armadilha: ninguem volta para desmarcar
-- quando o criativo finalmente sobe. Derivar se auto-corrige e custa zero.
--
-- O N de 7 dias sai da medicao: quando um card vira anuncio, vira em <= 1 dia
-- em 90% dos casos e <= 4 dias em 95%. Sete e quase o dobro do p95.
--
-- E o corte de 01/05/2026 e o que impede a view de inventar perda: antes disso
-- `metricas_meta` nao existe, entao nao da para saber se o card rodou. Sao
-- 2.300 dos 2.459 sem anuncio que caem ANTES de maio — a view devolve 76, e os
-- 2.300 ficam de fora porque sobre eles o banco nao tem o que dizer.
--
-- UMA NOTA SOBRE security_invoker
--
-- Nenhuma das views existentes do projeto usa (vw_faturamento_liquido,
-- vw_meta_status, vw_producao_estado_ads e vw_mapa_revs tem reloptions nulo).
-- Estas duas usam assim mesmo. Hoje da no mesmo — a politica de SELECT de
-- producoes, producao_ads, metricas_meta e vendas e `true` —, mas se alguem
-- apertar o RLS de producoes amanha, uma view sem invoker continuaria
-- entregando tudo em silencio. Divergir da maioria aqui e deliberado, e a
-- divida e normalizar as outras quatro depois, nao imitar o que elas fazem.

CREATE OR REPLACE VIEW vw_criativo_funil
WITH (security_invoker = on) AS
WITH dim AS (
  /* De qual conjunto e campanha cada anuncio e. `distinct` porque um anuncio
     pode aparecer em varias linhas de dia. */
  SELECT DISTINCT ad_id, adset_id, campanha_id
    FROM metricas_meta
   WHERE nivel = 'ad' AND ad_id IS NOT NULL
),
venda AS (
  SELECT v.ad_id_meta AS ad_id, v.funil_id
    FROM vendas v
   WHERE v.status = 'aprovada'
     AND v.funil_id IS NOT NULL
     AND v.ad_id_meta IS NOT NULL
     AND v.pedido_id NOT LIKE 'TEST%' AND v.pedido_id NOT LIKE 'LC-%'
),
-- 1o degrau: o proprio anuncio do card vendeu naquele REV
d1 AS (
  SELECT pa.producao_id, v.funil_id, count(*) AS vendas_base
    FROM producao_ads pa
    JOIN venda v ON v.ad_id = pa.ad_id
   GROUP BY 1, 2
),
-- 2o degrau: o conjunto do anuncio vende esmagadoramente num REV so
adset AS (
  SELECT d.adset_id, v.funil_id, count(*) AS n,
         count(*)::numeric / sum(count(*)) OVER (PARTITION BY d.adset_id) AS frac
    FROM venda v JOIN dim d ON d.ad_id = v.ad_id
   WHERE d.adset_id IS NOT NULL
   GROUP BY d.adset_id, v.funil_id
),
d2 AS (
  SELECT DISTINCT pa.producao_id, a.funil_id, a.n AS vendas_base
    FROM producao_ads pa
    JOIN dim d ON d.ad_id = pa.ad_id
    JOIN adset a ON a.adset_id = d.adset_id
   WHERE a.frac >= 0.8 AND a.n >= 10
),
-- 3o degrau: a campanha inteira vende esmagadoramente num REV so
camp AS (
  SELECT d.campanha_id, v.funil_id, count(*) AS n,
         count(*)::numeric / sum(count(*)) OVER (PARTITION BY d.campanha_id) AS frac
    FROM venda v JOIN dim d ON d.ad_id = v.ad_id
   WHERE d.campanha_id IS NOT NULL
   GROUP BY d.campanha_id, v.funil_id
),
d3 AS (
  SELECT DISTINCT pa.producao_id, c.funil_id, c.n AS vendas_base
    FROM producao_ads pa
    JOIN dim d ON d.ad_id = pa.ad_id
    JOIN camp c ON c.campanha_id = d.campanha_id
   WHERE c.frac >= 0.8 AND c.n >= 10
),
todos AS (
  SELECT producao_id, funil_id, 'venda'::text    AS origem, vendas_base, 1 AS forca FROM d1
  UNION ALL
  SELECT producao_id, funil_id, 'conjunto'::text, vendas_base, 2 FROM d2
  UNION ALL
  SELECT producao_id, funil_id, 'campanha'::text, vendas_base, 3 FROM d3
),
/* Cada card fica SO no degrau mais forte que o alcanca. Sem isto, um card com
   venda propria tambem herdaria o REV da campanha e a tela mostraria o mesmo
   card duas vezes, com duas certezas diferentes. */
melhor AS (
  SELECT producao_id, min(forca) AS forca FROM todos GROUP BY producao_id
)
SELECT DISTINCT ON (t.producao_id, t.funil_id)
       t.producao_id, t.funil_id, t.origem, t.vendas_base
  FROM todos t
  JOIN melhor m ON m.producao_id = t.producao_id AND m.forca = t.forca
 ORDER BY t.producao_id, t.funil_id, t.vendas_base DESC;

COMMENT ON VIEW vw_criativo_funil IS
  'De qual REV veio cada criativo, derivado na LEITURA — nunca espelhado em '
  'tabela. Cascata de tres degraus: venda do proprio anuncio, conjunto '
  'dominante, campanha dominante; cada card fica so no degrau mais forte que o '
  'alcanca, e `origem` diz qual foi. Dominancia exige >= 80% E >= 10 vendas '
  'atribuidas: o percentual sozinho deixa um conjunto de 2 vendas decidir um '
  'REV. Em 21/09/2026 liga 457 cards a 11 REVs. Se um dia virar tabela por '
  'desempenho, o refresh entra no cron atribuicao-horaria — nunca como carga '
  'unica, que foi como funil_checkouts congelou.';

CREATE OR REPLACE VIEW vw_criativo_sem_veiculacao
WITH (security_invoker = on) AS
SELECT p.id AS producao_id,
       p.projeto_id,
       p.nome,
       p.data_inicio,
       (current_date - p.data_inicio) AS dias_desde_a_postagem
  FROM producoes p
 WHERE p.fase = 'postado'
   /* Antes de maio/2026 nao ha metricas_meta: o banco nao consegue dizer se o
      card rodou, e chamar de descartado o que ele nao podia enxergar seria
      inventar perda. Sao 2.300 cards que ficam de fora por isso. */
   AND p.data_inicio >= DATE '2026-05-01'
   /* 7 dias e quase o dobro do p95 de 4 dias entre postar e virar anuncio. */
   AND p.data_inicio <= current_date - 7
   AND NOT EXISTS (SELECT 1 FROM producao_ads pa WHERE pa.producao_id = p.id);

COMMENT ON VIEW vw_criativo_sem_veiculacao IS
  'O "descartado" DERIVADO: card postado, passado o prazo, e sem nenhuma linha '
  'em producao_ads. Campo digitado repetiria a primeira armadilha — ninguem '
  'volta para desmarcar quando o criativo sobe —, e derivar se auto-corrige. '
  'O corte de 01/05/2026 existe porque antes disso metricas_meta nao existe e '
  'nao da para saber se o card rodou.';

-- ── As provas ───────────────────────────────────────────────────────────────
DO $prova$
DECLARE
  v_n     int;
  v_cards int;
  v_revs  int;
BEGIN
  -- 1. todo card da view tem anuncio de verdade, e todo REV existe
  SELECT count(*) INTO v_n FROM vw_criativo_funil f
   WHERE NOT EXISTS (SELECT 1 FROM producao_ads pa WHERE pa.producao_id = f.producao_id)
      OR NOT EXISTS (SELECT 1 FROM funis fu WHERE fu.id = f.funil_id);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'vw_criativo_funil tem % linhas orfas', v_n;
  END IF;

  -- 2. a precedencia funciona: um card nao pode ter duas origens
  SELECT count(*) INTO v_n FROM (
    SELECT producao_id FROM vw_criativo_funil GROUP BY producao_id
     HAVING count(DISTINCT origem) > 1) x;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% cards aparecem com mais de uma origem — a precedencia falhou', v_n;
  END IF;

  -- 3. so o vocabulario conhecido
  SELECT count(*) INTO v_n FROM vw_criativo_funil
   WHERE origem NOT IN ('venda', 'conjunto', 'campanha');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% linhas com origem fora do vocabulario', v_n;
  END IF;

  -- 4. o piso de volume esta valendo
  SELECT count(*) INTO v_n FROM vw_criativo_funil
   WHERE origem IN ('conjunto', 'campanha') AND vendas_base < 10;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% linhas derivadas com menos de 10 vendas de base', v_n;
  END IF;

  -- 5. a cascata alcanca alguma coisa (medido em 21/09/2026: 457 cards, 11 REVs)
  SELECT count(DISTINCT producao_id), count(DISTINCT funil_id)
    INTO v_cards, v_revs FROM vw_criativo_funil;
  IF v_cards < 300 OR v_cards > (SELECT count(DISTINCT producao_id) FROM producao_ads) THEN
    RAISE EXCEPTION 'a cascata ligou % cards, fora da faixa plausivel', v_cards;
  END IF;
  IF v_revs < 5 THEN
    RAISE EXCEPTION 'a cascata alcancou so % REVs', v_revs;
  END IF;
  RAISE NOTICE 'vw_criativo_funil: % cards em % REVs', v_cards, v_revs;

  -- 6. a view do descartado nao inventa perda
  SELECT count(*) INTO v_n FROM vw_criativo_sem_veiculacao s
   WHERE s.data_inicio < DATE '2026-05-01'
      OR s.data_inicio > current_date - 7
      OR EXISTS (SELECT 1 FROM producao_ads pa WHERE pa.producao_id = s.producao_id);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'vw_criativo_sem_veiculacao tem % linhas fora da regra', v_n;
  END IF;

  -- 7. e nao engoliu o universo: os 2.300 anteriores a maio ficam de fora
  SELECT count(*) INTO v_n FROM vw_criativo_sem_veiculacao;
  IF v_n > 500 THEN
    RAISE EXCEPTION 'vw_criativo_sem_veiculacao devolveu % linhas — o corte de maio sumiu?', v_n;
  END IF;
  RAISE NOTICE 'vw_criativo_sem_veiculacao: % cards', v_n;
END
$prova$;
