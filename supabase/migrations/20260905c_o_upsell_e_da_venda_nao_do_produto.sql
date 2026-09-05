-- O UPSELL E DA VENDA, NAO DO PRODUTO
--
-- "O Handify completo pode ser comprado em varios lugares, mas normalmente e
-- upsell, mas a pessoa pode comprar ele direto no site tambem, sendo assim um
-- principal."
--
-- A frase parece pedir uma escolha entre `upsell` e `oferta_principal`. Nao e:
-- ela descreve um produto que e as DUAS COISAS, e a pergunta certa nao e "que
-- tipo esse produto tem" mas "essa VENDA foi upsell?".
--
-- E essa pergunta ja tem resposta ha muito tempo. `fn_marcar_upsell` grava
-- `vendas.is_upsell` a partir de `payload_webhook->>'type' IN ('upsell',
-- 'manual_upsell')` — a propria Payt diz, venda por venda, se aquilo entrou
-- pelo fluxo de upsell. Para o Handify completo o numero e 57 upsell e 9
-- diretas: o produto e mesmo os dois, e o campo por venda ja separava.
--
-- O DEFEITO
--
-- `vw_conversao_upsell` exigia AS DUAS condicoes:
--
--   WHERE v.is_upsell = true AND o.tipo = 'upsell'
--
-- Isso e a armadilha 1 em forma de filtro: dois campos respondendo "isso e
-- upsell?", e o AND faz a analise perder tudo em que eles divergem. O que
-- estava sendo cortado:
--
--   354 vendas   8 produtos sem linha em `ofertas` (o join nao acha nada)
--    26 vendas   Handify/LPGKQ8, cadastrado `oferta_principal`
--     4 vendas   um `orderbump_4`
--   ---
--   384 vendas   R$ 28.895,49
--
-- A tela ficava VAZIA e ninguem sabia — armadilha 2: existe o cadastro, nao
-- existia o resultado ao lado dizendo que o cadastro estava incompleto.
--
-- `ofertas` e cadastro manual e envelhece; `is_upsell` vem do webhook e nao
-- envelhece. Entre um julgamento cadastrado e um fato recebido, a analise fica
-- com o fato. Por isso a condicao de `ofertas` sai: `ofertas` continua util
-- para dar NOME ao upsell (por isso o LEFT JOIN fica), nunca para decidir se
-- ele e um.
--
-- DE QUEBRA, DOIS `code_payt` PARA O MESMO PRODUTO
--
-- LPGKQ8 (35 vendas, 26 como upsell) e 6a24237a549f9-handify-completo (31
-- vendas, 31 como upsell). O segundo nao existia em `ofertas`. Entra aqui — nao
-- para consertar a analise, que ja nao depende dele, mas porque um code_payt
-- vendendo R$ 9.207 sem cadastro nao tem nome em lugar nenhum.
--
-- E O NOME NULO
--
-- O rotulo caia para 'Upsell ' || produto, e concatenacao com nulo e nulo: 44
-- vendas apareciam com nome em branco. Agora dizem "Upsell sem categoria", que
-- e feio de proposito — e um produto ainda sem categoria, e a tela tem de
-- denunciar isso em vez de esconder num vazio.

-- 1) o code_payt que faltava
INSERT INTO ofertas (code_payt, nome, tipo, produto, ativo, primeira_vez)
VALUES ('6a24237a549f9-handify-completo', 'Handify Artesanato Completo',
        'upsell', 'handify', true, '2026-08-01'::timestamptz)
ON CONFLICT (code_payt) DO UPDATE
  SET tipo = 'upsell', produto = 'handify', ativo = true;

-- 2) a view para de exigir o cadastro, e o rotulo para de sumir
DO $mig$
DECLARE
  v_def text;
  v_n   int;
  -- a condicao que cortava 384 vendas
  c_de   text := ' AND o.tipo = ''upsell''::tipo_item_venda';
  -- o rotulo que virava nulo quando produto era nulo
  n_de   text := 'COALESCE(u.nome_upsell, ''Upsell ''::text || u.produto)';
  n_para text := 'COALESCE(u.nome_upsell, ''Upsell '' || COALESCE(u.produto, ''sem categoria''))';
BEGIN
  v_def := rtrim(btrim(pg_get_viewdef('vw_conversao_upsell'::regclass, true)), ';');

  IF position(c_de IN v_def) > 0 THEN
    v_n := (length(v_def) - length(replace(v_def, c_de, ''))) / length(c_de);
    IF v_n <> 1 THEN RAISE EXCEPTION 'ancora do tipo bate %x', v_n; END IF;
    v_def := replace(v_def, c_de, '');
  END IF;

  IF position(n_de IN v_def) > 0 THEN
    v_n := (length(v_def) - length(replace(v_def, n_de, ''))) / length(n_de);
    IF v_n <> 1 THEN RAISE EXCEPTION 'ancora do nome bate %x', v_n; END IF;
    v_def := replace(v_def, n_de, n_para);
  END IF;

  EXECUTE 'CREATE OR REPLACE VIEW vw_conversao_upsell AS ' || v_def;
END
$mig$;

COMMENT ON VIEW vw_conversao_upsell IS
  'Quem foi upsell sai de `vendas.is_upsell`, que a Payt manda no webhook — '
  'NUNCA de `ofertas.tipo`, que e cadastro manual e envelhece. Exigir os dois '
  'cortava 384 vendas / R$ 28.895,49 e deixava a tela vazia. `ofertas` entra '
  'so por LEFT JOIN, para dar nome.';
