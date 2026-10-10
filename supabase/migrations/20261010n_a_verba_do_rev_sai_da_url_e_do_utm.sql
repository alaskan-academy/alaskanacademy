-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ A verba do REV sai da URL e do UTM, não da venda aprovada               ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- O card do REV10 mostrava, em 10/10/2026, no período de 26/09 a 10/10:
--
--   Investimento   R$ 0,00    "sem conjunto identificado"
--   Lucro líquido  R$ 56,06   margem de 84,5%
--
-- O conjunto existia e estava gastando: `07/10 TESTE REV10`, conta
-- `Saponaria Brasil - TSL`, 8 anúncios, **R$ 305,98** entre 07/10 e 10/10. O
-- REV10 era o teste menos rentável do painel aparecendo como o mais rentável.
--
--                        na tela        de verdade
--   Investimento         R$ 0,00        R$ 305,98
--   Resultado           +R$ 66,33       -R$ 239,65
--   ROAS                 --              0,22
--   Lucro líquido       +R$ 56,06       -R$ 292,76
--   Margem              +84,5%          -441,4%
--
-- Erro de R$ 348,82 na linha de baixo, num teste de 3 dias.
--
-- ── Por que sumia ───────────────────────────────────────────────────────
--
-- `mapa_ad` montava o vínculo anúncio↔REV **a partir das vendas aprovadas**:
--
--     select distinct v.ad_id_meta, v.funil_id
--       from vendas v where v.status = 'aprovada' ...
--
-- Sem ad não há conjunto, sem conjunto o investimento é zero. E o REV10 tem
-- duas vendas:
--
--   KYEWAYZ   aprovada   sem UTM nenhum                    origem organico
--   V8XGVMG   PENDENTE   utm_medium = "07/10 TESTE REV10|120252583859370560"
--                        ad_id_meta = 120252583867220560   origem pago
--
-- A venda que carrega a cadeia de atribuição inteira **está pendente**, e o
-- filtro `aprovada` a descartava. O painel tinha o vínculo na mão.
--
-- ── A regra que separa as duas perguntas ────────────────────────────────
--
-- > `status = 'aprovada'` está certo quando se conta DINHEIRO, e errado quando
-- > se estabelece IDENTIDADE.
--
-- Saber que conjunto mandou tráfego para que REV não depende de o pagamento
-- ter caído: o clique aconteceu, a pessoa chegou na página, o Meta cobrou.
-- Exigir aprovação para ATRIBUIR CUSTO faz o custo aparecer só depois da
-- primeira venda paga — exatamente ao contrário do que um teste precisa, que é
-- ver o custo ANTES de decidir se continua.
--
-- Por isso `fn_metricas_meta_agregado` (receita por anúncio) **continua**
-- exigindo aprovada, e está certa: lá a pergunta é dinheiro. As duas não
-- divergem; elas respondem coisas diferentes.
--
-- ── Pela URL, e não pelo nome ───────────────────────────────────────────
--
-- Decidido por ela em 10/10/2026: *"você deve rastrear não pelo nome do funil,
-- mas pela URL linkada a ele, cada funil tem sua URL, e assim cruzar com a URL
-- enviada pela Payt"*.
--
-- É o que esta migração faz, e os dois lados já existiam:
--
--   o REV      vem de `vendas.funil_id`, que `fn_venda_resolve_funil` já
--              resolve pela URL da Payt (`link_url` -> `funil_checkouts` ->
--              `fn_funil_da_venda`)
--   o CONJUNTO vem de `utm_medium`, que a Payt entrega como "nome|id" —
--              e o que se usa é o **id**, não o nome
--
-- Eu tinha proposto casar pelo NOME do conjunto (`adset_nome ilike '%REV10%'`)
-- e estava errado, por dois motivos que a medição mostrou: `%REV1%` casa com
-- REV10 e REV11, e `REV3 - VSL` não casa com conjunto nenhum porque o conjunto
-- se chama só "REV3". Convenção de nome envelhece — terceira armadilha. O id
-- não.
--
-- ── Medido antes de mexer ───────────────────────────────────────────────
--
-- Cobertura do formato, em 17.134 vendas não-upsell:
--
--   com o id do conjunto dentro do utm_medium ......... 7.195
--     dessas, aprovadas ............................... 4.803
--     dessas, NÃO aprovadas ........................... 2.392   <- 33% do sinal
--
-- Conferência contra segunda fonte (a regra de leitura do CLAUDE.md), nas
-- 4.956 linhas com funil e id:
--
--   o adset do UTM existe em metricas_meta ............ 4.956  (100%)
--   o ad_id_meta da venda bate com esse adset ......... 4.956  (100%)
--   CONTRADIZEM ....................................... 0
--
-- Zero divergência. O `utm_medium` não é pista, é o id.
--
-- E o efeito, REV a REV, no período de 26/09 a 10/10:
--
--   REV10 ......................... 0,00  ->  305,98    <- o conserto
--   REV3 - VSL ................ 21.022,62  ->  21.022,62
--   REV1 - Original (Velas) .... 8.050,85  ->   8.050,85
--   REV4 (Guia) ................ 7.214,38  ->   7.214,38
--   REV9 / REV5 / REV6 / REV3 / REV1 ..... todas iguais
--
-- Onze REVs idênticos, um consertado. É a assinatura que um conserto deve ter.
--
-- ── Dupla contagem: medida, e barrada ───────────────────────────────────
--
-- Subir de anúncio para CONJUNTO tem um risco: se o mesmo conjunto mandou
-- tráfego para dois REVs, os dois reivindicam a verba inteira e o mesmo real é
-- contado duas vezes. Medido:
--
--   conjuntos ligados a algum REV .......... 120
--   ligados a MAIS DE UM REV ............... 1
--   verba desse um, na janela .............. R$ 0,00
--
-- Praticamente nulo hoje, e mesmo assim barrado: conjunto ambíguo fica **fora**
-- da conta dos dois, e sai pelo JSON em `conjuntos_ambiguos` /
-- `investimento_ambiguo` para a tela poder dizer. Dividir a verba por rateio
-- seria inventar número; somar nos dois seria mentir duas vezes. Não decidir e
-- dizer que não decidiu é a terceira opção, e é a honesta — o mesmo desenho do
-- "candidato único" de `fn_fixar_vinculo_ads`.
--
-- ── A segunda rota fica, embora hoje não acrescente nada ────────────────
--
-- O vínculo sai da união de DUAS rotas:
--
--   A. o id dentro de `utm_medium`  (o que a Payt manda)
--   B. `ad_id_meta` -> `metricas_meta.adset_id`  (o caminho antigo, sem o
--      filtro de aprovada)
--
-- Medido: as duas devolvem as MESMAS 121 ligações, então B é redundante hoje.
-- Ela fica mesmo assim, e de propósito: sem ela a função passaria a depender
-- inteiramente de um formato de texto ("nome|id") que a Payt pode mudar sem
-- avisar. Custa 89 ms numa base de 15 mil linhas de métrica.
--
-- ── O aviso que teria pego isto no primeiro dia ─────────────────────────
--
-- Entra `investimento_sem_rev_no_projeto`: a verba das contas do projeto, na
-- janela, que não está em REV nenhum. Hoje, depois do conserto:
--
--   Saponaria Brasil ........ R$ 34.155,37   100,0% em REV
--   Guia dos Comportamentos .. R$ 7.214,38   100,0%
--   Workshop Buquê ........... R$ 1.095,67   100,0%
--   Velas Lembrancinhas ...... R$ 8.773,61    99,0%   (R$ 87,72 soltos)
--
-- É um número que CHEGA A ZERO — e que, antes do conserto, estaria acusando os
-- R$ 305,98 da Saponária desde 07/10. Alerta que nasce zerado e sobe quando
-- algo se solta é o oposto do alerta que nunca zera.
--
-- Isso importa porque hoje os três avisos do módulo desligam todos quando o
-- investimento é zero: `distanciaDoMeta` devolve null, `baseAnteriorFragil`
-- devolve false, `trafego_se_paga`/`front_se_paga` viram null. Cada um está
-- certo para "não há mídia rodando" — e os três silenciam juntos no caso em que
-- há mídia e o que quebrou foi o vínculo. Este campo é o sinal que falta.
--
-- ── O que NÃO entra aqui ────────────────────────────────────────────────
--
-- `vw_criativo_funil` tem a mesma cegueira (liga criativo a REV só por venda
-- aprovada) e NÃO é tocada: ela responde outra pergunta, com rateio próprio
-- (frac >= 0.8, n >= 10), e mexer nela muda a atribuição de criativo, que não é
-- o que está errado na tela. Fica anotado.
--
-- E sobrou um buraco maior, que é cadastro e não código: **96 de 124 linhas de
-- `funil_checkouts` estão sem `funil_id`**, e por isso 9.881 vendas não têm REV
-- — 2.372 delas com conjunto identificado no UTM. Essas vendas não entram em
-- REV nenhum enquanto alguém não disser de quem é cada checkout. Nenhuma linha
-- deste arquivo adivinha isso.

