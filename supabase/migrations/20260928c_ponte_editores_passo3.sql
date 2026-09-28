-- PONTE perfis → editores, PASSO 3: A FICHA PASSA A NASCER SOZINHA
--
-- A ligação entre as duas tabelas existia e morava só no TypeScript. Sumiu num
-- merge em 18/07/2026, e por 69 dias nenhum editor novo ganhou ficha: o Gabriel
-- Nartey (28/09) e a Bruna Leopoldo, que fez 709 cards e recebeu R$ 3.677,50
-- sem nunca aparecer na tela de Editores.
--
-- Agora ela mora num gatilho. O que mora só no TypeScript morre num merge de
-- TypeScript; o que mora numa migração fica.
--
-- ── A CONDIÇÃO SAI DE TABELA, NÃO DE LISTA NO CÓDIGO ───────────────────────
--
--   nasce ficha quando o setor da pessoa tem `pagina_key = 'editores'`
--
-- Não é "o setor se chama Editor" escrito aqui dentro: `setores.pagina_key` já
-- existia no banco, já valia `'editores'` no setor Editor e nulo nos outros
-- três, e ninguém lia desde julho. No dia em que Copy virar setor avaliado, é
-- UMA LINHA na tabela de setores — não uma migração nova. É a terceira
-- armadilha do CLAUDE.md pelo lado certo.
--
-- ── AS TRÊS COISAS QUE A FICHA CARIMBA, E POR QUE CADA UMA ─────────────────
--
-- Uma conferência adversarial em 28/09 simulou a ficha nascendo como cadastro
-- simples e mediu o estrago de cada campo que faltasse:
--
--   `ativo`       DEFAULT true na tabela. Sem copiar de `perfis`, a Bruna —
--                 que já saiu — nasceria ATIVA, entraria no ranking de
--                 Desempenho e, como "Bruna" vem antes de "Gabriel", viraria a
--                 escolhida na aba de Notas Fiscais.
--
--   `data_inicio` Sem ela, `fn_nfs_do_editor` cobra competências anteriores à
--                 entrada da pessoa — exatamente o que a 20260928b consertou.
--                 E a data certa NÃO é a criação do perfil: para a Bruna o
--                 perfil é de 21/07/2026 e o primeiro card é de 21/07/**2025**,
--                 um ano de diferença. Vale o primeiro card; sem card, a
--                 criação do perfil.
--
--   `cargo_id`    O mais grave, e o menos óbvio. `AvaliacoesTab` lê o cargo de
--                 `editores.cargo_id`, NUNCA de `perfis.cargo_id`, e é dele que
--                 sai o degrau do multiplicador. Sem carimbar, o "Novato" com
--                 multiplicador ZERO — o pedido que abriu este dia inteiro —
--                 pagaria comissão CHEIA, e o 1 ficaria congelado no
--                 `multiplicador_snapshot` daquela avaliação. O conserto
--                 principal do dia não valeria justamente para a primeira
--                 pessoa que ele deveria atender.
--
-- ── ELE CRIA; ELE NAO ESPELHA ──────────────────────────────────────────────
--
-- A primeira versao desta migracao mantinha `nome`, `cargo_id` e `ativo` da
-- ficha sempre iguais aos do perfil. Um ataque adversarial mediu o estrago, e
-- ele era grande:
--
--   · `PerfisTab.tsx:307` — registrar uma PROMOCAO na linha do tempo do editor
--     grava `editores.cargo_id` e nao toca em `perfis`. Com o espelho ligado, o
--     proximo toque qualquer no perfil desfazia a promocao. Medido no ensaio:
--     "promocao gravada = Senior (x1.3) ; depois de UPDATE perfis = Pleno (x1.2)".
--   · `UsuarioPerfisTab` tem um botao de Ativo proprio, que voltaria sozinho.
--   · e como `perfis.nome` NAO e protegido por `trg_perfil_nao_se_promove`,
--     uma pessoa comum, so salvando o proprio nome, disparava o espelho.
--
-- O certo a longo prazo e `perfis` ser dono e as telas pararem de escrever na
-- ficha. Mas isso NAO e uma decisao tecnica: `perfis.cargo_id` manda na RLS,
-- entao promover alguem na linha do tempo passaria a CONCEDER PERMISSAO. Quem
-- decide isso e ela, e ela pediu o passo 3, nao a troca de dono do cargo.
--
-- Entao o gatilho faz o que o nome dele diz: a ficha NASCE do perfil. Depois de
-- nascida, ela e dela. As duas colunas continuam podendo divergir — como ja
-- divergem hoje —, e isso fica NOMEADO como a proxima decisao, nao resolvido as
-- escondidas dentro de uma migracao que foi pedida para outra coisa.
--
-- A unica coisa que continua acompanhando e a SAIDA do setor avaliado, porque
-- ali nao ha tela competindo: ninguem marca `editores.ativo = true` quando a
-- pessoa deixa de ser editora.
--
-- ── O GATILHO NUNCA APAGA ──────────────────────────────────────────────────
--
-- Quem sai da empresa, ou troca para um setor sem `pagina_key`, fica com
-- `ativo = false`. Apagar levaria junto avaliações, notas e remuneração: 6 das
-- 7 tabelas filhas são CASCADE.
--
-- ── O PASSADO ENTRA PELO MESMO CAMINHO DO PRESENTE ─────────────────────────
--
-- A carga inicial não é uma segunda cópia da regra: é um `UPDATE perfis SET
-- id = id` que DISPARA o gatilho. Uma regra só, um lugar só. A quarta armadilha
-- do CLAUDE.md é exatamente a carga inicial que envelhece sozinha ao lado do
-- gatilho que a mantém.
--
-- ── ORDEM, E POR QUE ESTA MIGRAÇÃO PODE RODAR AGORA ────────────────────────
--
-- O passo 1 (20260928b) subiu e ela confirmou a tela. O código que faltava — a
-- aba de Notas Fiscais deixar de escolher pessoa sozinha — está no mesmo commit
-- desta migração. Nenhuma coluna é apagada, então o cenário de 21/09 não
-- existe; desfazer é `drop trigger` e as fichas novas viram `ativo=false`.

-- Quem JA tinha ficha antes desta migracao. As provas precisam distinguir: o
-- que nasce agora e responsabilidade desta migracao; o que ja estava e dado
-- anterior, e consertar dado antigo escondido dentro de uma migracao de
-- estrutura e como o estrago viaja sem ninguem ver.
CREATE TEMP TABLE _ponte3_antes AS SELECT id FROM editores;

-- E o retrato das fichas que ja existiam, coluna por coluna, para a prova 5
-- confirmar que nenhuma delas foi tocada. Contagem fixa no codigo seria uma
-- bomba: uma avaliacao legitima criada entre hoje e o apply abortaria a
-- migracao sem nada estar errado. Comparar com o retrato do inicio da propria
-- transacao nao tem esse defeito.
CREATE TEMP TABLE _ponte3_retrato AS
SELECT e.id, e.nome, e.cargo_id, e.data_inicio, e.ativo, e.usuario_id
  FROM editores e;

CREATE TEMP TABLE _ponte3_contagens AS
SELECT (SELECT count(*) FROM avaliacoes_mensais)    AS aval,
       (SELECT count(*) FROM editor_notas)          AS notas,
       (SELECT count(*) FROM editores_remuneracao)  AS remun,
       (SELECT count(*) FROM avaliacoes_criativos)  AS aval_criativos,
       (SELECT count(*) FROM documentos_fiscais)    AS docs;

-- ── 1. A regra, num lugar só ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_editor_nasce_do_perfil()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_e_editor   boolean;
  v_ficha      uuid;
  v_primeiro   date;
BEGIN
  SELECT s.pagina_key = 'editores'
    INTO v_e_editor
    FROM setores s WHERE s.id = NEW.setor_id;
  v_e_editor := coalesce(v_e_editor, false);

  SELECT e.id INTO v_ficha FROM editores e WHERE e.usuario_id = NEW.id;

  IF NOT v_e_editor THEN
    /* Saiu do setor avaliado: a ficha nao some, so apaga. O historico dela
       continua com dono. */
    IF v_ficha IS NOT NULL THEN
      UPDATE editores SET ativo = false WHERE id = v_ficha AND ativo;
    END IF;
    RETURN NEW;
  END IF;

  /* A data de entrada: o primeiro card da pessoa, e nao a criacao do perfil.
     Para a Bruna sao 21/07/2025 contra 21/07/2026 — um ano, e essa data e o
     piso de cobranca de nota fiscal. */
  SELECT min(p.criado_em)::date INTO v_primeiro
    FROM producoes p WHERE p.responsavel_id = NEW.id;

  /* Ja tem ficha: nao mexe. Ela nasceu do perfil e agora e dela — as telas de
     promocao e de perfil escrevem nela, e espelhar aqui desfaria o trabalho
     delas no toque seguinte. Ver o cabecalho. */
  IF v_ficha IS NOT NULL THEN
    RETURN NEW;
  END IF;

  /* Antes de criar, ADOTA uma ficha orfa de mesmo nome — senao o historico de
     quem ja tinha ficha sem `usuario_id` fica pendurado na linha velha e a nova
     nasce vazia.

     Mas so durante a CARGA. Fora dela, `usuario_id` nulo significa "alguem
     desvinculou de proposito" (PermissoesTab.tsx:232 faz exatamente isso), e
     readotar desfaria a desvinculacao no toque seguinte — medido no ensaio:
     "apos desvincular = DESVINCULADA ; apos um toque no perfil = <id de volta>".
     Orfa por nascer e orfa por desvinculo sao indistinguiveis, entao quem
     decide e o contexto, nao a linha. */
  IF current_setting('ponte.carga', true) = 'on' THEN
    SELECT e.id INTO v_ficha
      FROM editores e
     WHERE e.usuario_id IS NULL AND lower(btrim(e.nome)) = lower(btrim(NEW.nome))
     LIMIT 1;
  END IF;

  IF v_ficha IS NOT NULL THEN
    UPDATE editores
       SET usuario_id  = NEW.id,
           cargo_id    = coalesce(cargo_id, NEW.cargo_id),
           data_inicio = coalesce(data_inicio, v_primeiro, NEW.created_at::date),
           ativo       = NEW.ativo
     WHERE id = v_ficha;
  ELSE
    INSERT INTO editores (nome, usuario_id, cargo_id, data_inicio, ativo)
    VALUES (NEW.nome, NEW.id, NEW.cargo_id,
            coalesce(v_primeiro, NEW.created_at::date), NEW.ativo);
  END IF;

  RETURN NEW;
