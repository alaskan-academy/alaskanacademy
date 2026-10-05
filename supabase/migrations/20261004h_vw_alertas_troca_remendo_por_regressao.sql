/*
  Troca o ramo do alerta na `vw_alertas` e derruba a função antiga.

  Por que REESCREVER a view inteira em vez de `ALTER FUNCTION ... RENAME`:
  a view liga pelo OID, então o rename funcionaria — mas o APELIDO fica
  gravado como texto. A definição passaria a dizer
  `FROM fn_alerta_rastreio_regredindo() fn_alerta_remendo_utm_resolvido(...)`,
  e quem lesse a view e procurasse esse nome não acharia função nenhuma.
  É a primeira armadilha em forma de apelido: dois nomes para a mesma coisa.

  A ordem das quatro colunas é a mesma (codigo, severidade, titulo, detalhe),
  que é o que o `CREATE OR REPLACE VIEW` exige — coluna nova no meio devolve
  42P16, e isso já apareceu duas vezes neste projeto.

  O DROP é seguro aqui, ao contrário do que a regra de deploy costuma exigir:
  nenhum arquivo do front cita `remendo_utm_resolvido`. A lista de alertas é
  renderizada direto da view, sem mapa de código escrito à mão — conferido por
  grep em `src/` antes de apagar.

  ── O `security_invoker` aqui não é enfeite ───────────────────────────────

  `CREATE OR REPLACE VIEW` REDEFINE as reloptions: omitir a opção APAGA a que
  estava lá. A `20260925a` tinha ligado o invoker na `vw_alertas`, e a primeira
  versão desta migração — sem esta linha — derrubou. Por meia hora a view ficou
  rodando com os direitos do dono, legível por `anon`, cuja chave vai inlinada
  no bundle. É o incidente de 24/09/2026 de novo, pelo caminho oposto: lá a
  view nasceu sem a opção, aqui ela nasceu com e um replace a tirou.

  Declarar na própria instrução é o que faz a correção sobreviver ao próximo
  replace — `alter view ... set` numa migração à parte conserta uma vez e
  perde na seguinte.
*/
create or replace view public.vw_alertas
with (security_invoker = on)
as
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
   FROM fn_alerta_conta_anuncio_invisivel() x(codigo, severidade, titulo, detalhe);

drop function if exists public.fn_alerta_remendo_utm_resolvido();