begin;

-- Retrato de ANTES, para a prova poder dizer que só o REV10 mudou. Sem isto a
-- prova seria "o REV10 ficou certo", que nao e a pergunta inteira — a pergunta
-- e "o REV10 ficou certo E nenhum outro se mexeu".
-- Sem `on commit drop`: a prova roda DEPOIS do commit, e se o runner nao
-- envolver o arquivo inteiro numa transacao a tabela sumiria antes de ser
-- lida. Ela e derrubada no fim, a mao.
drop table if exists _antes_rev;
create temp table _antes_rev as
select f.id,
       f.nome,
       (public.fn_metricas_do_rev(f.id, '2026-09-26', '2026-10-10')
          ->'atual'->>'investimento')::numeric as inv
  from public.funis f;

create or replace function public.fn_metricas_do_rev_bloco(p_funil_id uuid, p_inicio date, p_fim date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with todas as (
    select v.*
    from public.vendas v
    where v.funil_id = p_funil_id
      and v.status = 'aprovada'
      and (v.data_venda at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
      and v.pedido_id not like 'TEST%'
      and v.pedido_id not like 'LC-%'
  ),
  -- O recorte padrao da analise: front + order bumps. Tudo que a tela mostra
  -- como metrica de otimizacao sai daqui. AQUI 'aprovada' esta certo: e
  -- dinheiro.
  vendas_rev as (select * from todas where not coalesce(is_upsell, false)),
  upsells    as (select * from todas where     coalesce(is_upsell, false)),
  caixa as (
    select
      coalesce(sum(valor_sem_juros - coalesce(valor_reembolsado, 0) - coalesce(valor_coproducao, 0)), 0) as faturamento,
      coalesce(sum(valor_sem_juros - coalesce(valor_reembolsado, 0) - coalesce(valor_coproducao, 0) + coalesce(juros_parcelamento, 0)), 0) as base_simples,
      coalesce(sum(taxa_plataforma_valor), 0)                            as taxa,
      coalesce(sum(valor_reembolsado), 0)                                as reembolsos,
      count(*)                                                           as vendas,
      count(*) filter (where ad_id_meta is not null)                     as vendas_ads,
      coalesce(sum(valor_oferta_principal), 0)                           as oferta_principal
    from vendas_rev
  ),
  caixa_up as (
    select
      coalesce(sum(valor_sem_juros - coalesce(valor_reembolsado, 0) - coalesce(valor_coproducao, 0)), 0) as faturamento,
      coalesce(sum(valor_sem_juros - coalesce(valor_reembolsado, 0) - coalesce(valor_coproducao, 0) + coalesce(juros_parcelamento, 0)), 0) as base_simples,
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
      group by vi.nome
    ) x
  ),

  -- ── O VINCULO CONJUNTO <-> REV ───────────────────────────────────────────
  --
  -- O REV vem da URL: `vendas.funil_id` e resolvido por `fn_venda_resolve_funil`
  -- a partir do `link_url` que a Payt manda. O CONJUNTO vem do `utm_medium`,
  -- que a Payt entrega como "nome|id" — e o que se le e o id.
  --
  -- SEM filtro de status, de proposito: saber que conjunto mandou trafego para
  -- que REV e identidade, nao dinheiro. Uma venda pendente prova o vinculo
  -- igual. Com o filtro, 2.392 vendas eram descartadas e o REV10 ficava com
  -- investimento zero tendo R$ 305,98 gastos.
  liga as (
    -- Rota A: o id dentro do utm_medium.
    select distinct split_part(v.utm_medium, '|', 2) as adset_id, v.funil_id
      from public.vendas v
     where v.funil_id is not null
       and not coalesce(v.is_upsell, false)
       and v.utm_medium ~ '\|[0-9]{6,}$'
       and v.pedido_id not like 'TEST%'
       and v.pedido_id not like 'LC-%'
    union
    -- Rota B: o caminho antigo, pelo ad_id, sem o filtro de aprovada. Hoje
    -- devolve exatamente as mesmas ligacoes que A; fica para a funcao nao
    -- depender so de um formato de texto que a Payt pode mudar.
    select distinct m.adset_id, v.funil_id
      from public.vendas v
      join public.metricas_meta m on m.ad_id = v.ad_id_meta and m.nivel = 'ad'
     where v.funil_id is not null
       and not coalesce(v.is_upsell, false)
       and v.ad_id_meta is not null
       and m.adset_id is not null
       and v.pedido_id not like 'TEST%'
       and v.pedido_id not like 'LC-%'
  ),
  -- Conjunto que mandou trafego para mais de um REV. Ninguem decide: somar nos
  -- dois conta o mesmo real duas vezes, e ratear inventa numero.
  ambiguos as (
    select adset_id from liga group by adset_id having count(distinct funil_id) > 1
  ),
  conjuntos_rev as (
    select adset_id from liga
     where funil_id = p_funil_id
       and adset_id not in (select adset_id from ambiguos)
  ),
  -- Ultimo recurso, quando o REV nao tem conjunto nenhum identificado. Leitura
  -- PIOR: so os anuncios que venderam, o que exclui por construcao o gasto que
  -- nao converteu e infla o ROAS. `nivel_investimento` denuncia quando e o caso.
  ads_rev as (
    select distinct v.ad_id_meta as ad_id
      from public.vendas v
     where v.funil_id = p_funil_id
       and v.ad_id_meta is not null
       and not coalesce(v.is_upsell, false)
       and v.pedido_id not like 'TEST%'
       and v.pedido_id not like 'LC-%'
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
  -- O que ficou de fora por ambiguidade, para a tela dizer em vez de esconder.
  ambiguo_do_rev as (
    select coalesce(sum(m.investimento), 0) as verba,
           count(distinct m.adset_id)       as conjuntos
      from public.metricas_meta m
     where m.nivel = 'ad'
       and m.data between p_inicio and p_fim
       and m.adset_id in (select adset_id from ambiguos)
       and m.adset_id in (select adset_id from liga where funil_id = p_funil_id)
  ),
  -- A verba das contas DESTE projeto que nao esta em REV nenhum. E o aviso que
  -- teria pego o REV10 em 07/10, e e um numero que chega a zero.
  sem_rev as (
    select coalesce(sum(m.investimento), 0) as verba
      from public.metricas_meta m
      join public.ad_accounts ac on ac.id = m.ad_account_id
     where m.nivel = 'ad'
       and m.data between p_inicio and p_fim
       and ac.projeto_id = (select f.projeto_id from public.funis f where f.id = p_funil_id)
       and (m.adset_id is null or m.adset_id not in (select adset_id from liga))
  ),
  cobertura as (
    select
      coalesce(sum(m.investimento), 0) as gasto_total,
      coalesce(sum(m.investimento) filter (
        where m.adset_id in (select adset_id from liga)), 0) as gasto_atribuido
    from public.metricas_meta m
    where m.nivel = 'ad' and m.data between p_inicio and p_fim
  ),
  imposto as (
    /* Por EMPRESA, via fn_config. A empresa sai do projeto do funil; funil sem
       projeto cai na linha geral, que e o que o segundo argumento nulo faz.
       Era `max(valor)` sobre a tabela inteira, que escolhe a MAIOR aliquota
       entre as empresas e aplica em todas. Ver 20261006k. */
    select
      coalesce(public.fn_config('imposto_simples_nacional_pct',
        (select oe.empresa_id from public.funis f
           left join public.ofertas_editores oe on oe.id = f.projeto_id
          where f.id = p_funil_id)), 0) as simples_pct,
      coalesce(public.fn_config('imposto_meta_ads_pct',
        (select oe.empresa_id from public.funis f
           left join public.ofertas_editores oe on oe.id = f.projeto_id
          where f.id = p_funil_id)), 0) as meta_pct
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
      (select base_simples from caixa)    as base_simples,
      (select base_simples from caixa_up) as base_up,
      (select simples_pct from imposto)   as pct_simples,
      round((select base_simples from caixa) * (select simples_pct from imposto) / 100.0, 2) as imp_simples,
      round((select investimento from meta) * (select meta_pct from imposto) / 100.0, 2)    as imp_meta
  ),
  -- O mesmo calculo, com o upsell somado. Imposto e taxa do upsell entram
  -- junto: contar a receita dele sem os custos dele inventaria lucro.
  com_up as (
    select
      /* O lucro do FRONT, calculado uma vez so. `lucro_liquido`, `margem_pct` e
         `front_se_paga` leem daqui. Eram copias da mesma expressao, e copias
         divergem: ver 20261006d. */
      c.fat - c.inv - c.imp_simples - c.imp_meta - c.taxa                      as lucro,
      c.fat + c.fat_up                                                        as fat_total,
      round((c.base_simples + c.base_up) * c.pct_simples / 100.0, 2)           as imp_simples_total,
      c.taxa + c.taxa_up                                                       as taxa_total
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
    -- A taxa real em percentual, para a tela nao precisar dizer "nao e 7% fixo"
    -- e sim quanto de fato foi.
    'taxa_plataforma_pct', case when c.fat > 0 then round(100.0 * c.taxa / c.fat, 2) end,
    'lucro_liquido',    round(u.lucro, 2),
    'margem_pct',       case when c.fat > 0
                          then round(100.0 * u.lucro / c.fat, 1)
                        end,
    'reembolsos',       (select reembolsos from caixa),

    -- ── O upsell, ao lado e nunca dentro ────────────────────────────────────
    'upsell_qtd',           c.qtd_up,
    'upsell_faturamento',   c.fat_up,
    -- A metrica que faltava: e por ela que se compara "10% de up" com "2%".
    'upsell_adesao_pct',    case when c.vendas > 0
                              then round(100.0 * c.qtd_up / c.vendas, 2) end,
    'faturamento_com_upsell', u.fat_total,
    'roas_com_upsell',        case when c.inv > 0 then round(u.fat_total / c.inv, 2) end,
    'lucro_com_upsell',       round(u.fat_total - c.inv - u.imp_simples_total - c.imp_meta - u.taxa_total, 2),
    'margem_com_upsell_pct',  case when u.fat_total > 0
      then round(100.0 * (u.fat_total - c.inv - u.imp_simples_total - c.imp_meta - u.taxa_total) / u.fat_total, 1)
    end,
    -- Duas perguntas, dois niveis, dois selos. Ver 20261006d.
    'trafego_se_paga', case when c.inv > 0 then (c.fat >= c.inv) end,
    'front_se_paga',   case when c.inv > 0 then (u.lucro >= 0) end,

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
  -- ── O que ficou de fora, dito e nao escondido ─────────────────────────────
  --
  -- Em objeto SEPARADO, concatenado com `||`: `jsonb_build_object` aceita no
  -- maximo 100 argumentos (50 pares), o bloco acima ja usava 96, e as tres
  -- chaves novas levavam a 102. O erro e `54023: cannot pass more than 100
  -- arguments to a function`, e aparece so na hora de criar a funcao.
  || jsonb_build_object(
    -- Conjunto que serve a mais de um REV: fora da conta dos dois, e dito.
    'conjuntos_ambiguos',              (select conjuntos from ambiguo_do_rev),
    'investimento_ambiguo',            (select verba from ambiguo_do_rev),
    -- A verba do projeto que nao esta em REV nenhum. Zero quando esta tudo
    -- ligado; foi o que faltou gritar entre 07/10 e 10/10.
    'investimento_sem_rev_no_projeto', (select verba from sem_rev)
  )
  from calc c, com_up u;
$function$;

comment on function public.fn_metricas_do_rev_bloco(uuid, date, date) is
  'Metricas de um REV num periodo. O vinculo conjunto<->REV sai da URL (o '
  'funil_id que fn_venda_resolve_funil resolve do link_url da Payt) cruzado com '
  'o id do conjunto que a Payt manda dentro do utm_medium como "nome|id" — '
  'nunca pelo NOME do conjunto, que colide (%REV1% casa com REV10 e REV11) e '
  'envelhece. E SEM filtrar status: identificar de quem e o trafego nao depende '
  'de o pagamento ter caido, e exigir aprovada escondia R$ 305,98 do REV10 em '
  '10/10/2026 descartando 2.392 vendas. O filtro aprovada continua no CAIXA, '
  'onde a pergunta e dinheiro. Conjunto que serve a mais de um REV fica fora da '
  'conta dos dois e sai em conjuntos_ambiguos/investimento_ambiguo.';

commit;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_n     integer;
  v_num   numeric;
  v_real  numeric;
  v_txt   text;
  v_rev10 constant uuid := '75cda2af-0030-4b89-b129-2c4c416d18dc';
  v_at    jsonb;
begin
  v_at := public.fn_metricas_do_rev(v_rev10, '2026-09-26', '2026-10-10')->'atual';

  -- 1. O conserto em si: o REV10 enxerga os R$ 305,98 do conjunto
  --    "07/10 TESTE REV10".
  v_num := (v_at->>'investimento')::numeric;
  if v_num is distinct from 305.98 then
    v_erros := v_erros || format('o REV10 ficou com investimento %s, esperava 305.98. ', v_num);
  end if;

  -- 2. E as contas que dependiam dele viraram junto. Margem +84,5% era o
  --    sintoma; -441,4% e a verdade.
  if (v_at->>'resultado')::numeric is distinct from -239.65 then
    v_erros := v_erros || format('resultado do REV10 e %s, esperava -239.65. ', v_at->>'resultado');
  end if;
  if (v_at->>'roas')::numeric is distinct from 0.22 then
    v_erros := v_erros || format('roas do REV10 e %s, esperava 0.22. ', v_at->>'roas');
  end if;
  if (v_at->>'margem_pct')::numeric >= 0 then
    v_erros := v_erros || format('margem do REV10 seguiu positiva (%s). ', v_at->>'margem_pct');
  end if;

  -- 3. O selo voltou a existir. Era NULL justamente porque inv=0 — o unico
  --    sinal silenciava no caso em que fazia falta.
  if (v_at->>'front_se_paga') is distinct from 'false' then
    v_erros := v_erros || format('front_se_paga do REV10 e %s, esperava false. ',
                                 coalesce(v_at->>'front_se_paga','(nulo)'));
  end if;

  -- 4. E passou a ler por CONJUNTO, nao pelo fallback de anuncio.
  if (v_at->>'nivel_investimento') <> 'conjunto' then
    v_erros := v_erros || format('o REV10 segue lendo por %s. ', v_at->>'nivel_investimento');
  end if;

  -- 5. A PROVA QUE VALE: nenhum OUTRO REV se mexeu. Um conserto que arruma o
  --    caso e move os outros nao e conserto, e troca de problema.
  select count(*) into v_n
    from _antes_rev a
   where a.id <> v_rev10
     and a.inv is distinct from
         (public.fn_metricas_do_rev(a.id, '2026-09-26', '2026-10-10')->'atual'->>'investimento')::numeric;
  if v_n > 0 then
    select string_agg(format('%s: %s -> %s', a.nome, a.inv,
             (public.fn_metricas_do_rev(a.id,'2026-09-26','2026-10-10')->'atual'->>'investimento')), ', ')
      into v_txt
      from _antes_rev a
     where a.id <> v_rev10
       and a.inv is distinct from
           (public.fn_metricas_do_rev(a.id,'2026-09-26','2026-10-10')->'atual'->>'investimento')::numeric;
    v_erros := v_erros || format('%s outro(s) REV mudaram de investimento: %s. ', v_n, v_txt);
  end if;

  -- 6. O REV10 mudou MESMO (o contrario da prova 5). Sem este caso, uma funcao
  --    que devolvesse o valor antigo para todo mundo passaria em 5.
  select a.inv into v_num from _antes_rev a where a.id = v_rev10;
  if v_num is not distinct from 305.98 then
    v_erros := v_erros || 'o REV10 ja valia 305.98 antes: a prova nao prova nada. ';
  end if;

  -- 7. O filtro de aprovada saiu do VINCULO e continua no CAIXA. Se alguem
  --    tirar dos dois, o faturamento passa a contar venda pendente como
  --    receita — que e o erro oposto, e pior.
  v_txt := pg_get_functiondef('public.fn_metricas_do_rev_bloco'::regproc);
  if v_txt !~ 'todas as \(' or v_txt !~ 'v\.status = ''aprovada''' then
    v_erros := v_erros || 'o filtro aprovada sumiu do caixa: venda pendente viraria faturamento. ';
  end if;
  if substring(v_txt from position('liga as (' in v_txt)
                        for position('ambiguos as (' in v_txt) - position('liga as (' in v_txt))
       ~ 'status' then
    v_erros := v_erros || 'voltou um filtro de status dentro do vinculo. ';
  end if;

  -- 8. E o vinculo le o ID, nao o NOME do conjunto. `%REV1%` casa com REV10 e
  --    REV11; o id nao colide.
  if v_txt !~ 'split_part\(v\.utm_medium' then
    v_erros := v_erros || 'o vinculo deixou de ler o id dentro do utm_medium. ';
  end if;
  if v_txt ~* 'adset_nome\s+i?like' then
    v_erros := v_erros || 'apareceu casamento por NOME de conjunto. ';
  end if;

  -- 9. Dupla contagem barrada: a soma do que cada REV reporta nao pode passar
  --    do que foi gasto de verdade na janela.
  select round(sum((public.fn_metricas_do_rev(f.id,'2026-09-26','2026-10-10')
                     ->'atual'->>'investimento')::numeric), 2)
    into v_num from public.funis f;
  select round(sum(m.investimento), 2) into v_real
    from public.metricas_meta m
   where m.nivel = 'ad' and m.data between '2026-09-26' and '2026-10-10';
  if v_num > v_real then
    v_erros := v_erros || format('a soma dos REVs (%s) passou do gasto real (%s): ha dupla contagem. ', v_num, v_real);
  end if;

  -- 10. O aviso novo existe e e um numero que chega a zero — a Saponaria, que
  --     tinha os R$ 305,98 soltos, agora esta em zero.
  if (v_at->>'investimento_sem_rev_no_projeto') is null then
    v_erros := v_erros || 'investimento_sem_rev_no_projeto nao veio no JSON. ';
  elsif (v_at->>'investimento_sem_rev_no_projeto')::numeric <> 0 then
    v_erros := v_erros || format('a Saponaria ainda tem R$ %s de verba fora de REV. ',
                                 v_at->>'investimento_sem_rev_no_projeto');
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: o REV10 saiu de R$ 0,00 para R$ 305,98 (ROAS 0,22, margem negativa), nenhum outro REV se mexeu, o filtro aprovada ficou so no caixa, o vinculo le o id do utm e nao o nome, e a soma dos REVs (R$ %) nao passa do gasto real (R$ %).', v_num, v_real;
end $prova$;

drop table if exists _antes_rev;

notify pgrst, 'reload schema';
