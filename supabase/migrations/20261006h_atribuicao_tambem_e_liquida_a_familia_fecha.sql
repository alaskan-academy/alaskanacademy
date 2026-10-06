-- Atribuicao tambem e liquida: "faturamento" passa a ser uma coisa so
-- ============================================================================
--
-- Em 06/10/2026, ao separar o que descontava coproducao do que nao descontava,
-- eu propus uma regra: **atribuicao e bruta, receita e liquida**. Ela esta
-- escrita nas 20261006b e 20261006c, e o argumento era que o link vendeu o
-- produto inteiro e a divisao com o coprodutor e contrato de depois.
--
-- A Jessica decidiu o contrario, no mesmo dia, e o argumento dela e melhor:
--
--   > se "faturamento" quer dizer uma coisa na tela de links e outra no
--   > Resumo, a palavra parou de significar alguma coisa.
--
-- Duas definicoes para a mesma palavra e a PRIMEIRA armadilha do CLAUDE.md, e
-- ela nao perdoa por ser proposital. Uma regra que eu preciso lembrar para
-- ler um numero certo e uma regra que alguem vai esquecer. A partir daqui:
--
--   **faturamento, em qualquer tela, e o que chegou na conta.**
--   Sem juros de parcelamento (20260905d), sem coproducao (20261006a).
--
-- A regra "atribuicao e bruta" das 20261006b e 20261006c fica SUPERADA. Os
-- arquivos ficam como estao — sao registro do que se pensou na hora —, e esta
-- migracao e o que vale.
--
-- -- Os dois lugares, porque a regra velha cobria dois ------------------------
--
-- 1. `vw_utm_links_desempenho` — a tabela de links do Gerador de UTM
--    (`GeradorUtmTab.tsx`). Somava `valor_total`.
--
--    142 links, 59 com venda, 23 mudam:
--      total   R$ 32.477,11 -> R$ 31.282,55   (-R$ 1.194,56)
--      juros   R$    982,89
--      copro   R$    211,67
--
--    O pior em proporcao: "Bio Instagram - guia-dos-comportamentos", inflado
--    18,5% (R$ 1.434,41 -> R$ 1.210,43), e "Site Handify - Handify Completo",
--    16,2% (R$ 1.711,88 -> R$ 1.473,12).
--
--    A tela ordena por data de criacao, nao por faturamento, entao o ranking
--    nao se mexe — so os valores.
--
-- 2. `fn_overview`, quebra `por_link` — a mesma pergunta no Resumo, deixada
--    bruta pela 20261006b com a justificativa que agora caiu. Consertar so a
--    view deixaria as DUAS telas respondendo "quanto este link trouxe" com
--    numeros diferentes, que e exatamente o que esta migracao existe para
--    acabar.
--
-- Entra tambem, na view, a exclusao de pedido de teste, que ela nao tinha.
-- Hoje e inerte (zero vendas de teste casam com algum link) e entra pela
-- convencao. `fn_overview` ja exclui na origem.
--
-- -- O que isto fecha ---------------------------------------------------------
--
-- Era o ultimo dos tres que somavam `valor_total` e chamavam de faturamento.
-- A prova aqui embaixo exige ZERO, no catalogo inteiro — nao ha mais excecao
-- nomeada, que e o estado em que uma regra para de precisar de nota de rodape.

