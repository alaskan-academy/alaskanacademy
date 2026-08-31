-- Bloqueado e Arquivado deixam de ser uma lista escrita à mão.
--
-- `useFases.ts` trazia `['bloqueado','arquivado']` dentro de `fasesVizinhas`
-- para tirá-las do avançar/voltar. Funcionava, e envelheceria calada na
-- próxima saída que surgisse — a terceira armadilha do CLAUDE.md.
--
-- Agora "isto é uma saída, não um degrau" é propriedade da fase, e quem
-- cadastrar a próxima saída não precisa mexer em código nenhum.

alter table producao_fases
  add column if not exists fora_do_fluxo boolean not null default false;

comment on column producao_fases.fora_do_fluxo is
  'A fase e uma SAIDA, nao um degrau. Bloqueado e Arquivado terminam o card sem '
  'que ele tenha percorrido o resto: nao entram no avancar/voltar e aparecem '
  'separadas no seletor. Antes isto era a lista ["bloqueado","arquivado"] escrita '
  'a mao em useFases.ts, que envelheceria calada na proxima saida que surgisse.';

update producao_fases set fora_do_fluxo = true
where chave in ('bloqueado', 'arquivado');
