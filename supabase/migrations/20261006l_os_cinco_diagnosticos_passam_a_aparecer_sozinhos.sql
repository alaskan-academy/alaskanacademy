-- Os cinco diagnosticos passam a aparecer sozinhos
-- ============================================================================
--
-- Existem cinco views que acusam trabalho pendente de cadastro, e as cinco
-- vivem no editor de SQL: so aparecem para quem abre o banco e lembra do nome.
-- Medido em 06/10/2026:
--
--   vw_criativo_sem_veiculacao   77 criativos cadastrados que nunca rodaram
--   vw_producoes_duplicadas      69 producoes duplicadas
--   vw_ofertas_faltando           6 ofertas vendidas e nao cadastradas
--   vw_origens_a_classificar      2 utm_source sem classificacao
--   vw_regras_orfas               0 (limpo)
--
-- Sao 154 itens que ninguem ve. E a segunda armadilha do CLAUDE.md inteira:
-- a tela de cadastro existe, a de resultado nao, e sem resultado ninguem
-- volta. So que aqui a de resultado EXISTE — ela e que nao tem porta.
--
-- -- Por que vira alerta, e nao tela nova -------------------------------------
--
-- Uma tela de saude seria um sexto lugar para lembrar de abrir. O painel ja
-- tem o mecanismo certo: `vw_alertas` e uma cadeia de `fn_alerta_*()`, e o que
-- sai dela aparece sozinho no Inicio (`SaudeSistema`) e na faixa do topo
-- (`IngestStatusBanner`). Entrar por ali e ganhar a porta sem construir sala.
--
-- -- Uma linha so, e nao cinco -------------------------------------------------
--
-- A 20261004 (aviso de tendencia) deixou escrito o motivo: "Aviso que aparece
-- sempre e aviso que ninguem le". Cinco linhas permanentes afogariam os dois
-- alertas de verdade que hoje aparecem. Entao e UMA linha, com o total no
-- titulo e a quebra no detalhe — o numero no titulo e o que deixa ver se esta
-- encolhendo.
--
-- A tensao continua de pe e vale dizer em voz alta: isto VAI aparecer todo dia
-- enquanto houver pendencia, porque pendencia e o que ele mede. Some sozinho
-- quando as cinco zerarem, e e esse o desenho — um aviso que so sai quando o
-- trabalho acaba.
--
-- Severidade `atencao`, nunca `critico`: nada aqui esta quebrado, esta
-- atrasado. O vermelho fica para o que perde dinheiro agora.

create or replace function public.fn_alerta_cadastro_a_arrumar()
returns table(codigo text, severidade text, titulo text, detalhe text)
language sql
stable
as $function$
  with achados(o_que, n) as (
    select 'criativo sem veiculação',            (select count(*) from public.vw_criativo_sem_veiculacao)
    union all
    select 'produção duplicada',                 (select count(*) from public.vw_producoes_duplicadas)
    union all
    select 'oferta vendida e não cadastrada',    (select count(*) from public.vw_ofertas_faltando)
    union all
    select 'origem de UTM sem classificar',      (select count(*) from public.vw_origens_a_classificar)
    union all
    select 'regra de categoria órfã',            (select count(*) from public.vw_regras_orfas)
  ),
  /* So o que tem pendencia entra no detalhe: listar "0 regras orfas" ensinaria
     a pessoa a ignorar a linha. */
  pendentes as (select o_que, n from achados where n > 0)
  select
    'cadastro_a_arrumar'::text,
    'atencao'::text,
    sum(n)::text || ' ' ||
      case when sum(n) = 1 then 'item de cadastro esperando arrumação'
           else 'itens de cadastro esperando arrumação' end,
    string_agg(n || ' ' || o_que, ' · ' order by n desc)
  from pendentes
  having sum(n) > 0;
$function$;

comment on function public.fn_alerta_cadastro_a_arrumar() is
  'Junta as cinco views de diagnostico de cadastro numa linha de alerta. Elas '
  'existiam e so apareciam para quem abrisse o editor de SQL. Uma linha e nao '
  'cinco para nao afogar os alertas de verdade. Ver 20261006l.';

