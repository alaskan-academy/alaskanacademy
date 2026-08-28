-- ── A chave do Obsidian sai de baixo do tapete ────────────────────────────
--
-- `configuracoes_texto` guardava a chave do Obsidian (64 caracteres, viva) com
-- `authenticated_read USING (true)` e `authenticated_write ALL true/true`:
-- qualquer usuario logado lia a chave, e escrevia em qualquer configuracao.
--
-- A regra e por COLUNA e nao por lista de chaves no policy. Uma lista
-- (`chave <> 'obsidian_api_key'`) e a terceira armadilha do CLAUDE.md: o
-- segundo segredo entra sem ninguem lembrar de mexer na policy, e nasce aberto.
-- Com a coluna, um segredo novo se declara segredo na propria linha.
--
-- A chave nao vai para o Vault porque quem a usa e o NAVEGADOR: o sync do
-- Obsidian fala com `http://127.0.0.1:27123`, a maquina de quem esta usando.
-- Vault so alcanca Edge Function. Conferido com ela: so admin roda Obsidian.
ALTER TABLE public.configuracoes_texto
  ADD COLUMN IF NOT EXISTS segredo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.configuracoes_texto.segredo IS
  'Linha que so admin le e escreve. Marque true para qualquer chave, token ou senha.';

UPDATE public.configuracoes_texto SET segredo = true WHERE chave = 'obsidian_api_key';

DROP POLICY IF EXISTS authenticated_read  ON public.configuracoes_texto;
DROP POLICY IF EXISTS authenticated_write ON public.configuracoes_texto;

-- Uma policy so, para ALL: `USING` guarda a linha como ELA ESTA, entao ninguem
-- consegue virar `segredo` de true para false para depois ler.
--
-- Conferido fazendo-se passar por uma usuaria nao-admin: ela ve
-- `analises_spreadsheet_id` e `notas_admin`, e a chave do Obsidian nao existe
-- para ela. O aviso de planilha das Analises, que le e escreve
-- `analises_spreadsheet_id`, continua funcionando para todo mundo.
CREATE POLICY configuracoes_texto_por_segredo ON public.configuracoes_texto
  FOR ALL TO authenticated
  USING      (NOT segredo OR public.fn_sou_admin())
  WITH CHECK (NOT segredo OR public.fn_sou_admin());

-- ── Referencias: a tela dizia uma coisa, o banco fazia outra ───────────────
--
-- A tela calcula `podeEditar = isAdmin || criado_por === user.id` e esconde os
-- botoes. O banco tinha `USING (true) WITH CHECK (true)`: qualquer autenticado
-- editava, arquivava ou excluia qualquer referencia pela API. Era porta pintada
-- na parede, o mesmo caso das quatro tabelas do Copy.
--
-- Agora as duas pontas dizem a mesma coisa, e a MESMA que `radar_testes` ja
-- dizia -- duas tabelas irmas com dois modelos de permissao era como estava.
--
-- Conferido antes de aplicar: das 34 referencias vivas, ZERO tem `criado_por`
-- nulo, entao ninguem perde acesso ao que ja e seu. E conferido depois, como
-- nao-admin: ela acha a referencia alheia (ver todo mundo ve) e nao consegue
-- arquiva-la.
DROP POLICY IF EXISTS referencias_update ON public.referencias;
DROP POLICY IF EXISTS referencias_insert ON public.referencias;

CREATE POLICY referencias_update ON public.referencias
  FOR UPDATE TO authenticated
  USING      (criado_por = auth.uid() OR public.fn_sou_admin())
  WITH CHECK (criado_por = auth.uid() OR public.fn_sou_admin());

-- O insert continua aberto (todo mundo pode contribuir), mas passa a exigir que
-- a pessoa se declare dona: sem isso nasceria referencia sem dono, que so admin
-- editaria depois -- foi assim que os 25 espelhos do Funis ficaram travados.
CREATE POLICY referencias_insert ON public.referencias
  FOR INSERT TO authenticated
  WITH CHECK (criado_por = auth.uid());
