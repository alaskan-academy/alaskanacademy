-- A menção com sobrenome para de acordar o xará
--
-- A Jaqueline escreveu "@Jessica Maihato informando um detalhe pra essas
-- variações" e o sino tocou nas DUAS Jessicas. Medido: essa linha gerou
-- notificação para "Jessica Gavazza + Jessica Maihato", e a Gavazza não tinha
-- nada com o assunto.
--
-- A causa está numa linha só de `fn_comentario_notifica`:
--
--     v_texto LIKE '%@' || lower(split_part(p.nome, ' ', 1)) || '%'
--
-- `LIKE '%@jessica%'` casa com "@jessica maihato" também — o `%` do fim não
-- liga para o que vem depois. Então quem se chama Jessica casa com toda menção
-- a qualquer Jessica, por mais completo que o nome escrito esteja.
--
-- E o texto quase sempre vem completo: o seletor de menção do drawer insere
-- `@${perfil.nome}`, nome e sobrenome. Quem escolheu na lista escolheu UMA
-- pessoa, e mesmo assim as duas eram avisadas.
--
-- ── O que muda ───────────────────────────────────────────────────────────
--
-- O primeiro nome CONTINUA valendo, porque gente digita "@ana" na mão e perder
-- esse aviso seria trocar um defeito por outro pior: ruído no sino alguém
-- percebe, silêncio não.
--
-- O que ele passa a respeitar é o resto da frase: um primeiro nome só conta
-- quando o texto NÃO nomeou por inteiro outra pessoa que se chama assim. Se
-- "@Jessica Maihato" está escrito, a menção tem dona e a homônima sai de cena;
-- se está escrito só "@Jessica", ninguém sabe qual delas é — inclusive quem
-- leu —, e as duas continuam sendo avisadas.
--
-- A checagem não filtra por `q.ativo` de propósito: escrever o nome inteiro de
-- alguém desativado é uma menção àquela pessoa, e não à xará que ficou.
--
-- Conferido contra os perfis reais antes de aplicar. Há exatamente uma colisão
-- de primeiro nome na base (Jessica Gavazza e Jessica Maihato):
--
--   texto                              antes                    depois
--   "@Jessica Maihato informando…"     Gavazza + Maihato        Maihato
--   "@Jessica Gavazza confere aí"      Gavazza + Maihato        Gavazza
--   "@jessica olha isso"               Gavazza + Maihato        Gavazza + Maihato
--   "@Jaqueline Coelho, vê isso"       Jaqueline                Jaqueline
--
-- A última linha é o teste de que nada quebrou: vírgula colada no nome já era
-- o motivo de a regra viver aqui e não no `@(\S+)` do navegador.

CREATE OR REPLACE FUNCTION public.fn_comentario_notifica()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_texto  text := lower(coalesce(NEW.texto, ''));
  v_nome   text;
  v_resp   uuid;
  v_pai    uuid;
BEGIN
  SELECT nome, responsavel_id INTO v_nome, v_resp
    FROM producoes WHERE id = NEW.criativo_id;

  -- Menções. Numa nota de devolução o responsável fica de fora: ele já recebe
  -- o aviso de que o card voltou, e duas linhas no sino para uma ação só é
  -- ruído. A regra é declarativa de propósito -- não depende de qual gatilho
  -- roda primeiro.
  INSERT INTO notificacoes (usuario_id, tipo, mensagem, referencia_id, referencia_tipo)
  SELECT p.id,
         'mencao_comentario',
         'Você foi mencionado em '
           || CASE WHEN NEW.tipo = 'devolucao' THEN 'uma nota de devolução'
                   WHEN NEW.resposta_a IS NOT NULL THEN 'uma resposta'
                   ELSE 'um comentário' END
           || ' em "' || coalesce(v_nome, 'um criativo') || '".',
         NEW.criativo_id,
         'criativo'
    FROM perfis p
   WHERE p.ativo
     AND p.id IS DISTINCT FROM NEW.autor_id
     AND NOT (NEW.tipo = 'devolucao' AND p.id = v_resp)
     AND (
           -- O nome inteiro nomeia UMA pessoa, e é o que o seletor escreve.
           v_texto LIKE '%@' || lower(p.nome) || '%'

           -- O primeiro nome sozinho vale quando ninguém mais se chama assim,
           -- ou quando o texto não desempatou escrevendo o nome inteiro de
           -- outro xará. É a linha que fazia a Gavazza receber o recado da
           -- Maihato.
        OR (v_texto LIKE '%@' || lower(split_part(p.nome, ' ', 1)) || '%'
            AND NOT EXISTS (
                  SELECT 1
                    FROM perfis q
                   WHERE q.id <> p.id
                     AND lower(split_part(q.nome, ' ', 1))
                         = lower(split_part(p.nome, ' ', 1))
                     AND v_texto LIKE '%@' || lower(q.nome) || '%'))
         );

  -- Resposta avisa quem escreveu o comentário respondido -- a não ser que ele
  -- já tenha sido avisado logo acima, ou que esteja respondendo a si mesmo.
  IF NEW.resposta_a IS NOT NULL THEN
    SELECT autor_id INTO v_pai FROM criativo_comentarios WHERE id = NEW.resposta_a;

    IF v_pai IS NOT NULL AND v_pai <> NEW.autor_id
       AND NOT EXISTS (SELECT 1 FROM notificacoes n
                        WHERE n.usuario_id = v_pai
                          AND n.referencia_id = NEW.criativo_id
                          AND n.tipo = 'mencao_comentario'
                          AND n.criado_em >= now() - interval '1 second')
    THEN
      INSERT INTO notificacoes (usuario_id, tipo, mensagem, referencia_id, referencia_tipo)
      SELECT v_pai,
             'resposta_comentario',
             coalesce(pa.nome, 'Alguém') || ' respondeu você em "' || coalesce(v_nome, 'um criativo') || '".',
             NEW.criativo_id,
             'criativo'
        FROM (SELECT nome FROM perfis WHERE id = NEW.autor_id) pa;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_comentario_notifica() IS
  'Comentario novo avisa quem foi mencionado e, se for resposta, quem esta sendo respondido. '
  'O primeiro nome so vale quando o texto nao nomeou por inteiro outro xara.';
