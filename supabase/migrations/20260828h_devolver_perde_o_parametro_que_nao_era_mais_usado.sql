-- ── `fn_devolver_criativo` perde o `p_mencionados` ────────────────────────
--
-- O parametro ficou vivo por uma migration so, e de proposito: quando os
-- gatilhos assumiram as notificacoes, o front publicado ainda chamava a funcao
-- com quatro argumentos, e trocar a assinatura antes do deploy derrubaria o
-- botao de devolver ate a hora do push. Com a versao nova no ar, o argumento
-- nao e mais mandado por ninguem.
--
-- Sai porque parametro ignorado nao fica parado: ele parece um jeito de fazer
-- alguma coisa. Alguem passa uma lista de mencionados, nada acontece, e o
-- tempo que se perde procurando o defeito e o preco da compatibilidade que
-- ninguem lembrou de remover.
--
-- As mencoes saem do texto da nota, dentro de `fn_comentario_notifica`.
DROP FUNCTION IF EXISTS public.fn_devolver_criativo(uuid, uuid, text, uuid[]);

CREATE OR REPLACE FUNCTION public.fn_devolver_criativo(
  p_criativo_id uuid,
  p_usuario_id  uuid,
  p_nota        text
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

COMMENT ON FUNCTION public.fn_devolver_criativo(uuid, uuid, text) IS
  'Devolve o card para alteracao. Nao escreve notificacao: quem faz isso sao os gatilhos em producoes e criativo_comentarios.';

-- ── E o anonimo NAO volta de carona no DROP/CREATE ────────────────────────
--
-- Errei isto na primeira tentativa e so descobri porque fui conferir depois de
-- aplicar. Eu tinha escrito so `REVOKE ALL ... FROM PUBLIC`, achando que era
-- dali que vinha a permissao. Nao e: o Supabase mantem
-- `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon,
-- authenticated, service_role`, entao o `anon` ganha um GRANT DIRETO no
-- momento do CREATE -- e revogar de PUBLIC nao encosta num grant direto.
--
-- A conferencia mostrou `anon, authenticated, postgres, service_role` onde a
-- versao antiga tinha `postgres, authenticated, service_role`. Ou seja: o
-- DROP/CREATE tinha desfeito, nesta funcao, a limpeza que tirou o anonimo das
-- funcoes do projeto. Sem olhar, eu teria dito que estava fechado.
--
-- A licao vale para toda funcao recriada aqui: permissao se escreve, nao se
-- herda do padrao.
REVOKE ALL ON FUNCTION public.fn_devolver_criativo(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_devolver_criativo(uuid, uuid, text) TO authenticated, service_role;
