-- FATURAMENTO E O QUE A VENDA VALEU, NAO O QUE A CLIENTE PAGOU
--
-- A conferencia com a Payt de 05/09 (docs/conferencias/2026-09-05-payt.md)
-- achou R$ 5.802,80 de diferenca em 31 dias, com a contagem de vendas batendo
-- exata nos dois lados. A causa e uma so: quando a cliente parcela no cartao,
-- ela paga juros que ficam com a adquirente. Esse dinheiro nunca chega na
-- conta, e a Payt nao conta ele como venda. O painel contava.
--
-- A razao entre os dois numeros e a tabela de parcelas, e fecha em todos os
-- casos: 2x 1,050 · 3x 1,066 · 5x 1,107 · 7x 1,144 · 8x 1,163 · 12x 1,241.
--
-- O DADO JA EXISTIA
--
-- `vendas.valor_sem_juros` e gravado desde 12/03/2026 a partir de
-- `payload_webhook->transaction->price_without_installments`, e bate com a
-- Payt ao centavo (NPME5D3 R$ 294,03 · V89O3ZN R$ 118,66 · 6DG3AMD R$ 97,00).
-- `juros_parcelamento` guarda a diferenca. Cobertura: 1.785 de 1.785 vendas no
-- cartao com payload. Pix nao tem o campo e nao precisa — zero parceladas.
--
-- Nao ha nada a calcular aqui. Ha o que USAR: o campo foi criado, e mantido, e
-- metade dos consumidores nunca soube dele.
--
-- O QUE JA ESTAVA CERTO
--
-- `faturamento_liquido`, `margem_pct`, `roas` e `taxa_plataforma_pct` saem de
-- `receita_tributavel`, que ja e `coalesce(valor_sem_juros, valor_total)`
-- menos coproducao. O lucro nunca esteve errado. `fn_overview` ja usava o
-- campo em receita, ticket e nos cortes por produto.
--
-- O QUE ESTAVA ERRADO, E O QUE ESTA MIGRACAO TROCA
--
--   vw_faturamento_liquido.faturamento_bruto   o numero do topo da tela
--   fn_overview            fat_bruto e fat_bruto_total
--   fn_vendas_agregado     faturamento, ticket medio, por produto, por pagamento
--   fn_utm_agregado        faturamento por origem — media canal com juros dentro
--   fn_vendas_lista        o total da lista
--
-- Em `fn_vendas_agregado` e `fn_vendas_lista` a troca e feita na CTE de
-- origem, com apelido `valor_total`: toda soma abaixo herda de uma vez, em vez
-- de uma dezena de trocas que depois envelheceriam separadas.
--
-- O LIMITE, QUE PRECISA FICAR ESCRITO
--
-- `valor_sem_juros` so existe de 12/03/2026 em diante — antes nao ha payload.
-- O `coalesce` faz o passado cair de volta em `valor_total`, entao comparar
-- com janeiro e fevereiro de 2026 poe os juros dentro de um lado so. Sao 6.451
-- vendas sem payload, e nao ha de onde tirar o numero delas.

DO $mig$
DECLARE
  v_def  text;
  v_n    int;
  -- (objeto, tipo, de, para) — cada troca e conferida antes de aplicar
  trocas constant text[][] := ARRAY[
    ARRAY['vw_faturamento_liquido', 'view',
          E'THEN v.valor_total\n                    ELSE 0::numeric\n                END) AS faturamento_bruto,',
          E'THEN COALESCE(v.valor_sem_juros, v.valor_total)\n                    ELSE 0::numeric\n                END) AS faturamento_bruto,'],
    ARRAY['fn_overview', 'func',
          '''fat_bruto'',   coalesce((SELECT sum(valor_total) FROM aprovadas), 0),',
          '''fat_bruto'',   coalesce((SELECT sum(coalesce(valor_sem_juros, valor_total)) FROM aprovadas), 0),'],
    ARRAY['fn_overview', 'func',
          '''fat_bruto_total'', coalesce((SELECT sum(valor_total) FROM periodo',
          '''fat_bruto_total'', coalesce((SELECT sum(coalesce(valor_sem_juros, valor_total)) FROM periodo'],
    ARRAY['fn_vendas_agregado', 'func',
          'v.valor_total,',
          'coalesce(v.valor_sem_juros, v.valor_total) AS valor_total,'],
    ARRAY['fn_vendas_lista', 'func',
          'v.valor_total,',
          'coalesce(v.valor_sem_juros, v.valor_total) AS valor_total,'],
    ARRAY['fn_utm_agregado', 'func',
          'coalesce(v.valor_total, 0) AS valor',
          'coalesce(v.valor_sem_juros, v.valor_total, 0) AS valor']
  ];
BEGIN
  FOR i IN 1 .. array_length(trocas, 1) LOOP
    DECLARE
      obj  text := trocas[i][1];
      kind text := trocas[i][2];
      de   text := trocas[i][3];
      para text := trocas[i][4];
    BEGIN
      v_def := CASE kind
                 WHEN 'view' THEN rtrim(btrim(pg_get_viewdef(obj::regclass, true)), ';')
                 ELSE pg_get_functiondef(obj::regproc)
               END;

      -- ja aplicada? a migracao pode rodar de novo sem estragar nada
      CONTINUE WHEN position(para IN v_def) > 0;

      v_n := (length(v_def) - length(replace(v_def, de, ''))) / length(de);
      IF v_n <> 1 THEN
        RAISE EXCEPTION '% : a ancora bate %x, esperava 1 — a definicao mudou', obj, v_n;
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

COMMENT ON COLUMN vendas.valor_sem_juros IS
  'O que a venda valeu: o que a cliente pagou MENOS os juros do parcelamento, '
  'que ficam com a adquirente e nunca chegam na conta. Vem de '
  'payload_webhook->transaction->price_without_installments e bate com a '
  'coluna "Valor da Venda" da Payt ao centavo. Nulo antes de 12/03/2026 (sem '
  'payload) — por isso todo consumidor le coalesce(valor_sem_juros, valor_total).';

COMMENT ON COLUMN vendas.valor_total IS
  'O que a cliente PAGOU, juros do parcelamento inclusos. Serve para conferir '
  'extrato e para saber o que foi cobrado do cartao — nunca para faturamento: '
  'os juros nao sao receita. Para faturamento, valor_sem_juros.';
