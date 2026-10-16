-- O juro do parcelamento sai da base do Simples
--
-- Decisão dela, 16/10/2026: *"de fato não o recebemos, e não pagamos
-- impostos do simples sobre eles"*.
--
-- A base era `receita − coprodução + juros` — escrito assim de propósito
-- em `20261008i`, que a chamou de "a base legal do Simples". O juro não é
-- receita dela: medido numa compra de 15/10, a Payt cobrou R$ 228,12 do
-- cartão, o preço era R$ 183,80, e a comissão da mesma compra mostra o
-- produtor recebendo R$ 156,27. O juro fica com a adquirente.
--
-- ── O que muda no resultado, que é menos do que parece ─────────────────
--
-- A alíquota é MEDIDA — `imposto pago em M+1 / base de M` — contra essa
-- mesma base inflada, então os dois erros se cancelavam. No agregado da
-- janela com pagamento casado, Alaskan:
--
--     alíquota com juros na base ... 5,580%   imposto ... R$ 50.780,57
--     alíquota sem juros .......... 5,671%   imposto ... R$ 50.780,57
--     DAS realmente pago .......... R$ 50.780,57
--
-- Idêntico. Mês a mês sobra um resíduo, porque a janela de 3 meses não
-- acompanha a proporção de juros de cada mês:
--
--     Alaskan 07/26  8.396,44 -> 8.255,69   (−140,75)
--     Alaskan 08/26 14.050,34 -> 13.990,47  ( −59,87)
--     Alaskan 09/26 13.839,93 -> 13.755,90  ( −84,03)
--     Aeliss  09/26  1.094,37 ->  1.062,02  ( −32,35)
--
-- ~R$ 360 a menos de imposto em quatro meses. E o resíduo variar de −4 a
-- −141 É o argumento: hoje estava certo por COINCIDÊNCIA, e a coincidência
-- já não fecha mês a mês. No mês em que o mix de parcelado mudar de
-- verdade, a base cai e a alíquota não acompanha na hora.
--
-- ── Por que a definição inteira está escrita aqui ──────────────────────
--
-- A primeira versão desta migração trocou as quatro expressões por um
-- `do $$` que lia `pg_get_viewdef`, substituía e reexecutava — cirúrgico,
-- e por construção não mexia no resto. Funcionou no banco e **quebrou dois
-- testes**: `aliquota-do-simples-e-medida` lê a ÚLTIMA MIGRAÇÃO que define
-- a view e exige ver `simples_origem` e `simples_medido` no texto. Com a
-- definição dentro de uma string, não havia o que ler.
--
-- O teste está certo, e é a lição de 04/10 noutra forma: migração que os
-- testes não conseguem ler é migração que desliga os testes. O que está
-- abaixo não é transcrição à mão — é o `pg_get_viewdef` da view já
-- corrigida e conferida, colado. As quatro expressões que mudaram:
--
--     imposto_simples, faturamento_liquido, margem_pct  (3, com parênteses)
--     base_simples                                      (1, sem parênteses)
--
-- `juros_parc` CONTINUA na view como coluna — ele é real, e
-- `fn_resultado_mes` o soma em `pago_pelos_clientes`, que é o que de fato
-- saiu do bolso de quem comprou. O que saiu foi a soma na base do imposto.
--
-- `with (security_invoker = on)` nas duas instruções: o replace REDEFINE
-- as reloptions, e omitir apaga.

-- ---------------------------------------------------------------------------
-- 1. A base, na origem
-- ---------------------------------------------------------------------------

create or replace view public.vw_base_simples_mes
with (security_invoker = on) as
  select (date_trunc('month', ((data_venda at time zone 'America/Sao_Paulo')::date)::timestamp with time zone))::date as mes,
         empresa_id,
         /* SEM `+ coalesce(juros_parcelamento, 0)`. */
         sum(coalesce(valor_sem_juros, valor_total) - coalesce(valor_coproducao, 0::numeric)) as base
    from vendas v
   where status = 'aprovada'::status_venda
     and pedido_id !~~ 'TEST%'::text
     and pedido_id !~~ 'LC-%'::text
   group by 1, empresa_id;

comment on view public.vw_base_simples_mes is
  'A base do Simples por mes e empresa: receita − coproducao. O juro do parcelamento NAO entra (decisao dela, 16/10/2026): ele e cobrado do cliente pela adquirente e nao passa pela conta dela. Ate 16/10 entrava, e como a aliquota e medida contra esta mesma base os dois erros se cancelavam — o imposto saia certo por coincidencia, e quebraria no mes em que o mix de parcelado mudasse.';

