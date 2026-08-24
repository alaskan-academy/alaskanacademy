-- 2026-08-24 (parte 3) — o evento pago que se perde não pode emudecer sozinho
--
-- Em 24/08 um índice sendo criado em `vendas` travou as escritas por alguns
-- segundos. O gatilho de normalização estourou o `statement_timeout` e dois
-- eventos da Payt morreram na gravação — um deles um `paid` de R$ 87,12, que
-- ficou fora do caixa até ser reprocessado à mão.
--
-- O alerta existia e apontou o problema. O que ele não fazia era durar: a
-- checagem só olhava as últimas 48h, então um evento pago perdido sumia do
-- aviso em dois dias e continuava faltando no caixa, em silêncio. E tratava
-- tudo como crítico, então um Pix que expirou — que não move dinheiro nenhum —
-- pintava a tela de vermelho igual.
--
-- Aqui a checagem se separa em duas. O retry que evita a falha na origem está
-- na edge function `payt-webhook`, que não sobe por migration.

begin;

-- ---------------------------------------------------------------------------
-- 1. fn_alerta_webhook_pendente
-- ---------------------------------------------------------------------------
-- Segue o formato dos outros alertas que já viraram função — a view só chama.
create or replace function public.fn_alerta_webhook_pendente()
 returns table(codigo text, severidade text, titulo text, detalhe text)
 language sql
 stable
as $function$
  with pendente as (
    select r.payt_id, r.recebido_em, r.motivo,
           coalesce(r.body->'transaction'->>'payment_status', r.body->>'status') as estado,
           coalesce((r.body->'transaction'->>'total_price')::numeric / 100, 0) as valor,
           exists (select 1 from vendas v
                    where v.pedido_id = r.payt_id and v.status = 'aprovada') as ja_resolvido
      from payt_webhook_raw r
     where not r.processado
       and coalesce(r.motivo, '') <> 'pedido de teste'
       -- Dois minutos de folga: o evento que acabou de chegar ainda pode estar
       -- sendo gravado, e alertar sobre ele seria alarme de relógio.
       and r.recebido_em < now() - interval '2 minutes'
  ),
  perdido as (select * from pendente where estado = 'paid' and not ja_resolvido)
  -- Venda paga que nunca virou registro é dinheiro que ninguém viu: sem janela de
  -- tempo. Era isso que a janela de 48h escondia — passados dois dias o evento
  -- sumia do aviso e continuava faltando no caixa.
  select 'webhook_pago_perdido', 'critico',
         count(*)::text || ' venda(s) paga(s) que o webhook nunca gravou',
         fn_brl(sum(valor)) || ', a mais antiga de ' ||
         to_char(min(recebido_em) at time zone 'America/Sao_Paulo', 'DD/MM') ||
         '. Não estão no caixa até serem reprocessadas.'
    from perdido
  having count(*) > 0
  union all
  -- O resto — expirado, cancelado, tipo de evento desconhecido — não move dinheiro,
  -- então segue com janela curta para não virar aviso permanente.
  select 'webhook_nao_processado', 'atencao',
         count(*)::text || ' evento(s) da Payt recebidos e não virados venda',
         'Nas últimas 48h. Motivo mais comum: ' ||
         mode() within group (order by coalesce(motivo, 'sem motivo registrado'))
    from pendente
   where recebido_em >= now() - interval '48 hours'
     and not (estado = 'paid' and not ja_resolvido)
  having count(*) > 0;
$function$;

-- ---------------------------------------------------------------------------
-- 2. vw_alertas passa a chamar a função
-- ---------------------------------------------------------------------------
-- Única mudança: o ramo `webhook_nao_processado`, que era inline, virou a
-- chamada acima. O resto vai igual porque `create or replace view` exige o
-- corpo inteiro.
create or replace view vw_alertas as
 SELECT 'fonte_parada'::text AS codigo,
        CASE
            WHEN h.horas_atras > (h.limiar_horas * 4::numeric) THEN 'critico'::text
            ELSE 'atencao'::text
        END AS severidade,
    h.rotulo || ' sem atualizar'::text AS titulo,
    'Última entrada há '::text ||
        CASE
            WHEN h.horas_atras < 48::numeric THEN round(h.horas_atras)::text || 'h'::text
            ELSE round(h.horas_atras / 24::numeric)::text || ' dias'::text
        END AS detalhe
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
 SELECT fn_alerta_remendo_utm_resolvido.codigo,
    fn_alerta_remendo_utm_resolvido.severidade,
    fn_alerta_remendo_utm_resolvido.titulo,
    fn_alerta_remendo_utm_resolvido.detalhe
   FROM fn_alerta_remendo_utm_resolvido() fn_alerta_remendo_utm_resolvido(codigo, severidade, titulo, detalhe);

commit;
