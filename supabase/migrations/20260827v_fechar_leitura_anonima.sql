-- Fechar a leitura anônima de 15 tabelas internas.
--
-- Cada uma tinha TRÊS políticas: `authenticated_write` (ALL), `authenticated_read`
-- (SELECT) e mais uma `FOR SELECT TO public USING (true)` — chamada `anon_read`
-- em 13 delas e `processos_*_select` nas duas de Processos.
--
-- `public` no Postgres inclui o papel `anon`, que é o papel da chave publicável
-- que vai dentro do bundle do frontend. Qualquer pessoa com a URL do projeto
-- lia o conteúdo inteiro sem login. Não era teórico — assumindo o papel `anon`
-- a consulta devolveu 9 processos, 2 editores e 14 avaliações mensais.
--
-- O que estava exposto vai além dos processos internos: `editor_comissoes`
-- (quanto cada um recebe), `avaliacoes_mensais` (desempenho), `editor_folgas` e
-- `editores` (dados pessoais). O CLAUDE.md já manda o oposto — a política
-- padrão de tabela interna é `FOR ALL TO authenticated`.
--
-- Derrubar as públicas não tira nada de quem está logado: as outras duas
-- políticas já cobrem `authenticated` por inteiro. Conferido antes de aplicar:
--
--   * as 12 edge functions usam SERVICE_ROLE, que ignora RLS;
--   * `/login` e `/setup` são as únicas rotas fora do ProtectedRoute, e as duas
--     só tocam `perfis`, que não está nesta lista;
--   * `windsor_meta_staging` não recebe nada desde 24/07, e escrita anônima já
--     era impossível — não existe política de INSERT para `anon` em nenhuma.

do $$
declare
  t text;
  p text;
  alvos text[] := array[
    'avaliacoes_criativos', 'avaliacoes_mensais', 'cargos', 'criterio_opcoes',
    'criterios_avaliacao', 'editor_comissoes', 'editor_folgas', 'editor_promocoes',
    'editores', 'empresas', 'ofertas_editores', 'processos_artigos',
    'processos_categorias', 'vendas_hotmart', 'windsor_meta_staging'
  ];
begin
  foreach t in array alvos loop
    -- Pelo NOME encontrado no catálogo, e não por uma lista de nomes escrita
    -- aqui: são dois padrões diferentes (`anon_read` e `processos_*_select`), e
    -- um terceiro que alguém crie depois cairia fora de uma lista fixa.
    for p in
      select policyname from pg_policies
       where schemaname = 'public' and tablename = t
         and 'public' = any(roles)
    loop
      execute format('drop policy %I on public.%I', p, t);
    end loop;

    -- Cinto e suspensório. A RLS já barrava a escrita anônima, mas o GRANT
    -- continuava lá: bastava alguém criar uma política `TO public` sem pensar
    -- para o anon passar a escrever. Sem o GRANT, a porta não existe.
    execute format('revoke all on public.%I from anon', t);

    -- Garante que sobrou o caminho de quem está logado, mesmo que alguém tenha
    -- apagado a política `authenticated_*` alguma hora.
    if not exists (
      select 1 from pg_policies
       where schemaname = 'public' and tablename = t
         and 'authenticated' = any(roles) and cmd in ('SELECT','ALL')
    ) then
      execute format(
        'create policy %I on public.%I for all to authenticated using (true) with check (true)',
        t || '_authenticated', t);
    end if;
  end loop;
end $$;
