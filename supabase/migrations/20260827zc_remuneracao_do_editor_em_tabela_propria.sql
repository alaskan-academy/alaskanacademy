-- Duas coisas, e a primeira é uma correção de leitura minha.
--
-- Eu tinha lido os 21 cargos como "7 nomes triplicados". Não são: cada SETOR
-- tem a sua própria escada de 7 — Copy, Editor e Gestor de Tráfego. Os três
-- "Head / Líder" são de setores diferentes, e cada pessoa aponta para o do seu
-- setor. Deduplicar teria destruído o modelo.
--
-- O que faltava era a trava que garante isso: `unique (nome, setor_id)`. Sem
-- ela nada impedia dois "Pleno" no mesmo setor, e aí sim seriam duplicata de
-- verdade — com metade das pessoas em cada, divergindo em silêncio.
ALTER TABLE public.cargos
  ADD CONSTRAINT cargos_nome_por_setor_unico UNIQUE (nome, setor_id);

-- ── A remuneração sai de `editores` ─────────────────────────────────────────
--
-- `editores.multiplicador` e `percentual_lideranca` são pagamento, e estavam
-- legíveis por qualquer autenticado. Não dá para resolver com RLS: RLS é por
-- LINHA, e o problema aqui é por COLUNA — a linha do editor precisa continuar
-- visível para todo mundo, porque é dela que saem os nomes nos filtros e nos
-- mapas de várias telas.
--
-- Então a coluna sai da linha. Tabela própria, com a mesma regra das
-- avaliações: cada um vê o seu, head/líder vê o time, admin vê tudo. E
-- escrever é só de admin — quem define pagamento não é quem avalia.
CREATE TABLE public.editores_remuneracao (
  editor_id            uuid PRIMARY KEY REFERENCES public.editores(id) ON DELETE CASCADE,
  multiplicador        numeric,
  percentual_lideranca numeric,
  atualizado_em        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.editores_remuneracao IS
  'Multiplicador e percentual de lideranca do editor. Vive fora de `editores` porque a linha do editor precisa ser legivel por todos (nomes em filtros) e estes dois numeros nao.';

INSERT INTO public.editores_remuneracao (editor_id, multiplicador, percentual_lideranca)
SELECT id, multiplicador, percentual_lideranca
  FROM public.editores
 WHERE multiplicador IS NOT NULL OR percentual_lideranca IS NOT NULL;

ALTER TABLE public.editores_remuneracao ENABLE ROW LEVEL SECURITY;

CREATE POLICY editores_remuneracao_leitura ON public.editores_remuneracao
  FOR SELECT TO authenticated
  USING (fn_ve_o_time() OR editor_id = fn_meu_editor_id());

CREATE POLICY editores_remuneracao_escrita ON public.editores_remuneracao
  FOR ALL TO authenticated
  USING (fn_sou_admin())
  WITH CHECK (fn_sou_admin());

-- As colunas antigas saem de vez. Manter as duas seria a primeira armadilha do
-- CLAUDE.md — dois campos dizendo a mesma coisa divergem sempre —, e aqui a
-- divergência seria entre o valor protegido e o valor exposto.
ALTER TABLE public.editores DROP COLUMN multiplicador;
ALTER TABLE public.editores DROP COLUMN percentual_lideranca;

-- Conferido assumindo a identidade da Jaqueline (Pleno, não-admin):
--   editores visíveis          2   (os nomes continuam, e precisam continuar)
--   remunerações visíveis      1   (só a dela)
