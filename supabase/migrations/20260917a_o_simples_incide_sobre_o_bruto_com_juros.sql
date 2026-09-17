-- O SIMPLES INCIDE SOBRE O BRUTO, JUROS DO PARCELAMENTO INCLUSOS
--
-- A contabilidade confirmou em 17/09/2026: a base do Simples Nacional e o
-- montante BRUTO da venda — o que a cliente pagou —, e nao o valor descontado
-- dos juros de parcelamento. O painel calculava sobre o valor sem juros em
-- cinco lugares, e por isso subestimava o imposto.
--
-- Quanto, medido em 17/09/2026 (soma de vw_faturamento_liquido por mes):
--
--     mes        juros      imposto hoje   imposto certo   a mais
--     2026-05    547,88      9.481,94        9.531,24       49,30
--     2026-06    692,64      5.183,00        5.245,37       62,37
--     2026-07  2.414,05     10.309,88       10.527,20      217,32
--     2026-08  5.305,14     17.770,23       18.247,69      477,46
--     2026-09  3.199,30     10.859,89       11.147,80      287,91
--
-- A serie cresce porque o parcelamento cresce: 55 vendas parceladas em maio,
-- 398 em agosto. Nao e um erro que fica pequeno com o tempo.
--
-- O QUE ESTA MIGRACAO ESTA DESFAZENDO, E POR QUE ISSO PRECISA FICAR ESCRITO
--
-- A migracao 20260905d tirou os juros do FATURAMENTO, e aquilo continua certo:
-- os juros ficam com a adquirente, nunca entram na conta da empresa, e a Payt
-- nao os conta como venda. Receita, margem, ROAS e ticket seguem sem juros.
--
-- O que estava errado era usar a MESMA base para o imposto. Sao duas perguntas
-- diferentes: "quanto a empresa faturou" e "sobre quanto o fisco cobra". A
-- resposta da segunda e maior que a da primeira, e a diferenca e justamente o
-- dinheiro que a empresa nao viu — o imposto e pago sobre ele mesmo assim.
--
-- Por isso nasce a coluna `base_simples`, separada de `receita_tributavel`:
-- um campo por pergunta. E por isso ela e DERIVADA na view, num lugar so, em
-- vez de cada consumidor somar `receita + juros` por conta — tres copias da
-- mesma regra divergem (a terceira armadilha do CLAUDE.md).
--
-- O QUE NAO MUDA
--
-- A coproducao continua FORA da base. A Payt paga a coprodutora direto e esse
-- dinheiro nunca passa pela conta da empresa; a migracao 20260902a tirou ele
-- da base pela mesma razao. Isso nao foi reexaminado aqui, e e uma pergunta
-- aberta separada — se a nota e emitida pelo valor cheio, a coproducao volta
-- para a base do mesmo jeito que os juros voltaram agora.
--
-- `fn_sugestao_parametros` e o unico lugar que MEDE a aliquota em vez de
-- aplicar a configurada: ele divide o imposto pago pela receita do mes
-- anterior. O denominador dele passa a ser o bruto, senao a aliquota sugerida
-- sai inflada. So que ali a coproducao nunca foi descontada, entao ele fica
-- com uma base propria — anotado, nao consertado.
--
-- POR QUE A CONTA BANCARIA NAO SERVIU DE PROVA
--
-- O caminho obvio seria conferir: imposto pago / receita do mes anterior
-- deveria bater com a aliquota. Nao bate com nada. A serie de `Impostos e
-- Tributos` do extrato oscila 5,64% · 6,65% · 6,43% · 6,03% · 8,26% · 7,41%,
-- e a diferenca entre as duas bases candidatas e de 0,03 a 0,15 ponto — bem
-- dentro do ruido. O extrato nao consegue arbitrar esta questao; quem arbitra
-- e a contabilidade, e foi ela que respondeu.

