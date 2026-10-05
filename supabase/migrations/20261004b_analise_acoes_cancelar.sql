/*
  Cancelar uma ação: o terceiro destino, que faltava.

  Até agora a ação só saía da lista de duas formas, e nenhuma servia para
  "decidimos não fazer":

  · marcar como FEITA mente sobre o que aconteceu, e ainda vai parar no bloco
    "O que já foi feito" ao lado dos números que ela não mexeu;
  · APAGAR diz, na própria confirmação, "a decisão some do histórico e não
    volta" — e desistir é uma decisão que vale guardar. A ação de 08/09 ficou
    aberta um mês com "desde 08/09/2026" piscando em âmbar justamente porque
    nenhuma das duas era verdade.

  O CLAUDE.md do módulo diz "alteração sem veredito é dívida". Cancelar É um
  veredito, e o motivo mora em `resultado`, que já é o campo do que ficou
  dessa ação — feita ou não. Um campo próprio de "motivo do cancelamento"
  seria o mesmo fato escrito em dois lugares, e eles divergiriam.

  O CHECK existe porque os dois estados são excludentes por definição. Sem
  ele, uma tela gravando `feita` sem limpar `cancelada_em` produziria uma ação
  feita E cancelada, e cada consulta decidiria por conta própria qual vale.
*/
ALTER TABLE public.analise_acoes
  ADD COLUMN IF NOT EXISTS cancelada_em  timestamptz,
  ADD COLUMN IF NOT EXISTS cancelada_por uuid REFERENCES public.perfis(id) ON DELETE SET NULL;

ALTER TABLE public.analise_acoes
  DROP CONSTRAINT IF EXISTS analise_acoes_feita_ou_cancelada;

ALTER TABLE public.analise_acoes
  ADD CONSTRAINT analise_acoes_feita_ou_cancelada
  CHECK (NOT (feita AND cancelada_em IS NOT NULL));

COMMENT ON COLUMN public.analise_acoes.cancelada_em IS
  'Quando se decidiu NÃO fazer. Excludente com `feita`; o motivo vai em `resultado`.';

/*
  O carimbo das duas pontas numa função só.

  Já existia para `feita`. Separar o de cancelar em outro gatilho deixaria duas
  regras de carimbo para a mesma tabela, e a hora em que elas discordassem
  seria a hora em que alguém marcasse os dois — que é o caso que o CHECK existe
  para impedir, mas a defesa não pode depender de uma só camada.

  Marcar um lado LIMPA o outro, em vez de recusar: a pessoa que cancelou e
  depois fez quer o segundo estado, não um erro na cara.
*/
CREATE OR REPLACE FUNCTION public.fn_analise_acao_carimbo()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
begin
  if new.feita and not coalesce(old.feita, false) then
    new.feita_em := now();
    -- Fazer depois de cancelar desfaz o cancelamento, e não empilha os dois.
    new.cancelada_em := null;
    new.cancelada_por := null;
  elsif not new.feita then
    new.feita_em := null;
    new.feita_por := null;
  end if;

  if new.cancelada_em is not null and old.cancelada_em is null then
    new.cancelada_em := now();
    new.feita := false;
    new.feita_em := null;
    new.feita_por := null;
  elsif new.cancelada_em is null then
    new.cancelada_por := null;
  end if;

  return new;
end;
$function$;
