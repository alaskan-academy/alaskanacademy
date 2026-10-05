/* A busca lia so `html` e `legenda`. Com o tipo `checklist`, os itens ficariam
   invisiveis: quem procurasse por uma palavra que so existe num item nao acharia
   o processo. Para o "Checklist de Revisao de ADs" isso nao morderia hoje (o
   texto completo tambem esta nos blocos de texto), mas morderia no primeiro
   processo que nascesse so com checklist — e sem nada na tela denunciando.

   A migracao tem DUAS partes, e a segunda e a que se esquece: trocar a funcao
   NAO reindexa o que ja existe, porque `busca` so recalcula quando a linha e
   tocada. Sem o UPDATE, os artigos de hoje ficariam com o indice velho. */
CREATE OR REPLACE FUNCTION public.fn_texto_dos_blocos(p_blocos jsonb)
RETURNS text LANGUAGE sql IMMUTABLE
AS $function$
  select coalesce(btrim(regexp_replace(regexp_replace(
    (select string_agg(
              coalesce(b->'dados'->>'html', '') || ' ' ||
              coalesce(b->'dados'->>'legenda', '') || ' ' ||
              coalesce((select string_agg(i->>'texto', ' ')
                          from jsonb_array_elements(
                                 case when jsonb_typeof(b->'dados'->'itens') = 'array'
                                      then b->'dados'->'itens' else '[]'::jsonb end) i), ''),
              ' ' order by ord)
       from jsonb_array_elements(coalesce(p_blocos, '[]'::jsonb)) with ordinality t(b, ord)),
    '<[^>]*>', ' ', 'g'), '\s+', ' ', 'g')), '');
$function$;

COMMENT ON FUNCTION public.fn_texto_dos_blocos(jsonb) IS
  'Texto de um artigo para a busca: html, legenda e os itens de bloco `checklist`. Os itens entraram em 28/09/2026 — sem eles, um processo feito so de checklist nao seria encontrado. Ver 20260928e.';

DO $prova$
DECLARE v_antes int; v_depois int; v_n int;
BEGIN
  SELECT count(*) INTO v_antes FROM processos_artigos WHERE ativo;

  /* Reindexa TODOS: tocar a linha e o que recalcula `busca`. */
  UPDATE processos_artigos SET atualizado_em = atualizado_em;

  SELECT count(*) INTO v_depois FROM processos_artigos WHERE ativo;
  IF v_antes <> v_depois THEN
    RAISE EXCEPTION 'o reindex mexeu na contagem: % -> %', v_antes, v_depois;
  END IF;

  /* O que ja funcionava continua funcionando. */
  SELECT count(*) INTO v_n FROM processos_artigos
   WHERE ativo AND busca @@ plainto_tsquery('portuguese', 'safezone');
  IF v_n < 1 THEN RAISE EXCEPTION 'a busca por safezone parou de achar'; END IF;

  SELECT count(*) INTO v_n FROM processos_artigos
   WHERE ativo AND busca @@ plainto_tsquery('portuguese', 'recesso');
  IF v_n < 1 THEN RAISE EXCEPTION 'a busca por recesso parou de achar'; END IF;

  /* E a novidade: um item de checklist entra no indice. Testado num bloco
     de mentira, desfeito em seguida. */
  IF position('palavraunicadeprova' in
      fn_texto_dos_blocos('[{"tipo":"checklist","dados":{"itens":[{"texto":"palavraunicadeprova"}]}}]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'o item de checklist NAO entrou no texto da busca';
  END IF;

  /* E o bloco sem `itens` nao quebra a funcao. */
  IF fn_texto_dos_blocos('[{"tipo":"texto","dados":{"html":"<p>ok</p>"}}]'::jsonb) IS DISTINCT FROM 'ok' THEN
    RAISE EXCEPTION 'a funcao mudou o resultado de um bloco de texto simples';
  END IF;

  RAISE NOTICE 'busca reindexada em % artigos', v_depois;
END
$prova$;

NOTIFY pgrst, 'reload schema';