DO $mig$
DECLARE
  v_def text;
  v_n   int;
  -- (objeto, tipo, de, para, quantas vezes a ancora deve bater)
  trocas constant text[][] := ARRAY[
    -- ── vw_faturamento_liquido ────────────────────────────────────────────
    -- A coluna nova entra no FIM: CREATE OR REPLACE VIEW so aceita ali.
    ARRAY['vw_faturamento_liquido', 'view',
          E'    vendas_sem_dado_coproducao\n   FROM com_cfg c',
          E'    vendas_sem_dado_coproducao,\n    receita_tributavel + juros_parc AS base_simples\n   FROM com_cfg c',
          '1'],
    ARRAY['vw_faturamento_liquido', 'view',
          'round(receita_tributavel * simples_pct / 100::numeric, 2) AS imposto_simples,',
          'round((receita_tributavel + juros_parc) * simples_pct / 100::numeric, 2) AS imposto_simples,',
          '1'],
    -- a mesma expressao serve `faturamento_liquido` e `margem_pct`
    ARRAY['vw_faturamento_liquido', 'view',
          'receita_tributavel - taxa_plataforma - reembolsos - receita_tributavel * simples_pct / 100::numeric',
          'receita_tributavel - taxa_plataforma - reembolsos - (receita_tributavel + juros_parc) * simples_pct / 100::numeric',
          '2'],

    -- ── fn_overview ───────────────────────────────────────────────────────
    ARRAY['fn_overview', 'func',
          E'           sum(coalesce(valor_sem_juros, valor_total) - coalesce(valor_coproducao, 0)) AS receita\n      FROM aprovadas GROUP BY 1',
          E'           sum(coalesce(valor_sem_juros, valor_total) - coalesce(valor_coproducao, 0)) AS receita,\n           /* A base do Simples e o BRUTO: os juros do parcelamento nao chegam\n              na conta, mas o fisco cobra sobre eles. Ver 20260917a. */\n           sum(coalesce(valor_sem_juros, valor_total) - coalesce(valor_coproducao, 0)\n               + coalesce(juros_parcelamento, 0)) AS base_simples\n      FROM aprovadas GROUP BY 1',
          '1'],
    ARRAY['fn_overview', 'func',
          'coalesce(sum(round(re.receita * c.simples_pct / 100, 2)), 0) AS simples,',
          'coalesce(sum(round(re.base_simples * c.simples_pct / 100, 2)), 0) AS simples,',
          '1'],
    -- o peso da media ponderada muda junto com a base, senao a invariante
    -- "com uma empresa so devolve a aliquota configurada" quebra
    ARRAY['fn_overview', 'func',
          'coalesce(sum(re.receita * c.simples_pct), 0) AS simples_peso,',
          'coalesce(sum(re.base_simples * c.simples_pct), 0) AS simples_peso,',
          '1'],
    ARRAY['fn_overview', 'func',
          'CASE WHEN r.receita > 0 THEN round(imp.simples_peso / r.receita, 4)',
          'CASE WHEN r.base_simples > 0 THEN round(imp.simples_peso / r.base_simples, 4)',
          '1'],
    ARRAY['fn_overview', 'func',
          '(SELECT coalesce(sum(receita), 0) AS receita FROM receita_empresa) r,',
          '(SELECT coalesce(sum(receita), 0) AS receita, coalesce(sum(base_simples), 0) AS base_simples FROM receita_empresa) r,',
          '1'],
    -- a tela precisa da base para calcular o imposto do recorte que ela mostra
    ARRAY['fn_overview', 'func',
          '''receita'',     coalesce((SELECT sum(coalesce(valor_sem_juros, valor_total) - coalesce(valor_coproducao, 0)) FROM aprovadas), 0),',
          E'''receita'',     coalesce((SELECT sum(coalesce(valor_sem_juros, valor_total) - coalesce(valor_coproducao, 0)) FROM aprovadas), 0),\n    ''base_simples'', coalesce((SELECT sum(coalesce(valor_sem_juros, valor_total) - coalesce(valor_coproducao, 0) + coalesce(juros_parcelamento, 0)) FROM aprovadas), 0),',
          '1'],

    -- ── fn_metricas_do_rev_bloco ──────────────────────────────────────────
    -- a mesma linha abre `caixa` e `caixa_up`; as duas precisam da base
    ARRAY['fn_metricas_do_rev_bloco', 'func',
          '      coalesce(sum(valor_sem_juros - coalesce(valor_reembolsado, 0)), 0) as faturamento,',
          E'      coalesce(sum(valor_sem_juros - coalesce(valor_reembolsado, 0)), 0) as faturamento,\n      coalesce(sum(valor_sem_juros - coalesce(valor_reembolsado, 0) + coalesce(juros_parcelamento, 0)), 0) as base_simples,',
          '2'],
    ARRAY['fn_metricas_do_rev_bloco', 'func',
          '      (select simples_pct from imposto)   as pct_simples,',
          E'      (select base_simples from caixa)    as base_simples,\n      (select base_simples from caixa_up) as base_up,\n      (select simples_pct from imposto)   as pct_simples,',
          '1'],
    ARRAY['fn_metricas_do_rev_bloco', 'func',
          'round((select faturamento from caixa) * (select simples_pct from imposto) / 100.0, 2) as imp_simples,',
          'round((select base_simples from caixa) * (select simples_pct from imposto) / 100.0, 2) as imp_simples,',
          '1'],
    ARRAY['fn_metricas_do_rev_bloco', 'func',
          'round((c.fat + c.fat_up) * c.pct_simples / 100.0, 2)                     as imp_simples_total,',
          'round((c.base_simples + c.base_up) * c.pct_simples / 100.0, 2)           as imp_simples_total,',
          '1'],

    -- ── fn_metas_sugeridas ────────────────────────────────────────────────
    -- `sobra` e por real de FATURAMENTO; o imposto agora incide sobre uma base
    -- maior, entao ele entra corrigido pela razao entre as duas.
    ARRAY['fn_metas_sugeridas', 'func',
          '      sum(faturamento_bruto)  AS receita,',
          E'      sum(faturamento_bruto)  AS receita,\n      sum(base_simples)       AS base_simples,',
          '1'],
    ARRAY['fn_metas_sugeridas', 'func',
          '      p.taxa / nullif(p.receita, 0)                     AS taxa_frac,',
          E'      p.taxa / nullif(p.receita, 0)                     AS taxa_frac,\n      coalesce(p.base_simples / nullif(p.receita, 0), 1) AS base_frac,',
          '1'],
    ARRAY['fn_metas_sugeridas', 'func',
          '      1 - b.taxa_frac - b.simples                       AS sobra,',
          '      1 - b.taxa_frac - b.simples * b.base_frac         AS sobra,',
          '1'],

    -- ── fn_sugestao_parametros ────────────────────────────────────────────
    -- Este MEDE a aliquota: imposto pago / receita. Se o denominador for menor
    -- que a base real, a aliquota sugerida sai maior do que e.
    ARRAY['fn_sugestao_parametros', 'func',
          '           sum(coalesce(v.valor_sem_juros, v.valor_total)) AS receita',
          '           sum(coalesce(v.valor_sem_juros, v.valor_total) + coalesce(v.juros_parcelamento, 0)) AS receita',
          '1']
  ];
