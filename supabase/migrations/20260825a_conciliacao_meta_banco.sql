-- O que saiu para a Meta, separado pelo que o CS já sabe, contra o que a Meta
-- reporta de campanha.
--
-- A pergunta era separar campanha de automação de WhatsApp. Três caminhos
-- tentados, dois sem saída:
--
--   descritor      — 540 lançamentos "FACEBK *<id aleatório>", sem MCC. O
--                    sufixo parece um código de produto e não é: "Q4" aparece
--                    tanto no grupo sem categoria quanto no marcado como ads.
--   faixa de valor — distribuição contínua de R$ 0,19 a R$ 5.275, sem cluster.
--   categoria do CS — esta funciona.
--
-- O resultado da terceira é forte. Em agosto, o que está marcado como campanha
-- fecha com a Meta com R$ 57 de resíduo sobre R$ 90 mil. Sem separar, a
-- diferença aparecia como 9,9%. Em julho o resíduo cai de 13,5% para 6%.
--
-- O que esta view NÃO faz é dizer que o grupo sem categoria é o WhatsApp. Ele
-- começa em 21/07 e é o candidato óbvio, mas está sem categoria porque ninguém
-- categorizou — e maio e junho têm 13% a 18% de resíduo sem um único lançamento
-- nesse grupo. Correlação forte não é atribuição, e um rateio inventado entraria
-- no DRE parecendo apurado.
drop view if exists public.vw_conciliacao_meta;

create view public.vw_conciliacao_meta as
with meta as (
  select date_trunc('month', data)::date as mes,
         sum(investimento)::numeric(14,2) as ads_meta
    from public.metricas_meta
   where nivel::text = 'campanha'
   group by 1
),
banco as (
  select date_trunc('month', t.data)::date as mes,
         sum(-t.valor) filter (
           where coalesce(t.payload_raw->'category'->>'name',
                          t.payload_raw->'category'->>'description') is not null
         )::numeric(14,2) as marcado_campanha,
         sum(-t.valor) filter (
           where coalesce(t.payload_raw->'category'->>'name',
                          t.payload_raw->'category'->>'description') is null
         )::numeric(14,2) as sem_categoria_cs,
         sum(-t.valor)::numeric(14,2) as saiu_banco,
         count(*)::int as lancamentos
    from public.transacoes t
   where t.valor < 0 and t.descricao ilike 'FACEBK%'
   group by 1
)
select coalesce(m.mes, b.mes) as mes,
       m.ads_meta,
       coalesce(b.marcado_campanha, 0)  as marcado_campanha,
       coalesce(b.sem_categoria_cs, 0)  as sem_categoria_cs,
       b.saiu_banco,
       b.lancamentos,
       (b.saiu_banco - m.ads_meta)::numeric(14,2) as diferenca,
       -- O que sobra depois de tirar o grupo sem categoria. É o número que diz
       -- se a conciliação fecha de verdade.
       (coalesce(b.marcado_campanha, 0) - m.ads_meta)::numeric(14,2) as residuo_campanha,
       case when b.saiu_banco > 0
            then round(100.0 * (b.saiu_banco - m.ads_meta) / b.saiu_banco, 1)
       end as pct_diferenca,
       -- Mês corrente sempre parece fechar melhor: parte do gasto já aconteceu
       -- e ainda não foi cobrada. Sinalizado para não ser lido como melhora.
       (date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date
         = coalesce(m.mes, b.mes)) as mes_em_curso
  from meta m
  full join banco b on b.mes = m.mes
 where m.ads_meta is not null or b.saiu_banco is not null;

comment on view public.vw_conciliacao_meta is
  'Saída para a Meta separada pela categorização do CS, contra o gasto de campanha reportado.';

grant select on public.vw_conciliacao_meta to authenticated;
