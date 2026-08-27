-- A conta já sabia de qual produto era. Faltava dizer de qual PROJETO.
--
-- Perguntando por que o Desafios aparecia com 9% do investimento atribuído,
-- apareceu uma conta chamada "Velas Buquê" com R$ 17.830 investidos e nenhum
-- vínculo — 0% atribuído, invisível para a Esteira e para tudo mais.
--
-- Ela apontou que "Velas Buquê" é a mesma coisa que Workshop Buquê, e o banco
-- confirma sozinho: `ad_accounts.produto_payt` = "Workshop Buquê de Velas",
-- que é EXATAMENTE o nome do projeto. O campo que responde a pergunta já estava
-- preenchido; o `projeto_id` ao lado é que estava vazio.
--
-- É a primeira armadilha do CLAUDE.md numa forma nova: em vez de dois campos
-- que divergem, dois campos onde um sabe e o outro não — e quem lê usa o que
-- não sabe.
--
-- ── Duas regras, e só as que não exigem palpite ────────────────────────────
--
-- 1. `produto_payt` bate exato com o nome de um projeto.
--    "Workshop Buquê de Velas" é as duas coisas ao mesmo tempo. Resolve a
--    conta "Velas Buquê" (R$ 17.830).
--
-- 2. Outra conta do mesmo produto já foi mapeada à mão.
--    "Curso Saponaria Brasil" não é o nome de nenhum projeto, mas TRÊS contas
--    com esse produto já apontam para "Saponaria Brasil" — então a quarta
--    ("RMKT Saponaria - TSL", R$ 2.191) aponta para lá também. É derivar do
--    que já existe, não adivinhar. Se as irmãs discordassem entre si, não
--    preenche: preferir o vazio a um palpite é o que impede um número errado
--    de parecer certo.
--
-- Sobram três contas com "Curso Velas Perfeitas 2.0" (R$ 3.459), nenhuma delas
-- mapeada e nenhum projeto com esse nome. Ficam vazias de propósito — não há de
-- onde tirar a resposta sem alguém dizer.
--
-- ── E é GATILHO, não só carga ──────────────────────────────────────────────
--
-- Contas novas chegam do Meta pelo `meta-insights-sync` com `produto_payt`
-- preenchido e `projeto_id` vazio. Só um UPDATE deixaria o buraco voltar na
-- próxima conta descoberta — a quarta armadilha do CLAUDE.md, onde a carga
-- inicial preenche o passado e nada mantém o presente.
--
-- ── Medido depois ──────────────────────────────────────────────────────────
--
-- `fn_fixar_vinculo_ads()` vinculou 54 anúncios na primeira passada, e o
-- Workshop Buquê de Velas foi de R$ 25.515 / 100% para R$ 33.914 / 100% em 90
-- dias: os R$ 8.399 da conta "Velas Buquê" entraram na conta certa.

CREATE OR REPLACE FUNCTION public.fn_conta_herda_projeto()
 RETURNS trigger LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_ids uuid[];
BEGIN
  IF NEW.projeto_id IS NOT NULL OR NEW.produto_payt IS NULL THEN
    RETURN NEW;
  END IF;

  -- 1. O nome do produto na Payt bate exato com o nome de um projeto.
  SELECT array_agg(o.id) INTO v_ids
    FROM public.ofertas_editores o WHERE o.nome = NEW.produto_payt;
  IF coalesce(array_length(v_ids, 1), 0) = 1 THEN
    NEW.projeto_id := v_ids[1];
    RETURN NEW;
  END IF;

  -- 2. Não bate, mas outra conta do mesmo produto já foi mapeada à mão.
  --    `array_length = 1` é a condição inteira: com duas irmãs discordando,
  --    não preenche.
  SELECT array_agg(DISTINCT ac.projeto_id) INTO v_ids
    FROM public.ad_accounts ac
   WHERE ac.produto_payt = NEW.produto_payt
     AND ac.projeto_id IS NOT NULL
     AND ac.id IS DISTINCT FROM NEW.id;
  IF coalesce(array_length(v_ids, 1), 0) = 1 THEN
    NEW.projeto_id := v_ids[1];
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_conta_herda_projeto() IS
  'Preenche ad_accounts.projeto_id a partir de produto_payt: pelo nome do projeto, ou pelo mapeamento que outra conta do mesmo produto ja tem. Nunca sobrescreve, e nao preenche quando ha duvida.';

DROP TRIGGER IF EXISTS trg_conta_herda_projeto ON public.ad_accounts;
CREATE TRIGGER trg_conta_herda_projeto
  BEFORE INSERT OR UPDATE OF produto_payt, projeto_id ON public.ad_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_conta_herda_projeto();

-- ── A carga do passado, com as mesmas duas regras ──────────────────────────

UPDATE public.ad_accounts ac
   SET projeto_id = o.id
  FROM public.ofertas_editores o
 WHERE ac.projeto_id IS NULL
   AND ac.produto_payt IS NOT NULL
   AND o.nome = ac.produto_payt
   AND (SELECT count(*) FROM public.ofertas_editores x WHERE x.nome = ac.produto_payt) = 1;

UPDATE public.ad_accounts ac
   SET projeto_id = irma.projeto_id
  FROM (
    SELECT produto_payt, (array_agg(DISTINCT projeto_id))[1] AS projeto_id
      FROM public.ad_accounts
     WHERE projeto_id IS NOT NULL AND produto_payt IS NOT NULL
     GROUP BY 1 HAVING count(DISTINCT projeto_id) = 1
  ) irma
 WHERE ac.projeto_id IS NULL
   AND ac.produto_payt = irma.produto_payt;
