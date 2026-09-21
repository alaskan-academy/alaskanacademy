-- AGORA SIM: AS COLUNAS MORTAS DE FUNIL SAEM
--
-- `producoes.funil_id` e `funil_ids` estavam em 0 de 4.098 linhas. A 20260921c
-- ja as tinha apagado — e derrubou cinco telas, porque o codigo que ainda as
-- usava estava em producao e o conserto so existia em commits locais. As
-- 20260921d e 20260921e devolveram as duas para destravar a equipe.
--
-- A DIFERENCA DESTA VEZ E A ORDEM, E ELA FOI CUMPRIDA
--
--   1. push:    origin/main foi de 08f36c9 para cb05fac, 22 commits
--   2. deploy:  Vercel, projeto alaskanacademy, Ready em 19s
--   3. tela:    conferida em https://dash.alaskanacademyoficial.com, logada
--
-- O que foi verificado ANTES deste DROP, em producao, com um hook no fetch
-- capturando toda resposta nao-ok:
--
--   Producao / Meu Painel         28 itens de hoje
--   Producao / Calendario Geral   desenha os cards do mes (era o que quebrou)
--   Criativos / Avaliacao         carrega
--   Criativos / Por Projeto       35 projetos, 28 marcados "· encerrado";
--                                 Velas Perfeitas 788 e Cosmetica Natural 605,
--                                 que estavam invisiveis, aparecem
--   Criativos / Desempenho        tabela Por REV com projeto no rotulo e
--                                 ranking sobre amostra exclusiva
--
--   ZERO respostas com falha em todas elas.
--
-- O unico 400 visto foi no primeiro carregamento, antes do hook, e nao se
-- repetiu em nenhuma navegacao seguinte — e do fluxo de login, nao daqui.
--
-- Depois do DROP, o Calendario foi reaberto em producao: 233 cards desenhados,
-- nenhuma mensagem de erro.
--
-- O QUE SUBSTITUI AS DUAS
--
-- `vw_criativo_funil`: de qual REV o criativo veio, DERIVADO da venda do
-- anuncio em cascata de tres degraus. Liga 457 cards a 11 REVs, e acerta 94,3%
-- do que foi postado nos ultimos 90 dias. Nunca mais digitado.
--
-- A LICAO, QUE JA ESTA NO CLAUDE.md
--
-- Secao "O banco e COMPARTILHADO: a ordem do deploy nao e detalhe". Em resumo:
-- apagar coluna so depois que o codigo que parou de usa-la estiver em
-- producao, e a verificacao que vale e rodar a consulta que o codigo de
-- origin/main faz, inteira, contra o banco — nao listar o que se lembra de ter
-- apagado. Um `grep` pelo nome da coluna nao encontra o embed do PostgREST,
-- que e resolvido pela RELACAO.

ALTER TABLE producoes DROP COLUMN IF EXISTS funil_ids;
ALTER TABLE producoes DROP COLUMN IF EXISTS funil_id;

-- ── As provas ───────────────────────────────────────────────────────────────
DO $prova$
DECLARE
  v_n     int;
  v_cards int;
BEGIN
  -- 1. as duas sumiram, e com elas a chave estrangeira
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'producoes'
     AND column_name IN ('funil_id', 'funil_ids');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'ainda ha % coluna(s) de funil em producoes', v_n;
  END IF;

  -- 2. nenhum card se perdeu — o que ela pediu em voz alta no dia do incidente
  SELECT count(*) INTO v_cards FROM producoes;
  IF v_cards < 4098 THEN
    RAISE EXCEPTION 'producoes tem % cards, eram 4.098', v_cards;
  END IF;

  -- 3. o metodo do video continua inteiro (ele NAO sai nesta migracao)
  SELECT count(*) INTO v_n FROM producoes
   WHERE funil_video IS NOT NULL AND funil_video <> '';
  IF v_n < 2000 THEN
    RAISE EXCEPTION 'funil_video caiu para % linhas', v_n;
  END IF;

  -- 4. e o que substitui as colunas segue de pe
  SELECT count(DISTINCT producao_id) INTO v_n FROM vw_criativo_funil;
  IF v_n < 300 THEN
    RAISE EXCEPTION 'vw_criativo_funil ligou so % cards', v_n;
  END IF;

  -- 5. a consulta que o codigo EM PRODUCAO faz hoje continua rodando inteira.
  --    E a prova que faltou na 20260921c, e e a razao de ela ter quebrado.
  PERFORM p.id, p.nome, p.tipo, p.fase, p.funil_video, p.data_inicio,
          p.data_prazo, p.editor_nome_historico, p.tipo_teste,
          oe.nome, pe.nome
     FROM producoes p
     LEFT JOIN ofertas_editores oe ON oe.id = p.projeto_id
     LEFT JOIN perfis pe           ON pe.id = p.responsavel_id
    LIMIT 5;
END
$prova$;

NOTIFY pgrst, 'reload schema';
