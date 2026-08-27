-- As quatro funções da Produção, que existiam no banco e em nenhuma migração.
--
-- Foram aplicadas direto durante a revisão da área e ficaram sem arquivo. Um
-- banco reconstruído a partir de `supabase/migrations` sairia sem elas, e a
-- tela quebraria no primeiro "aprovar" — sem nada aqui explicando o que
-- faltou. Este arquivo é a definição real, extraída do catálogo com
-- `pg_get_functiondef`, não uma reescrita de memória.

-- ── fn_proxima_fase ─────────────────────────────────────────────────────────
-- A ordem das fases vem da TABELA, não de uma lista no código. Era o quarto
-- mapa de fases da área; os outros três estavam no front, cada um com a sua
-- versão do fluxo. `bloqueado` e `arquivado` ficam de fora porque são becos:
-- entra-se neles de propósito, não avançando.
CREATE OR REPLACE FUNCTION public.fn_proxima_fase(p_tipo text, p_fase text)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  with fluxo as (
    select f.chave, f.ordem
      from public.producao_fases f
      join public.producao_fases_tipo t on t.fase_chave = f.chave and t.tipo = p_tipo
     where f.chave not in ('bloqueado','arquivado')
  )
  select chave from fluxo
   where ordem > (select ordem from fluxo where chave = p_fase)
   order by ordem
   limit 1;
$function$;

-- ── fn_aprovar_criativo ─────────────────────────────────────────────────────
-- `for update` na leitura: dois aprovadores clicando junto avançariam duas
-- fases em vez de uma, e o histórico registraria a mesma origem duas vezes.
CREATE OR REPLACE FUNCTION public.fn_aprovar_criativo(p_criativo_id uuid, p_usuario_id uuid)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare
  v_tipo text;
  v_fase text;
  v_next text;
begin
  select tipo, fase into v_tipo, v_fase
    from public.producoes where id = p_criativo_id
    for update;

  if v_fase is null then
    raise exception 'Criativo % nao encontrado', p_criativo_id;
  end if;

  v_next := fn_proxima_fase(v_tipo, v_fase);

  -- 'alteracao' so se alcanca por devolucao; aprovar pula por cima dela.
  if v_next = 'alteracao' then
    v_next := fn_proxima_fase(v_tipo, 'alteracao');
  end if;

  if v_next is null then
    raise exception 'A fase "%" ja e a ultima do fluxo de %', v_fase, v_tipo;
  end if;

  update public.producoes
     set fase = v_next, atualizado_em = now()
   where id = p_criativo_id;

  insert into public.criativo_historico
    (criativo_id, usuario_id, tipo_alteracao, campo_alterado, valor_anterior, valor_novo)
  values
    (p_criativo_id, p_usuario_id, 'fase', 'fase', v_fase, v_next);

  return v_next;
end;
$function$;

-- ── fn_devolver_criativo ────────────────────────────────────────────────────
-- A nota é obrigatória: devolver sem dizer o motivo transfere o trabalho sem
-- transferir a informação, e quem recebe volta a perguntar no chat.
CREATE OR REPLACE FUNCTION public.fn_devolver_criativo(p_criativo_id uuid, p_usuario_id uuid, p_nota text, p_mencionados uuid[] DEFAULT '{}'::uuid[])
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  v_fase  text;
  v_nome  text;
  v_resp  uuid;
  v_pessoa uuid;
begin
  if coalesce(btrim(p_nota), '') = '' then
    raise exception 'A nota de devolucao e obrigatoria';
  end if;

  select fase, nome, responsavel_id into v_fase, v_nome, v_resp
    from public.producoes where id = p_criativo_id
    for update;

  if v_fase is null then
    raise exception 'Criativo % nao encontrado', p_criativo_id;
  end if;

  update public.producoes
     set fase = 'alteracao', atualizado_em = now()
   where id = p_criativo_id;

  insert into public.criativo_historico
    (criativo_id, usuario_id, tipo_alteracao, campo_alterado, valor_anterior, valor_novo)
  values
    (p_criativo_id, p_usuario_id, 'fase', 'fase', v_fase, 'alteracao');

  insert into public.criativo_comentarios (criativo_id, autor_id, texto, tipo)
  values (p_criativo_id, p_usuario_id, btrim(p_nota), 'devolucao');

  foreach v_pessoa in array coalesce(p_mencionados, '{}') loop
    if v_pessoa <> p_usuario_id then
      insert into public.notificacoes
        (usuario_id, tipo, mensagem, referencia_id, referencia_tipo)
      values
        (v_pessoa, 'mencao_comentario',
         format('Voce foi mencionado em uma nota de devolucao em "%s".', v_nome),
         p_criativo_id, 'criativo');
    end if;
  end loop;

  -- O responsável recebe aviso mesmo sem ser mencionado — mas só uma vez, e
  -- nunca quando é ele próprio quem devolveu.
  if v_resp is not null and v_resp <> p_usuario_id
     and not (v_resp = any(coalesce(p_mencionados, '{}'))) then
    insert into public.notificacoes
      (usuario_id, tipo, mensagem, referencia_id, referencia_tipo)
    values
      (v_resp, 'criativo_alteracao',
       format('"%s" foi devolvido para alteracao.', v_nome),
       p_criativo_id, 'criativo');
  end if;
end;
$function$;

-- ── fn_duplicar_criativos ───────────────────────────────────────────────────
-- As colunas vêm da própria tabela via `jsonb_populate_record`, e não de uma
-- lista escrita à mão. Havia DUAS implementações de duplicar no front, cada
-- uma com ~25 campos copiados, e já divergiam: uma perdia `video_story_url` e
-- a outra não gravava histórico. Uma coluna nova agora é copiada sozinha.
--
-- Só duas saem de fora, e por serem identidade e não conteúdo: `ad_id_meta`
-- (a cópia ainda não é um anúncio) e `variacao_de` (a cópia é irmã do
-- original, não filha dele).
CREATE OR REPLACE FUNCTION public.fn_duplicar_criativos(p_ids uuid[], p_usuario uuid)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
AS $function$
declare
  v_novo uuid;
  v_origem record;
begin
  for v_origem in
    select * from public.producoes where id = any(p_ids)
  loop
    v_novo := gen_random_uuid();

    insert into public.producoes
    select (jsonb_populate_record(
      null::public.producoes,
      to_jsonb(v_origem)
        - 'ad_id_meta'
        - 'variacao_de'
        || jsonb_build_object(
             'id',            v_novo,
             'nome',          v_origem.nome || ' (cópia)',
             'criado_em',     now(),
             'atualizado_em', now(),
             'criado_por',    p_usuario
           )
    )).*;

    insert into public.criativo_historico
      (criativo_id, usuario_id, tipo_alteracao, campo_alterado, valor_anterior, valor_novo)
    values
      (v_novo, p_usuario, 'criacao', 'nome', v_origem.nome, v_origem.nome || ' (cópia)');

    return next v_novo;
  end loop;
end;
$function$;