-- ── Emenda em vw_alertas, preservando o invoker ─────────────────────────────
DO $mig$
DECLARE
  v_def text;
BEGIN
  v_def := rtrim(btrim(pg_get_viewdef('vw_alertas'::regclass, true)), ';');

  -- Ja aplicada?
  IF position('fn_alerta_cadastro_a_arrumar' IN v_def) > 0 THEN RETURN; END IF;

  /*
    `with (security_invoker = on)` ESCRITO na instrucao: CREATE OR REPLACE VIEW
    redefine as reloptions, e omitir apaga. Foi assim que esta mesma view
    perdeu o invoker em 04/10.
  */
  EXECUTE 'create or replace view public.vw_alertas with (security_invoker = on) as '
          || v_def || E'\nUNION ALL\n'
          || ' SELECT x.codigo, x.severidade, x.titulo, x.detalhe'
          || E'\n   FROM fn_alerta_cadastro_a_arrumar() x(codigo, severidade, titulo, detalhe)';
END
$mig$;

-- A area: ele atravessa Criativos, Producao, Ofertas, UTM e Financeiro, entao
-- nao e de nenhuma delas. Inicio e o lugar de quem e de todas.
insert into public.alertas_area (codigo, area)
values ('cadastro_a_arrumar', 'inicio')
on conflict (codigo) do update set area = excluded.area;

-- ── As provas ───────────────────────────────────────────────────────────────
DO $prova$
DECLARE
  v_n        int;
  v_titulo   text;
  v_detalhe  text;
  v_total    int;
  v_invoker  text;
BEGIN
  -- 1. O invoker sobreviveu ao replace da vw_alertas.
  SELECT array_to_string(c.reloptions, ',') INTO v_invoker
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'vw_alertas';
  IF coalesce(v_invoker, '') NOT LIKE '%security_invoker=on%' THEN
    RAISE EXCEPTION 'vw_alertas perdeu o security_invoker (reloptions: %)',
                    coalesce(v_invoker, '(nenhuma)');
  END IF;

  -- 2. O alerta sai, e sai pela view (nao so pela funcao solta).
  SELECT count(*) INTO v_n FROM vw_alertas WHERE codigo = 'cadastro_a_arrumar';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'vw_alertas devolveu % linha(s) de cadastro_a_arrumar, esperava 1', v_n;
  END IF;

  -- 3. O numero do titulo e a SOMA real das cinco. Derivado, nao cravado:
  --    continua valendo quando as pendencias mudarem.
  SELECT titulo, detalhe INTO v_titulo, v_detalhe
  FROM vw_alertas WHERE codigo = 'cadastro_a_arrumar';

  SELECT (select count(*) from vw_criativo_sem_veiculacao)
       + (select count(*) from vw_producoes_duplicadas)
       + (select count(*) from vw_ofertas_faltando)
       + (select count(*) from vw_origens_a_classificar)
       + (select count(*) from vw_regras_orfas)
    INTO v_total;

  IF v_titulo NOT LIKE v_total::text || ' %' THEN
    RAISE EXCEPTION 'o titulo diz "%" e a soma das cinco da %', v_titulo, v_total;
  END IF;

  -- 4. A quebra nao lista o que esta zerado.
  IF (select count(*) from vw_regras_orfas) = 0 AND v_detalhe LIKE '%regra de categoria órfã%' THEN
    RAISE EXCEPTION 'o detalhe lista uma pendencia zerada: %', v_detalhe;
  END IF;

  -- 5. Chega na tela: `vw_alertas_por_area` e o que o banner le, e o codigo
  --    novo tem de ter area — sem o mapeamento ele cairia no default e
  --    ninguem notaria a diferenca ate alguem procurar.
  SELECT area INTO v_titulo FROM vw_alertas_por_area WHERE codigo = 'cadastro_a_arrumar';
  IF v_titulo IS DISTINCT FROM 'inicio' THEN
    RAISE EXCEPTION 'cadastro_a_arrumar caiu na area %, esperava inicio', v_titulo;
  END IF;

  RAISE NOTICE 'alerta de cadastro ligado: % itens — %', v_total, v_detalhe;
END
$prova$;
