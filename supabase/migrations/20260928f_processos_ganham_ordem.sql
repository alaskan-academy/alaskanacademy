/* PROCESSOS GANHAM ORDEM
 *
 * Nem `processos_categorias` nem `processos_artigos` tinham coluna de ordem, e
 * as tres listas ordenavam por `criado_em DESC` — o mais novo primeiro.
 *
 * Ja doi hoje: em "Radar Alaskan", o artigo "Como Documentar Testes no Radar
 * Alaskan", que e o tutorial de ENTRADA, aparece por ultimo. E doi muito mais
 * agora, que ela vai adicionar varios processos: um processo partido em 5
 * artigos sairia do passo 5 para o passo 1.
 *
 * A carga inicial preserva o que esta na tela HOJE (a ordem por criacao
 * decrescente), para ninguem abrir amanha e achar que embaralhou. A partir dai
 * a ordem e escolha de quem escreve. */

ALTER TABLE processos_categorias ADD COLUMN IF NOT EXISTS ordem int;
ALTER TABLE processos_artigos    ADD COLUMN IF NOT EXISTS ordem int;

COMMENT ON COLUMN processos_categorias.ordem IS
  'Posicao na grade da home. Nulo vai para o fim. Ver 20260928f.';
COMMENT ON COLUMN processos_artigos.ordem IS
  'Posicao dentro da categoria. Nulo vai para o fim. Ver 20260928f.';

/* Carga: numera na ordem que a tela ja mostrava. */
WITH n AS (
  SELECT id, row_number() OVER (ORDER BY criado_em DESC) * 10 AS pos
    FROM processos_categorias
)
UPDATE processos_categorias c SET ordem = n.pos FROM n WHERE n.id = c.id AND c.ordem IS NULL;

WITH n AS (
  SELECT id, row_number() OVER (PARTITION BY categoria_id ORDER BY criado_em DESC) * 10 AS pos
    FROM processos_artigos
)
UPDATE processos_artigos a SET ordem = n.pos FROM n WHERE n.id = a.id AND a.ordem IS NULL;

/* `* 10` para caber um item no meio sem renumerar tudo. */

DO $prova$
DECLARE v_n int; v_falta text; v_primeiro text;
BEGIN
  SELECT count(*) INTO v_n FROM processos_categorias WHERE ordem IS NULL;
  IF v_n > 0 THEN RAISE EXCEPTION '% categorias ficaram sem ordem', v_n; END IF;

  SELECT count(*) INTO v_n FROM processos_artigos WHERE ordem IS NULL;
  IF v_n > 0 THEN RAISE EXCEPTION '% artigos ficaram sem ordem', v_n; END IF;

  /* Ninguem empatou dentro da mesma categoria: empate volta a deixar a ordem
     a cargo do banco, que e o que estamos saindo de. */
  SELECT string_agg(x.cat::text, ', ') INTO v_falta FROM (
    SELECT categoria_id AS cat FROM processos_artigos
     GROUP BY categoria_id, ordem HAVING count(*) > 1) x;
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'artigos empatados na mesma categoria: %', v_falta;
  END IF;

  /* A ordem NOVA reproduz a que a tela mostrava: o primeiro por `ordem` tem de
     ser o mesmo que era o primeiro por `criado_em DESC`. */
  SELECT nome INTO v_primeiro FROM processos_categorias WHERE ativo ORDER BY criado_em DESC LIMIT 1;
  IF v_primeiro IS DISTINCT FROM
     (SELECT nome FROM processos_categorias WHERE ativo ORDER BY ordem LIMIT 1) THEN
    RAISE EXCEPTION 'a carga embaralhou as categorias: era % e virou %',
      v_primeiro, (SELECT nome FROM processos_categorias WHERE ativo ORDER BY ordem LIMIT 1);
  END IF;

  SELECT titulo INTO v_primeiro FROM processos_artigos WHERE ativo ORDER BY criado_em DESC LIMIT 1;
  IF v_primeiro IS DISTINCT FROM
     (SELECT a.titulo FROM processos_artigos a
       JOIN processos_categorias c ON c.id = a.categoria_id
      WHERE a.ativo ORDER BY c.ordem, a.ordem LIMIT 1)
     AND NOT EXISTS (SELECT 1 FROM processos_artigos WHERE ativo HAVING count(*) < 2) THEN
    RAISE NOTICE 'o primeiro artigo global mudou — esperado, porque agora a categoria manda na ordem';
  END IF;

  RAISE NOTICE 'ordem carregada: % categorias, % artigos',
    (SELECT count(*) FROM processos_categorias), (SELECT count(*) FROM processos_artigos);
END
$prova$;

NOTIFY pgrst, 'reload schema';
