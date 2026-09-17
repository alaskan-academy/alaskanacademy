-- O GRAFICO DIARIO USA A MESMA BASE DO IMPOSTO
--
-- A 20260917a trocou a base do Simples para o bruto em toda soma de PERIODO.
-- Faltava o unico lugar que faz a conta por DIA: `por_dia` do `fn_overview`,
-- que alimenta a linha de lucro diario do /resumo (`lucroPorDia`).
--
-- O grafico e explicitamente construido para FECHAR com o topo da tela — "a
-- soma dos lucros diarios e o lucro operacional do topo", diz o comentario de
-- `src/lib/resumo.ts`. Com duas bases de imposto diferentes ele deixaria de
-- fechar, e a diferenca (R$ 477 em agosto/2026) apareceria espalhada em 31
-- dias, pequena demais para alguem desconfiar e grande demais para ignorar.
--
-- Uma nota sobre o que NAO foi uniformizado aqui: `venda_dia.faturamento` nao
-- desconta coproducao, enquanto `receita` do topo desconta. Essa divergencia e
-- anterior a esta migracao e continua de pe — `base_simples` do dia acompanha
-- o `faturamento` do dia, para que a soma dos dias siga batendo com a serie
-- diaria. Consertar a coproducao no diario e outro assunto.

DO $mig$
DECLARE
  v_def text;
  v_n   int;
  trocas constant text[][] := ARRAY[
    ARRAY[E'           sum(coalesce(valor_sem_juros, valor_total)) AS faturamento,\n           sum(coalesce(taxa_plataforma_valor, 0))     AS taxa,',
          E'           sum(coalesce(valor_sem_juros, valor_total)) AS faturamento,\n           /* A base do Simples leva os juros do parcelamento junto. Ver 20260917a. */\n           sum(coalesce(valor_sem_juros, valor_total) + coalesce(juros_parcelamento, 0)) AS base_simples,\n           sum(coalesce(taxa_plataforma_valor, 0))     AS taxa,',
          '1'],
    ARRAY[E'               coalesce(v.faturamento, 0)      AS faturamento,',
          E'               coalesce(v.faturamento, 0)      AS faturamento,\n               coalesce(v.base_simples, 0)     AS base_simples,',
          '1'],
    ARRAY[E'               ''dia'', dia, ''faturamento'', faturamento, ''vendas'', vendas,',
          E'               ''dia'', dia, ''faturamento'', faturamento, ''base_simples'', base_simples, ''vendas'', vendas,',
          '1']
  ];
BEGIN
  FOR i IN 1 .. array_length(trocas, 1) LOOP
    DECLARE
      de   text := trocas[i][1];
      para text := trocas[i][2];
      qtd  int  := trocas[i][3]::int;
    BEGIN
      v_def := pg_get_functiondef('fn_overview'::regproc);
      CONTINUE WHEN position(para IN v_def) > 0;

      v_n := (length(v_def) - length(replace(v_def, de, ''))) / length(de);
      IF v_n <> qtd THEN
        RAISE EXCEPTION 'fn_overview (troca %) : a ancora bate % vezes, esperava %',
                        i, v_n, qtd;
      END IF;
      EXECUTE replace(v_def, de, para);
    END;
  END LOOP;
END
$mig$;

-- ── A prova: a serie diaria tem que fechar com o total do periodo ───────────
DO $prova$
DECLARE
  d           jsonb;
  v_soma_base numeric;
  v_soma_fat  numeric;
BEGIN
  d := fn_overview('2026-08-01 03:00'::timestamptz, '2026-09-01 02:59:59'::timestamptz);

  SELECT coalesce(sum((x->>'base_simples')::numeric), 0),
         coalesce(sum((x->>'faturamento')::numeric), 0)
    INTO v_soma_base, v_soma_fat
    FROM jsonb_array_elements(d->'por_dia') x;

  -- 1. a base diaria existe e e maior que o faturamento diario, pelos juros
  IF v_soma_base <= v_soma_fat THEN
    RAISE EXCEPTION 'soma diaria: base % nao supera faturamento %', v_soma_base, v_soma_fat;
  END IF;

  -- 2. a diferenca e exatamente os juros que o topo da tela declara
  IF round(v_soma_base - v_soma_fat, 2) <> round((d->>'juros')::numeric, 2) THEN
    RAISE EXCEPTION 'soma diaria: base menos faturamento da %, e os juros do periodo sao %',
                    round(v_soma_base - v_soma_fat, 2), round((d->>'juros')::numeric, 2);
  END IF;

  -- 3. o faturamento diario continua somando o do periodo — nada foi mexido nele
  IF round(v_soma_fat, 2) <> round((d->>'fat_bruto')::numeric, 2) THEN
    RAISE EXCEPTION 'soma diaria: faturamento % nao bate com fat_bruto %',
                    round(v_soma_fat, 2), round((d->>'fat_bruto')::numeric, 2);
  END IF;
END
$prova$;
