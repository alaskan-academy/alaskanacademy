-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ A alíquota do Simples deixa de ser digitada e passa a ser medida        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- `configuracoes.imposto_simples_nacional_pct` estava em **9%** para as duas
-- empresas. O que de fato se paga, medido contra a base legal, é **6,94%** —
-- o painel vinha mostrando lucro MENOR do que o real, em ~2 pontos da receita
-- (R$ 4.600/mês no volume de setembro).
--
-- E não é um número que se conserta uma vez: a alíquota do Simples sobe com a
-- faixa, que depende do faturamento dos últimos 12 meses. Trocar 9 por 6,94 à
-- mão só adia o erro para o mês em que a empresa mudar de faixa — é a terceira
-- armadilha (lista fixa que envelhece em silêncio) na forma de um número.
--
-- ── Como a medida é feita ──────────────────────────────────────────────────
--
--   alíquota(M) = imposto pago em M+1 / base tributável de M
--
-- O imposto da competência M é pago até o dia 20 de M+1, e a base é
-- `receita − coprodução + juros` (a mesma que `vw_faturamento_liquido` usa;
-- provado abaixo que as duas definições batem em 12 meses, 0,00 de diferença).
--
-- Três decisões dentro disso, e cada uma existe por um motivo:
--
-- 1. **Janela de 3 meses.** Mês a mês a medida oscila entre 6,00% e 8,16%, e a
--    oscilação não é a faixa mudando: é o DIA do pagamento caindo de um lado ou
--    do outro da virada do mês. Em 3 meses isso se dissolve e sobra a
--    tendência real: 6,65 → 6,55 → 6,33 → 6,66 → 6,87 → 6,94. Subindo, como o
--    Simples de uma empresa que cresce deve subir.
--
-- 2. **Só competência cujo mês de pagamento já FECHOU.** Hoje (08/10) o imposto
--    de setembro ainda não venceu, e setembro mediria 0,29% — quase zero. Uma
--    alíquota que despenca todo início de mês e volta no dia 20 seria pior que
--    o número fixo. O mês corrente herda a última medida fechada.
--
-- 3. **`fn_config` continua, como ÚLTIMO recurso.** Empresa nova não tem
--    histórico: a Aeliss faturou pela primeira vez em setembro e só terá
--    medida em novembro. Até lá usa o configurado — e a tela passa a dizer
--    qual dos dois está valendo, senão viram dois campos dizendo a mesma coisa
--    e o segundo mente (primeira armadilha).
--
-- ── O que entra na conta ───────────────────────────────────────────────────
--
-- A categoria "Impostos e Tributos" tem o DAS (R$ 12.915 em setembro) e mais
-- dois recorrentes menores (R$ 330 fixo e ~R$ 560), todos com a mesma descrição
-- "MINISTERIO DA FAZENDA" e sem nenhum campo que os separe — o `centro_custo`
-- deles inclusive diverge entre si ("Impostos" num, "Jurídico" nos outros).
--
-- Isso é deliberado e não um descuido: a conta mede o IMPOSTO QUE SE PAGA POR
-- REAL FATURADO, que é o número de que a margem precisa. Os dois menores somam
-- R$ 890/mês e diluem conforme o faturamento cresce. Separá-los exigiria um
-- campo novo que alguém teria de preencher todo mês — cadastro sem resultado
-- ao lado, a segunda armadilha.

-- ── A base, isolada para poder ser medida por mês ──────────────────────────
-- `vw_faturamento_liquido` calcula a base por DIA e produto, que é o que a
-- margem diária precisa. A alíquota precisa dela por MÊS e empresa. Mesma
-- regra, granularidade diferente — e a prova no fim confere que não divergiram.

create or replace view public.vw_base_simples_mes
with (security_invoker = on) as
select date_trunc('month', (v.data_venda at time zone 'America/Sao_Paulo')::date)::date as mes,
       v.empresa_id,
       sum(coalesce(v.valor_sem_juros, v.valor_total)
         - coalesce(v.valor_coproducao, 0)
         + coalesce(v.juros_parcelamento, 0)) as base
