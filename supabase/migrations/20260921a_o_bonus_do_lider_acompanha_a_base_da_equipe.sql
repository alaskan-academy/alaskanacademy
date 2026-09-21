-- O BONUS DO LIDER ACOMPANHA A BASE DA EQUIPE
--
-- Duas coisas, e a segunda so e segura por causa da primeira.
--
-- 1. A LIDERANCA INCIDE SOBRE A BASE, NAO SOBRE O TOTAL DO SUPERVISIONADO
--
-- O multiplicador e individual: premia o desempenho daquela pessoa, e nao e
-- trabalho que passou pela supervisao de ninguem. Quem lidera ganha sobre o que
-- a equipe produziu.
--
-- Em agosto/2026 isso apareceu pela primeira vez, porque foi o primeiro mes em
-- que a supervisionada teve multiplicador diferente de 1:
--
--   base da Jaqueline           R$ 528,00
--   total dela (x1,10)          R$ 580,80
--   lideranca pela regra velha  R$ 116,16   (20% do total)
--   lideranca correta           R$ 105,60   (20% da base)
--
-- `bonus_estimado` e a soma pura dos criterios — antes do multiplicador, antes
-- da lideranca e antes de ajuste manual. E a unica das tres que nao se move por
-- razao alheia ao trabalho supervisionado. Usar `bonus_total` tambem abriria
-- lideranca em cascata se um supervisionado fosse ele proprio lider.
--
-- 2. O CAMPO `bonus_total_manual`, QUE PRECISA EXISTIR ANTES DO GATILHO
--
-- Ate aqui o sistema ADIVINHAVA se um total tinha sido digitado a mao: ele
-- comparava o valor gravado com o recalculo, e se diferissem assumia ajuste
-- manual. Essa inferencia quebra exatamente quando a lideranca muda — a partir
-- dai um valor digitado e um valor velho ficam indistinguiveis, e um gatilho
-- que confiasse nela sobrescreveria lancamento feito a mao.
--
-- Sao 5 de 16 avaliacoes, todas da Jessica, com ajustes de R$ 152 a R$ 194
-- (jan, fev, mar, abr e jun/2026) — pelo tamanho, lideranca lancada a mao antes
-- de o calculo existir. O backfill usa a REGRA DA EPOCA de cada linha
-- (estimado x multiplicador + lideranca congelada), que e a mesma inferencia
-- que o formulario faz ao abrir. Nenhum valor de dinheiro muda aqui: so passa a
-- estar escrito o que antes era deduzido.
--
-- 3. O GATILHO
--
-- `bonus_total` e uma copia gravada de uma conta cujos ingredientes moram na
-- linha de OUTRA pessoa. Quando a avaliacao do supervisionado mudava, nada
-- atualizava a copia: a lista lia a copia, o formulario recalculava, e os dois
-- discordavam sem nada na tela dizendo isso. E a quarta armadilha do CLAUDE.md
-- — espelho sem gatilho —, e o conserto e o gatilho, nao uma carga inicial.
--
-- O QUE ISTO NAO FAZ, POR DECISAO DELA (21/09/2026)
--
-- Nao corrige retroativamente as avaliacoes ja salvas. Duas estao defasadas
-- (agosto R$ 656,16 onde a regra nova da R$ 685,20; maio R$ 1.192,00 onde da
-- R$ 1.212,00) e continuam como foram pagas.
--
-- Consequencia que precisa ficar dita: um gatilho recalcula a LINHA INTEIRA
-- quando um ingrediente muda — ele nao sabe aplicar "so a diferenca de hoje em
-- diante". Entao, na primeira vez que alguem editar a avaliacao de agosto da
-- Jaqueline, o total de agosto da lider vai para R$ 685,20 de uma vez. Isso e o
-- gatilho funcionando, nao um defeito; so nao acontece sozinho.
--
-- POR QUE SECURITY DEFINER
--
-- A politica de UPDATE da tabela e
--   fn_sou_admin() OR (fn_ve_o_time() AND editor_id IS DISTINCT FROM fn_meu_editor_id())
-- — ninguem altera a propria avaliacao. Sem SECURITY DEFINER o gatilho falharia
-- justamente no caso mais comum: a propria lider editando a avaliacao de quem
-- ela supervisiona, e a atualizacao caindo na linha DELA. A funcao nao recebe
-- parametro de usuario e so recalcula valor derivado de dado que ja esta na
-- tabela, entao ela nao amplia o alcance de ninguem: quem pode editar a
-- avaliacao de X ja podia, por definicao, mexer no que a lideranca de X gera.

