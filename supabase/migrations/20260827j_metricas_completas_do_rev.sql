-- A planilha inteira, calculada — e não mais oito números soltos.
--
-- A primeira versão desta função trazia vendas, faturamento, ticket, ROAS,
-- investimento e três de bump. Era menos do que a planilha que ela já
-- preenche à mão, e um módulo que entrega menos que a planilha não substitui
-- a planilha: só acrescenta mais um lugar para olhar.
--
-- Agora vem tudo o que o CLAUDE.md do módulo listou como calculável:
-- topo de funil (impressões, cliques, visitas, checkouts iniciados), as três
-- conversões, os custos por etapa, o resultado financeiro, e cada order bump
-- e upsell nomeado — que na planilha são as linhas "Orderbump 1..5".
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DUAS ARMADILHAS QUE ESTA VERSÃO DESARMA
--
-- 1. As janelas de venda e de investimento eram DIFERENTES. A versão anterior
--    recebia timestamptz e filtrava venda por `>= agora - 14 dias` (meio-dia de
--    um dia até meio-dia de outro) enquanto o investimento ia por `::date`
--    (meia-noite a meia-noite). O investimento ganhava meia janela a mais que
--    as vendas, e o ROAS saía pessimista sem nada denunciando. Agora os
--    parâmetros são `date` e as duas pontas usam a mesma janela.
--
-- 2. `ad_id_meta` NÃO serve de denominador. A tentação era usar só a venda com
--    anúncio identificado nas conversões e nos custos por venda, para não
--    misturar orgânico com clique pago. Conferido contra a segunda fonte, o
--    resultado é absurdo: no REV3 da Saponária isso dava CPA de R$ 198 com
--    ticket de R$ 89 — prejuízo catastrófico num REV que deu R$ 6.795 de lucro.
--
--    O Meta reporta 437 compras para os anúncios daquele REV nos mesmos 14
--    dias. Nós amarramos 102. As outras ~300 são vendas do anúncio que
--    perderam o `ad_id` pelo caminho, não vendas orgânicas. Com o total do REV
--    (406) a conversão da página dá 2,27% contra os 2,44% que o próprio Meta
--    calcula; com as 102, dava 0,57% — quatro vezes errado.
--
--    Nos outros REVs a diferença nem existe (122 de 124, 67 de 68). O buraco é
--    específico do REV3, e é por isso que `vendas_de_anuncio` e `compras_meta`
--    continuam no retorno: não como denominador, mas como o termômetro da
--    atribuição, para a tela avisar quando a distância for grande.
--
-- 3. As conversões do funil não podem cruzar as DUAS fontes. Numerador nosso
--    sobre denominador do pixel dava "Checkout → venda: 202,9%" — mais vendas
--    do que checkouts iniciados, porque o pixel só vê tráfego pago e as nossas
--    vendas incluem área de membros e WhatsApp.
--
--    O absurdo visível era o menor problema. O invisível: a conversão da página
--    caía de 7,69% para 2,27% (–70%) enquanto pela contagem do próprio Meta ia
--    de 2,52% para 2,44% — estável. A tela gritaria um colapso que não houve.
--
--    Agora as quatro taxas usam só números do Meta, coerentes entre si por
--    construção. As métricas de negócio — CPA, EPC, ROAS, lucro — seguem sobre
--    as NOSSAS vendas, que é o que entrou no caixa. A tela diz qual é qual.
--
-- O que continua não existindo: `add_to_cart` vem nulo do Meta neste conjunto,
-- então não entra — cartão eternamente vazio ensina a ignorar a tela. E a
-- retenção de VSL segue vindo ao vivo do VTurb, não daqui.

drop function if exists public.fn_metricas_do_rev(uuid, timestamptz, timestamptz);
drop function if exists public.fn_metricas_do_rev_bloco(uuid, timestamptz, timestamptz);