from public.vendas v
where v.status = 'aprovada'
  and v.pedido_id not like 'TEST%'
  and v.pedido_id not like 'LC-%'
group by 1, 2;

comment on view public.vw_base_simples_mes is
  'A base legal do Simples por mês e empresa: receita − coprodução + juros. '
  'Mesma regra de vw_faturamento_liquido, agrupada por mês para a alíquota '
  'medida poder dividir por ela.';

-- ── A alíquota medida ──────────────────────────────────────────────────────

create or replace view public.vw_aliquota_simples_mes
with (security_invoker = on) as
with pago as (
  select date_trunc('month', t.data)::date as mes_pagamento,
         t.empresa_id,
         sum(abs(t.valor)) as pago
  from public.transacoes t
  where t.valor < 0 and t.categoria = 'Impostos e Tributos'
  group by 1, 2
),
medido as (
  select b.mes, b.empresa_id, b.base,
         p.pago,
         /* O mês de pagamento já fechou? Enquanto não fechar, o que se mediria
            seria "quanto já pagaram até agora", que começa em zero. */
         (b.mes + interval '1 month')::date
           < date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date as pagamento_fechado
  from public.vw_base_simples_mes b
  left join pago p
    on p.empresa_id = b.empresa_id
   and p.mes_pagamento = (b.mes + interval '1 month')::date
  where b.base > 0
),
janela as (
  select m.*,
         case when m.pagamento_fechado then
           sum(case when m.pagamento_fechado then coalesce(m.pago,0) end)
             over (partition by m.empresa_id order by m.mes rows between 2 preceding and current row)
           / nullif(sum(case when m.pagamento_fechado then m.base end)
             over (partition by m.empresa_id order by m.mes rows between 2 preceding and current row), 0)
           * 100
         end as aliquota_3m
  from medido m
)
select j.mes,
       j.empresa_id,
       round(j.base, 2)                                            as base,
       round(j.pago, 2)                                            as imposto_pago,
       j.pagamento_fechado,
       round(100 * j.pago / nullif(j.base,0), 2)                   as aliquota_do_mes,
       round(j.aliquota_3m, 4)                                     as aliquota_3m,
       /* O que VALE para este mês: a janela dele, ou — se o pagamento ainda
          não fechou — a última janela fechada da mesma empresa. */
       round(coalesce(
         j.aliquota_3m,
         (select j2.aliquota_3m from janela j2
           where j2.empresa_id = j.empresa_id and j2.aliquota_3m is not null
             and j2.mes <= j.mes
           order by j2.mes desc limit 1)
       ), 4)                                                        as aliquota_vigente
from janela j;

comment on view public.vw_aliquota_simples_mes is
  'A alíquota do Simples MEDIDA: imposto pago em M+1 sobre a base de M, em '
  'janela de 3 meses. `aliquota_vigente` é a da janela, ou a última fechada '
  'quando o pagamento do mês ainda não venceu. Nula = sem histórico.';

-- ── A função que a tela e a view usam ──────────────────────────────────────
-- Devolve SEMPRE um número: a medida quando existe, o configurado quando não.
-- É o único lugar que decide essa precedência, para não haver duas respostas.

create or replace function public.fn_aliquota_simples(
  p_empresa uuid,
  p_data    date default (now() at time zone 'America/Sao_Paulo')::date
) returns numeric
language sql
stable
set search_path to 'public'
as $function$
  select coalesce(
    (select a.aliquota_vigente
       from public.vw_aliquota_simples_mes a
      where a.empresa_id is not distinct from p_empresa
        and a.mes <= date_trunc('month', p_data)::date
        and a.aliquota_vigente is not null
      order by a.mes desc
      limit 1),
    public.fn_config('imposto_simples_nacional_pct', p_empresa),
    0
  );
$function$;

comment on function public.fn_aliquota_simples(uuid, date) is
  'A alíquota do Simples a usar: a medida dos últimos 3 meses fechados, ou o '
  'valor de `configuracoes` quando a empresa ainda não tem histórico. Nunca '
  'devolve nulo.';