-- ── 1. o campo explicito ────────────────────────────────────────────────────
ALTER TABLE avaliacoes_mensais
  ADD COLUMN IF NOT EXISTS bonus_total_manual boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN avaliacoes_mensais.bonus_total_manual IS
  'true quando `bonus_total` foi digitado a mao no campo "Ajuste manual" e NAO '
  'deve ser recalculado. Antes de 20260921a isto era ADIVINHADO comparando o '
  'total gravado com o recalculo — inferencia que deixa de funcionar assim que '
  'a lideranca muda, porque ai um valor digitado e um valor velho ficam iguais '
  'aos olhos da comparacao. O gatilho fn_sincronizar_bonus_do_lider respeita '
  'este campo.';

-- backfill pela regra da epoca de cada linha; nenhum valor de dinheiro muda
UPDATE avaliacoes_mensais a
   SET bonus_total_manual = true
 WHERE a.bonus_total IS DISTINCT FROM
       round(coalesce(a.bonus_estimado, 0) * coalesce(a.multiplicador_snapshot, 1)
             + coalesce((a.respostas->'editores_responsaveis'->>'bonus_lideranca')::numeric, 0), 2)
   AND a.bonus_total_manual = false;

-- ── 2. o gatilho ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_sincronizar_bonus_do_lider()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_editor uuid;
  v_mes    date;
  v_pares  text[] := '{}';
  v_par    text;
BEGIN
  /* Os dois lados do evento: um UPDATE pode trocar o editor ou o mes, e ai os
     dois pares precisam ser ressincronizados. */
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_pares := v_pares || (OLD.editor_id::text || '|' || OLD.mes_referencia::text);
  END IF;
  IF TG_OP IN ('UPDATE', 'INSERT') THEN
    v_pares := v_pares || (NEW.editor_id::text || '|' || NEW.mes_referencia::text);
  END IF;

  /* Um UPDATE que nao troca editor nem mes gera o mesmo par duas vezes. Nao
     vale deduplicar: a segunda passada e inofensiva, porque o UPDATE abaixo so
     escreve quando o valor muda de verdade. */
  FOREACH v_par IN ARRAY v_pares
  LOOP
    v_editor := split_part(v_par, '|', 1)::uuid;
    v_mes    := split_part(v_par, '|', 2)::date;

    WITH lideres AS (
      SELECT l.id,
             coalesce(l.bonus_estimado, 0)          AS base,
             coalesce(l.multiplicador_snapshot, 1)  AS mult,
             coalesce((l.respostas->'editores_responsaveis'->>'percentual')::numeric, 0.2) AS pct,
             array(SELECT jsonb_array_elements_text(l.respostas->'editores_responsaveis'->'editor_ids')) AS sup
        FROM avaliacoes_mensais l
       WHERE l.mes_referencia = v_mes
         AND l.bonus_total_manual = false
         /* jsonb_exists() e a forma funcao do operador `?`. Escrita assim para
            nao depender de como cada driver trata a interrogacao. */
         AND jsonb_exists(l.respostas, 'editores_responsaveis')
         AND jsonb_exists(l.respostas->'editores_responsaveis'->'editor_ids', v_editor::text)
    ),
    calc AS (
      /* A lideranca sai de bonus_estimado: base pura, sem multiplicador, sem
         ajuste manual e sem lideranca de ninguem. Ver o cabecalho. */
      SELECT li.id, li.base, li.mult,
             round(coalesce(sum(s.bonus_estimado), 0) * li.pct, 2) AS lideranca
        FROM lideres li
        LEFT JOIN avaliacoes_mensais s
          ON s.mes_referencia = v_mes AND s.editor_id::text = ANY(li.sup)
       GROUP BY li.id, li.base, li.mult, li.pct
    )
    UPDATE avaliacoes_mensais a
       SET bonus_total = round(c.base * c.mult + c.lideranca, 2),
           respostas   = jsonb_set(a.respostas,
                                   '{editores_responsaveis,bonus_lideranca}',
                                   to_jsonb(c.lideranca))
      FROM calc c
     WHERE a.id = c.id
       AND (a.bonus_total IS DISTINCT FROM round(c.base * c.mult + c.lideranca, 2)
            OR (a.respostas->'editores_responsaveis'->>'bonus_lideranca')::numeric
               IS DISTINCT FROM c.lideranca);
  END LOOP;

  RETURN NULL;
END
$fn$;

COMMENT ON FUNCTION fn_sincronizar_bonus_do_lider() IS
  'Mantem `bonus_total` do lider igual ao recalculo quando a avaliacao de quem '
  'ele supervisiona muda. Respeita bonus_total_manual. Nao dispara sobre as '
  'proprias colunas que escreve (bonus_total e respostas), o que elimina '
  'recursao — ver a clausula UPDATE OF do gatilho.';

