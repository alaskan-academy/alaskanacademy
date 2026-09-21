-- AS DUAS COLUNAS DE FUNIL QUE NUNCA TIVERAM DADO SAEM
--
-- `producoes.funil_id` (uuid) e `producoes.funil_ids` (uuid[]) estavam em
-- 0 de 4.098 cards. Nao e coluna subutilizada: e coluna que nunca recebeu um
-- unico valor, e que mesmo assim tinha dois filtros de tela lendo dela.
--
-- O QUE ELAS CUSTAVAM
--
-- Selecionar qualquer funil em Criativos/Avaliacao ou em Producao/Por Projeto
-- ESVAZIAVA a lista — sem erro, sem aviso, sem nada na tela dizendo por que.
-- A pessoa concluia que nao havia criativo naquele funil. E a pergunta que ela
-- queria fazer ("quais criativos rodaram neste REV") tinha resposta: so nao
-- vinha dessas colunas, vinha da venda. Essa resposta agora existe em
-- `vw_criativo_funil` (20260921b), que liga 457 cards a 11 REVs.
--
-- Era a primeira armadilha do CLAUDE.md na forma mais cara: dois campos para a
-- mesma pergunta, os dois mortos, e a tela mentindo em silencio.
--
-- CONFERIDO ANTES DE APAGAR
--
--   · 0 de 4.098 em cada uma — apagar nao perde dado nenhum
--   · nenhuma funcao, view, indice ou constraint do banco depende delas. As
--     referencias que a busca acha sao de OUTRAS tabelas com colunas de mesmo
--     nome: `testes_funis.funil_ids` (fn_teste_sincroniza_funis,
--     fn_backfill_funil_dos_testes, fn_radar_espelha_teste_funil) e
--     `dominios.funil_ids` (vw_mapa_revs). `fn_esteira_defasagem` so cita
--     `producoes.funil_id` dentro de um comentario.
--   · a UI de ESCRITA nunca existiu: `toggleFunilId` (CriativoDrawer) e
--     `toggleFunil` (CriativoFormModal) estavam declarados e nunca renderizados
--   · o unico controle rotulado "Funil de Vendas" escreve em `funil_video`
--
-- O QUE SAIU DO CODIGO NO MESMO COMMIT
--
--   producao/components/types.ts        os dois campos da interface
--   AvaliacaoView, PorProjetoView       o filtro que esvaziava, o estado e a UI
--   CalendarioView, DesempenhoAdsView   as colunas do SELECT
--   CriativoDrawer, CriativoFormModal   os dois toggles mortos e o payload
--
-- O QUE **NAO** SAIU, E POR QUE
--
-- `funil_video` fica. Ele guarda TSL/VSL/QUIZ — metodo, nao funil — e tem 2.003
-- linhas preenchidas. O desenho pedia para renomea-lo para `metodo_video` na
-- mesma migracao, e isso NAO foi feito de proposito: `CriativoCard.tsx` le
-- `criativo.funil_video` e e um arquivo nao commitado da Jessica. Renomear a
-- coluna quebraria trabalho dela que ainda nao esta no git. O rename fica para
-- quando o arquivo entrar, e ate la a palavra "funil" continua com dois donos —
-- divida anotada, nao esquecida.

ALTER TABLE producoes DROP COLUMN IF EXISTS funil_ids;
ALTER TABLE producoes DROP COLUMN IF EXISTS funil_id;

COMMENT ON COLUMN producoes.funil_video IS
  'TSL / VSL / QUIZ: como o video foi feito, e NAO para onde ele manda. O nome '
  'e divida antiga — de qual REV o criativo veio sai de `vw_criativo_funil`, '
  'derivado da venda. Texto livre, e por isso a leitura normaliza (ja houve '
  '"TSL, VSL", "TSL,VSL" e "VSL,TSL" como tres chaves para a mesma coisa). '
  'A renomear para `metodo_video` assim que CriativoCard.tsx estiver no git.';

-- ── As provas ───────────────────────────────────────────────────────────────
DO $prova$
DECLARE
  v_n int;
BEGIN
  -- 1. as colunas sumiram
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'producoes'
     AND column_name IN ('funil_id', 'funil_ids');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'ainda ha % coluna(s) de funil em producoes', v_n;
  END IF;

  -- 2. o que ficou continua inteiro: nenhum card perdeu metodo
  SELECT count(*) INTO v_n FROM producoes
   WHERE funil_video IS NOT NULL AND funil_video <> '';
  IF v_n < 2000 THEN
    RAISE EXCEPTION 'funil_video caiu para % linhas, eram 2.003', v_n;
  END IF;

  -- 3. e a resposta que substitui as colunas continua de pe
  SELECT count(DISTINCT producao_id) INTO v_n FROM vw_criativo_funil;
  IF v_n < 300 THEN
    RAISE EXCEPTION 'vw_criativo_funil ligou so % cards', v_n;
  END IF;

  -- 4. o total de cards nao mudou
  SELECT count(*) INTO v_n FROM producoes;
  IF v_n < 4000 THEN
    RAISE EXCEPTION 'producoes tem % linhas — algo mais do que coluna sumiu', v_n;
  END IF;
END
$prova$;