-- ── A view de faturamento passa a usar a medida ────────────────────────────
-- Por JOIN e não por chamada de função: a view tem uma linha por (dia, produto,
-- empresa), e chamar a função em cada uma seria uma subconsulta por linha.

drop view if exists public.vw_faturamento_liquido;

create view public.vw_faturamento_liquido
with (security_invoker = on) as
 WITH vendas_base AS (
         SELECT v.empresa_id, v.produto,
            (v.data_venda AT TIME ZONE 'America/Sao_Paulo'::text)::date AS data,
            sum(CASE WHEN v.status = 'aprovada'::status_venda THEN COALESCE(v.valor_sem_juros, v.valor_total) ELSE 0::numeric END) AS faturamento_bruto,
            sum(CASE WHEN v.status = 'aprovada'::status_venda THEN COALESCE(v.valor_sem_juros, v.valor_total) - COALESCE(v.valor_coproducao, 0::numeric) ELSE 0::numeric END) AS receita_tributavel,
            sum(CASE WHEN v.status = 'aprovada'::status_venda THEN COALESCE(v.valor_coproducao, 0::numeric) ELSE 0::numeric END) AS coproducao,
            count(CASE WHEN v.status = 'aprovada'::status_venda AND v.valor_coproducao IS NULL AND (v.produto_nome IS NULL OR NOT (v.produto_nome IN ( SELECT vw_produto_sem_coprodutor.produto_nome FROM vw_produto_sem_coprodutor))) THEN 1 ELSE NULL::integer END) AS vendas_sem_dado_coproducao,
            sum(CASE WHEN v.status = 'aprovada'::status_venda THEN COALESCE(v.juros_parcelamento, 0::numeric) ELSE 0::numeric END) AS juros_parc,
            sum(CASE WHEN v.status = 'aprovada'::status_venda THEN COALESCE(v.taxa_plataforma_valor, 0::numeric) ELSE 0::numeric END) AS taxa_plataforma,
            sum(CASE WHEN v.status = ANY (ARRAY['reembolsada'::status_venda, 'chargeback'::status_venda]) THEN fn_perda_da_venda(v.valor_total, v.valor_reembolsado) ELSE 0::numeric END) AS reembolsos,
            sum(CASE WHEN v.status = 'reembolsada'::status_venda THEN fn_perda_da_venda(v.valor_total, v.valor_reembolsado) ELSE 0::numeric END) AS perda_reembolso,
            sum(CASE WHEN v.status = 'chargeback'::status_venda THEN fn_perda_da_venda(v.valor_total, v.valor_reembolsado) ELSE 0::numeric END) AS perda_chargeback,
            count(CASE WHEN v.status = 'aprovada'::status_venda AND (v.is_upsell IS NULL OR v.is_upsell = false) THEN 1 ELSE NULL::integer END) AS vendas_aprovadas,
            count(CASE WHEN v.status = 'pendente'::status_venda AND (v.is_upsell IS NULL OR v.is_upsell = false) THEN 1 ELSE NULL::integer END) AS vendas_pendentes,
            sum(CASE WHEN v.status = 'pendente'::status_venda THEN v.valor_total ELSE 0::numeric END) AS montante_pendente
           FROM vendas v
          WHERE v.pedido_id !~~ 'TEST%'::text AND v.pedido_id !~~ 'LC-%'::text
          GROUP BY v.empresa_id, v.produto, ((v.data_venda AT TIME ZONE 'America/Sao_Paulo'::text)::date)
        ), meta_base AS (
         SELECT m.empresa_id, m.produto, m.data, sum(m.investimento) AS investimento
           FROM metricas_meta m
          WHERE m.nivel = 'campanha'::nivel_meta
          GROUP BY m.empresa_id, m.produto, m.data
        ), juntos AS (
         SELECT COALESCE(v.data, m.data) AS data,
            COALESCE(v.produto, m.produto) AS produto,
            COALESCE(v.empresa_id, m.empresa_id) AS empresa_id,
            COALESCE(v.faturamento_bruto, 0::numeric) AS faturamento_bruto,
            COALESCE(v.receita_tributavel, 0::numeric) AS receita_tributavel,
            COALESCE(v.coproducao, 0::numeric) AS coproducao,
            COALESCE(v.vendas_sem_dado_coproducao, 0::bigint) AS vendas_sem_dado_coproducao,
            COALESCE(v.juros_parc, 0::numeric) AS juros_parc,
            COALESCE(v.taxa_plataforma, 0::numeric) AS taxa_plataforma,
            COALESCE(v.reembolsos, 0::numeric) AS reembolsos,
            COALESCE(v.perda_reembolso, 0::numeric) AS perda_reembolso,
            COALESCE(v.perda_chargeback, 0::numeric) AS perda_chargeback,
            COALESCE(v.vendas_aprovadas, 0::bigint) AS vendas_aprovadas,
            COALESCE(v.vendas_pendentes, 0::bigint) AS vendas_pendentes,
            COALESCE(v.montante_pendente, 0::numeric) AS montante_pendente,
            COALESCE(m.investimento, 0::numeric) AS investimento_meta
           FROM vendas_base v
             FULL JOIN meta_base m ON m.data = v.data AND NOT m.produto IS DISTINCT FROM v.produto AND NOT m.empresa_id IS DISTINCT FROM v.empresa_id
        ), com_cfg AS (
         SELECT j.data, j.produto, j.empresa_id, j.faturamento_bruto, j.receita_tributavel,
            j.coproducao, j.vendas_sem_dado_coproducao, j.juros_parc, j.taxa_plataforma,
            j.reembolsos, j.perda_reembolso, j.perda_chargeback, j.vendas_aprovadas,
            j.vendas_pendentes, j.montante_pendente, j.investimento_meta,
            /* A MEDIDA do mês da linha, e o configurado só quando não há
               histórico. Por LEFT JOIN e não por chamada de função: a view tem
               uma linha por (dia, produto, empresa). */
            COALESCE(a.aliquota_vigente,
                     fn_config('imposto_simples_nacional_pct'::text, j.empresa_id),
                     0::numeric) AS simples_pct,
            COALESCE(fn_config('imposto_meta_ads_pct'::text, j.empresa_id), 0::numeric) AS meta_pct,
            COALESCE(fn_config('custo_fixo_mensal'::text, j.empresa_id), 0::numeric) AS custo_fixo,
            (a.aliquota_vigente IS NOT NULL) AS simples_medido
           FROM juntos j
           LEFT JOIN vw_aliquota_simples_mes a
             ON a.empresa_id IS NOT DISTINCT FROM j.empresa_id
            AND a.mes = date_trunc('month', j.data)::date
        )
 SELECT data, produto, faturamento_bruto, taxa_plataforma,
        CASE WHEN receita_tributavel > 0::numeric THEN round(taxa_plataforma / receita_tributavel * 100::numeric, 2) ELSE 0::numeric END AS taxa_plataforma_pct,
    reembolsos, vendas_aprovadas, vendas_pendentes, montante_pendente, investimento_meta,
    round((receita_tributavel + juros_parc) * simples_pct / 100::numeric, 2) AS imposto_simples,
    round(investimento_meta * meta_pct / 100::numeric, 2) AS imposto_meta_ads,
    round(receita_tributavel - taxa_plataforma - (receita_tributavel + juros_parc) * simples_pct / 100::numeric - investimento_meta * meta_pct / 100::numeric - investimento_meta, 2) AS faturamento_liquido,
        CASE WHEN receita_tributavel > 0::numeric THEN round((receita_tributavel - taxa_plataforma - (receita_tributavel + juros_parc) * simples_pct / 100::numeric - investimento_meta * meta_pct / 100::numeric - investimento_meta) / receita_tributavel * 100::numeric, 2) ELSE 0::numeric END AS margem_pct,
        CASE WHEN investimento_meta > 0::numeric THEN round(receita_tributavel / investimento_meta, 2) ELSE NULL::numeric END AS roas,
    simples_pct, meta_pct, custo_fixo, receita_tributavel,
    juros_parc AS juros_parcelamento, empresa_id, perda_reembolso, perda_chargeback,
    coproducao, vendas_sem_dado_coproducao,
    receita_tributavel + juros_parc AS base_simples,
    /* A tela precisa poder dizer de onde veio o número, senão o configurado
       continua parecendo que manda quando não manda mais. */
    simples_medido
   FROM com_cfg c;

