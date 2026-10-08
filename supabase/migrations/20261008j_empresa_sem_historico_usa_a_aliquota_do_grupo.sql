-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Empresa sem histórico usa a alíquota do GRUPO, não a digitada           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- A medida nasceu em `20261008i` com `configuracoes` como último recurso. Para
-- a Aeliss isso significa 9% — um número que não é de ninguém, e que é pior
-- palpite que o comportamento medido da operação ao lado.
--
-- Decisão dela, 08/10/2026: enquanto uma empresa não tem média própria, usa a
-- do grupo; quando tiver, usa a sua.
--
-- ── O GRUPO, e não "a Alaskan" ────────────────────────────────────────────
--
-- Hoje o grupo É a Alaskan: ela é a única que já pagou imposto, então a
-- alíquota do grupo em agosto dá 6,9359%, idêntica à dela. Escrever o slug
-- 'alaskan' no código daria o mesmo número HOJE e envelheceria no dia em que
-- houvesse uma terceira empresa, ou em que a Alaskan parasse — lista fixa que
-- envelhece em silêncio, a terceira armadilha.
--
-- Derivar do grupo também diz a coisa certa: "enquanto não sei como esta
-- empresa se comporta, assumo que se comporta como a operação".
--
-- ── O que isso custa, e por que o lado é o certo ──────────────────────────
--
-- A faixa do Simples é de cada CNPJ, e depende do faturamento acumulado DELE.
-- Uma empresa nova está na PRIMEIRA faixa, que é menor que a de uma madura —
-- então herdar 6,94% da operação **superestima** o imposto da Aeliss, e
-- portanto subestima o lucro dela.
--
-- Esse é o lado seguro para errar, e dura pouco: a Aeliss paga o primeiro DAS
-- em 20/10 (competência de setembro), e a medida própria dela passa a existir
-- em **01/11**, quando outubro fechar. A partir daí ela nunca mais passa por
-- aqui.
--
-- ── A ordem, agora com três degraus ───────────────────────────────────────
--
--   1. a medida DELA         -> quando existe, manda
--   2. a medida do GRUPO     -> enquanto ela não tem a sua
--   3. `configuracoes`       -> só se o grupo inteiro não tiver histórico
--
-- O terceiro degrau ainda existe porque um banco recém-criado não tem imposto
-- pago nenhum, e a conta não pode devolver nulo.

-- A view passa a emitir também a linha do GRUPO, com `empresa_id` nulo. Por
-- `grouping sets` e não por `union all` de uma cópia: duas consultas
-- calculando a mesma média divergiriam no dia em que alguém mexesse numa só.
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
/* Uma linha por (mês, empresa) e uma por (mês) — esta última com empresa_id
   nulo, que nesta view significa "o grupo". Não há venda sem empresa
   (`vw_dinheiro_sem_empresa` é zero e é vigiada), então o nulo aqui nunca é
   ambíguo. */
cruzado as (
  select b.mes,
         b.empresa_id,
         sum(b.base)           as base,
         sum(p.pago)           as pago,
         grouping(b.empresa_id) = 1 as eh_grupo
  from public.vw_base_simples_mes b
  left join pago p
    on p.empresa_id = b.empresa_id
   and p.mes_pagamento = (b.mes + interval '1 month')::date
  where b.base > 0
  group by grouping sets ((b.mes, b.empresa_id), (b.mes))
),
medido as (
  select c.mes,
         case when c.eh_grupo then null else c.empresa_id end as empresa_id,
         c.eh_grupo,
         c.base,
         c.pago,
         (c.mes + interval '1 month')::date
           < date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date as pagamento_fechado
  from cruzado c
),
janela as (
  select m.*,
         case when m.pagamento_fechado then
           sum(case when m.pagamento_fechado then coalesce(m.pago,0) end)
             over (partition by m.eh_grupo, m.empresa_id order by m.mes rows between 2 preceding and current row)
           / nullif(sum(case when m.pagamento_fechado then m.base end)
             over (partition by m.eh_grupo, m.empresa_id order by m.mes rows between 2 preceding and current row), 0)
           * 100
         end as aliquota_3m
  from medido m
)
select j.mes,
       j.empresa_id,
       round(j.base, 2)                          as base,
       round(j.pago, 2)                          as imposto_pago,
       j.pagamento_fechado,
       round(100 * j.pago / nullif(j.base,0), 2) as aliquota_do_mes,
       round(j.aliquota_3m, 4)                   as aliquota_3m,
       round(coalesce(
         j.aliquota_3m,
         (select j2.aliquota_3m from janela j2
           where j2.eh_grupo = j.eh_grupo
             and j2.empresa_id is not distinct from j.empresa_id
             and j2.aliquota_3m is not null
             and j2.mes <= j.mes
           order by j2.mes desc limit 1)
       ), 4)                                      as aliquota_vigente,
       /* No FIM da lista de proposito: `create or replace view` nao insere
          coluna no meio nem reordena -- acrescentar no fim e o que permite
          substituir a view sem derrubar quem depende dela. */
       j.eh_grupo
from janela j;

comment on view public.vw_aliquota_simples_mes is
  'A alíquota do Simples MEDIDA: imposto pago em M+1 sobre a base de M, em '
  'janela de 3 meses. Uma linha por empresa e uma do GRUPO (eh_grupo, com '
  'empresa_id nulo), que é o que vale para empresa ainda sem histórico.';

-- ── A função ganha o degrau do meio ───────────────────────────────────────

