-- `vw_alertas` por extenso, para a catraca voltar a enxergar
-- ============================================================================
--
-- A 20261006l emendou o ramo novo na view assim:
--
--     EXECUTE 'create or replace view public.vw_alertas ... as '
--             || pg_get_viewdef(...) || ' UNION ALL ' || <ramo novo>;
--
-- Funciona no banco e e CEGO no arquivo. O teste
-- `rastreio-que-regride-acusa.test.ts` quebrou na hora, e estava certo: ele
-- procura a ultima migracao que define `vw_alertas` e exige ver o ramo do
-- alerta la dentro. Com a definicao montada em tempo de execucao, o arquivo
-- nao mostra ramo nenhum — nem o novo, nem os quinze que ja existiam.
--
-- E a mesma familia do que o CLAUDE.md descreve em "Migracao sem arquivo passa
-- por fora de TODA catraca": nao basta o banco ficar certo, o ARQUIVO precisa
-- dizer o que ficou. Uma migracao que se escreve sozinha e tao invisivel para
-- os testes quanto uma que nunca foi escrita.
--
-- Entao aqui a view vai por extenso, os dezesseis ramos a vista. E verboso de
-- proposito: e o que permite ler a lista de alertas sem abrir o banco, e e o
-- que o teste le.
--
-- Nada muda de comportamento: o texto abaixo e exatamente o que a 20261006l
-- deixou no banco, so que escrito em vez de computado.
--
-- `with (security_invoker = on)` na propria instrucao, como sempre: CREATE OR
-- REPLACE VIEW redefine as reloptions e omitir apaga.

create or replace view public.vw_alertas
with (security_invoker = on) as
 SELECT 'fonte_parada'::text AS codigo,
        CASE
            WHEN h.horas_atras > (h.limiar_horas * 4::numeric) THEN 'critico'::text
            ELSE 'atencao'::text
        END AS severidade,
    h.rotulo || ' sem atualizar'::text AS titulo,
    COALESCE(h.detalhe, 'Última entrada há '::text ||
        CASE
            WHEN h.horas_atras < 48::numeric THEN round(h.horas_atras)::text || 'h'::text
            ELSE round(h.horas_atras / 24::numeric)::text || ' dias'::text
        END) AS detalhe
   FROM vw_ingest_health h
  WHERE h.defasado
UNION ALL
 SELECT 'conta_sem_produto'::text AS codigo,
    'critico'::text AS severidade,
    count(*)::text || ' conta(s) de anúncio gastando sem produto definido'::text AS titulo,
    (fn_brl(sum(x.gasto)) || ' nos últimos 7 dias não entram no cálculo: '::text) || string_agg(x.nome, ', '::text) AS detalhe
   FROM ( SELECT a.nome,
            sum(m.investimento) AS gasto
           FROM metricas_meta m
             JOIN ad_accounts a ON a.id = m.ad_account_id
          WHERE m.nivel = 'campanha'::nivel_meta AND m.data >= ((now() AT TIME ZONE 'America/Sao_Paulo'::text)::date - 7) AND a.produto IS NULL
          GROUP BY a.nome
         HAVING sum(m.investimento) > 0::numeric) x
 HAVING count(*) > 0
UNION ALL
 SELECT 'receita_sem_rastreio'::text AS codigo,
        CASE
            WHEN y.pct > 40::numeric THEN 'critico'::text
            ELSE 'atencao'::text
        END AS severidade,
    round(y.pct)::text || '% da receita de origem desconhecida'::text AS titulo,
    fn_brl(y.valor) || ' nos últimos 7 dias não vieram de anúncio rastreado nem de origem já identificada'::text AS detalhe
   FROM ( SELECT 100.0 * sum(vendas.valor_sem_juros) FILTER (WHERE vendas.ad_id_meta IS NULL AND vendas.trafego_pago IS NOT TRUE) / NULLIF(sum(vendas.valor_sem_juros), 0::numeric) AS pct,
            sum(vendas.valor_sem_juros) FILTER (WHERE vendas.ad_id_meta IS NULL AND vendas.trafego_pago IS NOT TRUE) AS valor
           FROM vendas
          WHERE vendas.status = 'aprovada'::status_venda AND vendas.is_upsell IS NOT TRUE AND (vendas.data_venda AT TIME ZONE 'America/Sao_Paulo'::text)::date >= ((now() AT TIME ZONE 'America/Sao_Paulo'::text)::date - 7)) y
  WHERE y.pct > 25::numeric
