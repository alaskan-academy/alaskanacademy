-- A pagina de Vendas era a ultima, e a catraca de hoje nao a via
-- ============================================================================
--
-- As 20261006f, g e h se despediram dizendo que a familia tinha fechado. Nao
-- tinha: a varredura que eu escrevi para provar o fechamento exigia
-- `sum(valor_total)` colado em `AS faturamento`, e `fn_vendas_agregado`
-- escreve
--
--     coalesce(sum(valor_total) FILTER (WHERE status = 'aprovada'), 0) AS faturamento
--
-- com um FILTER no meio. A regex passou por cima de sete ocorrencias na
-- pagina de Vendas. E a terceira armadilha pela terceira vez no mesmo dia, e
-- as tres vezes dentro do guarda-corpo que existe para pega-la.
--
-- A varredura certa nao pede adjacencia: pede que a linha some `valor_total`
-- E diga `faturamento`, em qualquer ordem.
--
-- -- O diagnostico muda pela metade -------------------------------------------
--
-- O numero global que a varredura larga sugeria — R$ 18.478,61 de inflacao no
-- historico aprovado, quase tudo juros — NAO se aplica aqui, e por um motivo
-- que so aparece lendo a funcao: o CTE `base` ja faz
--
--     coalesce(v.valor_sem_juros, v.valor_total) AS valor_total
--
-- O alias SOMBREIA a coluna real. Dentro desta funcao, `valor_total` ja e
-- liquido de juros desde sempre. Falta so a coproducao.
--
-- Medido em 06/10/2026, historico aprovado inteiro:
--
--   Aeliss            R$  20.026,22 -> R$  18.140,24   (R$ 1.885,98 · 9,42%)
--   Alaskan Academy   R$ 920.797,79 -> R$ 920.420,29   (R$   377,50 · 0,04%)
--
-- De novo a Aeliss levando quase tudo, e de novo o defeito invisivel na
-- empresa que fatura mais.
--
-- -- Um ponto so, e nao sete ---------------------------------------------------
--
-- Como todo uso de dinheiro na funcao passa pelo alias, descontar a
-- coproducao NO ALIAS conserta as 12 leituras de uma vez: faturamento,
-- recusadas_valor, upsell_faturamento, o ranking por produto, a quebra por
-- status e as cinco quebras por dimensao. Nenhuma delas e um "pago pelos
-- clientes" — todas sao faturamento ou valor da venda, e todas querem o
-- liquido. Sete substituicoes seriam sete chances de errar uma.
--
-- -- As tres que ficam, e por que -----------------------------------------------
--
-- `vw_comparativo_periodos`, `vw_ofertas_faltando` e `vw_origens_a_classificar`
-- tambem somam `valor_total` como faturamento, e tambem no bruto de verdade
-- (leem `vendas` direto, sem alias). Nao foram consertadas: as tres tem ZERO
-- referencias em `src/`. Sao parte das views orfas ja levantadas nesta sessao,
-- e consertar tela morta e movimento sem resultado — a pergunta delas e se
-- devem existir, nao qual base usam.
--
-- A prova abaixo as NOMEIA em vez de ignora-las. Ela falha se alguem
-- consertar uma sem atualizar a lista, se o banco ganhar uma quarta, e
-- tambem — este e o ponto — se alguma delas ganhar uso em `src/`, porque ai
-- a decisao de deixar como esta caducou.

DO $mig$
DECLARE
  v_def text;
  v_n   int;
  de    constant text := '           coalesce(v.valor_sem_juros, v.valor_total) AS valor_total,';
  para  constant text := E'           /* Liquido de juros E de coproducao: nenhum dos dois chega na\n              conta. O alias sombreia a coluna real de proposito, entao as 12\n              leituras de `valor_total` nesta funcao ja saem certas daqui.\n              Ver 20260905d (juros) e 20261006i (coproducao). */\n           coalesce(v.valor_sem_juros, v.valor_total)\n             - coalesce(v.valor_coproducao, 0)               AS valor_total,';
BEGIN
  v_def := pg_get_functiondef('fn_vendas_agregado'::regproc);
  IF position(para IN v_def) = 0 THEN
    v_n := (length(v_def) - length(replace(v_def, de, ''))) / length(de);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'fn_vendas_agregado: a ancora do alias bate % vezes, esperava 1 -- a definicao mudou', v_n;
    END IF;
    EXECUTE replace(v_def, de, para);
  END IF;
END
$mig$;

-- -- As provas ---------------------------------------------------------------
DO $prova$
DECLARE
  v_fat      numeric;
  v_mao      numeric;
  v_copro    numeric;
  v_sobrando text[];
  v_vivas    text[];
