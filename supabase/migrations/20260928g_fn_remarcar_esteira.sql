/*
  Mover um dia inteiro da esteira de teste para outra data.

  O gestor marca o teste com antecedência e nem sempre sobe no dia marcado.
  Sem isto, remarcar 8 ADs era abrir 8 cards, um a um, e o que acontecia na
  prática era o dia ficar mentindo: a esteira dizia 21/09 e os anúncios
  subiram no 28.

  NÃO dá para reusar `fn_enviar_para_esteira`: ela só age sobre `aprovado`, e
  estes cards já estão em `esteira_teste`. Rodar ela aqui devolveria 0 sem
  erro nenhum — o botão pareceria funcionar e nada mudaria.

  Duas travas de propósito:

  · só mexe em card que JÁ está em `esteira_teste`. Um id de outra fase que
    entre na lista por engano é ignorado em vez de ser arrastado para uma data
    que não é dele;
  · só grava onde a data MUDA. Reescolher o mesmo dia vira no-op e não enche o
    histórico de linha igual.

  `data_prazo` não é tocada aqui: quem cuida disso é o gatilho
  `trg_periodo_do_card`, que mantém a duração coerente. Mexer nos dois lugares
  seria a primeira armadilha do CLAUDE.md.
*/
CREATE OR REPLACE FUNCTION public.fn_remarcar_esteira(
  p_ids uuid[], p_data date, p_usuario uuid
) RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE v_n integer;
BEGIN
  WITH antes AS (
    SELECT id, data_inicio
      FROM producoes
     WHERE id = ANY(p_ids)
       AND fase = 'esteira_teste'
       AND data_inicio IS DISTINCT FROM p_data
  ), movidos AS (
    UPDATE producoes p
       SET data_inicio = p_data
      FROM antes a WHERE p.id = a.id
    RETURNING p.id, a.data_inicio AS de_data
  ), reg AS (
    INSERT INTO criativo_historico
      (criativo_id, usuario_id, tipo_alteracao, campo_alterado, valor_anterior, valor_novo)
    SELECT m.id, p_usuario, 'campo', 'data_inicio', m.de_data::text, p_data::text
      FROM movidos m
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM movidos;
  RETURN v_n;
END;
$function$;

COMMENT ON FUNCTION public.fn_remarcar_esteira(uuid[], date, uuid) IS
  'Move cards da esteira de teste para outra data. Ignora quem não está em esteira_teste e quem já está na data pedida.';
