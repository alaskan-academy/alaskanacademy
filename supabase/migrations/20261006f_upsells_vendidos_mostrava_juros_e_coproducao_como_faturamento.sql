-- "Upsells vendidos" somava `valor_total` e chamava de faturamento
-- ============================================================================
--
-- `vw_rev_upsells_vendidos` alimenta o quadro de upsells da pagina de Funis
-- (`src/features/funis/components/ItensVendidos.tsx`, unico consumidor). Ela
-- soma `valor_total`, que e o que a CLIENTE DESEMBOLSOU — com juros de
-- parcelamento e com a fatia do coprodutor dentro.
--
-- Nenhum dos dois chega na conta da empresa:
--
--   juros_parcelamento   ficam com a adquirente. Saiu do faturamento no resto
--                        do painel em 05/09/2026 (20260905d), e esta view nao
--                        estava na varredura daquele dia.
--   valor_coproducao     a Payt repassa direto ao coprodutor (20261006a).
--
-- O defeito e PRE-EXISTENTE, e a maior parte dele e de juros. Foi achado em
-- 06/10/2026 por uma revisao adversarial das migracoes da coproducao: o
-- revisor apontou a coproducao, a refutacao mostrou que a causa dominante era
-- outra e mais antiga, e o numero continuou errado nos dois casos.
--
-- -- Medido em 06/10/2026, as 9 linhas da view -------------------------------
--
--   total mostrado   R$ 32.503,77
--   total correto    R$ 30.115,62   (7,93% inflado)
--   juros            R$  2.186,07   (a maior parte)
--   coproducao       R$    202,08
--
-- TODAS as nove linhas mudam. A pior e REV3 / velas: R$ 331,32 vira R$ 241,74,
-- 37% a mais do que entrou — uma venda so, parcelada e com coproducao.
--
-- `valor_medio` tinha o mesmo defeito e muda junto: media de um numero inflado
-- e um ticket medio inflado.
--
-- -- Duas coisas de forma -----------------------------------------------------
--
-- 1. O `with (security_invoker = on)` vai na PROPRIA instrucao. CREATE OR
--    REPLACE VIEW redefine as reloptions, e omitir a opcao a APAGA — foi assim
--    que `vw_alertas` e `vw_rev_tendencia` perderam o invoker em 04/10/2026 e
--    passaram a rodar com os direitos do dono. A view ja tinha a opcao; ela
--    continua aqui por escrito, nao por sorte.
--
-- 2. Entrou a exclusao de pedido de teste, que a view nao tinha e o resto do
--    painel tem. Hoje isso e INERTE: zero upsells aprovados casam com TEST% ou
--    LC-%. Entra porque a convencao existe e uma venda de teste amanha entraria
--    no quadro sem nada denunciando.

create or replace view public.vw_rev_upsells_vendidos
with (security_invoker = on) as
  select
    funil_id,
    coalesce(produto::text, 'sem nome'::text) as nome,
    count(*) as vendas,
    /* O que de fato entrou, nao o que a cliente desembolsou: sem os juros da
       adquirente e sem a fatia do coprodutor. Ver 20260905d e 20261006a. */
    round(avg(coalesce(valor_sem_juros, valor_total)
              - coalesce(valor_coproducao, 0)), 2)                  as valor_medio,
    sum(coalesce(valor_sem_juros, valor_total)
        - coalesce(valor_coproducao, 0))                            as faturamento,
    min(data_venda)::date as primeira,
    max(data_venda)::date as ultima
  from vendas
  where is_upsell
    and status = 'aprovada'::status_venda
    and funil_id is not null
    and pedido_id not like 'TEST%'
    and pedido_id not like 'LC-%'
  group by funil_id, (coalesce(produto::text, 'sem nome'::text));

-- -- As provas ---------------------------------------------------------------
DO $prova$
DECLARE
  v_invoker   text;
  v_divergem  int;
  v_inflava   numeric;
  v_sobrando  text[];
