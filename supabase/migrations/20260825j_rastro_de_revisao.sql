-- Quem revisou, e quando.
--
-- Não existia esse rastro, e por isso "confirmado" queria dizer duas coisas
-- muito diferentes: transação que alguém abriu, leu e confirmou, e transação
-- que entrou junto num "Confirmar 440 automáticas". As duas ficavam iguais no
-- banco, e ambas passavam a ser intocáveis pela recategorização — inclusive as
-- erradas. Quando fui olhar, as 1.206 transações estavam todas como confirmado
-- e a fila de revisão estava vazia.
--
-- Com o rastro, o botão de lote deixa `revisado_por` nulo e a confirmação
-- individual o preenche. Confirmado sem revisor é o que ainda merece um olhar.
alter table public.transacoes add column if not exists revisado_em  timestamptz;
alter table public.transacoes add column if not exists revisado_por uuid references auth.users(id);

comment on column public.transacoes.revisado_por is
  'Preenchido só na confirmação individual. Nulo em confirmação em lote — é o que separa "alguém leu" de "alguém aceitou tudo".';

-- Devolve ao estado "a máquina decidiu, ninguém olhou" as que a máquina de fato
-- decidiu: 524 linhas com `categoria_origem` preenchida, que é a marca de ter
-- passado por `aplicar_categorizacao` sem estar confirmada na época.
--
-- As 682 de dezembro a junho ficam como estão: foram confirmadas antes de a
-- automação existir, e `categoria_origem` nulo é justamente a prova disso.
update public.transacoes
   set status_revisao = 'auto_categorizado'
 where status_revisao = 'confirmado'
   and categoria_origem is not null
   and revisado_por is null;
