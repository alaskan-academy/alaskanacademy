-- O grafico do Resumo nao batia com o card em cima dele
-- ============================================================================
--
-- `fn_overview` ja descontava a coproducao onde importa: `receita`,
-- `base_simples`, `receita_sem_upsell` e `receita_backend` todas saem liquidas
-- desde a 20260917a, e a funcao ate expoe `coproducao` como linha propria.
--
-- Mas as QUEBRAS secundarias ficaram de fora, e uma delas e a serie diaria que
-- desenha o grafico. Resultado medido em 06/10/2026, Aeliss em setembro:
--
--     card "receita"               R$ 14.975,64
--     soma das barras do grafico   R$ 16.532,63
--     diferenca                    R$  1.556,99  = a coproducao, exata
--
--     card "base_simples"          R$ 15.778,15
--     soma das barras              R$ 17.335,14
--
-- Na Alaskan Academy os dois batem ao centavo, porque ela nao tem coproducao
-- nenhuma desde setembro (R$ 0,00; em agosto foram R$ 377,50, 0,186% da base).
-- A coproducao e praticamente toda da Aeliss: 8,98% da base em setembro e
-- 8,83% em outubro. Foi por isso que ninguem viu — o defeito so aparece numa
-- das duas empresas, e na que fatura menos.
--
-- Isso e a primeira armadilha do CLAUDE.md na forma mais pura: dois campos
-- dizendo a mesma coisa, e eles SEMPRE divergem. `base_simples` do topo e a
-- soma dos `base_simples` dos dias deveriam ser o mesmo numero, e nao eram —
-- um deles e base de imposto, e a tela mostrava os dois.
--
-- -- O que muda e o que NAO muda ---------------------------------------------
--
-- Descontam agora (4 expressoes):
--
--   venda_dia.faturamento    a barra do grafico
--   venda_dia.base_simples   a base de imposto por dia
--   por_origem.receita       receita por origem de trafego
--   upsells.receita          receita por upsell
--
-- Continuam BRUTOS de proposito, e cada um tem um motivo diferente:
--
--   fat_bruto / fat_bruto_total   e o numero que a conferencia compara com a
--                                 Payt, e a Payt reporta a venda inteira.
--                                 Tambem e ele que rateia o custo fixo.
--   por_link.valor                atribuicao, nao receita: o link vendeu o
--                                 produto inteiro, e a divisao com o
--                                 coprodutor e contrato de depois. A familia
--                                 dos links ja e toda bruta
--                                 (`vw_utm_links_desempenho`), entao a regra
--                                 fica coerente: ATRIBUICAO e bruta, RECEITA
--                                 e liquida.
--   base_copro                    e o DENOMINADOR que mostra a coproducao em
--                                 porcentagem. Descontar aqui seria dividir
--                                 pelo numero errado.
--   por status / perda            e o que a pessoa tentou pagar e o que voltou
--                                 atras. Nao e receita de ninguem.
--
-- -- Sobre o metodo ----------------------------------------------------------
--
-- A varredura que achou isto teve de ser por EXPRESSAO, nao por objeto. A
-- primeira versao listava os objetos sem nenhuma mencao a `valor_coproducao`,
-- e `fn_overview` passou batida justamente porque descontava em sete lugares e
-- esquecia em quatro. Procurar objeto limpo acha quem nunca ouviu falar do
-- assunto; o defeito mora em quem ouviu e aplicou pela metade.

DO $mig$
DECLARE
  v_def text;
  v_n   int;
  -- (objeto, tipo, de, para, quantas vezes a ancora deve bater)
  trocas constant text[][] := ARRAY[
    -- A barra do grafico.
    ARRAY['fn_overview', 'func',
          '           sum(coalesce(valor_sem_juros, valor_total)) AS faturamento,',
          '           sum(coalesce(valor_sem_juros, valor_total) - coalesce(valor_coproducao, 0)) AS faturamento,',
          '1'],
    -- A base do imposto por dia. Perde a coproducao e MANTEM os juros.
    ARRAY['fn_overview', 'func',
          '           sum(coalesce(valor_sem_juros, valor_total) + coalesce(juros_parcelamento, 0)) AS base_simples,',
          '           sum(coalesce(valor_sem_juros, valor_total) - coalesce(valor_coproducao, 0) + coalesce(juros_parcelamento, 0)) AS base_simples,',
          '1'],
    -- As duas quebras que se chamam `receita`: por_origem e upsells. A mesma
    -- linha serve as duas, e as duas precisam descontar — por isso 2.
    ARRAY['fn_overview', 'func',
          '               sum(coalesce(valor_sem_juros, valor_total)) AS receita',
          '               sum(coalesce(valor_sem_juros, valor_total) - coalesce(valor_coproducao, 0)) AS receita',
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

      CONTINUE WHEN position(para IN v_def) > 0;

      v_n := (length(v_def) - length(replace(v_def, de, ''))) / length(de);
      IF v_n <> qtd THEN
        RAISE EXCEPTION 'fn_overview (troca %): a ancora bate % vezes, esperava % -- a definicao mudou',
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

-- -- As provas ---------------------------------------------------------------
DO $prova$
DECLARE
  r          record;
  v_card     numeric;
  v_barras   numeric;
  v_base     numeric;
  v_base_dia numeric;
  v_copro    numeric;
  v_viu      int := 0;
BEGIN
  -- A prova e a invariante, nao o numero: para CADA empresa ativa, o card e a
  -- soma das barras tem de ser o mesmo numero. Escrita assim ela continua
  -- valendo mes que vem, e pega de volta qualquer regressao nas quatro
  -- expressoes de uma vez.
  FOR r IN SELECT id, nome FROM empresas WHERE ativo LOOP
    DECLARE j jsonb;
    BEGIN
      j := fn_overview('2026-09-01', '2026-09-30 23:59:59', 'misto', NULL, r.id);

      v_card   := round((j ->> 'receita')::numeric, 2);
      v_base   := round((j ->> 'base_simples')::numeric, 2);
      v_copro  := round((j ->> 'coproducao')::numeric, 2);

      SELECT round(coalesce(sum((x ->> 'faturamento')::numeric), 0), 2),
             round(coalesce(sum((x ->> 'base_simples')::numeric), 0), 2)
        INTO v_barras, v_base_dia
      FROM jsonb_array_elements(j -> 'por_dia') x;

      IF v_card <> v_barras THEN
        RAISE EXCEPTION '%: o card diz % e as barras somam % (coproducao %)',
                        r.nome, v_card, v_barras, v_copro;
      END IF;
      IF v_base <> v_base_dia THEN
        RAISE EXCEPTION '%: a base do card e % e a somada dos dias e %',
                        r.nome, v_base, v_base_dia;
      END IF;

      IF v_copro > 0 THEN v_viu := v_viu + 1; END IF;
      RAISE NOTICE '% : card = barras = % (coproducao % que saiu)',
                   r.nome, v_card, v_copro;
    END;
  END LOOP;

  -- Sem isto, a invariante acima passaria verde num mes sem coproducao
  -- nenhuma e nao provaria nada. Em setembro/2026 a Aeliss tem R$ 1.556,99.
  IF v_viu = 0 THEN
    RAISE EXCEPTION 'nenhuma empresa com coproducao em setembro: a prova virou tautologia';
  END IF;
END
$prova$;