create or replace function public.fn_aliquota_simples(
  p_empresa uuid,
  p_data    date default (now() at time zone 'America/Sao_Paulo')::date
) returns numeric
language sql
stable
set search_path to 'public'
as $function$
  select coalesce(
    -- 1. a dela
    (select a.aliquota_vigente from public.vw_aliquota_simples_mes a
      where not a.eh_grupo and a.empresa_id is not distinct from p_empresa
        and a.mes <= date_trunc('month', p_data)::date
        and a.aliquota_vigente is not null
      order by a.mes desc limit 1),
    -- 2. a do grupo
    (select a.aliquota_vigente from public.vw_aliquota_simples_mes a
      where a.eh_grupo
        and a.mes <= date_trunc('month', p_data)::date
        and a.aliquota_vigente is not null
      order by a.mes desc limit 1),
    -- 3. o configurado
    public.fn_config('imposto_simples_nacional_pct', p_empresa),
    0
  );
$function$;

comment on function public.fn_aliquota_simples(uuid, date) is
  'A alíquota do Simples a usar, nesta ordem: a medida DA EMPRESA, a medida do '
  'GRUPO enquanto ela não tem a sua, e `configuracoes` se nem o grupo tiver '
  'histórico. Nunca devolve nulo.';

-- ── A view de faturamento passa a ter o mesmo degrau ──────────────────────
-- Por JOIN duplo (própria + grupo), porque a view tem uma linha por (dia,
-- produto, empresa) e chamar a função em cada uma seria uma subconsulta por
-- linha.

create or replace view public.vw_faturamento_liquido
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
            /* A dela, a do grupo, o configurado — nesta ordem. */
            COALESCE(propria.aliquota_vigente,
                     grupo.aliquota_vigente,
                     fn_config('imposto_simples_nacional_pct'::text, j.empresa_id),
                     0::numeric) AS simples_pct,
            COALESCE(fn_config('imposto_meta_ads_pct'::text, j.empresa_id), 0::numeric) AS meta_pct,
            COALESCE(fn_config('custo_fixo_mensal'::text, j.empresa_id), 0::numeric) AS custo_fixo,
            /* Três estados, não dois: a tela precisa distinguir "medido nela"
               de "herdado do grupo" — um é fato, o outro é empréstimo. */
            CASE WHEN propria.aliquota_vigente IS NOT NULL THEN 'propria'
                 WHEN grupo.aliquota_vigente   IS NOT NULL THEN 'grupo'
                 ELSE 'configurado' END AS simples_origem
           FROM juntos j
           LEFT JOIN vw_aliquota_simples_mes propria
             ON NOT propria.eh_grupo
            AND propria.empresa_id IS NOT DISTINCT FROM j.empresa_id
            AND propria.mes = date_trunc('month', j.data)::date
           LEFT JOIN vw_aliquota_simples_mes grupo
             ON grupo.eh_grupo
            AND grupo.mes = date_trunc('month', j.data)::date
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
    (simples_origem <> 'configurado') AS simples_medido,
    simples_origem
   FROM com_cfg c;

comment on view public.vw_faturamento_liquido is
  'Faturamento e margem por dia/produto/empresa. A alíquota do Simples é a '
  'MEDIDA da empresa, ou a do GRUPO enquanto ela não tem a sua, ou o '
  'configurado; `simples_origem` diz qual dos três valeu.';

-- ── A prova ────────────────────────────────────────────────────────────────

do $$
declare
  v_aeliss  uuid;
  v_alaskan uuid;
  v_origem  text;
  v_pct     numeric;
  v_grupo   numeric;
  v_al_pct  numeric;
begin
  select id into v_aeliss  from public.empresas where slug = 'aeliss';
  select id into v_alaskan from public.empresas where slug = 'alaskan';

  -- 1. A Aeliss, que ainda não pagou imposto, herda o grupo — e NÃO os 9%.
  select max(simples_origem), max(simples_pct) into v_origem, v_pct
  from public.vw_faturamento_liquido
  where empresa_id = v_aeliss and data >= '2026-09-01' and data < '2026-10-01';

  if v_origem is distinct from 'grupo' then
    raise exception 'PROVA FALHOU: a Aeliss deveria herdar do grupo, veio origem %.', v_origem;
  end if;
  if v_pct >= 9 then
    raise exception 'PROVA FALHOU: a Aeliss continua com a aliquota configurada (%).', v_pct;
  end if;

  -- 2. E o que ela herdou é de fato a do grupo.
  select aliquota_vigente into v_grupo
  from public.vw_aliquota_simples_mes
  where eh_grupo and mes = '2026-09-01';

  if round(v_pct,4) is distinct from round(v_grupo,4) then
    raise exception 'PROVA FALHOU: a Aeliss usa % e o grupo e %.', v_pct, v_grupo;
  end if;

  -- 3. A Alaskan continua na DELA, e não passou a usar a do grupo por
  --    acidente. Hoje os dois números coincidem, então o que se confere é a
  --    ORIGEM: é ela que diz se a precedência está certa.
  select max(simples_origem), max(simples_pct) into v_origem, v_al_pct
  from public.vw_faturamento_liquido
  where empresa_id = v_alaskan and data >= '2026-09-01' and data < '2026-10-01';

  if v_origem is distinct from 'propria' then
    raise exception 'PROVA FALHOU: a Alaskan deveria usar a propria, veio %.', v_origem;
  end if;

  raise notice 'PROVA OK: Aeliss herda % do grupo (era 9%%); Alaskan usa a propria, %.',
    v_pct, v_al_pct;
end $$;
