-- ── Recesso entra na agenda ───────────────────────────────────────────────
--
-- Feriado e o que o calendario do pais manda; recesso e o que a empresa
-- decide -- os dias entre o Natal e o Ano Novo, a parada de fim de ano, a
-- semana que ninguem trabalha porque foi combinado que nao. Sao coisas
-- diferentes: uma nao se escolhe, a outra sim, e misturar as duas embaixo de
-- "feriado" apagaria justamente a informacao de quem decidiu.
--
-- Os dois param a empresa inteira, entao os dois avisam com quatro dias de
-- antecedencia na tela de Inicio -- o que sai de `TIPOS_QUE_PARAM`, no front,
-- e nao de uma lista repetida na consulta.
--
-- Esta lista tem uma copia so, em `TIPOS_EVENTO`, e um teste
-- (`src/test/tipos-evento.test.ts`) que falha quando as duas discordam. Antes
-- do recesso eram CINCO copias no front: o `type`, o `ROTULO_TIPO`, o
-- `COR_TIPO`, as opcoes do seletor e a legenda embaixo do calendario --
-- esquecer uma nao quebrava nada, so fazia o tipo novo sair sem cor ou sumir
-- da legenda, em silencio. Terceira armadilha do CLAUDE.md.
ALTER TABLE public.eventos DROP CONSTRAINT IF EXISTS eventos_tipo_check;

ALTER TABLE public.eventos
  ADD CONSTRAINT eventos_tipo_check
  CHECK (tipo = ANY (ARRAY['reuniao', 'folga', 'feriado', 'recesso', 'marco']));

COMMENT ON COLUMN public.eventos.tipo IS
  'reuniao, folga (de uma pessoa), feriado (do pais), recesso (parada decidida pela empresa), marco. Esta lista tem copia no front, em TIPOS_EVENTO: mexer aqui e mexer la, e o teste tipos-evento.test.ts falha se as duas discordarem.';
