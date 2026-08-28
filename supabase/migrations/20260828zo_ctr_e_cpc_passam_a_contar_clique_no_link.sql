-- ── CTR e CPC passam a contar clique no LINK ──────────────────────────────
--
-- O Meta devolve dois números de clique e o dashboard estava usando o errado:
--
--   clicks              567   qualquer clique -- curtida, comentário, ver
--                             perfil, expandir texto, clicar no link
--   inline_link_clicks  416   só quem foi para a página
--
-- Medido no anúncio "AD 002 H01 V01", agosto/2026:
--
--                  com clique total   com clique no link
--   CTR                  3,54%              2,60%
--   CPC              R$ 1,53            R$ 2,09
--
-- CTR 36% inflado e CPC 27% barato -- e é o CPC que decide se o anúncio está
-- caro. O Gerenciador de Anúncios mostra o do link; qualquer comparação com ele
-- dava diferença.
--
-- E JÁ HAVIA DUAS DEFINIÇÕES NA CASA
--
-- `fn_criativos_meta` (a tela dos editores) e `fn_metricas_do_rev_bloco` (o
-- Análises) já usavam `cliques_link`. Só `fn_tendencias` e a tela de Meta Ads
-- usavam o total. Ou seja: o mesmo dashboard tinha dois CTRs diferentes com o
-- mesmo nome, em telas vizinhas -- a primeira armadilha da CLAUDE.md, viva.
--
-- Esta migration corrige `fn_tendencias`; a tela de Meta Ads é corrigida no
-- front, no mesmo commit, e passa a mostrar as duas contagens de clique em
-- colunas separadas, com nome que diz qual é qual.
--
-- O dado nunca faltou: `cliques_link` já vinha da sincronização e já estava na
-- view. O que faltava era usá-lo.
--
-- A alteração é por substituição de texto na própria definição: são duas linhas
-- numa função de 70, e transcrever é onde se perde um ramo sem perceber.
DO $$
DECLARE
  v_def  text;
  v_novo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_tendencias';

  v_novo := replace(
    v_def,
    E'UNION ALL SELECT conta_id, conta, produto, data, ''CPC'',          gasto, cliques, NULL, NULL FROM dia',
    E'UNION ALL SELECT conta_id, conta, produto, data, ''CPC'',          gasto, cliques_link, NULL, NULL FROM dia'
  );
  v_novo := replace(
    v_novo,
    E'UNION ALL SELECT conta_id, conta, produto, data, ''CTR'',          cliques*100, impressoes, NULL, NULL FROM dia',
    E'UNION ALL SELECT conta_id, conta, produto, data, ''CTR'',          cliques_link*100, impressoes, NULL, NULL FROM dia'
  );

  IF v_def = v_novo THEN
    RAISE NOTICE 'fn_tendencias: nada a trocar (ja aplicada?)';
  ELSE
    EXECUTE v_novo;
  END IF;
END $$;
