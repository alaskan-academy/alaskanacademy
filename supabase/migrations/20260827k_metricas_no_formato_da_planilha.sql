-- As métricas do REV no formato da planilha que ela já usa, com as fórmulas
-- dela — conferidas linha a linha contra "08/08 a 23/08 - PV PADRÃO"
-- (Velas Lembrancinhas · REV1 - Original).
--
-- Seis divergências apareceram naquela conferência. Quatro eram defeito desta
-- função e estão corrigidas aqui:
--
-- 1. FUSO. Comparava `data_venda` em UTC; o resto do dash usa
--    America/Sao_Paulo. Dava 126 vendas onde ela conta 127, e 32 Pacote Impulso
--    onde há 33. Com o fuso certo TODAS as quantidades batem exatamente.
--
-- 2. NÍVEL DO TRÁFEGO. Ela mede a campanha; esta função media só os anúncios
--    com venda atribuída. Dos 46 anúncios que gastaram no PV PADRÃO, só 27
--    produziram venda — R$ 8.034 contra os R$ 8.433 dela. Agora mede a campanha
--    inteira quando a campanha serve UM REV só (7 das 8 campanhas), e cai para
--    o nível de anúncio quando ela é compartilhada, que hoje é o caso da
--    "TESTE TSL - 27/06/26" (REV5 e REV6 juntos). O campo `nivel_investimento`
--    diz qual dos dois valeu, para a tela não precisar adivinhar.
--
-- 3. ORDER BUMP MARCADO COMO OFERTA PRINCIPAL. "Workshop Buquê de Velas" tem
--    tipo `oferta_principal` e era excluído. Conferido em toda a base:
--    `venda_itens` NUNCA contém a oferta principal de verdade — zero linhas em
--    que o nome do item bate com o produto da venda, nos 2.407 itens
--    convertidos. Então a regra deixa de olhar o tipo: item que converteu é
--    bump, ponto. Regra derivada, não lista no código.
--
-- 4. UPSELL. Resolvido na migração anterior, pelo carrinho.
--
-- As outras duas eram da planilha, e aqui vale o número real, por decisão dela:
--    * a planilha multiplica quantidade por preço cheio (127 × R$ 97 =
--      R$ 12.319) e ignora cupom; o recebido foi R$ 12.147,76;
--    * a planilha cobra taxa fixa de 7% (R$ 1.099,78); a Payt cobrou R$ 841,06.
--    Curiosamente o lucro líquido sai quase igual — a taxa real menor compensa
--    o faturamento menor. Os dois erros da planilha se anulavam.
--
-- FATURAMENTO já entra líquido de juros de parcelamento e de reembolso, a
-- pedido dela — não há mais três cartões separados para descontar de cabeça.
-- Juros ficam com a plataforma; reembolso saiu do caixa. Contar qualquer um dos
-- dois como receita inventaria dinheiro.