UNION ALL
 SELECT 'meta_divergente'::text AS codigo,
    'critico'::text AS severidade,
    'Meta reporta mais conversões do que houve vendas'::text AS titulo,
    ((('Meta: '::text || z.meta::text) || ' conversões · Payt: '::text) || z.total::text) || ' vendas no total nos últimos 7 dias. Sinal de contagem duplicada.'::text AS detalhe
   FROM ( SELECT ( SELECT COALESCE(sum(metricas_meta.compras_meta), 0::bigint) AS "coalesce"
                   FROM metricas_meta
                  WHERE metricas_meta.nivel = 'campanha'::nivel_meta AND metricas_meta.data >= ((now() AT TIME ZONE 'America/Sao_Paulo'::text)::date - 7)) AS meta,
            ( SELECT count(*) AS count
                   FROM vendas
                  WHERE vendas.status = 'aprovada'::status_venda AND (vendas.data_venda AT TIME ZONE 'America/Sao_Paulo'::text)::date >= ((now() AT TIME ZONE 'America/Sao_Paulo'::text)::date - 7)) AS total) z
  WHERE z.total > 0 AND (z.meta::numeric / z.total::numeric) > 1.5
UNION ALL
 SELECT fn_alerta_venda_sem_categoria.codigo,
    fn_alerta_venda_sem_categoria.severidade,
    fn_alerta_venda_sem_categoria.titulo,
    fn_alerta_venda_sem_categoria.detalhe
   FROM fn_alerta_venda_sem_categoria() fn_alerta_venda_sem_categoria(codigo, severidade, titulo, detalhe)
UNION ALL
 SELECT fn_alerta_webhook_pendente.codigo,
    fn_alerta_webhook_pendente.severidade,
    fn_alerta_webhook_pendente.titulo,
    fn_alerta_webhook_pendente.detalhe
   FROM fn_alerta_webhook_pendente() fn_alerta_webhook_pendente(codigo, severidade, titulo, detalhe)
UNION ALL
 SELECT 'venda_sem_liquido'::text AS codigo,
    'atencao'::text AS severidade,
    count(*)::text || ' venda(s) sem o líquido do produtor'::text AS titulo,
    fn_brl(sum(vendas.valor_sem_juros)) || ' nos últimos 7 dias: a Payt mandou a comissão zerada, então o valor a receber fica de fora das somas'::text AS detalhe
   FROM vendas
  WHERE vendas.status = 'aprovada'::status_venda AND vendas.valor_liquido_produtor IS NULL AND (vendas.data_venda AT TIME ZONE 'America/Sao_Paulo'::text)::date >= ((now() AT TIME ZONE 'America/Sao_Paulo'::text)::date - 7)
 HAVING count(*) > 0
UNION ALL
 SELECT 'venda_nao_normalizada'::text AS codigo,
    'critico'::text AS severidade,
    count(*)::text || ' venda(s) recebidas da Payt que não viraram registro'::text AS titulo,
    fn_brl(sum(p.valor)) || ' nos últimos 7 dias estão na camada bruta mas não em vendas'::text AS detalhe
   FROM vendas_payt p
  WHERE p.status = 'paid'::text AND p.data >= ((now() AT TIME ZONE 'America/Sao_Paulo'::text)::date - 7) AND NOT (EXISTS ( SELECT 1
           FROM vendas v
          WHERE v.pedido_id = p.payt_id))
 HAVING count(*) > 0
