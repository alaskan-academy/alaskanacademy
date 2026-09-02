-- A COPRODUCAO GANHA A COLUNA DE RESULTADO AO LADO
--
-- Ontem a migracao 20260902a criou `vendas.valor_coproducao` e a linha na
-- cascata. Faltava a metade que o CLAUDE.md chama de armadilha 2: a tela de
-- resultado. O total do mes dizia QUANTO saiu, e nenhuma tela dizia DE QUEM —
-- entao a unica forma de saber se um produto tinha coprodutor era abrir o
-- payload da Payt.
--
-- O sintoma apareceu rapido: em setembro a Alaskan tem 117 vendas e ZERO
-- coproducao, entao a linha nao renderiza. "Nao teve coproducao neste mes"
-- ficou visualmente identico a "nao foi implementado para esta empresa".
--
-- Agora cada produto do `/resumo` leva o que saiu por ele:
--
--     Workshop Desafios na Sala de Aula    13 vendas
--       - coproducao R$ 377,50  ·  10,3% do produto
--
-- ONDE A SOMA E TIRADA
--
-- Da MESMA fatia que ja conta as vendas daquele produto (`principais`, sem
-- upsell), e nao de uma consulta paralela. Duas consultas com filtros
-- parecidos e o comeco de dois numeros que divergem — a armadilha 1.
--
-- `sem_dado_copro` acompanha pelo mesmo motivo de sempre: a Payt so manda
-- `commission` desde mai/2026, e mes anterior nao tem coproducao zero, tem
-- coproducao ignorada. Exibir R$ 0,00 ali seria afirmar o que nao se sabe.
--
-- A PORCENTAGEM PRECISA DA BASE CERTA, POR ISSO `base_copro`
--
-- A primeira versao dividia pelo `faturamento_principal` e mostrava 10,35% no
-- Desafios. O combinado com a coprodutora e 9,18%, e a diferenca nao era erro
-- de calculo: `faturamento_principal` e `valor_oferta_principal`, que EXCLUI
-- order bump, enquanto a Payt divide sobre a venda inteira. Um numero
-- inflado ali mandaria alguem conferir contrato atras de um bug inexistente.
--
-- `base_copro` e a soma de `valor_sem_juros` do produto — exatamente a base
-- que a Payt reparte — e da 9,47%, que e o repasse real medido. Vai no JSON
-- em vez de ser reconstruido na tela como `vendas x ticket_medio`: o produto
-- daria o mesmo numero hoje, mas seria um segundo campo dizendo a mesma coisa
-- que `ticket_medio`, e esses divergem (armadilha 1).
--
-- O QUE ESTA MIGRACAO NAO RESOLVE, E A TELA RESOLVE
--
-- A lista por produto exclui upsell e venda sem oferta principal. Hoje isso
-- zera (as 14 vendas com coprodutor sao todas oferta principal, conferido),
-- mas um upsell de produto coproduzido faria a coluna divergir da cascata sem
-- nada denunciando. Por isso a tela DERIVA a sobra — total da cascata menos a
-- soma das linhas — e mostra um aviso quando ela existe. Derivar custa uma
-- subtracao e nunca envelhece; uma lista fixa envelheceria.
--
-- Reescrita ancorada: le a definicao viva, confere que cada ancora bate
-- exatamente uma vez e recria. Nao ha CREATE OR REPLACE escrito a mao aqui
-- porque `fn_overview` tem ~400 linhas e copiar todas para mudar duas seria
-- convidar divergencia com o que esta no banco.

DO $mig$
DECLARE
  v_def text; v_de text; v_para text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_overview';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'fn_overview nao existe';
  END IF;

  -- Ja aplicada? Sai sem erro, para a migracao poder rodar duas vezes.
  IF position('base_copro' IN v_def) > 0 THEN
    RETURN;
  END IF;

  /* 1) a coproducao entra no objeto de cada produto */
  v_de   := '''ticket_medio'', ticket';
  v_para := '''ticket_medio'', ticket, ''coproducao'', copro, ''base_copro'', base_copro, ''sem_dado_copro'', sem_dado';
  IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
    RAISE EXCEPTION 'ancora 1 nao bate exatamente 1x';
  END IF;
  v_def := replace(v_def, v_de, v_para);

  /* 2) e e agregada da MESMA fatia que ja conta as vendas do produto */
  v_de   := 'valor_total)) AS ticket';
  v_para := 'valor_total)) AS ticket,' || chr(10) ||
            '               sum(coalesce(valor_coproducao, 0)) AS copro,' || chr(10) ||
            '               sum(coalesce(valor_sem_juros, valor_total)) AS base_copro,' || chr(10) ||
            '               count(*) FILTER (WHERE valor_coproducao IS NULL) AS sem_dado';
  IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
    RAISE EXCEPTION 'ancora 2 nao bate exatamente 1x';
  END IF;
  v_def := replace(v_def, v_de, v_para);

  EXECUTE v_def;
END
$mig$;
