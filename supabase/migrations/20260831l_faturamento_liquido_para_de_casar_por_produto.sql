/*
  `vw_faturamento_liquido` casava gasto com venda por `produto`. Isso deixa de
  funcionar amanhã.

  Medido em 31/08/2026, quatro contas dividem `produto = 'velas'`:

      Desafios na Sala - TSL   R$  3.274,52/30d   ← vira Aeliss em 01/09
      Lembrancinha - TSL       R$ 17.115,62/30d
      Workshop Buquê - TSL     R$ 10.856,72/30d
      Worshop Buquê - SO       R$    832,57/30d

  Depois da migração, `velas` é Aeliss E Alaskan. A view jogaria R$ 3.274/mês de
  mídia da Aeliss dentro da Alaskan, e a receita correspondente no sentido
  contrário. **`produto` deixou de identificar uma empresa.**

  A CORREÇÃO É PÔR A EMPRESA NA CHAVE

  O casamento passa a ser por (data, empresa, produto). Dentro de uma empresa,
  produto continua significando o que sempre significou; entre empresas, ele
  para de encostar uma na outra.

  E O LEFT JOIN VIRA FULL OUTER

  Era `vendas LEFT JOIN mídia`: dia com GASTO e sem venda desaparecia inteiro,
  gasto junto. Hoje isso não acontece — medi, são zero casos em 90 dias —, mas
  a Aeliss começa amanhã, e o primeiro dia de uma operação nova é exatamente
  "gastei e ainda não vendi". O gasto dela sumiria no dia em que mais se olha.

  A ALÍQUOTA TAMBÉM É POR EMPRESA

  `cfg` era um CROSS JOIN de uma linha só. Agora sai de `fn_config(chave,
  empresa)`, que é onde a regra "a específica ganha da geral" mora — senão o
  DRE da Aeliss sairia com a receita dela e o imposto da Alaskan.

  QUEM USA ISTO

  Só o painel de conferência de Configurações. `fn_overview` saiu daqui em
  `20260831e`, justamente para não depender de um casamento por produto.
*/