create or replace function public.fn_metricas_do_rev_bloco(
  p_funil_id uuid,
  p_inicio   date,
  p_fim      date   -- inclusivo, como o resto do dash
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
      -- Fuso de São Paulo, como o resto do dash. Ver o defeito 1 no cabeçalho.
      and (v.data_venda at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
      and v.pedido_id not like 'TEST%'
      and v.pedido_id not like 'LC-%'
  ),
  principais as (
    select * from vendas_rev where not coalesce(is_upsell, false)
  ),
  caixa as (
    select
      -- Líquido de juros e de reembolso, por decisão dela.
      coalesce(sum(valor_sem_juros - coalesce(valor_reembolsado, 0)), 0) as faturamento,
      coalesce(sum(taxa_plataforma_valor), 0)                            as taxa,
      coalesce(sum(valor_reembolsado), 0)                                as reembolsos
    from vendas_rev
  ),
  totais as (
    select
      count(*)                                       as vendas,
      count(*) filter (where ad_id_meta is not null) as vendas_ads,
      coalesce(sum(valor_oferta_principal), 0)       as oferta_principal
    from principais
  ),
  -- Item que converteu é order bump. Ver o defeito 3 no cabeçalho.
  bumps as (
    select count(*)                    as qtd,
           coalesce(sum(vi.valor), 0)  as faturamento,
           count(distinct vi.venda_id) as vendas_com_bump
    from public.venda_itens vi
    join vendas_rev v on v.id = vi.venda_id
    where vi.converteu
  ),
  -- As linhas "Orderbump 1..5" da planilha, uma por oferta nomeada. Agrupa por
  -- nome e não por `tipo`: dois bumps diferentes já dividem o slot
  -- `orderbump_4` na Saponária, e agrupar por slot somaria ofertas distintas
  -- num número que não descreve nenhuma das duas.
  itens as (
    select jsonb_agg(x order by x.qtd desc) as lista
    from (
      select vi.nome,
             count(*)                as qtd,
             round(sum(vi.valor), 2) as faturamento,
             case when (select vendas from totais) > 0
                    then round(100.0 * count(*) / (select vendas from totais), 2)
             end                     as adesao_pct
      from public.venda_itens vi
      join vendas_rev v on v.id = vi.venda_id
      where vi.converteu
      group by vi.nome
    ) x
  ),
  ups as (
    select count(*) as qtd, coalesce(sum(valor_sem_juros), 0) as faturamento
    from vendas_rev where coalesce(is_upsell, false)
  ),
  -- ── Tráfego: campanha quando ela é de um REV só. Ver o defeito 2. ──────────
  mapa_ad as (
    select distinct v.ad_id_meta as ad_id, v.funil_id
    from public.vendas v
    where v.funil_id is not null and v.ad_id_meta is not null and v.status = 'aprovada'
  ),
  ads_rev as (select ad_id from mapa_ad where funil_id = p_funil_id),
  camp_rev as (
    select distinct m.campanha_id
    from public.metricas_meta m
    where m.nivel = 'ad' and m.campanha_id is not null
      and m.ad_id in (select ad_id from ads_rev)
  ),
  camp_exclusiva as (
    select m.campanha_id
    from public.metricas_meta m
    join mapa_ad a on a.ad_id = m.ad_id
    where m.nivel = 'ad' and m.campanha_id in (select campanha_id from camp_rev)
    group by m.campanha_id
    having count(distinct a.funil_id) = 1
  ),
  ads_alvo as (
    select distinct m.ad_id
    from public.metricas_meta m
    where m.nivel = 'ad' and m.campanha_id in (select campanha_id from camp_exclusiva)
    union
    select ad_id from ads_rev
  ),
  meta as (
    select
      coalesce(sum(m.investimento), 0)          as investimento,
      coalesce(sum(m.impressoes), 0)            as impressoes,
      coalesce(sum(m.cliques_link), 0)          as cliques,
      coalesce(sum(m.visualizacoes_pagina), 0)  as visitas,
      coalesce(sum(m.initiate_checkout), 0)     as checkouts,
      -- A contagem do próprio Meta, ao lado da nossa: é a segunda fonte que
      -- denuncia atribuição quebrada antes que ela vire decisão errada.
      coalesce(sum(m.compras_meta), 0)          as compras_meta
    from public.metricas_meta m
    where m.nivel = 'ad'
      and m.ad_id in (select ad_id from ads_alvo)
      and m.data between p_inicio and p_fim
  ),
  cobertura as (
    select
      coalesce(sum(m.investimento), 0) as gasto_total,
      coalesce(sum(m.investimento) filter (
        where m.ad_id in (select distinct ad_id from mapa_ad)), 0) as gasto_atribuido
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
      (select vendas from totais)       as vendas,
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

    -- ── Bloco 1: o resultado, na ordem da planilha ───────────────────────────
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

    -- ── Bloco 2: as ofertas ─────────────────────────────────────────────────
    'oferta_principal_qtd',   c.vendas,
    'oferta_principal_valor', (select oferta_principal from totais),
    'bump_qtd',               (select qtd from bumps),
    'bump_faturamento',       (select faturamento from bumps),
    'bump_adesao_pct',        case when c.vendas > 0
                                then round(100.0 * (select vendas_com_bump from bumps) / c.vendas, 2) end,
    'upsell_qtd',             (select qtd from ups),
    'upsell_faturamento',     (select faturamento from ups),
    'itens',                  coalesce((select lista from itens), '[]'::jsonb),
    -- O 21,59% ao lado do AOV na planilha: quanto do faturamento veio de bump
    -- e upsell, e não da oferta principal.
    'pct_ofertas_extras', case when c.fat > 0
      then round(100.0 * ((select faturamento from bumps) + (select faturamento from ups)) / c.fat, 2) end,

    -- ── Bloco 3: o tráfego ──────────────────────────────────────────────────
    'nivel_investimento', case
      when (select count(*) from camp_rev) = 0 then 'anuncio'
      when (select count(*) from camp_rev) = (select count(*) from camp_exclusiva) then 'campanha'
      else 'misto' end,
    'impressoes',          c.impr,
    'cliques',             c.cliques,
    'visitas',             c.visitas,
    'checkouts_iniciados', c.ic,
    'compras_meta',        (select compras_meta from meta),
    'vendas_de_anuncio',   (select vendas_ads from totais),
    'cobertura_geral_pct',
      (select case when gasto_total > 0
                then round(100.0 * gasto_atribuido / gasto_total, 1) end from cobertura),

    -- ── Bloco 4: as conversões, nas fórmulas dela ───────────────────────────
    'conv_funil_pct',    case when c.visitas > 0 then round(100.0 * c.vendas / c.visitas, 2) end,
    'conv_checkout_pct', case when c.ic > 0 then round(100.0 * c.vendas / c.ic, 2) end,
    'connect_rate_pct',  case when c.cliques > 0 then round(100.0 * c.visitas / c.cliques, 2) end,
    'taxa_checkout_pct', case when c.visitas > 0 then round(100.0 * c.ic / c.visitas, 2) end,

    -- ── Bloco 5: custo e ganho por etapa ────────────────────────────────────
    'cpm', case when c.impr    > 0 then round(1000.0 * c.inv / c.impr, 2) end,
    'cpc', case when c.cliques > 0 then round(c.inv / c.cliques, 2) end,
    'cpv', case when c.visitas > 0 then round(c.inv / c.visitas, 2) end,
    'cpi', case when c.ic      > 0 then round(c.inv / c.ic, 2) end,
    'cpa', case when c.vendas  > 0 then round(c.inv / c.vendas, 2) end,
    'epc', case when c.visitas > 0 then round(c.fat / c.visitas, 2) end,
    'aov', case when c.vendas  > 0 then round(c.fat / c.vendas, 2) end,
    -- EPC menos CPV, os dois por VISITA -- é assim que a planilha faz. Negativo
    -- é o sinal mais direto de escala comprando prejuízo.
    'epc_menos_cpv', case when c.visitas > 0
      then round((c.fat - c.inv) / c.visitas, 2) end
  )
  from calc c;
$$;

comment on function public.fn_metricas_do_rev_bloco(uuid, date, date) is
  'Um período só, p_fim inclusivo, no fuso de São Paulo. Fórmulas conferidas '
  'contra a planilha de 08/08 a 23/08 do PV PADRÃO.';
