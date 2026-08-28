-- ── O aviso de recado passa a dizer QUEM escreveu ─────────────────────────
--
-- Uma correcao de rota, registrada: ela pediu "que os recados disparem
-- notificacao para todos", e eu escrevi um gatilho para isso. So que
-- `fn_recado_notifica` JA fazia exatamente isso desde sempre -- avisa todo
-- perfil ativo, menos quem escreveu.
--
-- Descobri porque testei num begin/rollback antes de dizer que estava pronto:
-- cada pessoa recebeu DUAS notificacoes. Sem o teste, eu teria entregado a
-- primeira armadilha do CLAUDE.md de mao beijada -- dois mecanismos fazendo a
-- mesma coisa, divergindo na primeira mudanca. O meu foi embora; ficou o que ja
-- existia.
--
-- A funcionalidade nunca tinha disparado por um motivo simples: `recados` esta
-- VAZIA. Ninguem nunca postou. O mural nao esta quebrado, esta sem uso -- e
-- ninguem usa um quadro sobre o qual nao e avisado.
--
-- O que valia a pena da minha versao entrou aqui: a mensagem era so o texto do
-- recado, sem autor. Num sino que junta aviso de criativo, de mencao e de
-- mural, "amanha a reuniao muda para as 14h" chega sem dizer quem disse -- e
-- recado sem autor e recado que ninguem sabe se pode seguir. E o
-- `regexp_replace` nas quebras de linha, porque recado de tres paragrafos
-- virava tres linhas dentro de um item de lista que espera uma.

-- O gatilho duplicado que eu cheguei a criar sai daqui, e sai idempotente: em
-- banco novo ele nunca existiu, e em banco que ja rodou a versao errada ele
-- some sozinho, sem precisar de ninguem lembrando de rodar a mao.
DROP TRIGGER  IF EXISTS trg_recado_avisa_a_equipe ON public.recados;
DROP FUNCTION IF EXISTS public.fn_recado_avisa_a_equipe();

CREATE OR REPLACE FUNCTION public.fn_recado_notifica()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_autor  text;
  v_resumo text;
BEGIN
  SELECT nome INTO v_autor FROM perfis WHERE id = NEW.criado_por;

  v_resumo := regexp_replace(trim(NEW.texto), '\s+', ' ', 'g');
  IF length(v_resumo) > 120 THEN
    v_resumo := left(v_resumo, 119) || '…';
  END IF;

  INSERT INTO notificacoes (usuario_id, tipo, mensagem, referencia_id, referencia_tipo)
  SELECT p.id,
         'recado_novo',
         coalesce(v_autor, 'Alguém') || ' no mural: "' || v_resumo || '"',
         NEW.id,
         'recado'
    FROM perfis p
   WHERE p.ativo
     AND p.id IS DISTINCT FROM NEW.criado_por;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_recado_notifica() IS
  'Recado novo vira notificacao para todo perfil ativo, menos quem escreveu, com o nome de quem escreveu na mensagem.';

-- ── Evento que se repete pode pular um dia ────────────────────────────────
--
-- O proprio formulario avisava: "Ainda nao da para pular uma ocorrencia
-- especifica -- se a reuniao de uma semana nao acontecer, ela continua
-- aparecendo". Aviso honesto, e o jeito de resolver era um so: um lugar para
-- guardar as datas que nao valem.
--
-- Um array de datas na propria linha, e nao tabela filha: a serie inteira ja
-- mora numa linha so (`recorrencia_tipo`, `recorrencia_dias_semana`,
-- `recorrencia_fim`), e uma tabela a parte para guardar tres datas seria a
-- unica parte da recorrencia morando em outro lugar.
--
-- E pular NAO e excluir: a serie continua, e a data volta se alguem tirar da
-- lista. Por isso o formulario mostra os dias pulados com um X ao lado -- sem
-- isso, o dia sumiria da agenda e nao haveria por onde traze-lo de volta.
ALTER TABLE public.eventos
  ADD COLUMN IF NOT EXISTS recorrencia_puladas date[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.eventos.recorrencia_puladas IS
  'Datas em que esta serie NAO acontece. Pular nao e excluir: tirar a data daqui traz a ocorrencia de volta.';
