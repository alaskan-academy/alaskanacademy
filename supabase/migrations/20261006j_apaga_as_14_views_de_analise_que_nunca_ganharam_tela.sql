-- Apaga as 14 views de analise que nunca ganharam tela
-- ============================================================================
--
-- A varredura do faturamento de hoje esbarrou em tres views sem nenhum
-- consumidor. Procurando direito, eram DEZENOVE: views que existem no banco e
-- que nenhum codigo, nenhuma outra view, nenhuma funcao, nenhuma politica de
-- RLS e nenhum job do cron le.
--
-- Duas delas alimentavam telas que foram REMOVIDAS: `/clientes` e `/funil`
-- hoje sao `<Navigate>` para `/vendas` e `/meta-ads`. As paginas sairam e as
-- views ficaram.
--
-- -- O que fica, e por que nao e tudo ----------------------------------------
--
-- Das 19, CINCO nao sao analise morta: sao diagnosticos que apontam trabalho
-- pendente, e sao o unico lugar que sabe desse trabalho. Medido em 06/10/2026:
--
--   vw_criativo_sem_veiculacao   77 criativos cadastrados que nunca rodaram
--   vw_producoes_duplicadas      69 producoes duplicadas
--   vw_ofertas_faltando           6 ofertas vendidas e nao cadastradas
--   vw_origens_a_classificar      2 utm_source sem classificacao
--   vw_regras_orfas               0 (limpo)
--
-- Apagar essas seria apagar o alarme junto com o problema — a segunda
-- armadilha ao contrario. Ficam, e a decisao delas e virar tela de saude ou
-- nao, que e outra conversa. Esta migracao nao as toca.
--
-- -- As 14 que saem -----------------------------------------------------------
--
--   vw_assinaturas_resumo            102 linhas
--   vw_churn_mensal                    0
--   vw_clientes_listagem          13.253   (alimentava /clientes, removida)
--   vw_cohort_retencao                 4
--   vw_comparativo_periodos          285
--   vw_conversao_obs                  21
--   vw_conversao_upsell                7
--   vw_frequencia_clientes        13.253   (alimentava /clientes, removida)
--   vw_funil                         353   (alimentava /funil, removida)
--   vw_ltv_por_segmento               41
--   vw_vendas_por_campanha            99
--   vw_vendas_por_placement           28
--   vw_vendas_por_produto_principal    8
--   vw_vendas_por_utm              1.525
--
-- -- Como desfazer -------------------------------------------------------------
--
-- A definicao de cada uma e capturada do CATALOGO para `views_apagadas` ANTES
-- do drop. Nao e transcricao minha: e `pg_get_viewdef` do proprio Postgres, o
-- que tira do caminho o risco de eu errar justamente o desfazer. Para trazer
-- uma de volta:
--
--     select definicao from views_apagadas where nome = 'vw_funil';
--
-- e executar o que sair.
--
-- -- Por que RESTRICT e nao CASCADE ---------------------------------------------
--
-- CASCADE apagaria em silencio tudo que dependesse delas. RESTRICT faz o
-- Postgres RECUSAR o drop se alguem depender — e a segunda rede, depois da
-- minha analise. Se a analise estiver errada, a migracao para em vez de levar
-- junto o que nao devia.
--
-- O que a analise NAO alcanca: consumidor fora do repositorio (um painel de
-- BI, uma planilha conectada, um bookmark no editor de SQL). E o motivo de a
-- definicao ficar guardada em vez de so apagada.

-- ── Onde o desfazer mora ────────────────────────────────────────────────────
create table if not exists public.views_apagadas (
  nome        text primary key,
  definicao   text        not null,
  motivo      text,
  apagada_em  timestamptz not null default now()
);

comment on table public.views_apagadas is
  'A definicao de views apagadas por falta de uso, capturada do catalogo antes '
  'do DROP. Serve para trazer de volta sem arqueologia: `select definicao from '
  'views_apagadas where nome = ...` e executar. Ver 20261006j.';

alter table public.views_apagadas enable row level security;

drop policy if exists views_apagadas_rw on public.views_apagadas;
create policy views_apagadas_rw on public.views_apagadas
  for all to authenticated using (true) with check (true);

-- ── Captura e drop ──────────────────────────────────────────────────────────
DO $mig$
DECLARE
  alvos constant text[] := ARRAY[
    'vw_assinaturas_resumo', 'vw_churn_mensal', 'vw_clientes_listagem',
    'vw_cohort_retencao', 'vw_comparativo_periodos', 'vw_conversao_obs',
    'vw_conversao_upsell', 'vw_frequencia_clientes', 'vw_funil',
    'vw_ltv_por_segmento', 'vw_vendas_por_campanha', 'vw_vendas_por_placement',
    'vw_vendas_por_produto_principal', 'vw_vendas_por_utm'
  ];
  v_existem int;
  v_salvas  int;
  -- `v_nome`, e nao `nome`: a coluna da tabela se chama `nome`, e o PL/pgSQL
  -- recusa a consulta inteira por ambiguidade em vez de escolher um dos dois.
  v_nome    text;