CREATE OR REPLACE VIEW public.vw_faturamento_liquido AS
  WITH vendas_base AS (
    SELECT v.empresa_id,
           v.produto,
           (v.data_venda AT TIME ZONE 'America/Sao_Paulo')::date AS data,
           sum(CASE WHEN v.status = 'aprovada' THEN v.valor_total ELSE 0 END) AS faturamento_bruto,
           sum(CASE WHEN v.status = 'aprovada' THEN COALESCE(v.valor_sem_juros, v.valor_total) ELSE 0 END) AS receita_tributavel,
           sum(CASE WHEN v.status = 'aprovada' THEN COALESCE(v.juros_parcelamento, 0) ELSE 0 END) AS juros_parc,
           sum(CASE WHEN v.status = 'aprovada' THEN COALESCE(v.taxa_plataforma_valor, 0) ELSE 0 END) AS taxa_plataforma,
           sum(CASE WHEN v.status IN ('reembolsada','chargeback')
                    THEN fn_perda_da_venda(v.valor_total, v.valor_reembolsado) ELSE 0 END) AS reembolsos,
           count(CASE WHEN v.status = 'aprovada' AND (v.is_upsell IS NULL OR v.is_upsell = false) THEN 1 END) AS vendas_aprovadas,
           count(CASE WHEN v.status = 'pendente' AND (v.is_upsell IS NULL OR v.is_upsell = false) THEN 1 END) AS vendas_pendentes,
           sum(CASE WHEN v.status = 'pendente' THEN v.valor_total ELSE 0 END) AS montante_pendente
      FROM vendas v
     WHERE v.pedido_id NOT LIKE 'TEST%'
       AND v.pedido_id NOT LIKE 'LC-%'
     GROUP BY v.empresa_id, v.produto, ((v.data_venda AT TIME ZONE 'America/Sao_Paulo')::date)
  ),
  meta_base AS (
    SELECT m.empresa_id, m.produto, m.data,
           sum(m.investimento) AS investimento
      FROM metricas_meta m
     WHERE m.nivel = 'campanha'
     GROUP BY m.empresa_id, m.produto, m.data
  ),
  /*
    A empresa entra na chave do casamento. Sem ela, `velas` da Aeliss casaria
    com `velas` da Alaskan — que é o defeito que esta migração existe para
    corrigir.
  */
  juntos AS (
    SELECT COALESCE(v.data, m.data)             AS data,
           COALESCE(v.produto, m.produto)       AS produto,
           COALESCE(v.empresa_id, m.empresa_id) AS empresa_id,
           COALESCE(v.faturamento_bruto,  0) AS faturamento_bruto,
           COALESCE(v.receita_tributavel, 0) AS receita_tributavel,
           COALESCE(v.juros_parc,         0) AS juros_parc,
           COALESCE(v.taxa_plataforma,    0) AS taxa_plataforma,
           COALESCE(v.reembolsos,         0) AS reembolsos,
           COALESCE(v.vendas_aprovadas,   0) AS vendas_aprovadas,
           COALESCE(v.vendas_pendentes,   0) AS vendas_pendentes,
           COALESCE(v.montante_pendente,  0) AS montante_pendente,
           COALESCE(m.investimento,       0) AS investimento_meta
      FROM vendas_base v
      FULL JOIN meta_base m
             ON m.data = v.data
            /* `IS NOT DISTINCT FROM` e nao `=`: com `=`, uma linha de produto
               nulo nunca casa com outra de produto nulo, e as duas apareceriam
               separadas somando a mesma coisa duas vezes. */
            AND m.produto    IS NOT DISTINCT FROM v.produto
            AND m.empresa_id IS NOT DISTINCT FROM v.empresa_id
  ),
  /* A alíquota de cada linha é a da empresa dela. */
  com_cfg AS (
    SELECT j.*,
           COALESCE(fn_config('imposto_simples_nacional_pct', j.empresa_id), 0) AS simples_pct,
           COALESCE(fn_config('imposto_meta_ads_pct',         j.empresa_id), 0) AS meta_pct,
           COALESCE(fn_config('custo_fixo_mensal',            j.empresa_id), 0) AS custo_fixo
      FROM juntos j
  )
  SELECT c.data,
         c.produto,
         c.faturamento_bruto,
         c.taxa_plataforma,
         CASE WHEN c.receita_tributavel > 0
              THEN round(c.taxa_plataforma / c.receita_tributavel * 100, 2)
              ELSE 0 END AS taxa_plataforma_pct,
         c.reembolsos,
         c.vendas_aprovadas,
         c.vendas_pendentes,
         c.montante_pendente,
         c.investimento_meta,
         round(c.receita_tributavel * c.simples_pct / 100, 2) AS imposto_simples,
         round(c.investimento_meta  * c.meta_pct    / 100, 2) AS imposto_meta_ads,
         round(c.receita_tributavel
               - c.taxa_plataforma
               - c.reembolsos
               - c.receita_tributavel * c.simples_pct / 100
               - c.investimento_meta  * c.meta_pct    / 100
               - c.investimento_meta, 2) AS faturamento_liquido,
         CASE WHEN c.receita_tributavel > 0
              THEN round((c.receita_tributavel
                          - c.taxa_plataforma
                          - c.reembolsos
                          - c.receita_tributavel * c.simples_pct / 100
                          - c.investimento_meta  * c.meta_pct    / 100
                          - c.investimento_meta) / c.receita_tributavel * 100, 2)
              ELSE 0 END AS margem_pct,
         CASE WHEN c.investimento_meta > 0
              THEN round(c.receita_tributavel / c.investimento_meta, 2)
              ELSE NULL END AS roas,
         c.simples_pct,
         c.meta_pct,
         c.custo_fixo,
         c.receita_tributavel,
         c.juros_parc AS juros_parcelamento,
         c.empresa_id
    FROM com_cfg c;

COMMENT ON VIEW public.vw_faturamento_liquido IS
  'Faturamento liquido por dia, produto e EMPRESA. O casamento entre venda e '
  'midia leva a empresa na chave desde 31/08/2026: ate entao era so por '
  'produto, e `velas` passou a existir em duas empresas. FULL JOIN para dia com '
  'gasto e sem venda nao sumir — que e o primeiro dia de qualquer operacao nova.';
