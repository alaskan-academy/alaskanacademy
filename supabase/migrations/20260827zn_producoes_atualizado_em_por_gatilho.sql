-- `producoes.atualizado_em` não queria dizer nada.
--
-- Ele aparecia dizendo que 100% dos cards da esteira foram mexidos nos últimos
-- 30 dias — inclusive um cuja `data_inicio` é 25/08/2025. Fui procurar o que
-- tocava todas as linhas e a resposta é que NADA toca: `producoes` não tinha
-- nenhum gatilho, e o frontend nunca escreve esse campo nessa tabela.
--
-- O que existia eram três cargas em massa que reescreveram quase tudo:
--
--   2026-07-29   1.772 linhas
--   2026-08-23   1.545 linhas   (criadas E atualizadas no mesmo dia)
--   2026-07-28     600 linhas
--
-- 3.917 das 4.093 linhas da tabela. O campo não estava desatualizado: estava
-- carimbado com a data de uma migração.
--
-- E as duas únicas coisas que o mantinham de verdade eram `fn_aprovar_criativo`
-- e `fn_devolver_criativo`, ambas com `atualizado_em = now()` na mão. Arrastar
-- um card de fase, renomear, colar um link — nada disso mexia. Esse gatilho faz
-- para todos os caminhos o que essas duas já faziam para dois.
--
-- É a quarta armadilha do CLAUDE.md pela raiz: a carga inicial preenche o
-- passado, o gatilho é que mantém o presente.
--
-- ── Conferido antes de aplicar ──────────────────────────────────────────────
--   · nenhum gatilho existente em `producoes` (não há o que atropelar)
--   · nenhum lugar do frontend escreve `producoes.atualizado_em` — grep na src
--     inteira só encontra a declaração do tipo em producao/components/types.ts
--   · nenhum job do cron escreve em `producoes`
--   · nenhuma Edge Function escreve em `producoes` (a `sync-notion-criativos`
--     grava em `notion_criativos`, que é outra tabela)
--   · as duas funções que carimbam o campo passam a ser redundantes, não
--     conflitantes: escrevem o mesmo `now()` que o gatilho escreveria
--
-- ── E o que ele impede ──────────────────────────────────────────────────────
-- O gatilho sobrescreve valor explícito: um `set atualizado_em = <data>` vira
-- `now()`. É de propósito — é o que faz o campo ser confiável. Uma carga que
-- precise preservar o histórico tem que desligar o gatilho na marra:
--
--   alter table producoes disable trigger trg_producoes_atualizado_em;
--   ...
--   alter table producoes enable  trigger trg_producoes_atualizado_em;

CREATE OR REPLACE FUNCTION public.fn_marca_atualizado_em()
 RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_marca_atualizado_em() IS
  'Carimba atualizado_em em todo UPDATE que muda alguma coluna. Existe porque o campo so era mantido por fn_aprovar_criativo e fn_devolver_criativo, e ficava parado em qualquer outra edicao.';

DROP TRIGGER IF EXISTS trg_producoes_atualizado_em ON public.producoes;

-- `WHEN (OLD.* IS DISTINCT FROM NEW.*)`: um UPDATE que não muda nada não deve
-- rejuvenescer o card. Sem isso, abrir e salvar um formulário sem editar nada
-- zeraria a conta de "parado há X" — justamente o que o campo precisa medir.
--
-- Provado num teste dentro de begin/rollback:
--   antes         2026-07-28 23:08:42
--   após no-op    2026-07-28 23:08:42   (preservou)
--   após mudança  2026-08-27 12:35:46   (carimbou)
CREATE TRIGGER trg_producoes_atualizado_em
  BEFORE UPDATE ON public.producoes
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION public.fn_marca_atualizado_em();
