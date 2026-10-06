-- O resto do painel para de chamar coproducao de receita
-- ============================================================================
--
-- Terceira e ultima leva da regra dita em 06/10/2026: a coproducao nunca chega
-- na conta e nao e tributada. A 20261006a arrumou a Analise do REV, a
-- 20261006b o Resumo. Aqui ficam os cinco objetos restantes que chamam o
-- numero de `receita` e o usam para decidir dinheiro.
--
--   fn_sugestao_parametros      a base de onde sai a ALIQUOTA sugerida
--   fn_metas_sugeridas          receita e receita_sem_upsell por conta
--   fn_tendencias               receita por periodo, nos dois lados da conta
--   fn_criativos_meta           receita por criativo (vira ROAS do criativo)
--   fn_metricas_meta_agregado   receita_payt por anuncio/conjunto/campanha
--
-- -- Por que `fn_sugestao_parametros` e a mais importante das cinco ----------
--
-- Ela nao mostra um numero: ela sugere a ALIQUOTA que o painel inteiro aplica.
-- A conta e imposto_pago / receita_do_mes, e a receita agora precisa ser a
-- mesma base sobre a qual o imposto e aplicado depois. Se a sugestao divide
-- por uma base COM coproducao e a aplicacao usa uma base SEM, a aliquota sai
-- pequena demais e o imposto fica subestimado em toda a operacao — pela fatia
-- exata da coproducao.
--
-- Hoje isso quase nao se ve, e e justamente o risco. Medido em 06/10/2026:
--
--   Alaskan Academy  valor_a  imposto de AGOSTO / receita de JULHO
--                             julho nao tem coproducao nenhuma (a primeira
--                             venda com ela e de 20/08), entao 7,01% fica
--                    valor_b  imposto de SETEMBRO / receita de AGOSTO
--                             agosto tem R$ 377,50 de coproducao, 0,186% da
--                             base: 6,5231% vira 6,5352%, ou 6,52% -> 6,54%
--                    media    6,77% nos dois casos
--   Aeliss                    ainda devolve nulo: nao tem mes fechado com
--                             imposto pago, entao nao ha o que corrigir hoje
--
-- O deslocamento de mes acima nao e detalhe, e foi o que derrubou a primeira
-- tentativa desta migracao: a prova cravava 7,02% em `valor_a` e o banco
-- devolveu 7,01%, porque `valor_a` divide pela receita do mes ANTERIOR ao do
-- pagamento. A correcao da coproducao de agosto aparece em `valor_b`, nao em
-- `valor_a`. A migracao inteira voltou atras sozinha, que e para isso que a
-- prova existe.
--
-- Mas a coproducao e praticamente TODA da Aeliss: 8,98% da base em setembro,
-- 8,83% em outubro. No primeiro mes fechado dela a diferenca entre as duas
-- bases vira ~9%, e ai a aliquota sugerida sairia ~9% abaixo do devido. A hora
-- de acertar e agora, enquanto o numero ainda e zero e ninguem precisa
-- reconciliar nada.
--
-- -- `fn_criativos_meta` e `fn_metricas_meta_agregado` andam juntas ----------
--
-- As duas respondem a mesma pergunta por caminhos diferentes: quanto este
-- anuncio devolveu por real investido. Um anuncio da Aeliss parecia devolver
-- 9% a mais do que devolve, porque a fatia do coprodutor entrava no numerador
-- do ROAS. O nome `receita_payt` da segunda nao salva: a Payt processa a venda
-- inteira, mas o que volta para a empresa e o que sobra depois do repasse.
--
-- -- O que fica de fora, e por que -------------------------------------------
--
-- `fn_linha_de_base_do_projeto` soma `v.valor_total` e chama de `faturamento`.
-- Esta com DOIS problemas, nao um: alem da coproducao, `valor_total` carrega
-- os juros do parcelamento, que tambem nunca chegam (20260905d). Consertar so
-- a coproducao ali deixaria o defeito pela metade e faria parecer resolvido.
-- Fica anotada para uma decisao propria.
--
-- Continuam brutos de proposito, pelos motivos ja escritos na 20261006b: os
-- alertas de proporcao (a coproducao esta no numerador E no denominador),
-- `vw_ad_morrendo` (compara o anuncio com ele mesmo), a familia dos links
-- (atribuicao e bruta) e tudo que diz `valor_total` por venda, que e o que a
-- pessoa pagou.

