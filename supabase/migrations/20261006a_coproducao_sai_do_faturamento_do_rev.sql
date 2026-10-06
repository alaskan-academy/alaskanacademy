-- A coproducao nao e receita da empresa, e nao e base do Simples
-- ============================================================================
--
-- `fn_metricas_do_rev_bloco` e a funcao que alimenta o bloco de metricas da
-- Analise de cada REV. Ela computava duas grandezas de dinheiro assim:
--
--     faturamento   = valor_sem_juros - valor_reembolsado
--     base_simples  = valor_sem_juros - valor_reembolsado + juros_parcelamento
--
-- As duas deixavam a coproducao dentro, e as duas estavam erradas pelo mesmo
-- motivo, dito pela Jessica em 06/10/2026:
--
--   > a coproducao nao pagamos impostos sobre o montante dado ao coprodutor,
--   > e nunca chega para nos
--
-- Sao duas afirmacoes, e cada uma condena uma das linhas:
--
--   "nunca chega para nos"  -> sai do FATURAMENTO. O dinheiro e repassado ao
--                              coprodutor pela propria Payt; a empresa nunca
--                              o ve, igualzinho aos juros do parcelamento.
--   "nao pagamos impostos"  -> sai da BASE DO SIMPLES. E aqui a coproducao e
--                              o OPOSTO dos juros: os juros tambem nao chegam,
--                              mas o fisco cobra sobre eles (20260917a). A
--                              coproducao nao chega E nao e tributada.
--
-- Por isso as duas linhas mudam, e mudam de jeitos diferentes: `faturamento`
-- perde a coproducao e pronto; `base_simples` perde a coproducao e CONTINUA
-- somando os juros. Na mesma expressao, um sinal para cada lado.
--
-- -- O que o erro escondia ---------------------------------------------------
--
-- Medido em 06/10/2026, janela de 05/09 a 05/10 (`valor_coproducao` existe em
-- 171 vendas aprovadas, sempre em torno de 9,4% do valor da venda):
--
--   REV4  faturamento c/ upsell  R$ 13.443,99 -> R$ 12.178,26   (-1.265,73)
--         imposto do Simples     R$  1.270,45 -> R$  1.156,54   (-113,91)
--   REV3  faturamento c/ upsell  R$  1.589,40 -> R$  1.439,85   (-149,55)
--         imposto do Simples     R$    152,26 -> R$    138,80   (-13,46)
--
-- Os dois erros empurravam na MESMA direcao enganosa: faturamento maior do que
-- o real e imposto maior do que o devido. O faturamento inflado melhorava ROAS
-- e margem do REV; o imposto inflado piorava o lucro. Nao se cancelam, porque
-- o imposto e 9% e o faturamento e 100% -- sobre a coproducao de R$ 1.265,73
-- do REV4, o painel contava R$ 1.265,73 de receita que nao existe e so
-- R$ 113,91 de imposto a mais. Sobra R$ 1.151,82 de lucro imaginario.
--
-- A coproducao nao esta so nesses dois. Na historia inteira ela aparece em
-- REV1 (R$ 27,10), REV2 (R$ 325,11), REV3 (R$ 282,77), REV4 (R$ 1.345,30) e em
-- 17 vendas sem funil (R$ 263,09).
--
-- -- Por que a edicao e cirurgica --------------------------------------------
--
-- A funcao tem ~250 linhas e vinte CTEs. Reescreve-la inteira aqui congelaria
-- a versao de hoje e desfaria qualquer migracao posterior que tenha mexido em
-- outra parte dela. Entao vale o mesmo mecanismo do 20260917a: ler a definicao
-- viva, trocar a linha pelo texto exato, e EXIGIR que a ancora bata o numero
-- de vezes esperado. Sao 2 e 2, porque a mesma linha abre `caixa` (front +
-- bumps) e `caixa_up` (upsells) -- se virar 1 ou 3, a funcao mudou e a
-- migracao para em vez de adivinhar.

