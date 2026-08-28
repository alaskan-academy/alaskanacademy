-- Espelho sem dono nao e o mesmo que "so do admin".
--
-- 33 dos 44 espelhos do Funis tem `criado_por` nulo, porque a origem tambem
-- tem: `testes_funis.criado_por` so foi preenchido em 11 das 44 linhas. Nao ha
-- dono para herdar, e inventar um seria pior que nao ter.
--
-- Mas a policy era `criado_por = auth.uid() OR admin`, e `null = auth.uid()`
-- da NULL -- entao "sem dono" virou "so admin" por acidente de logica ternaria,
-- nao por decisao de ninguem. O efeito na tela: quem nao e admin nao conseguia
-- preencher area, projeto nem aprendizado em 33 dos 44 testes de funil, que sao
-- justamente os campos que so existem no Radar e que a pagina inteira pede.
--
-- (O espelho em si ja acompanha o Funis desde o gatilho: ele e SECURITY
-- DEFINER e nao passa por RLS. Conferido fazendo-se passar por uma usuaria
-- nao-admin: editar o titulo no Funis reflete no Radar mesmo num espelho sem
-- dono. Isto aqui e sobre anotar o espelho a mao.)
--
-- A regra nova, DERIVADA da origem e nao copiada dela:
--
--   e espelho do Funis, e a pessoa enxerga o teste de origem
--     -> pode anotar o espelho
--
-- O `EXISTS` roda com a permissao de quem chama, entao ele pergunta de verdade
-- "voce ve este teste no Funis?". Hoje `testes_funis` e aberta a todo
-- autenticado e isso vale para todos; se um dia fechar, isto fecha junto,
-- sozinho. Escrever `fonte = 'funis'` e pronto seria a primeira armadilha do
-- CLAUDE.md: duas regras dizendo a mesma coisa, prontas para divergir.
--
-- E, separadamente: teste sem dono nenhum e da empresa. Hoje isso so alcanca
-- espelhos (dos 30 testes proprios do Radar, ZERO estao sem dono), mas a regra
-- vale para o dia em que alcancar outra coisa.
--
-- Conferido depois, como nao-admin: consegue anotar o espelho sem dono, e
-- continua sem conseguir editar um teste proprio do Radar de outra pessoa.
DROP POLICY IF EXISTS radar_testes_update ON public.radar_testes;

CREATE POLICY radar_testes_update ON public.radar_testes
  FOR UPDATE TO authenticated
  USING (
    criado_por = auth.uid()
    OR public.fn_sou_admin()
    OR criado_por IS NULL
    OR (fonte = 'funis'
        AND EXISTS (SELECT 1 FROM public.testes_funis f WHERE f.id = radar_testes.fonte_id))
  );

COMMENT ON POLICY radar_testes_update ON public.radar_testes IS
  'Dono, admin, teste sem dono, ou espelho cuja origem no Funis a pessoa enxerga.';
