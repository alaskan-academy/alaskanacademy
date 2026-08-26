-- O investimento passa a ser somado pelo CONJUNTO, nunca pela campanha.
--
-- "Nunca pegue a campanha, pegue sempre o conjunto, pois a mesma campanha pode
-- rodar diferentes REVs inclusive as de teste."
--
-- Ela está certa, e o dado é brutal. No REV6 da Saponária, nos últimos 14 dias:
--
--   por conjunto  R$  1.898,24   <- o real
--   por campanha  R$ 12.936,67   <- quase 7x inflado
--   por anúncio   R$  1.760,70   <- piso, perde anúncio que gastou sem vender
--
-- O REV6 é um teste pequeno dentro de uma campanha grande. Medir pela campanha
-- teria dado a ele o gasto do REV5 inteiro junto, e todo ROAS, CPA e lucro do
-- teste sairiam sem sentido — com cara de número exato.
--
-- Nas telas onde a campanha por acaso servia um REV só, os dois davam igual, e
-- foi por isso que a conferência contra o PV PADRÃO não pegou o defeito: lá
-- campanha e conjunto somam os mesmos R$ 8.437,24. Coincidência que esconde
-- erro estrutural é a pior forma de validação.
--
-- Conferido na base inteira: 52 conjuntos com venda atribuída, ZERO servindo
-- mais de um REV. O conjunto é a granularidade em que eles de fato separam o
-- que está sendo testado — os nomes dizem isso sozinhos ("12/08 Teste REV6",
-- "07/08 REV5 - Variação").
--
-- Com isso `nivel_investimento` deixa de ter três valores: é sempre conjunto,
-- ou anúncio quando o REV não tem conjunto nenhum identificado.