DO $mig$
DECLARE
  v_def text;
  v_n   int;
  -- (objeto, tipo, de, para, quantas vezes a ancora deve bater)
  trocas constant text[][] := ARRAY[
    -- O faturamento perde a coproducao: ela nunca chegou na conta.
    ARRAY['fn_metricas_do_rev_bloco', 'func',
          '      coalesce(sum(valor_sem_juros - coalesce(valor_reembolsado, 0)), 0) as faturamento,',
          '      coalesce(sum(valor_sem_juros - coalesce(valor_reembolsado, 0) - coalesce(valor_coproducao, 0)), 0) as faturamento,',
          '2'],
    -- A base do Simples perde a coproducao e MANTEM os juros: aquela nao e
    -- tributada, estes sao. Ver 20260917a para o lado dos juros.
    ARRAY['fn_metricas_do_rev_bloco', 'func',
          '      coalesce(sum(valor_sem_juros - coalesce(valor_reembolsado, 0) + coalesce(juros_parcelamento, 0)), 0) as base_simples,',
          '      coalesce(sum(valor_sem_juros - coalesce(valor_reembolsado, 0) - coalesce(valor_coproducao, 0) + coalesce(juros_parcelamento, 0)), 0) as base_simples,',
          '2']
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
        RAISE EXCEPTION 'fn_metricas_do_rev_bloco (troca %): a ancora bate % vezes, esperava % -- a definicao mudou',
                        i, v_n, qtd;
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

COMMENT ON COLUMN vendas.valor_coproducao IS
  'A fatia da venda repassada ao coprodutor. A Payt repassa direto, entao esse '
  'dinheiro NUNCA chega na conta da empresa -- por isso sai do faturamento. E, '
  'diferente dos juros do parcelamento, tambem NAO entra na base do Simples: '
  'a empresa nao e tributada sobre o que e do coprodutor (20261006a).';

-- -- As provas ---------------------------------------------------------------
DO $prova$
DECLARE
  v_def   text;
  v_n     int;
  v_func  numeric;
  v_mao   numeric;
  v_copro numeric;
  v_rev4  uuid := '8c8ca543-ce99-41df-b982-791674e0eafc';  -- REV4
BEGIN
  -- 1. ESTRUTURAL: a coproducao aparece nas quatro linhas, e so nelas.
  --    Duas de `faturamento` (caixa, caixa_up) e duas de `base_simples`.
  v_def := pg_get_functiondef('fn_metricas_do_rev_bloco'::regproc);
  v_n := (length(v_def) - length(replace(v_def, 'coalesce(valor_coproducao, 0)', '')))
         / length('coalesce(valor_coproducao, 0)');
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'esperava 4 mencoes a valor_coproducao na funcao, achei %', v_n;
  END IF;

  -- 2. COMPORTAMENTAL: o que a funcao devolve bate, ao centavo, com a conta
  --    feita a mao por fora dela. Esta prova nao tem numero cravado de
  --    proposito -- ela compara duas fontes, entao continua valendo quando
  --    vender mais amanha. O numero cravado esta no comentario do topo.
  SELECT (fn_metricas_do_rev_bloco(v_rev4, '2026-09-05', '2026-10-05') ->> 'faturamento')::numeric
    INTO v_func;

  SELECT round(sum(v.valor_sem_juros - coalesce(v.valor_reembolsado, 0)
                   - coalesce(v.valor_coproducao, 0)), 2),
         round(sum(coalesce(v.valor_coproducao, 0)), 2)
    INTO v_mao, v_copro
  FROM vendas v
  WHERE v.funil_id = v_rev4
    AND v.status = 'aprovada'
    AND NOT coalesce(v.is_upsell, false)
    AND (v.data_venda AT TIME ZONE 'America/Sao_Paulo')::date
        BETWEEN '2026-09-05' AND '2026-10-05'
    AND v.pedido_id NOT LIKE 'TEST%'
    AND v.pedido_id NOT LIKE 'LC-%';

  IF round(v_func, 2) <> v_mao THEN
    RAISE EXCEPTION 'REV4: a funcao diz % e a conta a mao diz %', round(v_func, 2), v_mao;
  END IF;

  -- 3. A troca MOVEU algo. Sem isto, as duas provas acima passariam verdes
  --    num REV sem coproducao nenhuma e nao provariam nada.
  IF coalesce(v_copro, 0) <= 0 THEN
    RAISE EXCEPTION 'REV4 ficou sem coproducao na janela: a prova 2 virou tautologia';
  END IF;

  RAISE NOTICE 'REV4 na janela: faturamento % (coproducao % que saiu)', v_mao, v_copro;
END
$prova$;