create or replace view public.vw_utm_links_desempenho
with (security_invoker = on) as
 SELECT l.id,
    l.nome,
    l.url_base,
    l.url_final,
    l.source,
    l.medium,
    l.campaign,
    l.content,
    l.term,
    l.projeto_id,
    l.criado_em,
    l.arquivado,
    COALESCE(s.vendas, 0::bigint) AS vendas,
    COALESCE(s.faturamento, 0::numeric) AS faturamento,
    s.primeira_venda,
    s.ultima_venda,
    CURRENT_DATE - l.criado_em::date AS dias_de_vida,
    ( SELECT count(*) AS count
           FROM utm_links o
          WHERE NOT o.arquivado AND NOT o.source IS DISTINCT FROM l.source AND NOT o.medium IS DISTINCT FROM l.medium AND NOT o.campaign IS DISTINCT FROM l.campaign AND NOT o.content IS DISTINCT FROM l.content) AS links_com_mesma_utm
   FROM utm_links l
     LEFT JOIN LATERAL ( SELECT count(*) AS vendas,
            /* O que chegou na conta, nao o que a cliente desembolsou: sem os
               juros da adquirente e sem a fatia do coprodutor. Ver 20261006h. */
            sum(COALESCE(v.valor_sem_juros, v.valor_total)
                - COALESCE(v.valor_coproducao, 0)) AS faturamento,
            min(v.data_venda)::date AS primeira_venda,
            max(v.data_venda)::date AS ultima_venda
           FROM vendas v
          WHERE v.status = 'aprovada'::status_venda
            AND v.pedido_id NOT LIKE 'TEST%'
            AND v.pedido_id NOT LIKE 'LC-%'
            AND NOT v.utm_source IS DISTINCT FROM l.source AND NOT v.utm_medium IS DISTINCT FROM l.medium AND NOT v.utm_campaign IS DISTINCT FROM l.campaign AND NOT v.utm_content IS DISTINCT FROM l.content) s ON true;

DO $mig$
DECLARE
  v_def text;
  v_n   int;
  de    constant text := '               sum(coalesce(valor_sem_juros, valor_total)) AS valor,';
  para  constant text := E'               /* Liquida, como todo o resto. A regra "atribuicao e bruta" da\n                  20261006b caiu em 20261006h: faturamento quer dizer a mesma\n                  coisa em toda tela. */\n               sum(coalesce(valor_sem_juros, valor_total)\n                   - coalesce(valor_coproducao, 0)) AS valor,';
BEGIN
  v_def := pg_get_functiondef('fn_overview'::regproc);
  IF position(para IN v_def) = 0 THEN
    v_n := (length(v_def) - length(replace(v_def, de, ''))) / length(de);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'fn_overview (por_link): a ancora bate % vezes, esperava 1 -- a definicao mudou', v_n;
    END IF;
    EXECUTE replace(v_def, de, para);
  END IF;
END
$mig$;

-- -- As provas ---------------------------------------------------------------
DO $prova$
DECLARE
  v_invoker  text;
  v_divergem int;
  v_mudaram  int;
  v_sobrando text[];
  v_link_ov  numeric;
  v_link_mao numeric;
