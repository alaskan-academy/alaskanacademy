-- Quantas vendas cada link de UTM trouxe.
--
-- São 134 links gerados e NENHUMA tela dizia qual vendeu. É o mesmo padrão que
-- apareceu em todo lugar nesta revisão: cria e não mede.
--
-- O custo disso é concreto. Nos dados de hoje, 39 links do site geraram 16
-- vendas enquanto 6 links de recuperação geraram 53 — o canal mais eficiente
-- por link, com folga, e ninguém no time sabia disso.
--
-- O vínculo já existia, só não estava escrito em lugar nenhum: `utm_links` casa
-- com `vendas` por source + medium + campaign + content.

create or replace view public.vw_utm_links_desempenho as
select
  l.id,
  l.nome,
  l.url_final,
  l.source,
  l.medium,
  l.campaign,
  l.content,
  l.projeto_id,
  l.criado_em,
  l.arquivado,
  coalesce(s.vendas, 0)     as vendas,
  coalesce(s.faturamento, 0) as faturamento,
  s.primeira_venda,
  s.ultima_venda,

  -- Dias desde a criação. Serve para separar "link novo, ainda sem dados" de
  -- "link velho que nunca vendeu" — que parecem iguais olhando só o zero, e
  -- exigem reações opostas.
  (current_date - l.criado_em::date) as dias_de_vida

from public.utm_links l
left join lateral (
  select
    count(*)                        as vendas,
    sum(v.valor_total)              as faturamento,
    min(v.data_venda)::date         as primeira_venda,
    max(v.data_venda)::date         as ultima_venda
  from public.vendas v
  where v.status = 'aprovada'
    -- `is not distinct from` e não `=`: `content` é nulo em boa parte dos links
    -- e das vendas, e com `=` todo par com nulo sairia da conta silenciosamente.
    and v.utm_source   is not distinct from l.source
    and v.utm_medium   is not distinct from l.medium
    and v.utm_campaign is not distinct from l.campaign
    and v.utm_content  is not distinct from l.content
) s on true;

comment on view public.vw_utm_links_desempenho is
  'Cada link de UTM com as vendas que trouxe. Existiam 134 links e nenhuma tela '
  'dizia qual vendeu.';

alter view public.vw_utm_links_desempenho set (security_invoker = on);

-- Sem isto, cada um dos 134 links varre as 13.552 vendas.
create index if not exists idx_vendas_utm
  on public.vendas (utm_source, utm_medium, utm_campaign, utm_content)
  where status = 'aprovada';