DO $mig$
DECLARE
  v_def text;
  v_n   int;
  -- (objeto, tipo, de, para, quantas vezes a ancora deve bater)
  trocas constant text[][] := ARRAY[
    -- A base da aliquota. Perde a coproducao, MANTEM os juros (20260917a).
    ARRAY['fn_sugestao_parametros', 'func',
          '           sum(coalesce(v.valor_sem_juros, v.valor_total) + coalesce(v.juros_parcelamento, 0)) AS receita',
          '           sum(coalesce(v.valor_sem_juros, v.valor_total) - coalesce(v.valor_coproducao, 0) + coalesce(v.juros_parcelamento, 0)) AS receita',
          '1'],

    -- fn_metas_sugeridas tem DUAS somas, e a segunda e prefixo da primeira.
    -- Por isso a de cima vai primeiro e a de baixo leva a linha seguinte
    -- junto: sem isso, a verificacao de idempotencia da troca 3 acharia que
    -- ela ja foi aplicada ao ver o texto que a troca 2 acabou de escrever.
    ARRAY['fn_metas_sugeridas', 'func',
          '           sum(coalesce(v.valor_sem_juros, v.valor_total))                              AS receita,',
          '           sum(coalesce(v.valor_sem_juros, v.valor_total) - coalesce(v.valor_coproducao, 0))        AS receita,',
          '1'],
    ARRAY['fn_metas_sugeridas', 'func',
          E'           sum(coalesce(v.valor_sem_juros, v.valor_total))\n             FILTER (WHERE NOT coalesce(v.is_upsell, false))                            AS receita_sem_upsell,',
          E'           sum(coalesce(v.valor_sem_juros, v.valor_total) - coalesce(v.valor_coproducao, 0))\n             FILTER (WHERE NOT coalesce(v.is_upsell, false))                            AS receita_sem_upsell,',
          '1'],

    -- Os dois lados da comparacao de tendencia: periodo atual e anterior.
    ARRAY['fn_tendencias', 'func',
          'SELECT sum(coalesce(v.valor_sem_juros, v.valor_total)) FROM vendas v',
          'SELECT sum(coalesce(v.valor_sem_juros, v.valor_total) - coalesce(v.valor_coproducao, 0)) FROM vendas v',
          '2'],

    -- ROAS por criativo e por anuncio/conjunto/campanha.
    ARRAY['fn_criativos_meta', 'func',
          '           sum(coalesce(v.valor_sem_juros, v.valor_total)) as receita',
          '           sum(coalesce(v.valor_sem_juros, v.valor_total) - coalesce(v.valor_coproducao, 0)) as receita',
          '1'],
    ARRAY['fn_metricas_meta_agregado', 'func',
          '           sum(coalesce(v.valor_sem_juros, v.valor_total)) AS receita_payt',
          '           sum(coalesce(v.valor_sem_juros, v.valor_total) - coalesce(v.valor_coproducao, 0)) AS receita_payt',
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

      CONTINUE WHEN position(para IN v_def) > 0;

      v_n := (length(v_def) - length(replace(v_def, de, ''))) / length(de);
      IF v_n <> qtd THEN
        RAISE EXCEPTION '% (troca %): a ancora bate % vezes, esperava % -- a definicao mudou',
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

-- -- As provas ---------------------------------------------------------------
DO $prova$
DECLARE
  r       record;
  v_n     int;
  v_alask uuid;
  v_pct   numeric;
  v_nada  int;
BEGIN
  -- 1. ESTRUTURAL, uma por funcao, com a contagem esperada.
  FOR r IN SELECT * FROM (VALUES
    ('fn_sugestao_parametros',    1),
    ('fn_metas_sugeridas',        2),
    ('fn_tendencias',             2),
    ('fn_criativos_meta',         1),
    ('fn_metricas_meta_agregado', 1)
  ) x(obj, esperado) LOOP
    v_n := (length(pg_get_functiondef(r.obj::regproc))
            - length(replace(pg_get_functiondef(r.obj::regproc),
                             'coalesce(v.valor_coproducao, 0)', '')))
           / length('coalesce(v.valor_coproducao, 0)');
    IF v_n <> r.esperado THEN
      RAISE EXCEPTION '%: esperava % mencoes a coproducao, achei %', r.obj, r.esperado, v_n;
    END IF;
  END LOOP;

  -- 2. NENHUMA soma de dinheiro em `vendas` ficou para tras nestas cinco.
  --    Derivado, nao listado: se amanha alguem acrescentar uma soma nova sem
  --    o desconto, esta prova e que acusa, nao a lista de cima.
  SELECT count(*) INTO v_nada
  FROM (
    SELECT p.proname, regexp_split_to_table(pg_get_functiondef(p.oid), E'\n') AS linha
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proname IN ('fn_sugestao_parametros','fn_metas_sugeridas','fn_tendencias',
                        'fn_criativos_meta','fn_metricas_meta_agregado')
  ) l
  WHERE linha ~ 'sum\s*\('
    AND (linha LIKE '%valor_sem_juros%' OR linha LIKE '%valor_total%')
    AND linha NOT LIKE '%valor_coproducao%';
  IF v_nada <> 0 THEN
    RAISE EXCEPTION 'sobraram % somas de dinheiro sem desconto de coproducao', v_nada;
  END IF;

  -- 3. COMPORTAMENTAL: as duas pontas, e as duas dizem algo.
  --
  --    valor_a NAO pode se mexer: ele divide pela receita de JULHO, e julho
  --    nao tem coproducao. Se mudar, a troca pegou mais do que devia.
  --    valor_b TEM de se mexer: divide pela receita de AGOSTO, que tem
  --    R$ 377,50. Sem esta segunda, a primeira sozinha passaria verde numa
  --    migracao que nao fez nada.
  SELECT id INTO v_alask FROM empresas WHERE nome = 'Alaskan Academy';

  SELECT valor_a INTO v_pct FROM fn_sugestao_parametros(v_alask)
   WHERE chave = 'imposto_simples_nacional_pct';
  IF v_pct IS DISTINCT FROM 7.01 THEN
    RAISE EXCEPTION 'valor_a (receita de julho, sem coproducao): esperava 7.01, veio %', v_pct;
  END IF;

  SELECT valor_b INTO v_pct FROM fn_sugestao_parametros(v_alask)
   WHERE chave = 'imposto_simples_nacional_pct';
  IF v_pct IS DISTINCT FROM 6.54 THEN
    RAISE EXCEPTION 'valor_b (receita de agosto, com coproducao): esperava 6.54, veio %', v_pct;
  END IF;

  PERFORM count(*) FROM fn_metas_sugeridas(30);
  PERFORM count(*) FROM fn_tendencias('2026-09-01', '2026-09-30');
  PERFORM count(*) FROM fn_criativos_meta('2026-09-01', '2026-09-30');
  PERFORM count(*) FROM fn_metricas_meta_agregado('2026-09-01', '2026-09-30');

  RAISE NOTICE 'as cinco executam; aliquota sugerida da Alaskan em agosto = %', v_pct;
END
$prova$;