-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_metricas_do_rev_bloco(
  p_funil_id uuid,
  p_inicio   date,
  p_fim      date   -- inclusivo, como o resto do dash (`lte(data_venda, ...)`)
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select p_inicio as ini, (p_fim + 1) as fim_excl
  ),
  vendas_rev as (
    select v.*
    from public.vendas v, params p
    where v.funil_id = p_funil_id
      and v.status = 'aprovada'
      and v.data_venda >= p.ini
      and v.data_venda <  p.fim_excl
      -- Mesma exclusão que o resto do dash usa para pedido de teste.
      and v.pedido_id not like 'TEST%'
      and v.pedido_id not like 'LC-%'
  ),
  principais as (
    select * from vendas_rev where not coalesce(is_upsell, false)
  ),
  totais as (
    select
      count(*)                                             as vendas,
      count(*) filter (where ad_id_meta is not null)        as vendas_ads,
      count(*) filter (where ad_id_meta is null)            as vendas_org,
      coalesce(sum(valor_total), 0)                         as faturamento_p,
      coalesce(sum(valor_total) filter (where ad_id_meta is not null), 0) as faturamento_ads,
      round(avg(valor_total), 2)                            as ticket
    from principais
  ),
  -- Tudo o que entrou, upsell incluso: é a base do ROAS e do lucro.
  caixa as (
    select
      coalesce(sum(valor_total), 0)             as faturamento,
      coalesce(sum(valor_sem_juros), 0)         as receita,
      -- Já é `valor_sem_juros - taxa_plataforma_valor`: o que de fato cai na
      -- conta. Conferido em 406 vendas: 35.331,38 - 2.166,58 = 33.164,80.
      coalesce(sum(valor_liquido_produtor), 0)  as liquido,
      coalesce(sum(taxa_plataforma_valor), 0)   as taxa,
      coalesce(sum(juros_parcelamento), 0)      as juros,
      coalesce(sum(valor_reembolsado), 0)       as reembolsos
    from vendas_rev
  ),
  bumps as (
    select count(*)                    as qtd,
           sum(vi.valor)               as faturamento,
           count(distinct vi.venda_id) as vendas_com_bump
    from public.venda_itens vi
    join vendas_rev v on v.id = vi.venda_id
    where vi.converteu
      and vi.tipo::text <> 'oferta_principal'
  ),
  -- As linhas "Orderbump 1..5" da planilha, uma por oferta NOMEADA.
  --
  -- Agrupa por nome e não por `tipo`: dois bumps diferentes já dividem o slot
  -- `orderbump_4` neste funil, e agrupar por slot somaria ofertas distintas
  -- num número que não descreve nenhuma das duas.
  itens as (
    select jsonb_agg(x order by x.qtd desc) as lista
    from (
      select vi.nome,
             min(vi.tipo::text)                                 as tipo,
             count(*)                                           as qtd,
             round(sum(vi.valor), 2)                            as faturamento,
             case when (select vendas from totais) > 0
                    then round(100.0 * count(*) / (select vendas from totais), 1)
             end                                                as adesao_pct
      from public.venda_itens vi
      join vendas_rev v on v.id = vi.venda_id
      where vi.converteu and vi.tipo::text <> 'oferta_principal'
      group by vi.nome
    ) x
  ),
  ups as (
    select count(*) as qtd, coalesce(sum(valor_total), 0) as faturamento
    from vendas_rev where coalesce(is_upsell, false)
  ),
  -- Os anúncios deste REV são os que produziram venda dele em QUALQUER época,
  -- e não só no período: um anúncio que vendeu mês passado e continua gastando
  -- pertence a este REV hoje, e ignorá-lo subestimaria ainda mais o piso.
  ads_do_rev as (
    select distinct v.ad_id_meta as ad_id
    from public.vendas v
    where v.funil_id = p_funil_id
      and v.ad_id_meta is not null
      and v.status = 'aprovada'
  ),
  meta as (
    select
      coalesce(sum(m.investimento), 0)         as investimento,
      coalesce(sum(m.impressoes), 0)           as impressoes,
      coalesce(sum(m.cliques_link), 0)         as cliques,
      coalesce(sum(m.visualizacoes_pagina), 0) as visitas,
      coalesce(sum(m.initiate_checkout), 0)    as checkouts,
      -- A contagem do próprio Meta, ao lado da nossa. É a segunda fonte que
      -- denunciou o CPA errado; sem ela, o número absurdo teria cara de certo.
      coalesce(sum(m.compras_meta), 0)         as compras_meta,
      coalesce(sum(m.faturamento_atribuido), 0) as faturamento_meta
    from public.metricas_meta m, params p
    where m.nivel = 'ad'
      and m.ad_id in (select ad_id from ads_do_rev)
      and m.data >= p.ini
      and m.data <  p.fim_excl
  ),
  -- Quanto do gasto TOTAL da janela conseguimos amarrar a algum REV. É o número
  -- que diz o quanto confiar no ROAS abaixo.
  cobertura as (
    select
      coalesce(sum(m.investimento), 0) as gasto_total,
      coalesce(sum(m.investimento) filter (
        where m.ad_id in (
          select distinct ad_id_meta from public.vendas
          where funil_id is not null and ad_id_meta is not null and status = 'aprovada'
        )), 0) as gasto_atribuido
    from public.metricas_meta m, params p
    where m.nivel = 'ad' and m.data >= p.ini and m.data < p.fim_excl
  ),
  imposto as (
    select
      coalesce(max(valor) filter (where chave = 'imposto_simples_nacional_pct'), 0) as simples_pct,
      coalesce(max(valor) filter (where chave = 'imposto_meta_ads_pct'), 0)         as meta_pct
    from public.configuracoes
  )
  select jsonb_build_object(
    'dias', (p_fim - p_inicio + 1),

    -- ── Venda ────────────────────────────────────────────────────────────────
    'vendas',            (select vendas from totais),
    -- Termômetro da atribuição, não denominador de nada.
    'vendas_de_anuncio', (select vendas_ads from totais),
    'vendas_organicas',  (select vendas_org from totais),
    'faturamento',       (select faturamento from caixa),
    'receita',           (select receita from caixa),
    'ticket_medio',      (select ticket from totais),

    -- ── Ofertas ──────────────────────────────────────────────────────────────
    'bump_qtd',          coalesce((select qtd from bumps), 0),
    'bump_faturamento',  coalesce((select faturamento from bumps), 0),
    -- Adesão: quantas vendas levaram ao menos um bump. A média do dash é ~39%.
    'bump_adesao_pct',   case when (select vendas from totais) > 0
                           then round(100.0 * coalesce((select vendas_com_bump from bumps), 0)
                                      / (select vendas from totais), 1)
                         end,
    'upsell_qtd',         (select qtd from ups),
    'upsell_faturamento', (select faturamento from ups),
    'itens',              coalesce((select lista from itens), '[]'::jsonb),

    -- ── Tráfego ──────────────────────────────────────────────────────────────
    'investimento',        (select investimento from meta),
    'investimento_e_piso', true,
    'impressoes',          (select impressoes from meta),
    'cliques',             (select cliques from meta),
    'visitas',             (select visitas from meta),
    'checkouts_iniciados', (select checkouts from meta),
    'compras_meta',        (select compras_meta from meta),
    'faturamento_meta',    (select faturamento_meta from meta),

    'roas',  case when (select investimento from meta) > 0
               then round((select receita from caixa) / (select investimento from meta), 2)
             end,
    -- Este número é da CONTA inteira, não deste REV: o investimento do REV cobre
    -- 100% dos anúncios que sabemos serem dele, por construção. O nome precisa
    -- dizer isso, senão alguém lê a variação entre janelas (69,7% x 35,8%) como
    -- se um dos ROAS fosse menos confiável que o outro — e descarta uma queda
    -- real.
    'cobertura_geral_pct',
      (select case when gasto_total > 0
                then round(100.0 * gasto_atribuido / gasto_total, 1) end from cobertura),

    -- ── Conversões ───────────────────────────────────────────────────────────
    -- As quatro medidas SÓ com números do Meta: clique → visita → checkout →
    -- compra. Ver a armadilha 3 no cabeçalho — cruzar as nossas vendas com o
    -- denominador do pixel produziu 202,9% de conversão de checkout.
    'connect_rate_pct',  case when (select cliques from meta) > 0
                           then round(100.0 * (select visitas from meta) / (select cliques from meta), 1)
                         end,
    'taxa_checkout_pct', case when (select visitas from meta) > 0
                           then round(100.0 * (select checkouts from meta) / (select visitas from meta), 2)
                         end,
    'conv_checkout_pct', case when (select checkouts from meta) > 0
                           then round(100.0 * (select compras_meta from meta) / (select checkouts from meta), 1)
                         end,
    'conv_pagina_pct',   case when (select visitas from meta) > 0
                           then round(100.0 * (select compras_meta from meta) / (select visitas from meta), 2)
                         end,

    -- ── Custo e ganho por etapa ──────────────────────────────────────────────
    'cpm', case when (select impressoes from meta) > 0
             then round(1000.0 * (select investimento from meta) / (select impressoes from meta), 2) end,
    'cpc', case when (select cliques from meta) > 0
             then round((select investimento from meta) / (select cliques from meta), 2) end,
    'cpv', case when (select visitas from meta) > 0
             then round((select investimento from meta) / (select visitas from meta), 2) end,
    'cpa', case when (select vendas from totais) > 0
             then round((select investimento from meta) / (select vendas from totais), 2) end,
    'epc', case when (select cliques from meta) > 0
             then round((select faturamento from caixa) / (select cliques from meta), 2) end,
    -- EPC − CPC: o que sobra de cada clique. Negativo é o sinal mais direto de
    -- que a escala está comprando prejuízo.
    'margem_por_clique',
      case when (select cliques from meta) > 0
        then round(((select faturamento from caixa) - (select investimento from meta))
                   / (select cliques from meta), 2) end,

    -- ── Resultado ────────────────────────────────────────────────────────────
    'taxa_plataforma', (select taxa from caixa),
    'juros_plataforma', (select juros from caixa),
    'reembolsos',      (select reembolsos from caixa),
    'imposto',         round((select faturamento from caixa) * (select simples_pct from imposto) / 100.0
                             + (select investimento from meta) * (select meta_pct from imposto) / 100.0, 2),
    -- Parte de `valor_liquido_produtor` (o que de fato cai na conta, já sem
    -- juros e sem taxa) e não do faturamento bruto: juros de parcelamento ficam
    -- com a plataforma, e contá-los como receita inventaria lucro.
    -- Custo fixo NÃO entra: ele é da empresa, e ratear por REV exigiria um
    -- critério inventado.
    'lucro', round(
      (select liquido from caixa)
      - (select reembolsos from caixa)
      - ((select faturamento from caixa) * (select simples_pct from imposto) / 100.0)
      - ((select investimento from meta) * (select meta_pct from imposto) / 100.0)
      - (select investimento from meta), 2),
    'margem_pct', case when (select faturamento from caixa) > 0
      then round(100.0 * (
        (select liquido from caixa)
        - (select reembolsos from caixa)
        - ((select faturamento from caixa) * (select simples_pct from imposto) / 100.0)
        - ((select investimento from meta) * (select meta_pct from imposto) / 100.0)
        - (select investimento from meta)
      ) / (select faturamento from caixa), 1) end
  );