END
$fn$;

COMMENT ON FUNCTION public.fn_editor_nasce_do_perfil() IS
  'A ficha de editor NASCE do perfil quando o setor tem pagina_key=editores, carimbando cargo_id (senao o multiplicador do cargo nao vale), data_inicio do primeiro card (senao cobra NF de antes da entrada) e ativo (senao quem saiu volta ativo). Depois de nascida a ficha e dela: NAO espelha, porque as telas de promocao e de perfil escrevem nela. So a saida do setor continua acompanhando, e nunca apagando. Ver 20260928c.';

DROP TRIGGER IF EXISTS trg_editor_nasce_do_perfil ON perfis;
CREATE TRIGGER trg_editor_nasce_do_perfil
  AFTER INSERT OR UPDATE OF nome, cargo_id, setor_id, ativo ON perfis
  FOR EACH ROW EXECUTE FUNCTION public.fn_editor_nasce_do_perfil();

-- ── 2. E quando um SETOR passa a ser avaliado ───────────────────────────────
-- O cabecalho promete "no dia em que Copy virar setor avaliado, e UMA LINHA na
-- tabela de setores". Sem isto a promessa era falsa: marcar `pagina_key` nao
-- criaria ficha nenhuma, so faria o painel do passo 1 acusar pendencia ate
-- alguem tocar cada perfil a mao. Promessa no comentario e codigo que nao a
-- cumpre e a segunda armadilha em forma de documentacao.
CREATE OR REPLACE FUNCTION public.fn_setor_avaliado_puxa_perfis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  /* Toca os perfis do setor para o gatilho de `perfis` fazer o resto. Uma regra
     so, num lugar so — este aqui nao sabe criar ficha, so sabe cutucar. */
  UPDATE perfis SET nome = nome WHERE setor_id = NEW.id;
  RETURN NEW;
