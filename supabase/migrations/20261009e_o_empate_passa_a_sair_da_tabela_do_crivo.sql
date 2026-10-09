-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ O empate passa a sair da tabela do crivo                                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- `vw_ad_morrendo` tinha o empate escrito à mão, em QUATRO lugares e DUAS
-- notações: `roas_7 < 1.6` (:125), o comentário (:33), o `COMMENT ON VIEW`
-- (:128-129, com **vírgula**) e a prova `roas_agora >= 1.6` (:166). A vírgula no
-- COMMENT é o detalhe que faz qualquer busca por `1.6` perder uma das cópias.
--
-- Agora ele sai de `vw_crivo_vigente`, que é o mesmo número que a tela de
-- avaliação usa. Uma fonte, e `o-empate-e-um-so` passa a ter o que vigiar de
-- verdade.
--
-- ── O número MUDA, e isso é o objetivo ───────────────────────────────────
--
-- 1,6 → **1,56**. O empate foi calculado com o Simples a 9%; a alíquota foi
-- remedida em `20261008i` e o que se paga é 6,9359%. O alerta fica levemente
-- mais exigente (menos anúncios acusados), e corretamente: 1,6 estava cobrando
-- de anúncio que já se pagava.
--
-- ── O QUE NÃO É DERIVADO, e por quê ──────────────────────────────────────
--
-- `vd_ant >= 6` fica como está, hardcoded, e o comentário ao lado diz por quê.
-- Ele PARECE o nível de validação do crivo antigo (que era 6 vendas), e por isso
-- o plano o chamou de órfão — mas ele responde outra pergunta: "este anúncio
-- vendia o suficiente ANTES para a queda significar algo?". É piso de AMOSTRA,
-- não régua de aprovação. Derivá-lo do crivo o levaria de 6 para 5 e mexeria na
-- sensibilidade de um alerta que está calibrado contra parede âmbar (6 em 102) —
-- mudança que não pertence a este trabalho.
--
-- Dois números iguais por coincidência não são a primeira armadilha. A armadilha
-- é dois campos respondendo a MESMA pergunta. Aqui é o contrário: documentar que
-- eles são diferentes é o que impede alguém de "unificá-los" amanhã.
--
-- `inv_7 >= 100` também fica: é piso de verba de uma janela de 7 dias, e o
-- `verba_min` do crivo (R$ 80) é de vida inteira. Perguntas diferentes.
--
-- ── A lista de colunas é IDÊNTICA ────────────────────────────────────────
--
-- `MetaAdsPage.tsx:597` seleciona as 13 colunas pelo nome, e
-- `vw_criativo_virou_contra` (20261009d) depende de `gasto_agora`, `roas_agora`,
-- `roas_antes`, `queda_pct` e `producao_id`. `create or replace view` não aceita
-- renomear nem reordenar — e se aceitasse, o PostgREST recusaria a consulta
-- inteira e as duas telas ficariam em branco.

begin;