comment on view public.vw_faturamento_liquido is
  'Faturamento e margem por dia/produto/empresa. A alíquota do Simples é a '
  'MEDIDA (vw_aliquota_simples_mes) desde 08/10/2026, com `configuracoes` só '
  'como fallback para empresa sem histórico; `simples_medido` diz qual valeu.';

-- ── A prova ────────────────────────────────────────────────────────────────

do $$
declare
  v_alaskan   uuid;
  v_divergem  int;
  v_aliq_ago  numeric;
  v_aliq_hoje numeric;
  v_set_antes numeric;
  v_set_agora numeric;
begin
  select id into v_alaskan from public.empresas where slug = 'alaskan';

  -- 1. A base isolada continua sendo a mesma da view. Se divergir, passam a
  --    existir duas definições da base legal, que é a primeira armadilha.
  select count(*) into v_divergem
  from (
    select to_char(data,'YYYY-MM') as mes, empresa_id, round(sum(base_simples),2) as b
      from public.vw_faturamento_liquido group by 1,2
  ) v
  join (
    select to_char(mes,'YYYY-MM') as mes, empresa_id, round(base,2) as b
      from public.vw_base_simples_mes
  ) m using (mes, empresa_id)
  where abs(v.b - m.b) > 0.01;

  if v_divergem > 0 then
    raise exception 'PROVA FALHOU: % mes(es) com base divergente entre a view e vw_base_simples_mes.', v_divergem;
  end if;

  -- 2. A medida de agosto bate com a conta feita à mão (6,94%).
  select aliquota_3m into v_aliq_ago
  from public.vw_aliquota_simples_mes
  where empresa_id = v_alaskan and mes = '2026-08-01';

  if v_aliq_ago is null or abs(v_aliq_ago - 6.94) > 0.05 then
    raise exception 'PROVA FALHOU: aliquota de agosto deveria ser ~6,94%%, veio %.', v_aliq_ago;
  end if;

  -- 3. Setembro, cujo imposto ainda não venceu, NÃO pode medir perto de zero:
  --    tem de herdar a última janela fechada. É a armadilha que motivou a
  --    regra do "pagamento fechado".
  select aliquota_vigente into v_aliq_hoje
  from public.vw_aliquota_simples_mes
  where empresa_id = v_alaskan and mes = '2026-09-01';

  if v_aliq_hoje is null or v_aliq_hoje < 5 then
    raise exception 'PROVA FALHOU: setembro herdou %, deveria herdar a janela fechada (~6,94%%).', v_aliq_hoje;
  end if;

  -- 4. E o efeito: o imposto de setembro cai do que 9%% cobrava para a medida.
  select round(sum(base_simples) * 9 / 100, 2),
         round(sum(imposto_simples), 2)
    into v_set_antes, v_set_agora
  from public.vw_faturamento_liquido
  where empresa_id = v_alaskan and data >= '2026-09-01' and data < '2026-10-01';

  if v_set_agora >= v_set_antes then
    raise exception 'PROVA FALHOU: o imposto de setembro nao caiu (antes % / agora %).', v_set_antes, v_set_agora;
  end if;

  raise notice 'PROVA OK: base intacta, aliquota de agosto %, setembro herda %, imposto de setembro % -> % (lucro sobe % reais).',
    v_aliq_ago, v_aliq_hoje, v_set_antes, v_set_agora, round(v_set_antes - v_set_agora, 2);
end $$;