END
$fn$;

COMMENT ON FUNCTION public.fn_setor_avaliado_puxa_perfis() IS
  'Marcar `setores.pagina_key` passa a valer na hora: cutuca os perfis do setor para trg_editor_nasce_do_perfil criar as fichas. Nao duplica a regra — so dispara a de perfis. Ver 20260928c.';

DROP TRIGGER IF EXISTS trg_setor_avaliado_puxa_perfis ON setores;
CREATE TRIGGER trg_setor_avaliado_puxa_perfis
  AFTER UPDATE OF pagina_key ON setores
  FOR EACH ROW
  WHEN (NEW.pagina_key IS DISTINCT FROM OLD.pagina_key)
  EXECUTE FUNCTION public.fn_setor_avaliado_puxa_perfis();

-- ── 3. O passado, pelo MESMO caminho ────────────────────────────────────────
-- Nao ha uma segunda copia da regra aqui: so um toque que dispara o gatilho.
--
-- `SET nome = nome`, e nao `SET id = id`: o gatilho e `UPDATE OF nome,
-- cargo_id, setor_id, ativo`, e o Postgres decide se dispara pela LISTA DO SET,
-- nao pelo valor ter mudado. Tocar uma coluna fora da lista faz a carga rodar
-- em silencio e nao criar ficha nenhuma — e a prova 1 so acusaria depois, sem
-- dizer por que. Escrito assim de proposito para a proxima pessoa nao "limpar".
--
-- `ponte.carga` liga a adocao de ficha orfa por nome, que so pode valer aqui:
-- fora da carga, orfa quer dizer "desvincularam de proposito".
SET LOCAL ponte.carga = 'on';
UPDATE perfis SET nome = nome;
SET LOCAL ponte.carga = 'off';

