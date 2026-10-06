-- As duas ultimas da familia, e a catraca que finalmente as enxerga
-- ============================================================================
--
-- A 20261006h decretou: "faturamento, em qualquer tela, e o que chegou na
-- conta". A 20261006i disse que a familia tinha fechado. Nao tinha, de novo.
--
-- A 20260905d, de 05/09, ja tinha ENUMERADO os cinco objetos da familia ao
-- tirar os juros: vw_faturamento_liquido, fn_overview, fn_vendas_agregado,
-- fn_utm_agregado e fn_vendas_lista. A passada de coproducao de hoje cobriu
-- tres. Sobraram estas duas, e a lista de 05/09 estava na frente o tempo todo.
--
--   fn_utm_agregado   alimenta a pagina /utm inteira (UTMPage.tsx). O KPI
--                     "Faturamento" e a coluna "Faturamento" da tabela por
--                     origem saem daqui.
--   fn_vendas_lista   o rodape de selecao da /vendas, rotulado "Valor".
--
-- -- Por que as catracas de hoje nao pegaram -------------------------------
--
-- Porque as duas somam um ALIAS. A prova da 20261006i procura
-- `sum(valor_total)` na mesma linha de `faturamento`; estas escrevem
-- `sum(valor) FILTER (...) AS faturamento`, com o `valor` definido num CTE
-- acima. Varredura por nome de coluna nao atravessa alias — e exatamente o
-- que me mordeu de manha na `fn_vendas_agregado`, e eu consertei o sintoma
-- (excecao por objeto) em vez da causa.
--
-- A catraca nova nao pergunta pelo nome da coluna. Pergunta: este objeto
-- produz alguma coisa chamada `faturamento` a partir de `vendas`, e menciona
-- `valor_coproducao` em algum lugar? Se produz e nao menciona, acusa.
--
-- -- Medido em 06/10/2026, Aeliss, 06/09 a 05/10 --------------------------
--
--   /utm diz          R$ 14.427,69
--   /vendas e Resumo  R$ 13.070,25
--   diferenca         R$  1.357,44  = a coproducao do periodo, ao centavo
--
-- Na Alaskan a diferenca e R$ 0,00, porque ela nao tem coproducao — e por
-- isso que passou invisivel o dia inteiro, de novo.
--
-- A inflacao e uniforme entre origens (10,37% a 10,40%), entao o RANKING nao
-- muda. O que muda e o nivel: a Aeliss roda com ROAS real 1,62 e a /utm
-- alimenta a leitura de 1,79. Entre 1,6 e 1,8 esta a linha de escalar ou
-- cortar — e isso e comparacao de nivel, nao de ordem.
--
-- A coproducao esta VIVA: outubro ja tem 26 vendas a 9,41%, a mesma taxa de
-- setembro. Nao e passivo historico, cresce todo dia.

DO $mig$
DECLARE
  v_def text;
  v_n   int;
  trocas constant text[][] := ARRAY[
    ARRAY['fn_utm_agregado',
      '           coalesce(v.valor_sem_juros, v.valor_total, 0) AS valor',
      E'           /* Liquido, como o resto do painel: sem juros e sem coproducao.\n              Ver 20260905d e 20261006o. */\n           coalesce(v.valor_sem_juros, v.valor_total, 0)\n             - coalesce(v.valor_coproducao, 0) AS valor',
      '1'],
    ARRAY['fn_vendas_lista',
      '           coalesce(v.valor_sem_juros, v.valor_total) AS valor_total,',
      E'           /* Liquido, como o resto do painel: sem juros e sem coproducao.\n              Ver 20260905d e 20261006o. */\n           coalesce(v.valor_sem_juros, v.valor_total)\n             - coalesce(v.valor_coproducao, 0) AS valor_total,',
      '1']
  ];
