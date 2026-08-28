-- Uma correcao de numero antes de tudo.
--
-- Eu tinha dito "72 tabelas com escrita aberta a todos". Sao 54. A consulta
-- contava politicas `FOR ALL ... USING (true)` sem olhar o PAPEL -- e boa parte
-- delas e para `service_role`, que e o webhook, nao o usuario. `vendas`,
-- `vendas_payt`, `metricas_meta`, `clientes` e `venda_itens` estavam na minha
-- lista e ja estavam certas: `service_role` escreve, `authenticated` so le.
--
-- E a regra de leitura do CLAUDE.md vale para o proprio numero: quando um
-- numero parecer estranho, ele provavelmente esta.
--
-- Das 54 restantes, a maioria e tabela de configuracao interna, onde
-- `USING (true)` para autenticado E o padrao documentado. O que segue sao as
-- quatro em que o padrao esta errado.

-- ── O historico so aceita escrita nova ────────────────────────────────────
--
-- `criativo_historico` tem 1490 linhas e e a unica memoria de quem mudou o que
-- num card. A policy era `FOR ALL ... USING (true) WITH CHECK (true)`: qualquer
-- usuario logado podia REESCREVER ou APAGAR o registro do proprio erro.
--
-- Registro que da para editar nao e registro. E hoje isso pesa mais do que
-- pesava: o "parado ha quanto tempo" da fila do gestor e a auditoria de datas
-- do Calendario leem daqui.
--
-- Conferido no codigo antes: das 12 chamadas a esta tabela, TODAS sao `select`
-- ou `insert`. Nenhuma tela edita nem apaga historico -- entao fechar update e
-- delete nao tira nada de ninguem.
--
-- Sem policy de UPDATE nem de DELETE, as duas ficam negadas: RLS nega o que nao
-- esta explicitamente permitido. O `service_role` (webhooks, funcoes) e o
-- `postgres` (migrations, painel) continuam passando por cima, que e onde uma
-- correcao de verdade deve acontecer, com alguem olhando.
--
-- Conferido depois, como usuaria nao-admin: le as 1490 linhas, grava linha
-- nova, e nao consegue reescrever nem apagar nenhuma.
DROP POLICY IF EXISTS criativo_historico_auth ON public.criativo_historico;

CREATE POLICY criativo_historico_le ON public.criativo_historico
  FOR SELECT TO authenticated USING (true);

CREATE POLICY criativo_historico_escreve ON public.criativo_historico
  FOR INSERT TO authenticated WITH CHECK (true);

COMMENT ON TABLE public.criativo_historico IS
  'So de escrever: aceita insert e select, nunca update nem delete. Registro que da para editar nao e registro.';

-- ── Dados de origem que tela nenhuma escreve ──────────────────────────────
--
-- `windsor_meta_staging` (2496 linhas) e alimentada pelo cron
-- `processar_windsor_staging`, e `vendas_hotmart` (2374) por importacao. As
-- duas tinham `authenticated_write` -- permissao que NADA no app usa: zero
-- chamadas de escrita no `src` para as duas, e as Edge Functions todas usam
-- `SUPABASE_SERVICE_ROLE_KEY`, que passa por cima de RLS.
--
-- Permissao que ninguem usa e a que um dia e usada por engano. Leitura fica
-- aberta (as telas dependem dela); escrever vira coisa de admin, que e a
-- valvula para o caso de eu nao ter achado algum fluxo.
DROP POLICY IF EXISTS authenticated_write ON public.windsor_meta_staging;
CREATE POLICY windsor_staging_escreve_admin ON public.windsor_meta_staging
  FOR ALL TO authenticated
  USING (public.fn_sou_admin()) WITH CHECK (public.fn_sou_admin());

DROP POLICY IF EXISTS authenticated_write ON public.vendas_hotmart;
CREATE POLICY vendas_hotmart_escreve_admin ON public.vendas_hotmart
  FOR ALL TO authenticated
  USING (public.fn_sou_admin()) WITH CHECK (public.fn_sou_admin());

-- ── Restos de importacao de 23/08 ─────────────────────────────────────────
--
-- `backup_projeto_20260823` (1958 linhas) e `import_a_20260823` (1548) nao sao
-- lidas por nenhuma linha de codigo -- sao rede de seguranca de uma importacao
-- de agosto que ficou para tras. Enquanto ninguem decide apaga-las, que pelo
-- menos nao fiquem abertas a todo mundo.
DROP POLICY IF EXISTS backup_projeto_auth ON public.backup_projeto_20260823;
CREATE POLICY backup_projeto_admin ON public.backup_projeto_20260823
  FOR ALL TO authenticated
  USING (public.fn_sou_admin()) WITH CHECK (public.fn_sou_admin());

DROP POLICY IF EXISTS import_a_auth ON public.import_a_20260823;
CREATE POLICY import_a_admin ON public.import_a_20260823
  FOR ALL TO authenticated
  USING (public.fn_sou_admin()) WITH CHECK (public.fn_sou_admin());
