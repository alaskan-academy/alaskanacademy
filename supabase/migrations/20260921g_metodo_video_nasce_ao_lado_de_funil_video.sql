-- METODO_VIDEO NASCE AO LADO DE FUNIL_VIDEO (fase 1 de 3)
--
-- `producoes.funil_video` guarda TSL / VSL / QUIZ / WhatsApp. Isso e o METODO
-- do video, nao o funil — o nome e divida antiga, e ele convivia com
-- `producoes.funil_id`, que era outra coisa. Dois campos com "funil" no nome
-- significando coisas diferentes e como a primeira armadilha do CLAUDE.md
-- comeca.
--
-- POR QUE EM TRES FASES, E NAO UM `ALTER ... RENAME`
--
-- Renomear coluna tem EXATAMENTE o mesmo perigo que apagar: o codigo em
-- producao le `funil_video`, e o rename quebra na hora. Em 21/09/2026 isso
-- derrubou a Producao duas vezes no mesmo dia, com colunas provadamente
-- vazias. A licao esta no CLAUDE.md, secao "O banco e COMPARTILHADO: a ordem
-- do deploy nao e detalhe". A ordem segura:
--
--   fase 1 (esta)  coluna nova ao lado, preenchida, com gatilho mantendo as
--                  duas em sincronia nos DOIS sentidos
--   fase 2         o codigo passa a ler e escrever `metodo_video`; push,
--                  deploy, e conferir a tela em producao
--   fase 3         so entao `funil_video` sai, junto com o gatilho
--
-- Entre a fase 1 e a fase 3, os dois campos coexistem — e coexistem sem
-- divergir, porque nenhum dos dois e editavel sozinho: o gatilho deriva um do
-- outro. E a forma que o CLAUDE.md pede quando dois campos precisam conviver
-- por compatibilidade.
--
-- O gatilho tambem resolve a quarta armadilha: `UPDATE ... SET metodo_video`
-- sozinho seria carga inicial sem gatilho, e todo card criado depois nasceria
-- com a coluna nova vazia.

ALTER TABLE producoes ADD COLUMN IF NOT EXISTS metodo_video text;

UPDATE producoes SET metodo_video = funil_video
 WHERE metodo_video IS DISTINCT FROM funil_video;

CREATE OR REPLACE FUNCTION fn_espelha_metodo_video() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    /* Quem escreveu, manda. Na fase 2 o codigo escreve `metodo_video`; hoje
       ele ainda escreve `funil_video`. */
    IF NEW.metodo_video IS NOT NULL AND NEW.funil_video IS NULL THEN
      NEW.funil_video := NEW.metodo_video;
    ELSE
      NEW.metodo_video := NEW.funil_video;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.metodo_video IS DISTINCT FROM OLD.metodo_video THEN
    NEW.funil_video := NEW.metodo_video;
  ELSIF NEW.funil_video IS DISTINCT FROM OLD.funil_video THEN
    NEW.metodo_video := NEW.funil_video;
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_espelha_metodo_video ON producoes;
CREATE TRIGGER trg_espelha_metodo_video
  BEFORE INSERT OR UPDATE OF funil_video, metodo_video
  ON producoes FOR EACH ROW EXECUTE FUNCTION fn_espelha_metodo_video();

-- As opcoes do seletor sao lidas de `criativo_campos_opcoes` por `campo`. Sem
-- isto o formulario da fase 2 abriria com a lista vazia.
INSERT INTO criativo_campos_opcoes (campo, valor, ordem)
SELECT 'metodo_video', valor, ordem
  FROM criativo_campos_opcoes WHERE campo = 'funil_video'
    ON CONFLICT (campo, valor) DO NOTHING;

-- ── As provas ───────────────────────────────────────────────────────────────
DO $prova$
DECLARE
  v_n int;
BEGIN
  -- 1. a coluna nova existe e nao divergiu de ninguem
  SELECT count(*) INTO v_n FROM producoes
   WHERE metodo_video IS DISTINCT FROM funil_video;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'metodo_video ja nasce divergindo em % linhas', v_n;
  END IF;

  -- 2. o backfill alcancou o que havia
  SELECT count(*) INTO v_n FROM producoes WHERE metodo_video IS NOT NULL;
  IF v_n < 2000 THEN
    RAISE EXCEPTION 'metodo_video ficou com so % linhas preenchidas', v_n;
  END IF;

  -- 3. o seletor da fase 2 tem o que mostrar
  SELECT count(*) INTO v_n FROM criativo_campos_opcoes WHERE campo = 'metodo_video';
  IF v_n < 4 THEN
    RAISE EXCEPTION 'criativo_campos_opcoes tem so % opcoes de metodo_video', v_n;
  END IF;

  -- 4. o gatilho sincroniza NOS DOIS SENTIDOS, medido de verdade e desfeito.
  --    Subtransacao propria: a prova escreve, confere e volta atras.
  BEGIN
    DECLARE
      v_id  uuid;
      v_ida text;
      v_volta text;
    BEGIN
      SELECT id INTO v_id FROM producoes WHERE funil_video IS NOT NULL LIMIT 1;

      UPDATE producoes SET metodo_video = 'PROVA-IDA' WHERE id = v_id;
      SELECT funil_video INTO v_ida FROM producoes WHERE id = v_id;

      UPDATE producoes SET funil_video = 'PROVA-VOLTA' WHERE id = v_id;
      SELECT metodo_video INTO v_volta FROM producoes WHERE id = v_id;

      IF v_ida <> 'PROVA-IDA' OR v_volta <> 'PROVA-VOLTA' THEN
        RAISE EXCEPTION 'gatilho nao espelhou: ida=% volta=%', v_ida, v_volta;
      END IF;

      RAISE EXCEPTION 'desfazendo a prova';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'desfazendo a prova' THEN RAISE; END IF;
    END;
  END;
END
$prova$;

NOTIFY pgrst, 'reload schema';