BEGIN
  FOR i IN 1 .. array_length(trocas, 1) LOOP
    DECLARE
      obj  text := trocas[i][1];
      kind text := trocas[i][2];
      de   text := trocas[i][3];
      para text := trocas[i][4];
      qtd  int  := trocas[i][5]::int;
    BEGIN
      v_def := CASE kind
                 WHEN 'view' THEN rtrim(btrim(pg_get_viewdef(obj::regclass, true)), ';')
                 ELSE pg_get_functiondef(obj::regproc)
               END;

      -- ja aplicada? a migracao pode rodar de novo sem estragar nada
      CONTINUE WHEN position(para IN v_def) > 0;

      v_n := (length(v_def) - length(replace(v_def, de, ''))) / length(de);
      IF v_n <> qtd THEN
        RAISE EXCEPTION '% (troca %) : a ancora bate % vezes, esperava % — a definicao mudou',
                        obj, i, v_n, qtd;
      END IF;

      IF kind = 'view' THEN
        EXECUTE 'CREATE OR REPLACE VIEW ' || obj || ' AS ' || replace(v_def, de, para);
      ELSE
        EXECUTE replace(v_def, de, para);
      END IF;
    END;
  END LOOP;
END
$mig$;

COMMENT ON COLUMN vendas.juros_parcelamento IS
  'O que a cliente paga a MAIS por parcelar no cartao. Fica com a adquirente e '
  'nunca chega na conta da empresa — por isso sai do faturamento (20260905d). '
  'Mas ENTRA na base do Simples: o fisco cobra sobre o montante bruto, e a '
  'empresa paga imposto sobre dinheiro que nao viu (20260917a).';

-- ── As provas ───────────────────────────────────────────────────────────────
DO $prova$
DECLARE
  v_n     int;
  v_val   numeric;
  v_sobra numeric;
BEGIN
  -- 1. a base e o bruto, em toda linha da view
  SELECT count(*) INTO v_n FROM vw_faturamento_liquido
   WHERE base_simples IS DISTINCT FROM receita_tributavel + juros_parcelamento;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'base_simples nao e receita + juros em % linhas', v_n;
  END IF;

  -- 2. o imposto sai da base nova, e nao da receita
  SELECT count(*) INTO v_n FROM vw_faturamento_liquido
   WHERE imposto_simples IS DISTINCT FROM round(base_simples * simples_pct / 100.0, 2);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'imposto_simples nao sai de base_simples em % linhas', v_n;
  END IF;

  -- 3. agosto/2026 fecha no numero medido ANTES de aplicar: 18.247,69
  SELECT round(sum(imposto_simples), 2) INTO v_val
    FROM vw_faturamento_liquido
   WHERE data >= '2026-08-01' AND data < '2026-09-01';
  IF v_val <> 18247.69 THEN
    RAISE EXCEPTION 'agosto/2026 deu %, esperava 18247.69', v_val;
  END IF;

  -- 4. fn_metas_sugeridas continua com sobra plausivel: se `base_frac` viesse
  --    nulo ou trocado, `sobra` saia negativa ou acima de 1 sem erro nenhum
  SELECT min(1 - taxa_pct / 100 - simples_pct / 100) INTO v_sobra
    FROM fn_metas_sugeridas(30, 0.30);
  IF v_sobra IS NOT NULL AND (v_sobra <= 0 OR v_sobra >= 1) THEN
    RAISE EXCEPTION 'fn_metas_sugeridas: sobra fora de (0,1): %', v_sobra;
  END IF;
END
$prova$;