-- `vw_aliquota_simples_mes` lê daqui e não muda: a alíquota medida sobe
-- sozinha, porque o mesmo DAS passa a ser dividido por uma base menor.
-- Medido: 6,936% -> 7,092%.

-- ---------------------------------------------------------------------------
-- 2. vw_faturamento_liquido
-- ---------------------------------------------------------------------------

create or replace view public.vw_faturamento_liquido
with (security_invoker = on) as
 WITH vendas_base AS (
         SELECT v.empresa_id,
            v.produto,
            (v.data_venda AT TIME ZONE 'America/Sao_Paulo'::text)::date AS data,
            sum(
                CASE
                    WHEN v.status = 'aprovada'::status_venda THEN COALESCE(v.valor_sem_juros, v.valor_total)
                    ELSE 0::numeric
                END) AS faturamento_bruto,
            sum(
                CASE
                    WHEN v.status = 'aprovada'::status_venda THEN COALESCE(v.valor_sem_juros, v.valor_total) - COALESCE(v.valor_coproducao, 0::numeric)
                    ELSE 0::numeric
                END) AS receita_tributavel,
            sum(
                CASE
                    WHEN v.status = 'aprovada'::status_venda THEN COALESCE(v.valor_coproducao, 0::numeric)
                    ELSE 0::numeric
                END) AS coproducao,
            count(
                CASE
                    WHEN v.status = 'aprovada'::status_venda AND v.valor_coproducao IS NULL AND (v.produto_nome IS NULL OR NOT (v.produto_nome IN ( SELECT vw_produto_sem_coprodutor.produto_nome
                       FROM vw_produto_sem_coprodutor))) THEN 1
                    ELSE NULL::integer
                END) AS vendas_sem_dado_coproducao,
            sum(
                CASE
                    WHEN v.status = 'aprovada'::status_venda THEN COALESCE(v.juros_parcelamento, 0::numeric)
                    ELSE 0::numeric
                END) AS juros_parc,
            sum(
                CASE
                    WHEN v.status = 'aprovada'::status_venda THEN COALESCE(v.taxa_plataforma_valor, 0::numeric)
                    ELSE 0::numeric
                END) AS taxa_plataforma,
            sum(
                CASE
                    WHEN v.status = ANY (ARRAY['reembolsada'::status_venda, 'chargeback'::status_venda]) THEN fn_perda_da_venda(v.valor_total, v.valor_reembolsado)
                    ELSE 0::numeric
                END) AS reembolsos,
            sum(
                CASE
                    WHEN v.status = 'reembolsada'::status_venda THEN fn_perda_da_venda(v.valor_total, v.valor_reembolsado)
                    ELSE 0::numeric
                END) AS perda_reembolso,
            sum(
                CASE
                    WHEN v.status = 'chargeback'::status_venda THEN fn_perda_da_venda(v.valor_total, v.valor_reembolsado)
                    ELSE 0::numeric
                END) AS perda_chargeback,
            count(
                CASE
                    WHEN v.status = 'aprovada'::status_venda AND (v.is_upsell IS NULL OR v.is_upsell = false) THEN 1
                    ELSE NULL::integer
                END) AS vendas_aprovadas,
            count(
                CASE
                    WHEN v.status = 'pendente'::status_venda AND (v.is_upsell IS NULL OR v.is_upsell = false) THEN 1
                    ELSE NULL::integer
                END) AS vendas_pendentes,
            sum(
                CASE
                    WHEN v.status = 'pendente'::status_venda THEN v.valor_total
                    ELSE 0::numeric
                END) AS montante_pendente
           FROM vendas v
          WHERE v.pedido_id !~~ 'TEST%'::text AND v.pedido_id !~~ 'LC-%'::text
          GROUP BY v.empresa_id, v.produto, ((v.data_venda AT TIME ZONE 'America/Sao_Paulo'::text)::date)
        ), meta_base AS (
         SELECT m.empresa_id,
            m.produto,
            m.data,
            sum(m.investimento) AS investimento
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
         SELECT j.data,
            j.produto,
            j.empresa_id,
            j.faturamento_bruto,
            j.receita_tributavel,
            j.coproducao,
            j.vendas_sem_dado_coproducao,
            j.juros_parc,
            j.taxa_plataforma,
            j.reembolsos,
            j.perda_reembolso,
            j.perda_chargeback,
            j.vendas_aprovadas,
            j.vendas_pendentes,
            j.montante_pendente,
            j.investimento_meta,
            COALESCE(propria.aliquota_vigente, grupo.aliquota_vigente, fn_config('imposto_simples_nacional_pct'::text, j.empresa_id), 0::numeric) AS simples_pct,
            COALESCE(fn_config('imposto_meta_ads_pct'::text, j.empresa_id), 0::numeric) AS meta_pct,
            COALESCE(fn_config('custo_fixo_mensal'::text, j.empresa_id), 0::numeric) AS custo_fixo,
                CASE
                    WHEN propria.aliquota_vigente IS NOT NULL THEN 'propria'::text
                    WHEN grupo.aliquota_vigente IS NOT NULL THEN 'grupo'::text
                    ELSE 'configurado'::text
                END AS simples_origem
           FROM juntos j
             LEFT JOIN vw_aliquota_simples_mes propria ON NOT propria.eh_grupo AND NOT propria.empresa_id IS DISTINCT FROM j.empresa_id AND propria.mes = date_trunc('month'::text, j.data::timestamp with time zone)::date
             LEFT JOIN vw_aliquota_simples_mes grupo ON grupo.eh_grupo AND grupo.mes = date_trunc('month'::text, j.data::timestamp with time zone)::date
        )
 SELECT data,
    produto,
    faturamento_bruto,
    taxa_plataforma,
        CASE
            WHEN receita_tributavel > 0::numeric THEN round(taxa_plataforma / receita_tributavel * 100::numeric, 2)
            ELSE 0::numeric
        END AS taxa_plataforma_pct,
    reembolsos,
    vendas_aprovadas,
    vendas_pendentes,
    montante_pendente,
    investimento_meta,
    round(receita_tributavel * simples_pct / 100::numeric, 2) AS imposto_simples,
    round(investimento_meta * meta_pct / 100::numeric, 2) AS imposto_meta_ads,
    round(receita_tributavel - taxa_plataforma - receita_tributavel * simples_pct / 100::numeric - investimento_meta * meta_pct / 100::numeric - investimento_meta, 2) AS faturamento_liquido,
        CASE
            WHEN receita_tributavel > 0::numeric THEN round((receita_tributavel - taxa_plataforma - receita_tributavel * simples_pct / 100::numeric - investimento_meta * meta_pct / 100::numeric - investimento_meta) / receita_tributavel * 100::numeric, 2)
            ELSE 0::numeric
        END AS margem_pct,
        CASE
            WHEN investimento_meta > 0::numeric THEN round(receita_tributavel / investimento_meta, 2)
            ELSE NULL::numeric
        END AS roas,
    simples_pct,
    meta_pct,
    custo_fixo,
    receita_tributavel,
    juros_parc AS juros_parcelamento,
    empresa_id,
    perda_reembolso,
    perda_chargeback,
    coproducao,
    vendas_sem_dado_coproducao,
    receita_tributavel AS base_simples,
    simples_origem <> 'configurado'::text AS simples_medido,
    simples_origem
   FROM com_cfg c;

