-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ A vigência do editor segue a RLS que o resto dos dados dele já tem      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- `editor_empresa` nasceu (20261008d) com `select using (true)`, copiando a
-- política de `editores`. Mas o que ela guarda não é como `editores`: é um fato
-- do CONTRATO de uma pessoa, e o projeto já tem o padrão certo para isso em
-- `editores_remuneracao` —
--
--     fn_ve_o_time() or editor_id = fn_meu_editor_id()
--
-- `fn_ve_o_time()` é admin ou cargo que aprova; `fn_meu_editor_id()` é o próprio.
-- As duas são `security definer`, então funcionam de dentro da política sem
-- abrir mais nada.
--
-- Continua funcionando para quem precisa, e foi conferido chamando:
--
--   - o editor abre a aba dele, `fn_nfs_do_editor` lê a vigência DELE
--     (`editor_id = fn_meu_editor_id()`);
--   - a administração abre a de qualquer um (`fn_ve_o_time()`).
--
-- A escrita já era só de admin e não muda.

drop policy if exists editor_empresa_leitura on public.editor_empresa;
create policy editor_empresa_leitura on public.editor_empresa
  for select to authenticated
  using (public.fn_ve_o_time() or editor_id = public.fn_meu_editor_id());

-- ── A prova ────────────────────────────────────────────────────────────────
-- Que a política é a esperada, e não "que existe uma política" — a anterior
-- também existia, e era `true`.

do $$
declare v_regra text;
begin
  select pg_get_expr(pol.polqual, pol.polrelid) into v_regra
  from pg_policy pol join pg_class c on c.oid = pol.polrelid
  where c.relname = 'editor_empresa' and pol.polname = 'editor_empresa_leitura';

  if v_regra is null then
    raise exception 'PROVA FALHOU: a politica de leitura sumiu.';
  end if;
  if v_regra = 'true' then
    raise exception 'PROVA FALHOU: a leitura continua aberta a todo autenticado.';
  end if;
  if v_regra !~ 'fn_ve_o_time' or v_regra !~ 'fn_meu_editor_id' then
    raise exception 'PROVA FALHOU: a politica nao usa as duas funcoes esperadas: %', v_regra;
  end if;

  raise notice 'PROVA OK: leitura restrita a quem ve o time ou ao proprio editor.';
end $$;