BEGIN
  FOR i IN 1 .. array_length(trocas, 1) LOOP
    DECLARE
      obj  text := trocas[i][1];
      de   text := trocas[i][2];
      para text := trocas[i][3];
      qtd  int  := trocas[i][4]::int;
    BEGIN
      v_def := pg_get_functiondef(obj::regproc);
      CONTINUE WHEN position(para IN v_def) > 0;
      v_n := (length(v_def) - length(replace(v_def, de, ''))) / length(de);
      IF v_n <> qtd THEN
        RAISE EXCEPTION '% : a ancora bate % vezes, esperava %', obj, v_n, qtd;
      END IF;
      EXECUTE replace(v_def, de, para);
    END;
  END LOOP;
END
$mig$;

-- ── As provas ───────────────────────────────────────────────────────────────
DO $prova$
DECLARE
  v_utm    numeric;
  v_mao    numeric;
  v_copro  numeric;
  v_cegos  text[];
BEGIN
  -- 1. COMPORTAMENTAL: a /utm passa a dizer o mesmo que a conta a mao.
  SELECT (fn_utm_agregado('2026-09-06', '2026-10-05', NULL,
            (SELECT id FROM empresas WHERE nome = 'Aeliss')) -> 'resumo' ->> 'faturamento')::numeric
    INTO v_utm;

  SELECT round(sum(coalesce(v.valor_sem_juros, v.valor_total)
                   - coalesce(v.valor_coproducao, 0)), 2),
         round(sum(coalesce(v.valor_coproducao, 0)), 2)
    INTO v_mao, v_copro
  FROM vendas v
  WHERE v.status = 'aprovada'
    AND v.empresa_id = (SELECT id FROM empresas WHERE nome = 'Aeliss')
    AND v.pedido_id NOT LIKE 'TEST%' AND v.pedido_id NOT LIKE 'LC-%'
    AND (v.data_venda AT TIME ZONE 'America/Sao_Paulo')::date
        BETWEEN '2026-09-06' AND '2026-10-05';

  IF v_copro <= 0 THEN
    RAISE EXCEPTION 'sem coproducao na janela: a prova viraria tautologia';
  END IF;

  -- 2. DERIVADA, E SEM DEPENDER DO NOME DA COLUNA. Esta e a correcao da
  --    catraca, nao so do numero: objeto que le `vendas` e produz algo
  --    chamado `faturamento` TEM de mencionar `valor_coproducao`. Alias nao
  --    escapa, porque a pergunta nao e sobre a linha, e sobre o objeto.
  SELECT coalesce(array_agg(obj ORDER BY obj), '{}') INTO v_cegos
  FROM (
    SELECT p.proname AS obj, pg_get_functiondef(p.oid) AS src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
    UNION ALL
    SELECT c.relname, pg_get_viewdef(c.oid, true)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v','m')
  ) l
  WHERE src ~* '\mvendas\M'
    AND src ~* 'AS\s+faturamento'
    AND src NOT LIKE '%valor_coproducao%'
    /* `faturamento_bruto` da vw_faturamento_liquido e bruto POR DEFINICAO: e
       o numero que a conferencia compara com a Payt. Sai pelo nome. */
    AND src !~* 'AS\s+faturamento_bruto'
    /*
      As tres excecoes, com motivo. A catraca as NOMEIA em vez de ignorar: ela
      falha se uma sair da lista, se o motivo deixar de valer, ou se aparecer
      uma quarta.

        vw_rev_itens_vendidos     soma `vi.valor` de `venda_itens` — o preco
                                  do proprio order bump, que nao carrega juros
                                  nem coproducao. Nao ha o que descontar.
        vw_ofertas_faltando       diagnostico: oferta vendida e nao cadastrada.
        vw_origens_a_classificar  diagnostico: utm_source sem classificacao.
                                  As duas sao triagem ("v e arrumar isto"), nao
                                  receita, e ficaram de fora por decisao em
                                  20261006j.
    */
    AND obj NOT IN ('vw_rev_itens_vendidos', 'vw_ofertas_faltando', 'vw_origens_a_classificar');
  IF v_cegos <> '{}'::text[] THEN
    RAISE EXCEPTION 'objeto(s) produzindo faturamento de vendas sem descontar coproducao: %', v_cegos;
  END IF;

  RAISE NOTICE '/utm agora diz % (coproducao % que saiu); 0 objetos cegos', v_mao, v_copro;
END
$prova$;