BEGIN
  SELECT count(*) INTO v_existem
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('v','m') AND c.relname = ANY(alvos);

  -- Ja aplicada? entao as 14 sumiram e o desfazer esta guardado.
  IF v_existem = 0 THEN
    SELECT count(*) INTO v_salvas
      FROM views_apagadas va WHERE va.nome = ANY(alvos);
    IF v_salvas <> array_length(alvos, 1) THEN
      RAISE EXCEPTION 'as views sumiram mas so % de % definicoes estao guardadas',
                      v_salvas, array_length(alvos, 1);
    END IF;
    RETURN;
  END IF;

  IF v_existem <> array_length(alvos, 1) THEN
    RAISE EXCEPTION 'esperava % views para apagar, achei % -- a lista nao bate com o banco',
                    array_length(alvos, 1), v_existem;
  END IF;

  -- 1. Guarda a definicao, direto do catalogo.
  INSERT INTO public.views_apagadas (nome, definicao, motivo)
  SELECT c.relname,
         'create or replace view public.' || c.relname ||
         CASE WHEN array_to_string(c.reloptions, ',') LIKE '%security_invoker=on%'
              THEN E'\n  with (security_invoker = on) as\n' ELSE E' as\n' END ||
         rtrim(btrim(pg_get_viewdef(c.oid, true)), ';') || ';',
         'orfa em 06/10/2026: zero referencias em src/, em outra view, funcao, '
         'politica de RLS ou job do cron. Ver 20261006j.'
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('v','m') AND c.relname = ANY(alvos)
  ON CONFLICT (nome) DO NOTHING;

  SELECT count(*) INTO v_salvas
    FROM views_apagadas va WHERE va.nome = ANY(alvos);
  IF v_salvas <> array_length(alvos, 1) THEN
    RAISE EXCEPTION 'guardei % de % definicoes -- nao apago sem o desfazer completo',
                    v_salvas, array_length(alvos, 1);
  END IF;

  -- 2. So entao apaga. RESTRICT: se alguem depender, para aqui.
  FOREACH v_nome IN ARRAY alvos LOOP
    EXECUTE format('drop view public.%I restrict', v_nome);
  END LOOP;
END
$mig$;

-- ── As provas ───────────────────────────────────────────────────────────────
DO $prova$
DECLARE
  v_sobrou   int;
  v_guardado int;
  v_faltam   text[];
  v_quebrada text;
BEGIN
  -- 1. As 14 sumiram.
  SELECT count(*) INTO v_sobrou
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('v','m')
    AND c.relname IN ('vw_assinaturas_resumo','vw_churn_mensal','vw_clientes_listagem',
                      'vw_cohort_retencao','vw_comparativo_periodos','vw_conversao_obs',
                      'vw_conversao_upsell','vw_frequencia_clientes','vw_funil',
                      'vw_ltv_por_segmento','vw_vendas_por_campanha','vw_vendas_por_placement',
                      'vw_vendas_por_produto_principal','vw_vendas_por_utm');
  IF v_sobrou <> 0 THEN
    RAISE EXCEPTION '% view(s) que deviam ter sumido continuam la', v_sobrou;
  END IF;

  -- 2. E o desfazer de cada uma esta guardado e nao esta vazio.
  SELECT count(*) INTO v_guardado
  FROM views_apagadas WHERE length(btrim(definicao)) > 60;
  IF v_guardado < 14 THEN
    RAISE EXCEPTION 'so % definicoes guardadas com conteudo -- o desfazer esta furado', v_guardado;
  END IF;

  -- 3. Os CINCO diagnosticos continuam de pe. Esta e a prova que impede a
  --    migracao de ter levado junto o que aponta trabalho pendente.
  SELECT coalesce(array_agg(d ORDER BY d), '{}') INTO v_faltam
  FROM unnest(ARRAY['vw_criativo_sem_veiculacao','vw_producoes_duplicadas',
                    'vw_ofertas_faltando','vw_origens_a_classificar','vw_regras_orfas']) d
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v','m') AND c.relname = d
  );
  IF v_faltam <> '{}'::text[] THEN
    RAISE EXCEPTION 'diagnostico(s) apagados por engano: %', v_faltam;
  END IF;

  -- 4. NENHUMA view ou funcao do schema ficou quebrada. RESTRICT ja teria
  --    barrado uma dependencia direta, mas uma funcao que cita o nome em SQL
  --    dinamico passa por ele — entao vale olhar todas de novo.
  SELECT string_agg(c.relname, ', ') INTO v_quebrada
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('v','m')
    AND pg_get_viewdef(c.oid, true) ~ '\mvw_(clientes_listagem|frequencia_clientes|funil|churn_mensal|cohort_retencao|ltv_por_segmento|assinaturas_resumo|comparativo_periodos|conversao_obs|conversao_upsell|vendas_por_campanha|vendas_por_placement|vendas_por_produto_principal|vendas_por_utm)\M';
  IF v_quebrada IS NOT NULL THEN
    RAISE EXCEPTION 'view(s) ainda citando uma apagada: %', v_quebrada;
  END IF;

  RAISE NOTICE '14 views apagadas, definicoes guardadas em views_apagadas, 5 diagnosticos de pe';
END
$prova$;
