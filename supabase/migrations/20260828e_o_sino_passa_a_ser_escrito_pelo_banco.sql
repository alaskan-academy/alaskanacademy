-- ── Quem escreve no sino e o banco ────────────────────────────────────────
--
-- Tres defeitos medidos, com uma causa so.
--
-- 1. A policy de INSERT em `notificacoes` era `WITH CHECK (true)`: qualquer
--    pessoa logada podia gravar notificacao para qualquer outra. Precisava ser
--    assim porque os inserts rodavam no navegador, gravando linha de outro
--    usuario -- e isso tornava o sino forjavel.
--
-- 2. Nenhum dos inserts conferia o erro. Recusado pelo RLS, nada acontecia e
--    ninguem ficava sabendo -- foi assim que o `cs-sync` falhou 52 dias
--    seguidos em silencio.
--
-- 3. A mesma regra estava escrita em VARIOS lugares. `criativo_alteracao` em
--    tres (CriativoDrawer, KanbanView e a propria `fn_devolver_criativo`), e o
--    bloco de @mencao em tres tambem (duas vezes no mesmo arquivo, mais a
--    funcao). E elas ja discordavam: so a do banco pulava o responsavel quando
--    ele ja tinha sido mencionado. Armadilha nº 1 do CLAUDE.md, e o numero
--    mostra o preco -- `criativo_alteracao` NUNCA disparou (0 linhas), e
--    ninguem podia dizer qual dos tres caminhos funcionava.
--
-- Com o gatilho, a regra tem um dono. E como ele e SECURITY DEFINER, a policy
-- pode fechar: nao ha mais nenhum insert vindo do navegador.

-- ── Card devolvido para alteracao ─────────────────────────────────────────
--
-- No `producoes`, e nao no `criativo_historico`: `fase` e a verdade, o
-- historico e o registro dela. E pegar a tabela pega os TRES caminhos de uma
-- vez -- o botao do drawer, o arrastar do kanban e o `fn_devolver_criativo` --,
-- inclusive os que ainda nao existem.
CREATE OR REPLACE FUNCTION public.fn_criativo_devolvido_notifica()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.responsavel_id IS NULL THEN
    RETURN NEW;   -- 1.766 dos 3.965 cards estao assim: nao ha a quem avisar
  END IF;

  -- Quem devolveu nao precisa ser avisado do que acabou de fazer.
  IF NEW.responsavel_id = auth.uid() THEN
    RETURN NEW;
  END IF;

  INSERT INTO notificacoes (usuario_id, tipo, mensagem, referencia_id, referencia_tipo)
  VALUES (NEW.responsavel_id,
          'criativo_alteracao',
          '"' || NEW.nome || '" foi devolvido para alteração.',
          NEW.id,
          'criativo');

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_criativo_devolvido_notifica() IS
  'Card que entra na fase alteracao avisa o responsavel. Dono unico da regra: o front nao escreve mais notificacao.';

DROP TRIGGER IF EXISTS trg_criativo_devolvido_notifica ON public.producoes;

CREATE TRIGGER trg_criativo_devolvido_notifica
  AFTER UPDATE OF fase ON public.producoes
  FOR EACH ROW
  WHEN (NEW.fase = 'alteracao' AND OLD.fase IS DISTINCT FROM 'alteracao')
  EXECUTE FUNCTION public.fn_criativo_devolvido_notifica();

-- ── Comentario: mencao, e agora tambem resposta ───────────────────────────
--
-- A resposta e nova, e cobre o buraco mais obvio que a medicao mostrou:
-- responder a alguem nao avisava ninguem. So o @ avisava -- e hoje NENHUM dos
-- 65 comentarios tem "@". A expectativa mais natural de um fio de comentarios,
-- "alguem me respondeu", nao produzia nada.
--
-- O casamento por LIKE em minusculas, e nao por regex: "@ana," nao encontrava
-- ninguem no front porque `@(\S+)` levava a virgula junto.
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
     AND (v_texto LIKE '%@' || lower(split_part(p.nome, ' ', 1)) || '%'
       OR v_texto LIKE '%@' || lower(p.nome) || '%');

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
  'Comentario novo avisa quem foi mencionado e, se for resposta, quem esta sendo respondido.';

