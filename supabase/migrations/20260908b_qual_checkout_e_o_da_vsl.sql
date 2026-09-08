-- QUAL CHECKOUT E O DA VSL
--
-- Numa PV que tem VSL, "quanto a VSL trouxe" nao tinha resposta. A retencao
-- dizia se o video segurava; nada dizia se ele vendia.
--
-- A Payt sabe — pelo CHECKOUT. Medido em 08/09/2026, ultimos 30 dias:
--
--   REV5   Saponaria Brasil Rev5        216 vendas   R$ 20.440
--          Saponaria Brasil VSL 03       77 vendas   R$  6.855   <- a VSL
--   REV6   Saponaria Brasil Rev6         51 vendas   R$  4.475
--          Saponaria Brasil VSL 03 Rev6  16 vendas   R$  1.261   <- a VSL
--
-- POR QUE UM CAMPO, E NAO O NOME
--
-- Daria para achar o checkout da VSL procurando "VSL" no titulo. Seria a
-- armadilha 3: lista fixa no codigo que envelhece em silencio. Bastaria um
-- checkout chamado "Aula gratuita" para a VSL sumir do calculo sem nada
-- reclamando — e o numero apareceria menor, com cara de certo.
--
-- Entao ela marca, uma vez por checkout, na mesma lista onde ja vincula o
-- checkout ao REV.
--
-- E O TESTE A/B FICA DE FORA DESTA CONTA
--
-- Quando o REV roda DUAS VSLs, o VTurb alterna os dois players na mesma pagina
-- e manda para o mesmo checkout. A Payt nao tem como saber qual lado a pessoa
-- viu — nao e limitacao do painel, e o que existe. Ali a unica medida possivel
-- e a do proprio VTurb, e a tela troca de fonte dizendo que trocou.

alter table funil_checkouts
  add column if not exists eh_vsl boolean not null default false;

comment on column funil_checkouts.eh_vsl is
  'Este checkout e o da VSL do REV. Marcado a mao, nunca deduzido do titulo: '
  'um checkout chamado "Aula gratuita" sumiria da conta sem nada reclamar. '
  'Serve para isolar, com dados da PAYT, quanto a VSL trouxe. Num teste A/B '
  'com duas VSLs a separacao nao existe do lado da Payt — os dois players vao '
  'para o mesmo checkout —, e ali a medida vem do VTurb.';

create index if not exists idx_funil_checkouts_vsl
  on funil_checkouts (funil_id) where eh_vsl;