create or replace view public.vw_ad_morrendo
  with (security_invoker = on) as
 WITH crivo AS (
         SELECT vw_crivo_vigente.empate
           FROM vw_crivo_vigente
        ), midia AS (
         SELECT m.ad_id,
            sum(m.investimento) FILTER (WHERE m.data >= (CURRENT_DATE - 7)) AS inv_7,
            sum(m.investimento) FILTER (WHERE m.data >= (CURRENT_DATE - 14) AND m.data < (CURRENT_DATE - 7)) AS inv_ant
           FROM metricas_meta m
          WHERE m.nivel = 'ad'::nivel_meta AND m.data >= (CURRENT_DATE - 14)
          GROUP BY m.ad_id
        ), receita AS (
         SELECT v.ad_id_meta AS ad_id,
            count(*) FILTER (WHERE v.data_venda >= (CURRENT_DATE - 7)) AS vd_7,
            sum(v.valor_sem_juros) FILTER (WHERE v.data_venda >= (CURRENT_DATE - 7)) AS rec_7,
            count(*) FILTER (WHERE v.data_venda >= (CURRENT_DATE - 14) AND v.data_venda < (CURRENT_DATE - 7)) AS vd_ant,
            sum(v.valor_sem_juros) FILTER (WHERE v.data_venda >= (CURRENT_DATE - 14) AND v.data_venda < (CURRENT_DATE - 7)) AS rec_ant
           FROM vendas v
          WHERE v.ad_id_meta IS NOT NULL AND v.status = 'aprovada'::status_venda AND v.data_venda >= (CURRENT_DATE - 14)
          GROUP BY v.ad_id_meta
        ), calc AS (
         SELECT mi.ad_id,
            o.nome,
            o.ad_account_id,
            c.nome AS conta,
            oe.empresa_id,
            pa.producao_id,
            mi.inv_7,
            mi.inv_ant,
            COALESCE(r.vd_7, 0::bigint) AS vd_7,
            COALESCE(r.vd_ant, 0::bigint) AS vd_ant,
            COALESCE(r.rec_7, 0::numeric) / NULLIF(mi.inv_7, 0::numeric) AS roas_7,
            COALESCE(r.rec_ant, 0::numeric) / NULLIF(mi.inv_ant, 0::numeric) AS roas_ant
           FROM midia mi
             LEFT JOIN receita r ON r.ad_id = mi.ad_id
             LEFT JOIN meta_objetos o ON o.objeto_id = mi.ad_id AND o.nivel = 'ad'::nivel_meta
             LEFT JOIN ad_accounts c ON c.id = o.ad_account_id
             LEFT JOIN ofertas_editores oe ON oe.id = c.projeto_id
             LEFT JOIN producao_ads pa ON pa.ad_id = mi.ad_id
          WHERE mi.inv_7 > 0::numeric
        )
 SELECT calc.ad_id,
    calc.nome,
    calc.ad_account_id,
    calc.conta,
    calc.empresa_id,
    calc.producao_id,
    round(calc.inv_ant, 2) AS gasto_antes,
    calc.vd_ant AS vendas_antes,
    round(calc.roas_ant, 2) AS roas_antes,
    round(calc.inv_7, 2) AS gasto_agora,
    calc.vd_7 AS vendas_agora,
    round(calc.roas_7, 2) AS roas_agora,
    round(100::numeric * (calc.roas_7 - calc.roas_ant) / NULLIF(calc.roas_ant, 0::numeric), 0)::integer AS queda_pct
   FROM calc
   CROSS JOIN crivo cr
  WHERE calc.inv_7 >= 100::numeric
    AND calc.inv_7 >= (0.40 * calc.inv_ant)
    -- Piso de AMOSTRA, não nível de validação. Ver o cabeçalho: parece o 6 do
    -- crivo antigo e responde outra pergunta ("vendia o bastante antes para a
    -- queda significar algo?"). Derivá-lo mexeria na calibração do alerta.
    AND calc.vd_ant >= 6
    -- O EMPATE, agora de uma fonte só.
    AND calc.roas_7 < cr.empate
    AND calc.roas_7 <= (0.70 * calc.roas_ant);

comment on view public.vw_ad_morrendo is
  'Anúncio que deixou de se pagar: últimos 7 dias contra os 7 anteriores, com '
  'ROAS abaixo do empate E caindo a 70% ou menos do que era. O empate vem de '
  'vw_crivo_vigente (hoje 1,56, remedido com o Simples em 6,9359%) e não está '
  'mais escrito aqui. `vd_ant >= 6` é piso de AMOSTRA e não nível de validação — '
  'não unificar com o crivo. `inv_7 >= 100` é piso de 7 dias, diferente do '
  'verba_min de vida inteira do crivo.';

commit;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_def   text;
  v_cols  text;
  v_n     integer;
  v_inv   boolean;
begin
  v_def := pg_get_viewdef('public.vw_ad_morrendo'::regclass, true);

  -- 1. O empate não está mais escrito aqui. A busca cobre as duas notações, que
  --    é como uma das quatro cópias antigas escapava.
  if v_def ~ 'roas_7\s*<\s*[0-9]' then
    v_erros := v_erros || 'o empate voltou a ser numero literal no WHERE. ';
  end if;
  if v_def like '%1,6%' or v_def like '%1.6%' then
    v_erros := v_erros || 'apareceu 1,6 ou 1.6 na definicao da view. ';
  end if;

  -- 2. E vem da tabela.
  if v_def not like '%vw_crivo_vigente%' then
    v_erros := v_erros || 'a view nao le o empate de vw_crivo_vigente. ';
  end if;

  -- 3. `security_invoker` sobreviveu ao replace — o defeito de 04/10/2026.
  select exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'vw_ad_morrendo'
       and c.reloptions @> array['security_invoker=on']
  ) into v_inv;
  if not v_inv then
    v_erros := v_erros || 'vw_ad_morrendo perdeu o security_invoker. ';
  end if;

  -- 4. As 13 colunas, com os mesmos nomes e na mesma ordem. MetaAdsPage as
  --    seleciona por nome; mudar uma derruba a tela.
  select string_agg(a.attname, ',' order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = 'public.vw_ad_morrendo'::regclass and a.attnum > 0 and not a.attisdropped;
  if v_cols <> 'ad_id,nome,ad_account_id,conta,empresa_id,producao_id,gasto_antes,'
               || 'vendas_antes,roas_antes,gasto_agora,vendas_agora,roas_agora,queda_pct' then
    v_erros := v_erros || format('a lista de colunas mudou: %s. ', v_cols);
  end if;

  -- 5. O piso de amostra continua sendo 6, de propósito.
  if v_def !~ 'vd_ant\s*>=\s*6' then
    v_erros := v_erros || 'o piso de amostra vd_ant >= 6 saiu ou mudou. ';
  end if;

  -- 6. A view executa, e todo anuncio acusado esta de fato abaixo do empate em
  --    vigor. Antes esta prova comparava com 1.6 escrito a mao; agora ela le a
  --    mesma fonte que a view, que e o ponto da migracao.
  select count(*) into v_n
    from public.vw_ad_morrendo m, public.vw_crivo_vigente c
   where m.roas_agora >= c.empate;
  if v_n <> 0 then
    v_erros := v_erros || format('%s anuncio(s) acusados com ROAS acima do empate. ', v_n);
  end if;

  -- 7. E `vw_criativo_virou_contra`, que depende desta view, continua de pe.
  begin
    select count(*) into v_n from public.vw_criativo_virou_contra;
  exception when others then
    v_erros := v_erros || format('vw_criativo_virou_contra quebrou: %s. ', sqlerrm);
  end;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  select count(*) into v_n from public.vw_ad_morrendo;
  raise notice 'PROVA OK: o empate sai de vw_crivo_vigente (1,56), as 13 colunas intactas, vd_ant >= 6 preservado como piso de amostra, e % anuncio(s) morrendo agora.', v_n;
end $prova$;

notify pgrst, 'reload schema';