DROP TRIGGER IF EXISTS trg_comentario_notifica ON public.criativo_comentarios;

CREATE TRIGGER trg_comentario_notifica
  AFTER INSERT ON public.criativo_comentarios
  FOR EACH ROW EXECUTE FUNCTION public.fn_comentario_notifica();

-- ── `fn_devolver_criativo` para de escrever notificacao ───────────────────
--
-- Ela fazia as duas coisas que agora tem gatilho: avisava os mencionados e
-- avisava o responsavel. Era a terceira copia da mesma regra, e a unica que
-- pulava o responsavel quando ele ja tinha sido mencionado -- as outras duas
-- nao sabiam dessa regra. Essa parte boa foi para dentro do gatilho do
-- comentario; o resto sai daqui.
--
-- `p_mencionados` continua na assinatura de proposito, e IGNORADO. Nao e
-- descuido: o front que esta no ar agora chama com quatro argumentos, e trocar
-- a assinatura antes do deploy derrubaria o botao de devolver ate a hora do
-- push. As mencoes agora saem do proprio texto da nota, que e de onde o front
-- ja as tirava -- o parametro pode ser removido depois que a versao nova
-- estiver publicada.
--
-- E `p_usuario_id` deixa de mandar sozinho: quem esta logado tem preferencia.
-- Do jeito que estava, o cliente dizia quem ele era, e o historico gravava
-- isso sem conferir.
CREATE OR REPLACE FUNCTION public.fn_devolver_criativo(
  p_criativo_id uuid,
  p_usuario_id  uuid,
  p_nota        text,
  p_mencionados uuid[] DEFAULT '{}'::uuid[]
)
RETURNS void
LANGUAGE plpgsql
AS $function$
declare
  v_fase text;
  v_quem uuid := coalesce(auth.uid(), p_usuario_id);
begin
  if coalesce(btrim(p_nota), '') = '' then
    raise exception 'A nota de devolucao e obrigatoria';
  end if;

  select fase into v_fase
    from public.producoes where id = p_criativo_id
    for update;

  if v_fase is null then
    raise exception 'Criativo % nao encontrado', p_criativo_id;
  end if;

  -- Esta linha e o que dispara o aviso ao responsavel, via gatilho.
  update public.producoes
     set fase = 'alteracao', atualizado_em = now()
   where id = p_criativo_id;

  insert into public.criativo_historico
    (criativo_id, usuario_id, tipo_alteracao, campo_alterado, valor_anterior, valor_novo)
  values
    (p_criativo_id, v_quem, 'fase', 'fase', v_fase, 'alteracao');

  -- E esta e o que dispara os avisos de mencao, tambem via gatilho.
  insert into public.criativo_comentarios (criativo_id, autor_id, texto, tipo)
  values (p_criativo_id, v_quem, btrim(p_nota), 'devolucao');
end;
$function$;

COMMENT ON FUNCTION public.fn_devolver_criativo(uuid, uuid, text, uuid[]) IS
  'Devolve o card para alteracao. Nao escreve notificacao: quem faz isso sao os gatilhos. p_mencionados e ignorado e existe so para nao quebrar o front publicado.';

-- ── O sino fecha para escrita vinda do navegador ──────────────────────────
--
-- Era `WITH CHECK (true)`: qualquer pessoa logada gravava notificacao para
-- qualquer outra, e uma mensagem forjada chegava com a mesma cara de uma
-- legitima. So dava para ser assim porque os inserts rodavam no front,
-- escrevendo linha de outro usuario.
--
-- Agora quem escreve sao gatilhos SECURITY DEFINER, que passam por fora do
-- RLS. Sobra a permissao de escrever para si mesmo -- inofensiva, e o unico
-- caso que uma tela poderia querer um dia.
DROP POLICY IF EXISTS notificacoes_insert_auth ON public.notificacoes;
DROP POLICY IF EXISTS notificacoes_insert_propria ON public.notificacoes;

CREATE POLICY notificacoes_insert_propria ON public.notificacoes
  FOR INSERT TO authenticated
  WITH CHECK (usuario_id = auth.uid());
