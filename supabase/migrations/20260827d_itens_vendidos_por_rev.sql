-- Order bumps e upsells param de ser digitados e passam a ser medidos.
--
-- No cadastro do funil havia duas listas para DIGITAR. Elas eram gravadas em
-- `funil_subofertas` e lidas só de volta no próprio formulário — nenhuma tela,
-- nenhum cálculo, nenhum relatório usava. Era trabalho que não virava nada.
--
-- E envelhecia: dos 36 order bumps cadastrados, 10 nunca venderam nada.
--
-- Enquanto isso `venda_itens` tem 3.761 order bumps que converteram de verdade,
-- com nome, valor e slot. Os nomes batem com os digitados — "Kit Completo da
-- Artesã" aparece nos dois lados —, então não é informação nova: é a mesma
-- informação, só que verdadeira.
--
-- Depende de `vendas.funil_id`, que a tela de Checkouts preenche. Sem os
-- checkouts atribuídos isto vem vazio, e a tela diz por quê em vez de só
-- mostrar nada.

create or replace view public.vw_rev_itens_vendidos as
select
  v.funil_id,
  vi.tipo::text                        as slot,
  -- `oferta_principal` é a venda em si; os demais slots são os bumps.
  case when vi.tipo::text = 'oferta_principal' then 'principal' else 'orderbump' end as familia,
  vi.nome,
  count(*)                             as vendas,
  round(avg(vi.valor), 2)              as valor_medio,
  sum(vi.valor)                        as faturamento,
  min(v.data_venda)::date              as primeira,
  max(v.data_venda)::date              as ultima
from public.venda_itens vi
join public.vendas v on v.id = vi.venda_id
where vi.converteu
  and v.funil_id is not null
group by 1,2,3,4;

comment on view public.vw_rev_itens_vendidos is
  'Order bumps e oferta principal que cada REV realmente vendeu. Substitui as '
  'listas digitadas em funil_subofertas, que ninguem lia.';

alter view public.vw_rev_itens_vendidos set (security_invoker = on);

-- Upsell não vive em `venda_itens`: é uma venda separada, marcada com
-- `is_upsell`. Por isso vem de outra view, e não da mesma com um filtro.
create or replace view public.vw_rev_upsells_vendidos as
select
  v.funil_id,
  -- `produto` é enum, então o texto do fallback não cabe nele sem o cast.
  coalesce(v.produto::text, 'sem nome') as nome,
  count(*)                              as vendas,
  round(avg(v.valor_total), 2)          as valor_medio,
  sum(v.valor_total)                    as faturamento,
  min(v.data_venda)::date               as primeira,
  max(v.data_venda)::date               as ultima
from public.vendas v
where v.is_upsell
  and v.status = 'aprovada'
  and v.funil_id is not null
group by 1,2;

comment on view public.vw_rev_upsells_vendidos is
  'Upsells vendidos por REV. Upsell e venda separada com is_upsell, nao item de venda.';

alter view public.vw_rev_upsells_vendidos set (security_invoker = on);