DROP TRIGGER IF EXISTS trg_sincronizar_bonus_do_lider ON avaliacoes_mensais;

/* UPDATE OF lista SO os ingredientes da lideranca. O gatilho escreve
   `bonus_total` e `respostas`, que nao estao na lista — entao ele nunca se
   dispara de novo, e nao ha recursao possivel. */
CREATE TRIGGER trg_sincronizar_bonus_do_lider
AFTER INSERT OR DELETE OR UPDATE OF bonus_estimado, mes_referencia, editor_id
ON avaliacoes_mensais
FOR EACH ROW EXECUTE FUNCTION fn_sincronizar_bonus_do_lider();

-- ── As provas ───────────────────────────────────────────────────────────────
DO $prova$
DECLARE
  v_n            int;
  v_jaque        uuid;
  v_lider_ago    uuid;
  v_lider_jun    uuid;
  v_total_ago    numeric;
  v_lid_ago      numeric;
  v_total_jun    numeric;
  v_esperado_ago numeric;
BEGIN
  -- 1. o backfill marcou exatamente as 5 linhas com ajuste a mao
  SELECT count(*) INTO v_n FROM avaliacoes_mensais WHERE bonus_total_manual;
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'backfill marcou % linhas como manuais, esperava 5', v_n;
  END IF;

  -- 2. nenhum valor de dinheiro se moveu: agosto e maio seguem como foram pagos
  SELECT round(sum(bonus_total), 2) INTO v_total_ago FROM avaliacoes_mensais
   WHERE mes_referencia = '2026-08-01';
  IF v_total_ago <> 1236.96 THEN
    RAISE EXCEPTION 'agosto/2026 somou %, esperava 1236.96 (656.16 + 580.80)', v_total_ago;
  END IF;

  -- 3. o gatilho funciona — testado de verdade e desfeito
  SELECT a.editor_id INTO v_jaque FROM avaliacoes_mensais a
    JOIN editores e ON e.id = a.editor_id
   WHERE a.mes_referencia = '2026-08-01' AND e.nome = 'Jaqueline Coelho';
  SELECT id INTO v_lider_ago FROM avaliacoes_mensais
   WHERE mes_referencia = '2026-08-01' AND jsonb_exists(respostas, 'editores_responsaveis');
  SELECT id INTO v_lider_jun FROM avaliacoes_mensais
   WHERE mes_referencia = '2026-06-01' AND jsonb_exists(respostas, 'editores_responsaveis');

  IF v_jaque IS NULL OR v_lider_ago IS NULL THEN
    RAISE EXCEPTION 'nao achei o par supervisionada/lider de agosto para testar';
  END IF;

  -- 414 x 1,40 + 20% x (528 + 100) = 579,60 + 125,60
  v_esperado_ago := 705.20;

  BEGIN
    UPDATE avaliacoes_mensais SET bonus_estimado = bonus_estimado + 100
     WHERE editor_id = v_jaque AND mes_referencia = '2026-08-01';

    SELECT bonus_total,
           (respostas->'editores_responsaveis'->>'bonus_lideranca')::numeric
      INTO v_total_ago, v_lid_ago
      FROM avaliacoes_mensais WHERE id = v_lider_ago;

    -- e junho, que e manual, nao pode se mexer
    UPDATE avaliacoes_mensais SET bonus_estimado = bonus_estimado + 100
     WHERE editor_id = v_jaque AND mes_referencia = '2026-06-01';
    SELECT bonus_total INTO v_total_jun FROM avaliacoes_mensais WHERE id = v_lider_jun;

    RAISE EXCEPTION 'desfazer o teste';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm <> 'desfazer o teste' THEN RAISE; END IF;
  END;

  IF v_total_ago IS DISTINCT FROM v_esperado_ago THEN
    RAISE EXCEPTION 'o gatilho deixou o total do lider em %, esperava %',
                    v_total_ago, v_esperado_ago;
  END IF;
  IF v_lid_ago IS DISTINCT FROM 125.60 THEN
    RAISE EXCEPTION 'a lideranca gravada ficou em %, esperava 125.60', v_lid_ago;
  END IF;
  IF v_total_jun IS DISTINCT FROM 528 THEN
    RAISE EXCEPTION 'junho e manual e mesmo assim foi para %, deveria seguir 528', v_total_jun;
  END IF;

  -- 4. o teste foi mesmo desfeito
  SELECT round(sum(bonus_total), 2) INTO v_total_ago FROM avaliacoes_mensais
   WHERE mes_referencia = '2026-08-01';
  IF v_total_ago <> 1236.96 THEN
    RAISE EXCEPTION 'o teste do gatilho NAO foi desfeito: agosto esta em %', v_total_ago;
  END IF;
END
$prova$;
