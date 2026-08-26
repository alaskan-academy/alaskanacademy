-- O upsell volta — ao LADO do resultado do front, nunca dentro dele.
--
-- O problema que ela descreveu tem dois lados opostos, e nenhum número único
-- resolve os dois:
--
--   * somar o upsell esconde front doente: um funil com ROAS de front 1,00 e
--     10% de adesão no up aparece saudável, e ninguém volta para consertar a
--     página;
--   * tirar o upsell mata funil lucrativo: aquele mesmo funil põe mais dinheiro
--     no bolso que um de ROAS 1,40 com 2% de up, e seria descartado.
--
-- Não é escolher o melhor dos dois. É que a pergunta é outra em cada caso:
-- "a página precisa de ajuste?" se responde só com o front, que é a superfície
-- onde se mexe; "esse funil dá dinheiro?" se responde com o total, que é o que
-- entra no caixa. As duas ficam na tela, com nomes diferentes, e nunca somadas
-- num número só.
--
-- O que decide entre os dois exemplos dela não é nenhum ROAS isolado: é se o
-- FRONT SE PAGA. Front que se paga significa que o upsell é lucro; front que
-- não se paga significa que o funil está de pé sobre uma perna só, e a
-- otimização é urgente mesmo com o total no azul. Por isso `front_se_paga` sai
-- daqui pronto, e não calculado na tela: é a regra de decisão do módulo, e
-- regra de decisão mora junto do dado.
--
-- Medido nos REVs ativos, 14 dias, e os dois casos dela existem de verdade:
--
--   Velas REV1   front 1,84 → 2,04 com up · adesão 4,00%  · front se paga
--   Saponaria R5 front 0,88 → 0,97 com up · adesão 4,96%  · front NÃO se paga
--
-- O REV5 é o caso ao contrário: o upsell ajuda e não salva — 0,97 continua
-- abaixo de 1. A tela precisa dizer isso, e não "o total pode estar no azul",
-- que ali seria consolo falso.
--
-- RESSALVA que a tela repete junto do número: o upsell é assinatura ANUAL.
-- R$ 297 hoje é um ano de acesso, e a renovação reaparece daqui a 12 meses como
-- venda nova. Serve para "quanto entrou", não para comparar períodos ao longo
-- do tempo.
--
-- Entra também `taxa_plataforma_pct`: a tela dizia "a taxa real cobrada, não 7%
-- fixo", que explica o que o número NÃO é. Dizer quanto ele É custa o mesmo e
-- informa — e a variação entre REVs é grande (5,87% na Velas, 14,80% no
-- Desafios), o que só se enxerga com o percentual à vista.

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
  with todas as (
    select v.*
    from public.vendas v
    where v.funil_id = p_funil_id
      and v.status = 'aprovada'
      and (v.data_venda at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
      and v.pedido_id not like 'TEST%'
      and v.pedido_id not like 'LC-%'
  ),
  -- O recorte padrão da análise: front + order bumps. Tudo que a tela mostra
  -- como métrica de otimização sai daqui.
  vendas_rev as (select * from todas where not coalesce(is_upsell, false)),
  upsells    as (select * from todas where     coalesce(is_upsell, false)),
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
  caixa_up as (
    select
      coalesce(sum(valor_sem_juros - coalesce(valor_reembolsado, 0)), 0) as faturamento,
      coalesce(sum(taxa_plataforma_valor), 0)                            as taxa,
      count(*)                                                           as qtd
    from upsells
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
  -- Os CONJUNTOS deste REV, nunca a campanha: a mesma campanha roda REVs
  -- diferentes, inclusive os de teste. Ver a migração anterior.
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
      (select faturamento from caixa)     as fat,
      (select vendas from caixa)          as vendas,
      (select investimento from meta)     as inv,
      (select cliques from meta)          as cliques,
      (select visitas from meta)          as visitas,
      (select checkouts from meta)        as ic,
      (select impressoes from meta)       as impr,
      (select taxa from caixa)            as taxa,
      (select faturamento from caixa_up)  as fat_up,
      (select taxa from caixa_up)         as taxa_up,
      (select qtd from caixa_up)          as qtd_up,
      (select simples_pct from imposto)   as pct_simples,
      round((select faturamento from caixa) * (select simples_pct from imposto) / 100.0, 2) as imp_simples,
      round((select investimento from meta) * (select meta_pct from imposto) / 100.0, 2)    as imp_meta
  ),
  -- O mesmo cálculo, com o upsell somado. Imposto e taxa do upsell entram
  -- junto: contar a receita dele sem os custos dele inventaria lucro.
  com_up as (
    select
      c.fat + c.fat_up                                     as fat_total,
      round((c.fat + c.fat_up) * c.pct_simples / 100.0, 2)  as imp_simples_total,
      c.taxa + c.taxa_up                                    as taxa_total
    from calc c
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
    'taxa_plataforma_pct', case when c.fat > 0 then round(100.0 * c.taxa / c.fat, 2) end,
    'lucro_liquido',    round(c.fat - c.inv - c.imp_simples - c.imp_meta - c.taxa, 2),
    'margem_pct',       case when c.fat > 0
                          then round(100.0 * (c.fat - c.inv - c.imp_simples - c.imp_meta - c.taxa) / c.fat, 1)
                        end,
    'reembolsos',       (select reembolsos from caixa),

    -- ── O upsell, ao lado e nunca dentro ────────────────────────────────────
    'upsell_qtd',           c.qtd_up,
    'upsell_faturamento',   c.fat_up,
    -- A métrica que faltava: é por ela que se compara "10% de up" com "2%".
    'upsell_adesao_pct',    case when c.vendas > 0
                              then round(100.0 * c.qtd_up / c.vendas, 2) end,
    'faturamento_com_upsell', u.fat_total,
    'roas_com_upsell',        case when c.inv > 0 then round(u.fat_total / c.inv, 2) end,
    'lucro_com_upsell',       round(u.fat_total - c.inv - u.imp_simples_total - c.imp_meta - u.taxa_total, 2),
    'margem_com_upsell_pct',  case when u.fat_total > 0
      then round(100.0 * (u.fat_total - c.inv - u.imp_simples_total - c.imp_meta - u.taxa_total) / u.fat_total, 1)
    end,
    -- A regra de decisão do módulo, resolvida aqui e não na tela.
    'front_se_paga', case when c.inv > 0 then (c.fat >= c.inv) end,

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
  from calc c, com_up u;
$$;
