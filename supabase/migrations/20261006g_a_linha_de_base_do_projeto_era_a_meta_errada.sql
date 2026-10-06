-- A linha de base pedia que o REV novo superasse um numero que nunca existiu
-- ============================================================================
--
-- `fn_linha_de_base_do_projeto` monta a META de um REV novo: pega o REV ativo
-- de maior volume do projeto e mostra, no modal de teste
-- (`TesteModal.tsx`), o que o novo precisa bater. Sao tres numeros na tela:
-- vendas/dia, TICKET MEDIO e vendas no periodo.
--
-- O ticket medio saia de `avg(valor_total)`, que e o que a cliente
-- DESEMBOLSOU: com os juros do parcelamento e com a fatia do coprodutor
-- dentro. Nenhum dos dois chega na conta da empresa (20260905d, 20261006a).
--
-- E ultimo da familia: a varredura de hoje achou tres lugares somando
-- `valor_total` e chamando de faturamento. `vw_rev_upsells_vendidos` saiu na
-- 20261006f, este sai aqui, e sobra `vw_utm_links_desempenho`, que fica por
-- decisao — atribuicao de link e bruta, e a familia inteira dos links e
-- bruta junto (ver 20261006b).
--
-- -- Por que este doi mais que os outros ------------------------------------
--
-- Os outros mostram o passado inflado. Este define o FUTURO: e contra ele que
-- a pessoa escreve a meta do REV novo. Com o ticket inflado, a meta nasce
-- acima do que o REV de referencia de fato entrega, e o novo "fracassa"
-- contra um alvo que nunca existiu.
--
-- Medido em 06/10/2026, janela de 30 dias, os tres projetos com REV ativo
-- vendendo:
--
--   Saponaria Brasil      REV3 - VSL        R$  93,46 -> R$  90,95   -2,7%
--   Velas Lembrancinhas   REV1 - Original   R$ 125,12 -> R$ 120,23   -3,9%
--   Guia dos Comportamentos  REV4           R$ 128,20 -> R$ 110,43  -13,9%
--
-- O REV4 e o pior porque e o unico dos tres com coproducao: leva os dois
-- defeitos somados.
--
-- -- O que NAO e problema aqui -----------------------------------------------
--
-- Chegamos a desconfiar que mexer nesta funcao estragaria comparacao
-- historica, por ela parecer um retrato de projeto. Nao e:
--
--   - a janela e MOVEL (`now() - p_dias`), recalculada a cada chamada;
--   - nada guarda o resultado — `TesteModal` so o exibe, e o que vai para
--     `testes_funis` e o texto que a pessoa escreve olhando para ele.
--
-- Entao nao ha passado para contradizer. A chave `faturamento` muda junto por
-- coerencia, mas nem aparece na tela: so `ticket_medio` e visivel.
--
-- Entra tambem a exclusao de pedido de teste, nos DOIS lugares que contam
-- venda — nos numeros e na escolha do REV de referencia, que e por volume.
-- Hoje e inerte (zero pedidos de teste nos 30 dias dos tres REVs), e entra
-- porque a convencao existe e uma venda de teste amanha mexeria na meta E em
-- qual REV serve de referencia.

DO $mig$
DECLARE
  v_def text;
  v_n   int;
  -- (de, para, quantas vezes a ancora deve bater)
  trocas constant text[][] := ARRAY[
    -- O faturamento: nao aparece na tela, mas nao pode ficar sendo a unica
    -- grandeza do painel que ainda chama `valor_total` de faturamento.
    ARRAY['      sum(v.valor_total)                         as faturamento,',
          E'      /* Sem os juros da adquirente e sem a fatia do coprodutor: nenhum dos\n         dois chega na conta. Ver 20260905d e 20261006a. */\n      sum(coalesce(v.valor_sem_juros, v.valor_total)\n          - coalesce(v.valor_coproducao, 0))     as faturamento,',
          '1'],
    -- O ticket medio: ESTE e o numero da tela, e e contra ele que a meta do
    -- REV novo e escrita.
    ARRAY['      round(avg(v.valor_total), 2)               as ticket_medio,',
          E'      round(avg(coalesce(v.valor_sem_juros, v.valor_total)\n                - coalesce(v.valor_coproducao, 0)), 2)  as ticket_medio,',
          '1'],
    -- Pedido de teste fora dos numeros...
    ARRAY[E'    where v.funil_id = (select id from rev_ativo)\n      and v.status = ''aprovada''\n      and v.data_venda >= now() - make_interval(days => p_dias)',
          E'    where v.funil_id = (select id from rev_ativo)\n      and v.status = ''aprovada''\n      and v.pedido_id not like ''TEST%''\n      and v.pedido_id not like ''LC-%''\n      and v.data_venda >= now() - make_interval(days => p_dias)',
          '1'],
    -- ...e tambem da escolha do REV de referencia, que e por VOLUME: venda de
    -- teste mexeria em qual REV serve de espelho, nao so nos numeros dele.
    ARRAY[E'      select count(*) from public.vendas v\n      where v.funil_id = f.id and v.status = ''aprovada''\n        and v.data_venda >= now() - make_interval(days => p_dias)',
          E'      select count(*) from public.vendas v\n      where v.funil_id = f.id and v.status = ''aprovada''\n        and v.pedido_id not like ''TEST%''\n        and v.pedido_id not like ''LC-%''\n        and v.data_venda >= now() - make_interval(days => p_dias)',
          '1']
  ];