$$;

comment on function public.fn_metricas_do_rev_bloco(uuid, date, date) is
  'Um período só, `p_fim` inclusivo. Existe separada porque fn_metricas_do_rev '
  'a chama duas vezes, para o período e para o anterior de mesmo tamanho.';

-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_metricas_do_rev(
  p_funil_id uuid,
  p_inicio   date,
  p_fim      date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dias integer := (p_fim - p_inicio) + 1;
begin
  -- Período anterior do MESMO tamanho. "ROAS 1,9" não diz nada; "1,7 → 1,9"
  -- diz. Comparar com período de tamanho diferente seria pior que não comparar.
  return jsonb_build_object(
    'dias',     v_dias,
    'inicio',   p_inicio,
    'fim',      p_fim,
    'atual',    public.fn_metricas_do_rev_bloco(p_funil_id, p_inicio, p_fim),
    'anterior', public.fn_metricas_do_rev_bloco(p_funil_id, p_inicio - v_dias, p_inicio - 1)
  );
end;
$$;

comment on function public.fn_metricas_do_rev(uuid, date, date) is
  'Métricas de um REV no período, com o período anterior de mesmo tamanho ao '
  'lado. O investimento é PISO: anúncio que gastou sem vender fica de fora.';

revoke execute on function public.fn_metricas_do_rev(uuid, date, date) from public, anon;
grant  execute on function public.fn_metricas_do_rev(uuid, date, date) to authenticated, service_role;
revoke execute on function public.fn_metricas_do_rev_bloco(uuid, date, date) from public, anon;
grant  execute on function public.fn_metricas_do_rev_bloco(uuid, date, date) to authenticated, service_role;
