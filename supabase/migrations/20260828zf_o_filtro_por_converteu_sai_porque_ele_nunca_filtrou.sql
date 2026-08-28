-- ── O filtro `WHERE vi.converteu` sai, porque ele nunca filtrou ───────────
--
-- `venda_itens.converteu` e `true` em 3.884 de 3.884 linhas. Nao por acaso: o
-- proprio `fn_normalizar_venda_payt` grava `true` literal no INSERT --
--
--   INSERT INTO venda_itens (..., converteu, ...)
--   SELECT ..., true, p_vp.payt_id
--   FROM jsonb_array_elements(p_vp.payload_raw->'order_bumps') b
--
-- -- porque o array `order_bumps` do payload so lista o que a pessoa LEVOU.
-- Bump oferecido e recusado nao vira linha. A linha existir JA E a conversao.
--
-- Entao `WHERE vi.converteu` em `fn_overview` e em `fn_metricas_do_rev_bloco`
-- e um filtro que le como se separasse alguma coisa e nunca separou nada. E o
-- feitio dos campos que ja custaram caro aqui: um que parece responder uma
-- pergunta e responde sempre a mesma coisa.
--
-- RESSALVA, dita antes de aplicar
--
-- O filtro tambem era uma defesa: se um dia a ingestao passar a gravar o bump
-- oferecido-e-recusado, quem tem o filtro continua contando so conversao e
-- quem nao tem passa a contar recusa como venda, calado. Tirar o filtro sem
-- tirar a coluna deixa a coluna la, parecendo util e sem ninguem a ler.
--
-- A correcao completa e apagar a coluna -- nada se perde, ela e constante e o
-- INSERT a reconstroi. Fica para uma decisao separada; esta migration faz o
-- que foi pedido e nada alem.
--
-- Conferido antes e depois, agosto/2026: 14 bumps distintos, 1.041 conversoes,
-- 731 vendas com bump, R$ 39.210,76. Os quatro numeros tem que continuar
-- iguais -- se algum mudar, o filtro estava filtrando e este comentario esta
-- errado.
--
-- A alteracao e por substituicao de texto na propria definicao, e nao
-- transcrevendo as duas funcoes: sao centenas de linhas para tirar duas, e
-- transcrever e onde se perde um trecho sem perceber.
DO $$
DECLARE
  v_def  text;
  v_novo text;
BEGIN
  -- ── fn_overview ────────────────────────────────────────────────────────
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_overview';

  v_novo := replace(
    v_def,
    E'\n        WHERE vi.converteu\n        GROUP BY 1, 2',
    E'\n        GROUP BY 1, 2'
  );
  v_novo := replace(
    v_novo,
    E' WHERE vi.converteu\n    )',
    E'\n    )'
  );

  IF v_def = v_novo THEN
    RAISE NOTICE 'fn_overview: nada a trocar (ja aplicada?)';
  ELSIF position('converteu' in v_novo) > 0 THEN
    RAISE EXCEPTION 'fn_overview: sobrou "converteu" na definicao -- abortando';
  ELSE
    EXECUTE v_novo;
  END IF;

  -- ── fn_metricas_do_rev_bloco ───────────────────────────────────────────
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_metricas_do_rev_bloco';

  v_novo := replace(v_def, E'\n    where vi.converteu', '');
  v_novo := replace(v_novo, E'\n      where vi.converteu', '');

  IF v_def = v_novo THEN
    RAISE NOTICE 'fn_metricas_do_rev_bloco: nada a trocar (ja aplicada?)';
  ELSIF position('converteu' in v_novo) > 0 THEN
    RAISE EXCEPTION 'fn_metricas_do_rev_bloco: sobrou "converteu" -- abortando';
  ELSE
    EXECUTE v_novo;
  END IF;
END $$;
