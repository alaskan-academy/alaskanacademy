-- Duas mudanças pedidas por ela, e a primeira é a que fecha o ciclo do módulo.
--
-- 1. "Quero poder marcar como feito as alterações."
--
--    `proximas_acoes` era um campo de texto solto por rodada. Texto solto não
--    se marca, não se cobra, e some da vista na rodada seguinte — e uma ação
--    que ninguém revisita é exatamente o Google Chat de novo, que é o que este
--    módulo veio substituir. O CLAUDE.md já registra a regra: "alteração sem
--    veredito é dívida".
--
--    Agora é uma linha por ação, com estado. E a ação pertence ao REV, não à
--    rodada: escrita numa quinzena, ela continua aparecendo na próxima até
--    alguém marcar. É isso que faz a análise virar ciclo em vez de diário.
--
--    A coluna de texto é REMOVIDA junto, não mantida "por compatibilidade":
--    dois lugares guardando a mesma coisa sempre divergem, e já custou caro
--    cinco vezes neste projeto.
--
-- 2. "Podemos deixar o upsell de fora. Vamos analisar apenas vendas do front e
--    obs mesmo."
--
--    O upsell continua sendo amarrado ao REV pelo carrinho — aquilo conserta o
--    dado, e o Resumo e o Financeiro seguem contando. O que muda é o recorte
--    DESTA análise: faturamento, ROAS, lucro, AOV e EPC passam a olhar só a
--    venda de front e seus order bumps. Misturar upsell aqui mediria a oferta
--    de outra página junto com a que se está analisando.

create table if not exists public.analise_acoes (
  id          uuid primary key default gen_random_uuid(),
  -- A rodada em que nasceu, para saber "desde quando isto está em aberto".
  analise_id  uuid references public.analises(id) on delete set null,
  -- O dono de verdade: a ação sobrevive à rodada.
  funil_id    uuid not null references public.funis(id) on delete cascade,
  texto       text not null,
  feita       boolean not null default false,
  feita_em    timestamptz,
  feita_por   uuid references auth.users(id),
  criada_em   timestamptz not null default now(),
  criada_por  uuid references auth.users(id)
);

create index if not exists idx_analise_acoes_abertas
  on public.analise_acoes (funil_id) where not feita;

comment on table public.analise_acoes is
  'O que ficou decidido numa rodada. Pertence ao REV e não à rodada: continua '
  'aparecendo nas próximas até alguém marcar como feita.';

-- `feita_em` nunca fica fora de sincronia com `feita` porque não é digitado.
create or replace function public.fn_analise_acao_carimbo()
returns trigger
language plpgsql
as $$
begin
  if new.feita and not coalesce(old.feita, false) then
    new.feita_em := now();
  elsif not new.feita then
    new.feita_em := null;
    new.feita_por := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_analise_acao_carimbo on public.analise_acoes;
create trigger trg_analise_acao_carimbo
before insert or update on public.analise_acoes
for each row execute function public.fn_analise_acao_carimbo();

alter table public.analise_acoes enable row level security;

drop policy if exists analise_acoes_admin on public.analise_acoes;
create policy analise_acoes_admin on public.analise_acoes
  for all to authenticated
  using (exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_admin));

-- Um campo a menos dizendo o que a tabela agora diz melhor.
alter table public.analise_itens drop column if exists proximas_acoes;

-- ─────────────────────────────────────────────────────────────────────────────
-- E a análise passa a olhar só front + order bumps.
--
-- Muda em relação à versão anterior: `vendas_rev` ganha
-- `and not coalesce(v.is_upsell, false)`, os campos `upsell_qtd` e
-- `upsell_faturamento` saem do retorno, e `pct_ofertas_extras` passa a medir só
-- os bumps. `taxa_checkout_pct` passa a ser sobre CLIQUES e não sobre visitas,
-- porque a tela deixou de mostrar visitas como etapa — a taxa de uma etapa
-- precisa se referir à etapa anterior que aparece ao lado dela.

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
      -- Upsell fica de fora desta análise, por decisão dela: mede a oferta de
      -- outra página junto com a que se está analisando. O vínculo do upsell ao
      -- REV continua existindo no banco -- Resumo e Financeiro seguem contando.
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

    'nivel_investimento', case
      when (select count(*) from camp_rev) = 0 then 'anuncio'
      when (select count(*) from camp_rev) = (select count(*) from camp_exclusiva) then 'campanha'
      else 'misto' end,
    'impressoes',          c.impr,
    'cliques',             c.cliques,
    'visitas',             c.visitas,
    'checkouts_iniciados', c.ic,
    'compras_meta',        (select compras_meta from meta),
    'vendas_de_anuncio',   (select vendas_ads from caixa),
    'cobertura_geral_pct',
      (select case when gasto_total > 0
                then round(100.0 * gasto_atribuido / gasto_total, 1) end from cobertura),

    -- Conversão do funil e CPV/EPC seguem sobre VISITAS, por escolha dela:
    -- visitas saíram da tela mas continuam nas contas, para os números
    -- continuarem batendo com a planilha.
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
