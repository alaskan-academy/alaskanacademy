-- "SEM DADO DE COPRODUCAO" PASSA A CONTAR SO O DESCONHECIDO QUE PODE IMPORTAR
--
-- Ela apontou: "Curso Saponaria Brasil — este curso nunca teve coproducao".
-- Estava certa, e o aviso estava tecnicamente correto e praticamente inutil.
--
-- O produto tem 1.395 vendas com `valor_coproducao = 0` e UMA com nulo. Nulo e
-- "nao sei", que e diferente de zero — por isso a coluna existe. Mas num
-- produto que 1.395 vendas provam nao ter coprodutor, a que nao sabe nao muda
-- numero nenhum. A tarja amarela ali nao informa: ensina a ignorar tarja.
--
-- (A venda em questao e a O9B6QZK, de 09/08/2026, R$ 70,45. Ela CHEGOU com o
-- array `commission`, so que com `platform: 0` e `producer: 0` — postback que
-- a Payt mandou antes de calcular o rateio. E um caso em 4.848; nao e defeito
-- sistematico, e por isso nao ganhou watchdog. Note que a TAXA dessa venda
-- tambem esta nula, o que e o dado mais valioso que falta ali.)
--
-- A DEFINICAO NOVA
--
-- `vw_produto_sem_coprodutor` — produto com pelo menos uma venda confirmada em
-- ZERO e nenhuma positiva. Sao 30 hoje. Saponaria entra; o Desafios nao entra,
-- porque tem coprodutora; "Acelerador da Primeira Venda - Laura Martins" nao
-- entra, porque NENHUMA venda dele traz o dado — dele continuamos sem saber.
--
-- `vendas_sem_dado_coproducao` deixa de contar as vendas desses produtos, na
-- view e nos DOIS lugares de `fn_overview` (o total do mes e o por produto).
--
--     Alaskan, agosto/2026     1  ->  0   (a unica em aberto era Saponaria)
--     Alaskan, marco/2026   1.458 ->  8   (o que sobra sao produtos nunca
--                                          confirmados — esses seguem em aberto)
--
-- POR QUE NO BANCO E NAO NA TELA
--
-- Porque o Financeiro nao carrega lista de produto: la a cascata so tem os
-- totais do mes. Filtrar no /resumo e nao no Financeiro faria as duas telas
-- discordarem sobre o mesmo mes, que e pior do que as duas avisarem demais.
--
-- E derivado, nao listado: o produto que ganhar coprodutor amanha sai da view
-- sozinho na primeira venda com `valor_coproducao > 0`. Lista de produto
-- escrita no codigo e a armadilha 3 do CLAUDE.md, e o DRE ja escondeu
-- R$ 10.065 exatamente assim.

CREATE OR REPLACE VIEW vw_produto_sem_coprodutor AS
SELECT produto_nome
  FROM vendas
 WHERE status = 'aprovada' AND produto_nome IS NOT NULL
 GROUP BY produto_nome
HAVING count(*) FILTER (WHERE valor_coproducao = 0) > 0
   AND count(*) FILTER (WHERE valor_coproducao > 0) = 0;

COMMENT ON VIEW vw_produto_sem_coprodutor IS
  'Produtos PROVADOS sem coprodutor: tem venda confirmada em zero e nenhuma '
  'positiva. Usada para nao alarmar sobre venda antiga sem o dado num produto '
  'que nunca teve coproducao. Sai sozinha quando o produto ganhar coprodutor.';

DO $mig$
DECLARE v_def text; v_de text; v_para text;
BEGIN
  /* ---------- vw_faturamento_liquido ---------- */
  v_def := rtrim(btrim(pg_get_viewdef('vw_faturamento_liquido'::regclass, true)), ';');

  IF position('vw_produto_sem_coprodutor' IN v_def) = 0 THEN
    v_de   := 'v.status = ''aprovada''::status_venda AND v.valor_coproducao IS NULL THEN 1';
    v_para := 'v.status = ''aprovada''::status_venda AND v.valor_coproducao IS NULL' || chr(10) ||
              '                     AND (v.produto_nome IS NULL OR v.produto_nome NOT IN' || chr(10) ||
              '                          (SELECT produto_nome FROM vw_produto_sem_coprodutor)) THEN 1';
    IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
      RAISE EXCEPTION 'ancora da view nao bate exatamente 1x';
    END IF;
    EXECUTE 'CREATE OR REPLACE VIEW vw_faturamento_liquido AS ' || replace(v_def, v_de, v_para);
  END IF;

  /* ---------- fn_overview: por produto E total do mes ---------- */
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_overview';

  IF position('vw_produto_sem_coprodutor' IN v_def) > 0 THEN
    RETURN;
  END IF;

  v_de   := 'count(*) FILTER (WHERE valor_coproducao IS NULL) AS sem_dado';
  v_para := 'count(*) FILTER (WHERE valor_coproducao IS NULL' || chr(10) ||
            '                   AND (produto_nome IS NULL OR produto_nome NOT IN' || chr(10) ||
            '                        (SELECT produto_nome FROM vw_produto_sem_coprodutor))) AS sem_dado';
  IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
    RAISE EXCEPTION 'ancora do por-produto nao bate exatamente 1x';
  END IF;
  v_def := replace(v_def, v_de, v_para);

  v_de   := '(SELECT count(*) FROM aprovadas WHERE valor_coproducao IS NULL)';
  v_para := '(SELECT count(*) FROM aprovadas WHERE valor_coproducao IS NULL' || chr(10) ||
            '                                    AND (produto_nome IS NULL OR produto_nome NOT IN' || chr(10) ||
            '                                         (SELECT produto_nome FROM vw_produto_sem_coprodutor)))';
  IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
    RAISE EXCEPTION 'ancora do total do mes nao bate exatamente 1x';
  END IF;
  v_def := replace(v_def, v_de, v_para);

  EXECUTE v_def;
END
$mig$;