BEGIN
  -- 1. COMPORTAMENTAL: o faturamento que a pagina de Vendas recebe bate com a
  --    conta feita por fora. Sem numero cravado — compara duas fontes.
  SELECT (fn_vendas_agregado(NULL, NULL, NULL, NULL) -> 'resumo' ->> 'faturamento')::numeric
    INTO v_fat;

  SELECT round(sum(coalesce(v.valor_sem_juros, v.valor_total)
                   - coalesce(v.valor_coproducao, 0)), 2),
         round(sum(coalesce(v.valor_coproducao, 0)), 2)
    INTO v_mao, v_copro
  FROM vendas v
  WHERE v.status = 'aprovada'
    AND NOT coalesce(v.is_upsell, false)
    AND v.pedido_id NOT LIKE 'TEST%' AND v.pedido_id NOT LIKE 'LC-%';

  IF round(v_fat, 2) <> v_mao THEN
    RAISE EXCEPTION 'Vendas: a funcao diz % e a conta a mao diz %', round(v_fat, 2), v_mao;
  END IF;

  -- 2. A troca MOVEU algo. Sem isto a prova 1 passaria verde num mundo sem
  --    coproducao, onde as duas contas coincidem.
  IF coalesce(v_copro, 0) <= 0 THEN
    RAISE EXCEPTION 'nenhuma coproducao nas vendas de front: a prova 1 virou tautologia';
  END IF;

  /*
    3. DERIVADA, agora sem exigir adjacencia — que foi o buraco que deixou
       esta funcao passar pelas catracas das 20261006f, g e h.

       E agora com a excecao no nivel do OBJETO, nao da linha, porque a
       primeira tentativa desta migracao falhou aqui e estava certa em falhar:
       depois do conserto, as sete linhas de `fn_vendas_agregado` CONTINUAM
       escrevendo `sum(valor_total)`. Elas estao certas por causa do alias, e
       nenhuma varredura de texto resolve alias.

       Entao a regra e: objeto que menciona `valor_coproducao` em qualquer
       lugar ja sabe da conversa, e quem responde por ele e a prova
       COMPORTAMENTAL (a n1 aqui em cima), que compara numero com numero.
       A varredura de texto fica para quem nunca ouviu falar do assunto.
  */
  SELECT coalesce(array_agg(DISTINCT obj ORDER BY obj), '{}') INTO v_sobrando
  FROM (
    SELECT p.proname AS obj,
           pg_get_functiondef(p.oid) AS fonte,
           regexp_split_to_table(pg_get_functiondef(p.oid), E'\n') AS linha
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
    UNION ALL
    SELECT c.relname,
           pg_get_viewdef(c.oid, true),
           regexp_split_to_table(pg_get_viewdef(c.oid, true), E'\n')
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v','m')
  ) l
  WHERE linha ~* 'sum\s*\(\s*v?\.?valor_total'
    AND linha ~* 'faturamento'
    AND fonte NOT LIKE '%valor_coproducao%';

  IF v_sobrando <> ARRAY['vw_comparativo_periodos',
                         'vw_ofertas_faltando',
                         'vw_origens_a_classificar'] THEN
    RAISE EXCEPTION 'mudou quem soma valor_total como faturamento: agora e %. '
                    'Esperava as tres views ORFAS listadas na 20261006i.',
                    v_sobrando;
  END IF;

  -- 4. E a razao de deixa-las continua valendo? Se uma orfa ganhar uso, a
  --    decisao de nao consertar caducou e isto tem de aparecer.
  --    (Confere no catalogo: view orfa nao e referenciada por nenhuma outra
  --     view, funcao ou politica de RLS. O uso em `src/` tem de ser conferido
  --     a mao, e esta anotado na 20261006i.)
  SELECT coalesce(array_agg(DISTINCT dependente ORDER BY dependente), '{}') INTO v_vivas
  FROM (
    SELECT c2.relname AS dependente
    FROM pg_depend d
    JOIN pg_rewrite r  ON r.oid = d.objid
    JOIN pg_class   c2 ON c2.oid = r.ev_class
    JOIN pg_class   c1 ON c1.oid = d.refobjid
    WHERE c1.relname IN ('vw_comparativo_periodos','vw_ofertas_faltando','vw_origens_a_classificar')
      AND c2.relname <> c1.relname
  ) x;
  IF v_vivas <> '{}'::text[] THEN
    RAISE EXCEPTION 'uma das views dadas como orfas passou a ser usada por: %', v_vivas;
  END IF;

  RAISE NOTICE 'Vendas: faturamento % (coproducao % que saiu)', v_mao, v_copro;
END
$prova$;
