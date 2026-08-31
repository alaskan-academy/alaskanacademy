-- Esta função é o "Enviar para a esteira" do painel do gestor de tráfego, e foi
-- ela que produziu os 29 cards com período invertido em 31/08: grava `fase` e
-- `data_inicio` e não toca em `data_prazo`.
--
-- Ela é uma função do POSTGRES — por isso nenhum grep em `src/features/producao`
-- a encontrava quando eu procurava quem escrevia esse par.
--
-- O corpo NÃO foi alterado, de propósito. Período coerente é regra da TABELA,
-- não desta função: quem cuida dela é o gatilho `trg_periodo_do_card`, que move
-- a outra ponta preservando a duração e vale para TODOS os caminhos de escrita.
-- Repetir a regra aqui seria a mesma regra em dois lugares — e no dia em que
-- uma das duas mudasse, elas discordariam.
--
-- Conferido com rollback, já com o gatilho no ar: enviar um card 'aprovado' com
-- prazo para 15/09 deixa início E prazo em 15/09.
comment on function public.fn_enviar_para_esteira(uuid[], date, uuid) is
  'Move cards aprovados para esteira_teste na data escolhida, registrando em criativo_historico. Grava só `fase` e `data_inicio`: o `data_prazo` é ajustado pelo gatilho trg_periodo_do_card, que mantém o período coerente para TODOS os caminhos de escrita.';