BEGIN
  FOR i IN 1 .. array_length(trocas, 1) LOOP
    DECLARE
      de   text := trocas[i][1];
      para text := trocas[i][2];
      qtd  int  := trocas[i][3]::int;
    BEGIN
      v_def := pg_get_functiondef('fn_linha_de_base_do_projeto'::regproc);
      CONTINUE WHEN position(para IN v_def) > 0;

      v_n := (length(v_def) - length(replace(v_def, de, ''))) / length(de);
      IF v_n <> qtd THEN
        RAISE EXCEPTION 'fn_linha_de_base_do_projeto (troca %): a ancora bate % vezes, esperava % -- a definicao mudou',
                        i, v_n, qtd;
      END IF;
      EXECUTE replace(v_def, de, para);
    END;
  END LOOP;
END
$mig$;

-- -- As provas ---------------------------------------------------------------
DO $prova$
DECLARE
  r          record;
  v_divergem int := 0;
  v_mexeu    int := 0;
  v_sobrando text[];
BEGIN
  -- 1. COMPORTAMENTAL, projeto a projeto: o ticket que a funcao devolve bate
  --    com a conta feita por fora dela, na mesma janela. Sem numero cravado:
  --    a janela e movel e um numero fixo apodreceria amanha.
  FOR r IN
    SELECT oe.id AS projeto_id,
           fn_linha_de_base_do_projeto(oe.id) AS j
    FROM ofertas_editores oe
  LOOP
    CONTINUE WHEN r.j IS NULL;

    DECLARE
      v_funil    uuid;
      v_esperado numeric;
      v_bruto    numeric;
    BEGIN
      SELECT f.id INTO v_funil FROM funis f
       WHERE f.projeto_id = r.projeto_id AND f.status = 'ativo'
         AND f.nome = (r.j ->> 'rev')
       LIMIT 1;

      SELECT round(avg(coalesce(v.valor_sem_juros, v.valor_total)
                       - coalesce(v.valor_coproducao, 0)), 2),
             round(avg(v.valor_total), 2)
        INTO v_esperado, v_bruto
      FROM vendas v
      WHERE v.funil_id = v_funil AND v.status = 'aprovada'
        AND v.pedido_id NOT LIKE 'TEST%' AND v.pedido_id NOT LIKE 'LC-%'
        AND v.data_venda >= now() - interval '30 days';

      IF (r.j ->> 'ticket_medio')::numeric IS DISTINCT FROM v_esperado THEN
        v_divergem := v_divergem + 1;
        RAISE WARNING 'projeto %: funcao diz %, conta a mao diz %',
                      r.projeto_id, r.j ->> 'ticket_medio', v_esperado;
      END IF;
      IF v_esperado IS DISTINCT FROM v_bruto THEN
        v_mexeu := v_mexeu + 1;
      END IF;
    END;
  END LOOP;

  IF v_divergem <> 0 THEN
    RAISE EXCEPTION '% projeto(s) com ticket discordando da conta feita a mao', v_divergem;
  END IF;

  -- 2. A troca MOVEU algo. Sem isto, a prova 1 passaria verde num mundo sem
  --    juros nem coproducao, onde as duas contas coincidem e nada foi provado.
  IF v_mexeu = 0 THEN
    RAISE EXCEPTION 'nenhum projeto mudou de ticket: a prova 1 virou tautologia';
  END IF;

  -- 3. DERIVADA: quem ainda soma `valor_total` como faturamento. Sobra UM, e
  --    esta nomeado. Falha nos dois sentidos — se alguem consertar o que
  --    falta sem atualizar esta linha, e se o banco ganhar outro.
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

  IF v_sobrando <> ARRAY['vw_utm_links_desempenho'] THEN
    RAISE EXCEPTION 'mudou quem soma valor_total como faturamento: agora e %. '
                    'Esperava so vw_utm_links_desempenho, que fica bruta por '
                    'decisao (atribuicao de link e bruta, ver 20261006b).',
                    v_sobrando;
  END IF;

  RAISE NOTICE '% projeto(s) com a linha de base conferida; % mudaram de ticket',
               v_divergem, v_mexeu;
END
$prova$;
