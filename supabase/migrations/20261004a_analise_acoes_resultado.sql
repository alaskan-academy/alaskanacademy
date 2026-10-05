/*
  O resultado da ação, no registro da própria ação.

  `expectativa` já existia e é escrita ANTES: "o que eu espero disso". Faltava
  o par dela, escrito DEPOIS: "o que aconteceu". Sem esse campo, o veredito de
  cada ação ia para a leitura solta da rodada, no formato
  "- Testar Headline: sem aumento significativo, vamos manter" — e ali ele some
  na quinzena seguinte junto com o resto do texto, que é exatamente o defeito
  do Google Chat que este módulo veio substituir.

  Com os dois campos lado a lado, a ação carrega o ciclo inteiro: o que se
  esperava, o que se fez, quando, e o que deu. É o que permite abrir uma ação
  de três meses atrás e entender a decisão sem reconstruir nada.

  Nulo é o estado normal de ação recém-feita: o resultado só existe depois de
  haver dados. A tela usa isso para convidar a escrever em vez de cobrar.
*/
ALTER TABLE public.analise_acoes
  ADD COLUMN IF NOT EXISTS resultado text;

COMMENT ON COLUMN public.analise_acoes.resultado IS
  'O que aconteceu depois da ação, escrito por quem avaliou. Par de `expectativa`, que é escrita antes.';