UNION ALL
 SELECT fn_alerta_conta_sem_venda.codigo,
    fn_alerta_conta_sem_venda.severidade,
    fn_alerta_conta_sem_venda.titulo,
    fn_alerta_conta_sem_venda.detalhe
   FROM fn_alerta_conta_sem_venda() fn_alerta_conta_sem_venda(codigo, severidade, titulo, detalhe)
UNION ALL
 SELECT fn_alerta_cron_falhando.codigo,
    fn_alerta_cron_falhando.severidade,
    fn_alerta_cron_falhando.titulo,
    fn_alerta_cron_falhando.detalhe
   FROM fn_alerta_cron_falhando() fn_alerta_cron_falhando(codigo, severidade, titulo, detalhe)
UNION ALL
 SELECT r.codigo,
    r.severidade,
    r.titulo,
    r.detalhe
   FROM fn_alerta_rastreio_regredindo() r(codigo, severidade, titulo, detalhe)
UNION ALL
 SELECT s.codigo,
    s.severidade,
    s.titulo,
    s.detalhe
   FROM fn_alerta_payt_silencio() s(codigo, severidade, titulo, detalhe)
UNION ALL
 SELECT t.codigo,
    t.severidade,
    t.titulo,
    t.detalhe
   FROM fn_alerta_trafego_sem_anuncio() t(codigo, severidade, titulo, detalhe)
UNION ALL
 SELECT c.codigo,
    c.severidade,
    c.titulo,
    c.detalhe
   FROM fn_alerta_checkout_sem_rastreio() c(codigo, severidade, titulo, detalhe)
UNION ALL
 SELECT x.codigo,
    x.severidade,
    x.titulo,
    x.detalhe
   FROM fn_alerta_venda_empresa_errada() x(codigo, severidade, titulo, detalhe)
UNION ALL
 SELECT x.codigo,
    x.severidade,
    x.titulo,
    x.detalhe
   FROM fn_alerta_conta_anuncio_invisivel() x(codigo, severidade, titulo, detalhe)
UNION ALL
 SELECT x.codigo,
    x.severidade,
    x.titulo,
    x.detalhe
   FROM fn_alerta_cadastro_a_arrumar() x(codigo, severidade, titulo, detalhe);

-- ── As provas ───────────────────────────────────────────────────────────────
DO $prova$
DECLARE
  v_invoker text;
  v_ramos   int;
  v_faltam  text[];
BEGIN
  -- 1. O invoker sobreviveu.
  SELECT array_to_string(c.reloptions, ',') INTO v_invoker
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'vw_alertas';
  IF coalesce(v_invoker, '') NOT LIKE '%security_invoker=on%' THEN
    RAISE EXCEPTION 'vw_alertas perdeu o security_invoker (reloptions: %)',
                    coalesce(v_invoker, '(nenhuma)');
  END IF;

  -- 2. DERIVADA: toda `fn_alerta_*` do schema esta ligada na view. E a regra
  --    que evita funcao de alerta existindo sem nunca aparecer — criar sem
  --    medir, a segunda armadilha. Se alguem escrever a proxima e esquecer de
  --    emendar, esta prova e que acusa.
  SELECT coalesce(array_agg(p.proname ORDER BY p.proname), '{}') INTO v_faltam
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE 'fn_alerta_%'
    AND position(p.proname || '()' IN pg_get_viewdef('vw_alertas'::regclass, true)) = 0;
  IF v_faltam <> '{}'::text[] THEN
    RAISE EXCEPTION 'funcao(oes) de alerta que ninguem chama: %', v_faltam;
  END IF;

  -- 3. A view continua devolvendo as quatro colunas, na ordem, e rodando.
  SELECT count(*) INTO v_ramos FROM vw_alertas;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_name = 'vw_alertas'
         AND column_name IN ('codigo','severidade','titulo','detalhe')) <> 4 THEN
    RAISE EXCEPTION 'vw_alertas perdeu uma das quatro colunas';
  END IF;

  RAISE NOTICE 'vw_alertas por extenso: % alerta(s) agora, 0 funcao solta', v_ramos;
END
$prova$;
