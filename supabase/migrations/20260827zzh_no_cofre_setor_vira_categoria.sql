-- "Setor" queria dizer duas coisas no mesmo sistema.
--
-- Em todo lugar, setor e o TIME de uma pessoa: `setores` tem Copy, Editor,
-- Especialista e Gestor de Trafego, e e por ele que `perfis`,
-- `producao_fases` e `setor_permissoes` se orientam.
--
-- Em `acessos` a palavra era outra coisa: a finalidade da FERRAMENTA --
-- Administrativo, Area de Membros, Automacao, Banco de Dados, Construtor IA,
-- Cursos e Formacoes, Edicao, Pesquisa. Os dois vocabularios nao tem uma unica
-- palavra em comum, conferido.
--
-- O preco disso nao era teorico: nao dava para dizer "quem e do setor X ve os
-- acessos do setor X", porque os dois X sao listas diferentes. A pergunta
-- morria antes de virar codigo.
--
-- `categoria` e o que essas oito coisas sao, e e a palavra que o resto do
-- projeto ja usa para "que tipo de coisa e esta" (radar_areas, financeiro).
-- Setor volta a significar gente, em todo lugar.
--
-- Nada no banco depende da coluna: zero views, zero funcoes, zero indices --
-- conferido antes. E so `AcessosPage.tsx` toca a tabela.
ALTER TABLE public.acessos RENAME COLUMN setor TO categoria;

COMMENT ON COLUMN public.acessos.categoria IS
  'Para que serve a ferramenta (Automacao, Edicao, Pesquisa...). Nao confundir com `setores`, que e o time das pessoas.';

-- ── A lista de categorias passa a existir de verdade ──────────────────────
--
-- O painel "gerenciar setores" gravava a lista em `configuracoes`, que tem
-- `valor` NUMERIC -- e a tabela e a dos parametros fiscais, onde vivem aliquota
-- e custo fixo. Gravar um JSON de texto num campo numerico falha, e o erro era
-- engolido: a tela mostrava a categoria nova como se tivesse salvado, e no F5
-- ela sumia. A chave nunca existiu no banco: conferido, zero linhas.
--
-- O lugar certo e `configuracoes_texto`, que e chave/valor de TEXTO e ja existia
-- ao lado.
--
-- A semente sai das categorias que os 52 acessos REALMENTE usam, e nao da lista
-- que estava escrita no codigo: comecar da realidade e melhor do que comecar de
-- uma lista que envelheceu sem ninguem olhar.
INSERT INTO public.configuracoes_texto (chave, valor, segredo)
SELECT 'categorias_acessos',
       (SELECT json_agg(c ORDER BY c)::text FROM (SELECT DISTINCT categoria AS c FROM public.acessos) x),
       false
ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor;