-- ── AS PROVAS ───────────────────────────────────────────────────────────────
DO $prova$
DECLARE
  v_n int; v_falta text; v_r record;
BEGIN
  -- 1. O painel do passo 1 tem que ter zerado. Era ele que denunciava.
  SELECT sem_linha INTO v_n FROM vw_ponte_editores_saude;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'ainda faltam % fichas — a carga nao pegou todo mundo', v_n;
  END IF;

  -- 2. E ninguem entrou que nao devia: a Helena (setor Especialista, sem
  --    pagina_key) fica de fora, pela regra, sem excecao escrita.
  SELECT string_agg(e.nome, ', ') INTO v_falta
    FROM editores e
    JOIN perfis p ON p.id = e.usuario_id
    LEFT JOIN setores s ON s.id = p.setor_id
   WHERE coalesce(s.pagina_key, '') <> 'editores';
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'ficha criada para quem nao e de setor avaliado: %', v_falta;
  END IF;

  -- 3. Os TRES carimbos, um por um, SO nas fichas que nasceram agora.
  --
  --    O escopo nao e detalhe: a Jaqueline tem `data_inicio` 02/10/2025 e o
  --    primeiro card dela e de 20/05/2024. A versao anterior desta prova cobria
  --    todas as fichas e abortava a migracao por causa desse dado — de 2024,
  --    que nao tem nada a ver com o que esta sendo feito aqui. Prova que pune o
  --    que a funcao nem tocou nao mede a funcao; mede outra coisa, e impede o
  --    trabalho por um motivo que ninguem entende na hora.
  --
  --    (Essa divergencia da Jaqueline continua de pe e foi relatada. Consertar
  --    dado antigo e tarefa propria, com decisao dela — nao carona.)
  FOR v_r IN
    SELECT p.nome, p.ativo AS perfil_ativo, p.cargo_id AS perfil_cargo,
           e.ativo AS ficha_ativa, e.cargo_id AS ficha_cargo, e.data_inicio,
           (SELECT min(pr.criado_em)::date FROM producoes pr WHERE pr.responsavel_id = p.id) AS primeiro_card
      FROM perfis p
      JOIN setores s ON s.id = p.setor_id AND s.pagina_key = 'editores'
      JOIN editores e ON e.usuario_id = p.id
     WHERE e.id NOT IN (SELECT id FROM _ponte3_antes)
  LOOP
    IF v_r.ficha_ativa IS DISTINCT FROM v_r.perfil_ativo THEN
      RAISE EXCEPTION '% nasceu com ativo=% e o perfil diz % — quem saiu voltaria a aparecer',
        v_r.nome, v_r.ficha_ativa, v_r.perfil_ativo;
    END IF;
    IF v_r.ficha_cargo IS DISTINCT FROM v_r.perfil_cargo THEN
      RAISE EXCEPTION '% ficou sem o cargo do perfil — o multiplicador do cargo nao valeria', v_r.nome;
    END IF;
    IF v_r.data_inicio IS NULL THEN
      RAISE EXCEPTION '% ficou sem data_inicio — a aba de NF cobraria meses de antes da entrada', v_r.nome;
    END IF;
    IF v_r.primeiro_card IS NOT NULL AND v_r.data_inicio > v_r.primeiro_card THEN
      RAISE EXCEPTION '% comeca em % e ja tinha card em % — a data esta depois do trabalho',
        v_r.nome, v_r.data_inicio, v_r.primeiro_card;
    END IF;
  END LOOP;

  -- 4. Uma pessoa, uma ficha. O indice do passo 1 vigia, isto confere.
  SELECT count(*) INTO v_n FROM (
    SELECT usuario_id FROM editores WHERE usuario_id IS NOT NULL
     GROUP BY usuario_id HAVING count(*) > 1) x;
  IF v_n > 0 THEN RAISE EXCEPTION '% pessoas com mais de uma ficha', v_n; END IF;

  -- 5a. As fichas que JA EXISTIAM nao foram tocadas. Esta prova e a contrapartida
  --     de o gatilho ter parado de espelhar: se ele voltar a espelhar, a
  --     promocao registrada na linha do tempo do editor seria desfeita, e e
  --     aqui que isso aparece.
  SELECT string_agg(a.nome, ', ') INTO v_falta
    FROM _ponte3_retrato a JOIN editores e ON e.id = a.id
   WHERE (a.nome, a.cargo_id, a.data_inicio, a.ativo, a.usuario_id)
      IS DISTINCT FROM (e.nome, e.cargo_id, e.data_inicio, e.ativo, e.usuario_id);
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'a migracao alterou ficha que ja existia: % — ela so deveria CRIAR', v_falta;
  END IF;

  -- 5b. E nada do passado se perdeu. Comparado com o retrato do inicio desta
  --     transacao, e nao com numero escrito no codigo — que abortaria a
  --     migracao so porque alguem lancou uma avaliacao legitima nesse meio.
  SELECT string_agg(x.o_que, ', ') INTO v_falta FROM (
    SELECT 'avaliacoes_mensais' AS o_que FROM _ponte3_contagens c
      WHERE (SELECT count(*) FROM avaliacoes_mensais) < c.aval
    UNION ALL SELECT 'editor_notas' FROM _ponte3_contagens c
      WHERE (SELECT count(*) FROM editor_notas) < c.notas
    UNION ALL SELECT 'editores_remuneracao' FROM _ponte3_contagens c
      WHERE (SELECT count(*) FROM editores_remuneracao) < c.remun
    UNION ALL SELECT 'avaliacoes_criativos' FROM _ponte3_contagens c
      WHERE (SELECT count(*) FROM avaliacoes_criativos) < c.aval_criativos
    UNION ALL SELECT 'documentos_fiscais' FROM _ponte3_contagens c
      WHERE (SELECT count(*) FROM documentos_fiscais) < c.docs
  ) x;
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'linhas desapareceram de: %', v_falta;
  END IF;

  -- 6. O ranking nao ganhou ninguem inativo — era o estrago medido: a Bruna
  --    entrando em 1o lugar com 100%.
  SELECT string_agg(e.nome, ', ') INTO v_falta
    FROM fn_desempenho_editores(date '2020-01-01', date '2030-12-31') d
    JOIN editores e ON e.id = d.editor_id
   WHERE NOT e.ativo;
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'editor inativo entrou no ranking: %', v_falta;
  END IF;

  -- 7. E o Gabriel nao abre a aba de NF devendo mes nenhum de antes.
  SELECT count(*) INTO v_n
    FROM editores e
   CROSS JOIN LATERAL fn_nfs_do_editor(e.id) n
   WHERE n.competencia < date_trunc('month', e.data_inicio)::date;
  IF v_n > 0 THEN
    RAISE EXCEPTION '% cobrancas de competencia anterior a entrada da pessoa', v_n;
  END IF;

  -- 8. O gatilho de `setores` cumpre a promessa do cabecalho: marcar um setor
  --    cria as fichas na hora. Provado ligando e desligando `pagina_key` do
  --    setor Copy dentro de uma sub-transacao que desfaz.
  BEGIN
    UPDATE setores SET pagina_key = 'editores' WHERE nome = 'Copy';
    SELECT count(*) INTO v_n
      FROM perfis p JOIN setores s ON s.id = p.setor_id AND s.nome = 'Copy'
     WHERE NOT EXISTS (SELECT 1 FROM editores e WHERE e.usuario_id = p.id);
    RAISE EXCEPTION 'ROLLBACK_PROVA_8:%', v_n;
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_falta = MESSAGE_TEXT;
    IF v_falta LIKE 'ROLLBACK_PROVA_8:%' THEN
      IF split_part(v_falta, ':', 2)::int <> 0 THEN
        RAISE EXCEPTION 'marcar um setor como avaliado NAO criou as fichas — % perfis ficaram sem',
          split_part(v_falta, ':', 2);
      END IF;
    ELSE
      RAISE;
    END IF;
  END;

  RAISE NOTICE 'passo 3: % fichas, % ativas, painel zerado',
    (SELECT count(*) FROM editores), (SELECT count(*) FROM editores WHERE ativo);
END
$prova$;

DROP TABLE IF EXISTS _ponte3_antes;
DROP TABLE IF EXISTS _ponte3_retrato;
DROP TABLE IF EXISTS _ponte3_contagens;

NOTIFY pgrst, 'reload schema';
