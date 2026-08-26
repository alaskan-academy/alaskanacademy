-- O preço passa a morar no checkout, e a vir da venda quando ela existe.
--
-- O cadastro do REV tinha DOIS blocos de checkout: "Checkouts deste REV" (os
-- reais, do webhook, que atribuem venda) e "Preços e Links de Checkout"
-- (digitado, que alimentava `funis.preco` e `funis.link_checkout` no cartão).
--
-- O link era redundante. O que sobrava de único era o preço — e os dados
-- mostram que nem esse estava sendo mantido:
--
--   Workshop REV1   preço digitado VAZIO   preço real R$ 47   428 vendas
--   Saponaria REV5  digitado R$ 67         real R$ 67         232 vendas
--   REV2, REV6, …   digitado R$ 127, 67    sem venda nenhuma
--
-- Onde há venda, o preço real existe e bate. Onde está digitado sem venda, é
-- plano e não fato. E o REV que mais vende tinha o campo vazio, o que diz que
-- ninguém mantinha aquele bloco.
--
-- Então: um bloco só. O preço é digitável enquanto o checkout não vendeu, e
-- passa a ser o praticado assim que a primeira venda entra.

alter table public.funil_checkouts
  add column if not exists preco numeric;

comment on column public.funil_checkouts.preco is
  'Preço planejado, digitado antes da primeira venda. Depois dela vale o '
  'praticado, que sai de `vendas.valor_oferta_principal` — por isso este campo '
  'é só um lugar de espera, não a verdade.';

-- ────────────────────────────────────────────────────────────────────────────
create or replace view public.vw_checkouts_a_confirmar as
select
  c.id, c.url, c.titulo, c.funil_id, c.eh_funil,
  f.nome as rev_nome,
  p.nome as projeto_nome,
  s.vendas, s.primeira_venda, s.ultima_venda,
  (regexp_match(c.titulo, '(?i)rev\s*0*(\d+)'))[1] as rev_no_titulo,
  c.preco,
  -- `mode()` e não `avg()`: a média afunda com cupom e oferta relâmpago, e o
  -- que se quer saber é por quanto o checkout VENDE, não a média das exceções.
  s.preco_praticado
from public.funil_checkouts c
left join public.funis f            on f.id = c.funil_id
left join public.ofertas_editores p on p.id = f.projeto_id
left join lateral (
  select count(*)                as vendas,
         min(v.data_venda)::date as primeira_venda,
         max(v.data_venda)::date as ultima_venda,
         mode() within group (order by v.valor_oferta_principal) as preco_praticado
  from public.vendas v
  where split_part(v.link_url, '?', 1) = c.url
    and v.link_titulo is not distinct from c.titulo
) s on true;

comment on view public.vw_checkouts_a_confirmar is
  'Os checkouts com o volume que cada um moveu e o preço praticado. Ordenar por '
  'vendas desc: confirmar os primeiros já cobre a maioria.';

alter view public.vw_checkouts_a_confirmar set (security_invoker = on);

-- ────────────────────────────────────────────────────────────────────────────
-- O mapa ganha o preço e o link do checkout de maior volume.
--
-- É o que o cartão do REV mostrava a partir de `funis.preco` e
-- `funis.link_checkout`, campos que ninguém mais vai escrever depois que o
-- bloco digitado sair da tela.
create or replace view public.vw_mapa_revs as
select
  f.id,
  f.nome                    as rev,
  f.status,
  f.metodo,
  f.url_page,
  p.id                      as projeto_id,
  p.nome                    as projeto,
  v.id                      as vsl_id,
  v.nome                    as vsl,
  v.duracao_seg             as vsl_duracao,
  d.dominios,
  c.checkouts,
  coalesce(vd.vendas, 0)    as vendas,
  vd.ultima_venda,
  unaccent(lower(concat_ws(' ',
    f.nome, p.nome, v.nome, f.url_page, f.metodo,
    array_to_string(d.dominios, ' '),
    array_to_string(c.checkouts, ' ')
  )))                       as busca,
  c.preco,
  c.checkout_url
from public.funis f
left join public.ofertas_editores p on p.id = f.projeto_id
left join public.vsls v              on v.id = f.vsl_id
left join lateral (
  select array_agg(dm.nome order by dm.nome) as dominios
  from public.dominios dm
  where f.id::text = any(coalesce(nullif(dm.funil_ids, '{}'), array[dm.funil_id::text]))
) d on true
left join lateral (
  select
    array_agg(distinct x.titulo) filter (where x.titulo is not null) as checkouts,
    -- O de maior volume representa o REV: é por ele que a maioria compra.
    (array_agg(coalesce(x.preco_praticado, x.preco) order by x.vendas desc nulls last))[1] as preco,
    (array_agg(x.url order by x.vendas desc nulls last))[1]                                as checkout_url
  from public.vw_checkouts_a_confirmar x
  where x.funil_id = f.id
) c on true
left join lateral (
  select count(*) as vendas, max(data_venda)::date as ultima_venda
  from public.vendas ve
  where ve.funil_id = f.id
) vd on true;

comment on view public.vw_mapa_revs is
  'Um REV por linha, com projeto, VSL, domínios, checkouts, preço e vendas. A '
  'coluna `busca` concatena tudo sem acento e em minúsculas.';

alter view public.vw_mapa_revs set (security_invoker = on);
