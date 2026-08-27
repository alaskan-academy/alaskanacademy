-- `editores.observacoes` guarda salário por extenso, e estava na linha que
-- qualquer autenticado lê.
--
-- Achado testando o conserto anterior: a aba do admin mostrou, nas observações
-- da Jaqueline, "aumento gradual de R$300 no salário, passando de R$2.200 para
-- R$2.500". Os dois editores têm texto assim — 3.225 e 2.781 caracteres, os
-- dois casando com salário/aumento/R$.
--
-- Ou seja: eu tinha protegido o multiplicador e deixado a prosa que diz o
-- valor. Faltava mover isto junto, pela mesma regra e para a mesma tabela.
--
-- O campo não é só pagamento: tem call de feedback, plano de promoção,
-- evolução. Por isso a regra de time serve — o líder precisa disso para
-- conduzir, e o colega não.

ALTER TABLE public.editores_remuneracao
  ADD COLUMN observacoes text;

COMMENT ON COLUMN public.editores_remuneracao.observacoes IS
  'Notas de carreira e remuneracao. Veio de `editores.observacoes`, que era legivel por qualquer autenticado e continha salario em texto.';

UPDATE public.editores_remuneracao r
   SET observacoes = e.observacoes
  FROM public.editores e
 WHERE e.id = r.editor_id
   AND e.observacoes IS NOT NULL;

-- Quem tem observações e não tinha linha de remuneração ganha uma agora.
INSERT INTO public.editores_remuneracao (editor_id, observacoes)
SELECT e.id, e.observacoes
  FROM public.editores e
 WHERE e.observacoes IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.editores_remuneracao r WHERE r.editor_id = e.id);

ALTER TABLE public.editores DROP COLUMN observacoes;

-- Conferido assumindo a identidade da Jaqueline (Pleno, não-admin): ela vê os
-- 2 editores pelo nome, e uma única linha de remuneração — a dela, com as
-- 3.225 letras de observação dela. As da colega sumiram.