-- ---------------------------------------------------------------------------
-- 3. Prova
-- ---------------------------------------------------------------------------

do $$
declare n int; ddl text;
begin
  select pg_get_viewdef('public.vw_faturamento_liquido'::regclass, true) into ddl;

  /* Nenhuma soma sobrou. Não se conta `juros_parc` solto: ele CONTINUA na
     view como coluna legítima, em cinco lugares. O que tinha de sumir é a
     SOMA na base do imposto. */
  select count(*) into n from regexp_matches(ddl, 'receita_tributavel \+ juros_parc', 'g');
  if n <> 0 then
    raise exception 'ainda ha % soma(s) de juros na base do imposto', n;
  end if;

  if ddl not like '%juros_parc AS juros_parcelamento%' then
    raise exception 'a coluna juros_parcelamento sumiu da view — ela tinha de ficar';
  end if;
  if ddl not like '%simples_origem%' or ddl not like '%simples_medido%' then
    raise exception 'a view perdeu as colunas que dizem de onde veio a aliquota';
  end if;

  select count(*) into n from regexp_matches(
    pg_get_viewdef('public.vw_base_simples_mes'::regclass, true), 'juros', 'g');
  /* Sobra uma: o `valor_sem_juros`, que é a receita. */
  if n <> 1 then
    raise exception 'vw_base_simples_mes ainda soma juros (% mencoes)', n;
  end if;
end $$;
