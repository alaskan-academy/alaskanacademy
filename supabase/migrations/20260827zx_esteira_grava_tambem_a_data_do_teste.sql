-- Enviar para a esteira gravava a mudanca de fase e calava a mudanca de data.
--
-- O painel do gestor troca DUAS coisas no card: a fase e a data do teste. So a
-- primeira virava historico. Era o mesmo defeito que o Calendario tinha -- data
-- reescrita sem rastro -- corrigido de um lado e deixado em pe do outro.
--
-- Apareceu num teste de ponta a ponta: 5 cards do AD 060 foram para a esteira
-- com `data_inicio` 19/08 -> 31/08, e nasceu uma linha de historico por card,
-- so a da fase.
--
-- A linha da data so nasce quando a data MUDA de verdade: reenviar um card para
-- o mesmo dia nao precisa virar registro.
--
-- E a contagem passa a sair de `movidos`, nao de `reg`: agora que um card pode
-- render duas linhas de historico, contar as linhas diria "10 cards enviados"
-- para 5 cards.
CREATE OR REPLACE FUNCTION public.fn_enviar_para_esteira(
  p_ids uuid[], p_data date, p_usuario uuid
) RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_n integer;
BEGIN
  WITH antes AS (
    SELECT id, fase, data_inicio
      FROM producoes
     WHERE id = ANY(p_ids) AND fase = 'aprovado'
  ), movidos AS (
    UPDATE producoes p
       SET fase = 'esteira_teste', data_inicio = p_data
      FROM antes a WHERE p.id = a.id
    RETURNING p.id, a.fase AS de_fase, a.data_inicio AS de_data
  ), linhas AS (
    SELECT m.id, 'fase'::text AS tipo, 'fase'::text AS campo,
           m.de_fase::text AS de, 'esteira_teste'::text AS para
      FROM movidos m
    UNION ALL
    SELECT m.id, 'campo', 'data_inicio', m.de_data::text, p_data::text
      FROM movidos m
     WHERE m.de_data IS DISTINCT FROM p_data
  ), reg AS (
    INSERT INTO criativo_historico
      (criativo_id, usuario_id, tipo_alteracao, campo_alterado, valor_anterior, valor_novo)
    SELECT l.id, p_usuario, l.tipo, l.campo, l.de, l.para FROM linhas l
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM movidos;
  RETURN v_n;
END;
$function$;

COMMENT ON FUNCTION public.fn_enviar_para_esteira(uuid[], date, uuid) IS
  'Move cards aprovados para esteira_teste com a data de teste em data_inicio, e grava no historico a fase e a data. Nao toca em data_prazo.';