BEGIN
  -- 1. O invoker sobreviveu ao replace. CREATE OR REPLACE VIEW redefine as
  --    reloptions, e omitir a opcao a APAGA devolvendo sucesso.
  SELECT array_to_string(c.reloptions, ',') INTO v_invoker
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'vw_utm_links_desempenho';
  IF coalesce(v_invoker, '') NOT LIKE '%security_invoker=on%' THEN
    RAISE EXCEPTION 'vw_utm_links_desempenho perdeu o security_invoker (reloptions: %)',
                    coalesce(v_invoker, '(nenhuma)');
  END IF;

  -- 2. COMPORTAMENTAL, link a link: o que a view devolve bate com a conta
  --    feita por fora. Sem numero cravado — compara duas fontes.
  SELECT count(*) INTO v_divergem
  FROM vw_utm_links_desempenho x
  JOIN utm_links l ON l.id = x.id
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(coalesce(v.valor_sem_juros, v.valor_total)
                        - coalesce(v.valor_coproducao, 0)), 0) AS esperado
    FROM vendas v
    WHERE v.status = 'aprovada'
      AND v.pedido_id NOT LIKE 'TEST%' AND v.pedido_id NOT LIKE 'LC-%'
      AND NOT v.utm_source   IS DISTINCT FROM l.source
      AND NOT v.utm_medium   IS DISTINCT FROM l.medium
      AND NOT v.utm_campaign IS DISTINCT FROM l.campaign
      AND NOT v.utm_content  IS DISTINCT FROM l.content
  ) m
  WHERE round(x.faturamento, 2) <> round(m.esperado, 2);
  IF v_divergem <> 0 THEN
    RAISE EXCEPTION '% link(s) com faturamento discordando da conta a mao', v_divergem;
  END IF;

  -- 3. A troca MOVEU algo, e em quantos. Sem isto a prova 2 passaria verde
  --    num mundo sem juros nem coproducao.
  SELECT count(*) INTO v_mudaram
  FROM utm_links l
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(coalesce(v.juros_parcelamento, 0)
                        + coalesce(v.valor_coproducao, 0)), 0) AS tirado
    FROM vendas v
    WHERE v.status = 'aprovada'
      AND NOT v.utm_source   IS DISTINCT FROM l.source
      AND NOT v.utm_medium   IS DISTINCT FROM l.medium
      AND NOT v.utm_campaign IS DISTINCT FROM l.campaign
      AND NOT v.utm_content  IS DISTINCT FROM l.content
  ) t
  WHERE t.tirado > 0;
  IF v_mudaram = 0 THEN
    RAISE EXCEPTION 'nenhum link mudou: a prova 2 virou tautologia';
  END IF;

  -- 4. As DUAS telas respondem igual. E a razao de existir desta migracao, e
  --    por isso ela tem prova propria: a soma do `por_link` do Resumo tem de
  --    bater com a mesma conta feita sobre as vendas de front do periodo.
  SELECT coalesce(sum((x ->> 'valor')::numeric), 0) INTO v_link_ov
  FROM jsonb_array_elements(
    fn_overview('2026-09-01', '2026-09-30 23:59:59', 'misto', NULL, NULL) -> 'por_link'
  ) x;

  /*
    Os filtros abaixo reproduzem os CTEs `periodo` -> `base` -> `aprovadas` ->
    `principais` da funcao. O recorte de data usa o TIMESTAMP CRU, nao a data
    em horario de Sao Paulo: e assim que `periodo` compara, e usar o cast aqui
    faria a prova falhar por motivo errado.
  */
  SELECT coalesce(round(sum(coalesce(v.valor_sem_juros, v.valor_total)
                            - coalesce(v.valor_coproducao, 0)), 2), 0)
    INTO v_link_mao
  FROM vendas v
  WHERE v.status = 'aprovada'
    AND NOT coalesce(v.is_upsell, false)
    AND coalesce(v.valor_oferta_principal, 0) > 0
    AND v.pedido_id NOT LIKE 'TEST%' AND v.pedido_id NOT LIKE 'LC-%'
    AND v.data_venda >= '2026-09-01'::timestamptz
    AND v.data_venda <= '2026-09-30 23:59:59'::timestamptz;

  IF round(v_link_ov, 2) <> v_link_mao THEN
    RAISE EXCEPTION 'por_link do Resumo soma % e a conta a mao da %',
                    round(v_link_ov, 2), v_link_mao;
  END IF;

  -- 5. DERIVADA, e agora sem excecao nomeada: ZERO somas de `valor_total`
  --    chamadas de faturamento no catalogo inteiro.
  SELECT coalesce(array_agg(obj ORDER BY obj), '{}') INTO v_sobrando
  FROM (
    SELECT p.proname AS obj, regexp_split_to_table(pg_get_functiondef(p.oid), E'\n') AS linha
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
    UNION ALL
    SELECT c.relname, regexp_split_to_table(pg_get_viewdef(c.oid, true), E'\n')
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v','m')
  ) l
  WHERE linha ~* 'sum\s*\(\s*v?\.?valor_total\s*\)\s*AS\s+faturamento';

  IF v_sobrando <> '{}'::text[] THEN
    RAISE EXCEPTION 'ainda somam valor_total como faturamento: %', v_sobrando;
  END IF;

  RAISE NOTICE '% links mudaram; por_link do Resumo = % e bate com a conta a mao',
               v_mudaram, round(v_link_ov, 2);
END
$prova$;
