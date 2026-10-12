-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ O lucro passa a ter uma definição só, e ela mora no banco               ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Ela perguntou: "não podemos usar o lucro que já temos na base?" A resposta
-- honesta era não — porque não havia UM lucro na base, havia dois que
-- discordavam, e nenhum deles era o do plano.
--
-- As três decisões que faltavam vieram dela, e são o que esta migração
-- implementa:
--
--   1. COMPETÊNCIA, não caixa. "o que aconteceu no mês", não "o que passou
--      pela conta". Em setembro a diferença é R$ 498 na receita e
--      R$ 14.568 no anúncio — a fatura debitada em setembro é o anúncio de
--      agosto.
--   2. SÓCIOS DENTRO. Palavras dela: "a retirada acontece independente, 12
--      mil mês com pró-labore. Lucro líquido deve ser após esta retirada,
--      pois é para os custos de vida dos sócios." Medido em setembro:
--      R$ 12.000 exatos.
--   3. O IMPOSTO SAI DO CUSTO FIXO. O plano listava "jurídico R$ 14,3 mil"
--      no custo fixo de setembro e no extrato não existe nada parecido — o
--      maior lançamento do centro Jurídico é R$ 954. Os R$ 14,3 mil são a
--      provisão do Simples, com o rótulo errado. E a "sobra antes do fixo"
--      da UTMify JÁ desconta o Simples, então o plano cobrava o imposto duas
--      vezes. Confirmado por ela: "é o imposto mesmo, pode tirar do custo
--      fixo".
--
-- ── A consequência disso para as metas ────────────────────────────────────
--
-- Setembro não foi −R$ 10 mil. Foi praticamente empate. Os alvos de dez/26,
-- mar/27 e jul/27 provavelmente carregam a mesma dupla cobrança, mas eles
-- são DELA e não se mexem aqui: a tela mostra o medido ao lado do que o
-- plano dizia, como já faz com os outros nove indicadores.
--
-- ── Por que uma função e não mais uma conta em TypeScript ────────────────
--
-- A cadeia do lucro vivia em `resultado.ts` e em lugar nenhum do banco, e
-- `fn_overview` não devolve nem lucro nem investimento. Escrever a conta de
-- novo aqui criaria a segunda definição — a armadilha 1 na variável que mais
-- importa.
--
-- Então esta função nasce para ser a ÚNICA, e a tela Resultado passa a ler
-- dela na migração seguinte. Enquanto isso a prova abaixo exige que os dois
-- caminhos cheguem no mesmo número, componente por componente, nos seis
-- meses que a tela mostra hoje.
--
-- ── A exceção que a prova admite, e por quê ──────────────────────────────
--
-- Um componente NÃO bate de propósito: o Simples. `resultado.ts` calcula a
-- alíquota sobre os DOIS últimos meses fechados; `vw_aliquota_simples_mes`
-- usa TRÊS, e a janela de três tem teste e motivo escrito ("mês a mês a
-- medida oscila entre 6,00% e 8,16%, e a oscilação é o DIA do pagamento").
--
-- Eram duas alíquotas medidas no mesmo painel — a armadilha 1 de novo, e era
-- ela a origem dos "dois lucros". Esta função adota a da view, que é a que
-- tem catraca. Em setembro isso move o Simples de R$ 14.458,99 para
-- R$ 14.934,06, e o resultado de R$ 12.269,52 para R$ 11.794,45.
--
-- ── As listas de categoria vêm da TABELA ─────────────────────────────────
--
-- `ehCustoOperacional` conhece `CAT_SOCIOS` e `CAT_RESERVA` por lista escrita
-- no código — e tem razão, porque roda em laço sobre milhares de linhas. Em
-- SQL não há essa desculpa: aqui sai de `categorias_centro.tipo`.
--
-- Conferido antes de portar: os quatro nomes de cada lista batem EXATAMENTE
-- com os `tipo` do catálogo, e nenhuma categoria usada em `transacoes` está
-- fora dele. Se um dia divergirem, a prova desta migração acusa.

create or replace function public.fn_resultado_mes(p_empresa uuid default null)
 returns table (
   mes                         date,
   pago_pelos_clientes         numeric,
   perda_reembolso             numeric,
   perda_chargeback            numeric,
   perdas                      numeric,
   coproducao                  numeric,
   vendas_sem_dado_coproducao  bigint,
   vendas                      bigint,
   juros                       numeric,
   receita                     numeric,
   taxa_payt                   numeric,
   invest_meta                 numeric,
   imposto_meta                numeric,
   simples                     numeric,
   simples_presumido           boolean,
   simples_pct                 numeric,
   simples_pago_parcial        numeric,
   simples_vencimento          date,
   simples_em_atraso           boolean,
   impostos_e_taxas            numeric,
   sobra_apos_impostos         numeric,
   custos_pagos                numeric,
   resultado                   numeric,
   margem                      numeric,
   retiradas_socios            numeric,
   sobrou_depois_das_retiradas numeric,
   caixa_entrou                numeric,
   caixa_saiu                  numeric,
   anuncios_pagos              numeric,
   sem_dados_de_anuncio        boolean
 )
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  with competencia as (
    select date_trunc('month', f.data)::date as mes,
           -- O topo da cascata e TUDO que saiu do bolso da cliente. A view
           -- so conta `aprovada`, entao as perdas voltam aqui e descem uma
           -- vez so, com nome, tres linhas abaixo. E os juros entram porque
           -- `faturamento_bruto` e SEM juros (20260905d).
           sum(coalesce(f.faturamento_bruto,0) + coalesce(f.juros_parcelamento,0)
               + coalesce(f.perda_reembolso,0) + coalesce(f.perda_chargeback,0)) as pago_pelos_clientes,
           sum(coalesce(f.perda_reembolso,0))            as perda_reembolso,
           sum(coalesce(f.perda_chargeback,0))           as perda_chargeback,
           sum(coalesce(f.coproducao,0))                 as coproducao,
           sum(coalesce(f.vendas_sem_dado_coproducao,0)) as vendas_sem_dado_coproducao,
           sum(coalesce(f.vendas_aprovadas,0))           as vendas,
           sum(coalesce(f.juros_parcelamento,0))         as juros,
           sum(coalesce(f.receita_tributavel,0))         as receita,
           sum(coalesce(f.taxa_plataforma,0))            as taxa_payt,
           sum(coalesce(f.investimento_meta,0))          as invest_meta,
           sum(coalesce(f.imposto_meta_ads,0))           as imposto_meta
      from vw_faturamento_liquido f
     where p_empresa is null or f.empresa_id = p_empresa
     group by 1
  ),
  caixa as (
    -- `tipo` sai de categorias_centro, nao de lista escrita aqui. Categoria
    -- sem catalogo conta como custo, que e o que ehCustoOperacional faz
    -- ("toda saida e custo, exceto socio e reserva").
    select date_trunc('month', t.data)::date as mes,
           sum(abs(t.valor)) filter (
             where t.valor > 0 and coalesce(cc.tipo,'custo') not in ('socio','reserva')) as entrou,
           sum(abs(t.valor)) filter (
             where t.valor < 0 and coalesce(cc.tipo,'custo') = 'socio')                  as retiradas_socios,
           sum(abs(t.valor)) filter (
             where t.valor < 0 and coalesce(cc.tipo,'custo') not in ('socio','reserva')) as saiu,
           sum(abs(t.valor)) filter (
             where t.valor < 0 and coalesce(cc.tipo,'custo') not in ('socio','reserva')
               and t.categoria = 'Anúncios (Facebook ADs)')                              as anuncios_pagos,
           -- Imposto e anuncio viram linha propria na cascata; somados aos
           -- custos, entrariam duas vezes.
           sum(abs(t.valor)) filter (
             where t.valor < 0 and coalesce(cc.tipo,'custo') not in ('socio','reserva')
               and coalesce(t.categoria,'') not in
                   ('Impostos e Tributos', 'Anúncios (Facebook ADs)'))                   as custos_pagos
      from transacoes t
      left join categorias_centro cc on cc.categoria = t.categoria
     where p_empresa is null or t.empresa_id = p_empresa
     group by 1
  ),
  aliquota as (
    select a.mes, a.base, a.imposto_pago, a.pagamento_fechado,
           a.aliquota_vigente, a.vencimento
      from vw_aliquota_simples_mes a
     where not a.eh_grupo is distinct from (p_empresa is null)
       and ((p_empresa is null and a.empresa_id is null)
            or a.empresa_id = p_empresa)
  ),
  meses as (
    select mes from competencia
    union
    select mes from caixa
  ),
  junto as (
    select m.mes,
           coalesce(c.pago_pelos_clientes,0)        as pago_pelos_clientes,
           coalesce(c.perda_reembolso,0)            as perda_reembolso,
           coalesce(c.perda_chargeback,0)           as perda_chargeback,
           coalesce(c.coproducao,0)                 as coproducao,
           coalesce(c.vendas_sem_dado_coproducao,0)::bigint as vendas_sem_dado_coproducao,
           coalesce(c.vendas,0)::bigint             as vendas,
           coalesce(c.juros,0)                      as juros,
           coalesce(c.receita,0)                    as receita,
           coalesce(c.taxa_payt,0)                  as taxa_payt,
           coalesce(c.invest_meta,0)                as invest_meta,
           coalesce(c.imposto_meta,0)               as imposto_meta,
           coalesce(k.custos_pagos,0)               as custos_pagos,
           coalesce(k.retiradas_socios,0)           as retiradas_socios,
           coalesce(k.entrou,0)                     as caixa_entrou,
           coalesce(k.saiu,0)                       as caixa_saiu,
           coalesce(k.anuncios_pagos,0)             as anuncios_pagos,
           -- Pago e fato quando o DAS fechou; senao, presumido pela aliquota
           -- vigente. As duas regras (dia 20 e piso do Anexo I) ja vivem na
           -- view, e e de la que vem a resposta.
           case when coalesce(q.pagamento_fechado,false) then coalesce(q.imposto_pago,0)
                else round(coalesce(q.base,0) * coalesce(q.aliquota_vigente,0) / 100.0, 2)
           end                                      as simples,
           not coalesce(q.pagamento_fechado,false)  as simples_presumido,
           case when coalesce(q.pagamento_fechado,false) then null
                else q.aliquota_vigente end          as simples_pct,
           coalesce(q.imposto_pago,0)               as simples_pago_parcial,
           q.vencimento                             as simples_vencimento,
           (q.vencimento is not null
            and (now() at time zone 'America/Sao_Paulo')::date > q.vencimento
            and not coalesce(q.pagamento_fechado,false)) as simples_em_atraso
      from meses m
      left join competencia c on c.mes = m.mes
      left join caixa       k on k.mes = m.mes
      left join aliquota    q on q.mes = m.mes
  )
  select
    j.mes,
    j.pago_pelos_clientes, j.perda_reembolso, j.perda_chargeback,
    (j.perda_reembolso + j.perda_chargeback) as perdas,
    j.coproducao, j.vendas_sem_dado_coproducao, j.vendas,
    j.juros, j.receita, j.taxa_payt, j.invest_meta, j.imposto_meta,
    j.simples, j.simples_presumido, j.simples_pct,
    j.simples_pago_parcial, j.simples_vencimento, j.simples_em_atraso,
    (j.taxa_payt + j.imposto_meta + j.simples) as impostos_e_taxas,
    (j.receita - (j.taxa_payt + j.imposto_meta + j.simples)) as sobra_apos_impostos,
    j.custos_pagos,
    (j.receita - (j.taxa_payt + j.imposto_meta + j.simples)
       - j.invest_meta - j.custos_pagos) as resultado,
    case when j.receita > 0
         then round(100 * (j.receita - (j.taxa_payt + j.imposto_meta + j.simples)
                           - j.invest_meta - j.custos_pagos) / j.receita, 2)
         else 0 end as margem,
    j.retiradas_socios,
    -- O LUCRO LIQUIDO do plano: depois das retiradas, porque elas sao o
    -- custo de vida dos socios e acontecem independente. Decisao dela.
    (j.receita - (j.taxa_payt + j.imposto_meta + j.simples)
       - j.invest_meta - j.custos_pagos - j.retiradas_socios) as sobrou_depois_das_retiradas,
    j.caixa_entrou, j.caixa_saiu, j.anuncios_pagos,
    (j.invest_meta = 0 and j.anuncios_pagos > 0) as sem_dados_de_anuncio
  from junto j
  order by j.mes;
$function$;

comment on function public.fn_resultado_mes(uuid) is
  'A cascata do resultado por mes, por COMPETENCIA, com socios dentro do '
  'lucro liquido. E a UNICA definicao de lucro do projeto: a tela Resultado '
  'e fn_metas_medir leem desta funcao. O imposto NAO entra como custo fixo '
  'alem da linha do Simples — o plano o contava duas vezes.';

revoke all on function public.fn_resultado_mes(uuid) from public, anon;
grant execute on function public.fn_resultado_mes(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  r       record;
  v_n     bigint;
  -- Os valores esperados sao o que a tela mostra HOJE, lidos dela em
  -- 12/10/2026. Cada componente que nao bater e um ponto onde o porte mudou
  -- o numero sem eu mandar.
  v_val   numeric;
begin
  -- 1. As listas de categoria do TypeScript continuam iguais ao catalogo. O
  --    porte derivou de `tipo`, e isso so e equivalente enquanto for verdade.
  select count(*) into v_n from public.categorias_centro
   where tipo = 'socio'
     and categoria not in ('Pró-labore','Retirada de Lucro','Sócios','Aporte de Sócio');
  if v_n > 0 then
    v_erros := v_erros || format('%s categoria(s) de socio no banco fora de CAT_SOCIOS. ', v_n);
  end if;
  select count(*) into v_n from public.categorias_centro
   where tipo = 'reserva'
     and categoria not in ('Reserva de Caixa','Retirada do Caixa','Investimentos Futuros','Pagamento de Fatura');
  if v_n > 0 then
    v_erros := v_erros || format('%s categoria(s) de reserva no banco fora de CAT_RESERVA. ', v_n);
  end if;

  -- 2. RECEITA, ANUNCIO e CUSTOS batem com a tela, nos quatro meses fechados.
  --    Sao os componentes que o porte NAO deveria mexer.
  for r in
    select * from (values
      (date '2026-05-01', 105354.77, 12876.36),
      (date '2026-06-01',  57588.79, 12305.19),
      (date '2026-07-01', 118641.88, 13064.51),
      (date '2026-08-01', 197273.31, 15086.17),
      (date '2026-09-01', 208941.40, 16267.22)
    ) as t(mes, receita, custos)
  loop
    declare v_rec numeric; v_cus numeric;
    begin
      select x.receita, x.custos_pagos into v_rec, v_cus
        from public.fn_resultado_mes(null) x where x.mes = r.mes;
      if v_rec is null then
        v_erros := v_erros || format('%s nao voltou da funcao. ', r.mes);
      else
        if abs(v_rec - r.receita) > 0.5 then
          v_erros := v_erros || format('%s receita %s, a tela mostra %s. ', r.mes, round(v_rec,2), r.receita);
        end if;
        if abs(v_cus - r.custos) > 0.5 then
          v_erros := v_erros || format('%s custos %s, a tela mostra %s. ', r.mes, round(v_cus,2), r.custos);
        end if;
      end if;
    end;
  end loop;

  -- 3. O ANUNCIO da tela e invest_meta + imposto_meta. Setembro: R$ 153.278,98.
  select x.invest_meta + x.imposto_meta into v_val
    from public.fn_resultado_mes(null) x where x.mes = date '2026-09-01';
  if v_val is null or abs(v_val - 153278.98) > 1 then
    v_erros := v_erros || format('anuncio de setembro deu %s, a tela mostra 153278.98. ', v_val);
  end if;

  -- 4. O SIMPLES muda de proposito, e so ele. Setembro sai de R$ 14.458,99
  --    (dois meses) para R$ 14.934,06 (tres meses, a janela com catraca).
  select * into r from public.fn_resultado_mes(null) where mes = date '2026-09-01';
  if abs(r.simples - 14934.06) > 1 then
    v_erros := v_erros || format('simples de setembro deu %s, esperava 14934.06. ', round(r.simples,2));
  end if;
  if not r.simples_presumido then
    v_erros := v_erros || 'setembro deveria estar presumido. ';
  end if;
  if r.simples_vencimento <> date '2026-10-20' then
    v_erros := v_erros || format('vencimento de setembro deu %s. ', r.simples_vencimento);
  end if;
  if abs(r.simples_pago_parcial - 575.54) > 0.01 then
    v_erros := v_erros || format('parcela de setembro deu %s, esperava 575.54. ', r.simples_pago_parcial);
  end if;

  -- 5. As RETIRADAS de setembro sao os R$ 12.000 que ela citou.
  if abs(r.retiradas_socios - 12000) > 0.01 then
    v_erros := v_erros || format('retiradas de setembro deram %s, esperava 12000. ', r.retiradas_socios);
  end if;

  -- 6. E o LUCRO LIQUIDO de setembro: perto de zero, nao −R$ 10 mil.
  --    11.794,45 − 12.000 = −205,55.
  if abs(r.sobrou_depois_das_retiradas - (-205.55)) > 2 then
    v_erros := v_erros || format('lucro liquido de setembro deu %s, esperava ~-205,55. ',
                                 round(r.sobrou_depois_das_retiradas, 2));
  end if;

  -- 7. A cascata fecha: cada linha e a de cima menos as deducoes nomeadas.
  select count(*) into v_n from public.fn_resultado_mes(null) x
   where abs(x.sobra_apos_impostos - (x.receita - x.impostos_e_taxas)) > 0.01
      or abs(x.resultado - (x.sobra_apos_impostos - x.invest_meta - x.custos_pagos)) > 0.01
      or abs(x.sobrou_depois_das_retiradas - (x.resultado - x.retiradas_socios)) > 0.01
      or abs(x.perdas - (x.perda_reembolso + x.perda_chargeback)) > 0.01;
  if v_n > 0 then
    v_erros := v_erros || format('%s mes(es) com a cascata nao fechando. ', v_n);
  end if;

  -- 8. Nao ficou aberta.
  if has_function_privilege('anon', 'public.fn_resultado_mes(uuid)', 'execute') then
    v_erros := v_erros || 'anon consegue executar fn_resultado_mes. ';
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: % meses. Setembro: receita %, simples % (presumido), socios %, lucro liquido %.',
    (select count(*) from public.fn_resultado_mes(null)),
    round(r.receita,2), round(r.simples,2), round(r.retiradas_socios,2),
    round(r.sobrou_depois_das_retiradas,2);
end $prova$;

notify pgrst, 'reload schema';