BEGIN
  -- 1. O invoker sobreviveu ao replace. Esta prova existe porque ja perdemos
  --    duas views assim, e o replace devolve sucesso quando apaga a opcao.
  SELECT array_to_string(c.reloptions, ',') INTO v_invoker
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'vw_rev_upsells_vendidos';
  IF coalesce(v_invoker, '') NOT LIKE '%security_invoker=on%' THEN
    RAISE EXCEPTION 'vw_rev_upsells_vendidos perdeu o security_invoker (reloptions: %)',
                    coalesce(v_invoker, '(nenhuma)');
  END IF;

  -- 2. COMPORTAMENTAL, linha a linha: o que a view devolve bate com a conta
  --    feita por fora dela. Sem numero cravado — compara duas fontes, entao
  --    continua valendo quando vender mais amanha.
  SELECT count(*) INTO v_divergem
  FROM vw_rev_upsells_vendidos x
  JOIN (
    SELECT funil_id, coalesce(produto::text, 'sem nome') AS nome,
           round(sum(coalesce(valor_sem_juros, valor_total)
                     - coalesce(valor_coproducao, 0)), 2) AS esperado
    FROM vendas
    WHERE is_upsell AND status = 'aprovada' AND funil_id IS NOT NULL
      AND pedido_id NOT LIKE 'TEST%' AND pedido_id NOT LIKE 'LC-%'
    GROUP BY 1, 2
  ) m ON m.funil_id = x.funil_id AND m.nome = x.nome
  WHERE round(x.faturamento, 2) <> m.esperado;
  IF v_divergem <> 0 THEN
    RAISE EXCEPTION '% linha(s) da view discordam da conta feita a mao', v_divergem;
  END IF;

  -- 3. A troca MOVEU algo. Sem isto, a prova 2 passaria verde num mundo sem
  --    juros nem coproducao, onde as duas contas coincidem.
  SELECT round(sum(coalesce(juros_parcelamento, 0) + coalesce(valor_coproducao, 0)), 2)
    INTO v_inflava
  FROM vendas
  WHERE is_upsell AND status = 'aprovada' AND funil_id IS NOT NULL
    AND pedido_id NOT LIKE 'TEST%' AND pedido_id NOT LIKE 'LC-%';
  IF coalesce(v_inflava, 0) <= 0 THEN
    RAISE EXCEPTION 'nenhum juro nem coproducao nos upsells: a prova 2 virou tautologia';
  END IF;

  -- 4. DERIVADA: quem mais ainda chama `sum(valor_total)` de faturamento.
  --    Sobram DOIS, de propósito, e estao nomeados. A prova falha nos dois
  --    sentidos: se alguem consertar um sem atualizar esta linha, e se o banco
  --    ganhar um terceiro. E a regra do CLAUDE.md para lista que vive no
  --    codigo — ela precisa quebrar quando o banco mudar.
  SELECT coalesce(array_agg(obj ORDER BY obj), '{}') INTO v_sobrando
  FROM (
    SELECT p.proname AS obj, regexp_split_to_table(pg_get_functiondef(p.oid), E'\n') AS linha
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
    UNION ALL
    SELECT c.relname, regexp_split_to_table(pg_get_viewdef(c.oid, true), E'\n')
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v','m')
  ) l
  WHERE linha ~* 'sum\s*\(\s*v?\.?valor_total\s*\)\s*AS\s+faturamento';

  IF v_sobrando <> ARRAY['fn_linha_de_base_do_projeto', 'vw_utm_links_desempenho'] THEN
    RAISE EXCEPTION 'mudou quem soma valor_total como faturamento: agora e %. '
                    'Esperava fn_linha_de_base_do_projeto e vw_utm_links_desempenho, '
                    'que ficaram de fora por decisao (ver o comentario da 20261006f).',
                    v_sobrando;
  END IF;

  RAISE NOTICE 'upsells vendidos: % de juros+coproducao sairam do faturamento', v_inflava;
END
$prova$;
