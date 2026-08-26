-- As contagens de venda passam a contar só o que foi APROVADO.
--
-- Bug meu, e dos que enganam: eu contava qualquer linha de `vendas`, e a tabela
-- guarda também `pendente`, `cancelada` e `expirada` — boleto não pago, PIX
-- abandonado, carrinho largado.
--
-- O tamanho do estrago, entre os dez checkouts de maior volume:
--
--   Saponaria - Desconto de Aula   283 "vendas"   →  0 aprovadas
--   Saponaria Brasil               253 "vendas"   →  0 aprovadas
--   Curso Velas Perfeitas 2.0      219 "vendas"   →  0 aprovadas
--   Workshop Rev1                  539 "vendas"   → 428 aprovadas
--
-- Três dos dez maiores eram inteiramente ruído, e o resto vinha inflado em
-- 20–30%. A fila de confirmação é ordenada por esse número, então ele decidia
-- em que ordem alguém gastava tempo — e mandava para o topo checkout que nunca
-- vendeu nada.
--
-- Foi assim que apareceu: ela reparou num checkout com "283 vendas" e apenas 8
-- order bumps. Não era falha na captura dos bumps; era que as 283 não eram
-- vendas.
--
-- A ATRIBUIÇÃO continua valendo para toda venda, aprovada ou não: uma pendente
-- que for paga depois já nasce com o REV certo. O que muda é só a contagem.
--
-- E `vendas_pendentes` entra ao lado em vez de o número sumir: um checkout com
-- muito pendente e pouca aprovação não é um checkout morto, é um checkout com
-- problema de pagamento — e isso é informação, não sujeira.

drop view if exists public.vw_mapa_revs;
drop view if exists public.vw_checkouts_a_confirmar;

create view public.vw_checkouts_a_confirmar as
select
  c.id, c.url, c.titulo, c.funil_id, c.eh_funil,
  f.nome as rev_nome,
  p.nome as projeto_nome,
  s.vendas, s.primeira_venda, s.ultima_venda,
  (regexp_match(c.titulo, '(?i)rev\s*0*(\d+)'))[1] as rev_no_titulo,
  c.preco,
  s.preco_praticado,
  s.vendas_pendentes
from public.funil_checkouts c
left join public.funis f            on f.id = c.funil_id
left join public.ofertas_editores p on p.id = f.projeto_id
left join lateral (
  select
    count(*) filter (where v.status = 'aprovada')                   as vendas,
    count(*) filter (where v.status <> 'aprovada')                  as vendas_pendentes,
    min(v.data_venda) filter (where v.status = 'aprovada')::date    as primeira_venda,
    max(v.data_venda) filter (where v.status = 'aprovada')::date    as ultima_venda,
    mode() within group (order by v.valor_oferta_principal)
      filter (where v.status = 'aprovada')                          as preco_praticado
  from public.vendas v
  where split_part(v.link_url, '?', 1) = c.url
    and v.link_titulo is not distinct from c.titulo
) s on true;

comment on view public.vw_checkouts_a_confirmar is
  'Checkouts com o volume APROVADO que cada um moveu, o preço praticado e '
  'quantas ficaram pendentes. Contar pendente como venda mandava para o topo da '
  'fila checkout que nunca vendeu nada.';

alter view public.vw_checkouts_a_confirmar set (security_invoker = on);

create view public.vw_mapa_revs as
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
    (array_agg(coalesce(x.preco_praticado, x.preco) order by x.vendas desc nulls last))[1] as preco,
    (array_agg(x.url order by x.vendas desc nulls last))[1]                                as checkout_url
  from public.vw_checkouts_a_confirmar x
  where x.funil_id = f.id
) c on true
left join lateral (
  select count(*) as vendas, max(data_venda)::date as ultima_venda
  from public.vendas ve
  where ve.funil_id = f.id and ve.status = 'aprovada'
) vd on true;

comment on view public.vw_mapa_revs is
  'Um REV por linha, com projeto, VSL, domínios, checkouts, preço e vendas '
  'aprovadas.';

alter view public.vw_mapa_revs set (security_invoker = on);

-- Order bumps também só de venda aprovada. Um bump de carrinho abandonado
-- inflaria a adesão e o faturamento do REV.
create or replace view public.vw_rev_itens_vendidos as
select
  v.funil_id,
  vi.tipo::text                        as slot,
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
  and v.status = 'aprovada'
group by 1,2,3,4;

alter view public.vw_rev_itens_vendidos set (security_invoker = on);