create or replace function public.fn_metricas_do_rev_bloco(
  p_funil_id uuid,
  p_inicio   date,
  p_fim      date
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with vendas_rev as (
    select v.*
    from public.vendas v
    where v.funil_id = p_funil_id
      and v.status = 'aprovada'
      and (v.data_venda at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
      and v.pedido_id not like 'TEST%'
      and v.pedido_id not like 'LC-%'
      and not coalesce(v.is_upsell, false)
  ),
  caixa as (
    select
      coalesce(sum(valor_sem_juros - coalesce(valor_reembolsado, 0)), 0) as faturamento,
      coalesce(sum(taxa_plataforma_valor), 0)                            as taxa,
      coalesce(sum(valor_reembolsado), 0)                                as reembolsos,
      count(*)                                                           as vendas,
      count(*) filter (where ad_id_meta is not null)                     as vendas_ads,
      coalesce(sum(valor_oferta_principal), 0)                           as oferta_principal
    from vendas_rev
  ),
  bumps as (
    select count(*)                    as qtd,
           coalesce(sum(vi.valor), 0)  as faturamento,
           count(distinct vi.venda_id) as vendas_com_bump
    from public.venda_itens vi
    join vendas_rev v on v.id = vi.venda_id
    where vi.converteu
  ),
  itens as (
    select jsonb_agg(x order by x.qtd desc) as lista
    from (
      select vi.nome,
             count(*)                as qtd,
             round(sum(vi.valor), 2) as faturamento,
             case when (select vendas from caixa) > 0
                    then round(100.0 * count(*) / (select vendas from caixa), 2)
             end                     as adesao_pct
      from public.venda_itens vi
      join vendas_rev v on v.id = vi.venda_id
      where vi.converteu
      group by vi.nome
    ) x
  ),
  mapa_ad as (
    select distinct v.ad_id_meta as ad_id, v.funil_id
    from public.vendas v
    where v.funil_id is not null and v.ad_id_meta is not null and v.status = 'aprovada'
  ),
  ads_rev as (select ad_id from mapa_ad where funil_id = p_funil_id),
  -- Os CONJUNTOS deste REV. Um anúncio que vendeu para o REV traz o conjunto
  -- inteiro junto — inclusive os anúncios dele que gastaram sem vender, que é
  -- o que a soma por anúncio perdia.
  conjuntos_rev as (
    select distinct m.adset_id
    from public.metricas_meta m
    where m.nivel = 'ad' and m.adset_id is not null
      and m.ad_id in (select ad_id from ads_rev)
  ),
  meta as (
    select
      coalesce(sum(m.investimento), 0)          as investimento,
      coalesce(sum(m.impressoes), 0)            as impressoes,
      coalesce(sum(m.cliques_link), 0)          as cliques,
      coalesce(sum(m.visualizacoes_pagina), 0)  as visitas,
      coalesce(sum(m.initiate_checkout), 0)     as checkouts,
      coalesce(sum(m.compras_meta), 0)          as compras_meta
    from public.metricas_meta m
    where m.nivel = 'ad'
      and m.data between p_inicio and p_fim
      and (
        case when exists (select 1 from conjuntos_rev)
          then m.adset_id in (select adset_id from conjuntos_rev)
          else m.ad_id    in (select ad_id from ads_rev)
        end
      )
  ),
  cobertura as (
    select
      coalesce(sum(m.investimento), 0) as gasto_total,
      coalesce(sum(m.investimento) filter (
        where m.adset_id in (
          select distinct m2.adset_id from public.metricas_meta m2
          join mapa_ad a on a.ad_id = m2.ad_id
          where m2.nivel = 'ad' and m2.adset_id is not null
        )), 0) as gasto_atribuido
    from public.metricas_meta m
    where m.nivel = 'ad' and m.data between p_inicio and p_fim
  ),
  imposto as (
    select
      coalesce(max(valor) filter (where chave = 'imposto_simples_nacional_pct'), 0) as simples_pct,
      coalesce(max(valor) filter (where chave = 'imposto_meta_ads_pct'), 0)         as meta_pct
    from public.configuracoes
  ),
  calc as (
    select
      (select faturamento from caixa)   as fat,
      (select vendas from caixa)        as vendas,
      (select investimento from meta)   as inv,
      (select cliques from meta)        as cliques,
      (select visitas from meta)        as visitas,
      (select checkouts from meta)      as ic,
      (select impressoes from meta)     as impr,
      (select taxa from caixa)          as taxa,
      round((select faturamento from caixa) * (select simples_pct from imposto) / 100.0, 2) as imp_simples,
      round((select investimento from meta) * (select meta_pct from imposto) / 100.0, 2)    as imp_meta
  )
  select jsonb_build_object(
    'dias', (p_fim - p_inicio + 1),

    'investimento',     c.inv,
    'faturamento',      c.fat,
    'resultado',        round(c.fat - c.inv, 2),
    'vendas',           c.vendas,
    'roas',             case when c.inv > 0 then round(c.fat / c.inv, 2) end,
    'imposto_simples',  c.imp_simples,
    'imposto_meta',     c.imp_meta,
    'taxa_plataforma',  c.taxa,
    'lucro_liquido',    round(c.fat - c.inv - c.imp_simples - c.imp_meta - c.taxa, 2),
    'margem_pct',       case when c.fat > 0
                          then round(100.0 * (c.fat - c.inv - c.imp_simples - c.imp_meta - c.taxa) / c.fat, 1)
                        end,
    'reembolsos',       (select reembolsos from caixa),

    'oferta_principal_qtd',   c.vendas,
    'oferta_principal_valor', (select oferta_principal from caixa),
    'bump_qtd',               (select qtd from bumps),
    'bump_faturamento',       (select faturamento from bumps),
    'bump_adesao_pct',        case when c.vendas > 0
                                then round(100.0 * (select vendas_com_bump from bumps) / c.vendas, 2) end,
    'itens',                  coalesce((select lista from itens), '[]'::jsonb),
    'pct_ofertas_extras', case when c.fat > 0
      then round(100.0 * (select faturamento from bumps) / c.fat, 2) end,

    'nivel_investimento', case when exists (select 1 from conjuntos_rev)
      then 'conjunto' else 'anuncio' end,
    'conjuntos', (select count(*) from conjuntos_rev),
    'impressoes',          c.impr,
    'cliques',             c.cliques,
    'visitas',             c.visitas,
    'checkouts_iniciados', c.ic,
    'compras_meta',        (select compras_meta from meta),
    'vendas_de_anuncio',   (select vendas_ads from caixa),
    'cobertura_geral_pct',
      (select case when gasto_total > 0
                then round(100.0 * gasto_atribuido / gasto_total, 1) end from cobertura),

    'conv_funil_pct',    case when c.visitas > 0 then round(100.0 * c.vendas / c.visitas, 2) end,
    'conv_checkout_pct', case when c.ic > 0 then round(100.0 * c.vendas / c.ic, 2) end,
    'connect_rate_pct',  case when c.cliques > 0 then round(100.0 * c.visitas / c.cliques, 2) end,
    'taxa_checkout_pct', case when c.cliques > 0 then round(100.0 * c.ic / c.cliques, 2) end,

    'cpm', case when c.impr    > 0 then round(1000.0 * c.inv / c.impr, 2) end,
    'cpc', case when c.cliques > 0 then round(c.inv / c.cliques, 2) end,
    'cpv', case when c.visitas > 0 then round(c.inv / c.visitas, 2) end,
    'cpi', case when c.ic      > 0 then round(c.inv / c.ic, 2) end,
    'cpa', case when c.vendas  > 0 then round(c.inv / c.vendas, 2) end,
    'epc', case when c.visitas > 0 then round(c.fat / c.visitas, 2) end,
    'aov', case when c.vendas  > 0 then round(c.fat / c.vendas, 2) end,
    'epc_menos_cpv', case when c.visitas > 0
      then round((c.fat - c.inv) / c.visitas, 2) end
  )
  from calc c;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- "Quero anotar o que espero de cada ação, a meta ou expectativa ou motivo."
--
-- Opcional de propósito: obrigar a escrever expectativa faria a pessoa escrever
-- qualquer coisa para passar, e campo preenchido por obrigação vira ficção —
-- foi o que aconteceu com os 38 testes de funil, dos quais só 3 tinham
-- vencedor de verdade.
--
-- Quando existe, é o que transforma "marquei feito" em "deu certo ou não":
-- sem a expectativa escrita ANTES, a leitura depois vira racionalização do
-- número que apareceu.
alter table public.analise_acoes add column if not exists expectativa text;

comment on column public.analise_acoes.expectativa is
  'O que se espera desta ação -- meta, hipótese ou motivo. Opcional. Escrita '
  'ANTES do resultado, é o que permite dizer depois se deu certo.';

-- ─────────────────────────────────────────────────────────────────────────────
-- `feita_por` e `criada_por` apontavam para `auth.users`, e o PostgREST não
-- consegue chegar em `perfis` por esse caminho: `perfis:feita_por(nome)` volta
-- PGRST200, "no matches were found". A tela ficava sem o nome de quem executou
-- -- que é metade do "quero saber quando foi feito e por quem".
--
-- Todas as outras seis colunas de autoria do projeto (`utm_links.criado_por`,
-- `producoes.responsavel_id`, `criativo_comentarios.autor_id`...) apontam para
-- `public.perfis`. Não havia motivo para esta ser a exceção, e ser a exceção
-- foi exatamente o que quebrou. `analises.autor_id` tinha o mesmo defeito e vai
-- junto, antes que a próxima tela que precise do autor da rodada esbarre nele.

alter table public.analise_acoes drop constraint if exists analise_acoes_feita_por_fkey;
alter table public.analise_acoes drop constraint if exists analise_acoes_criada_por_fkey;
alter table public.analise_acoes
  add constraint analise_acoes_feita_por_fkey
  foreign key (feita_por) references public.perfis(id) on delete set null;
alter table public.analise_acoes
  add constraint analise_acoes_criada_por_fkey
  foreign key (criada_por) references public.perfis(id) on delete set null;

alter table public.analises drop constraint if exists analises_autor_id_fkey;
alter table public.analises
  add constraint analises_autor_id_fkey
  foreign key (autor_id) references public.perfis(id) on delete set null;
