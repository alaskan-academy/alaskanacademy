-- A CAPI emudecer passa a gritar no painel
--
-- Em 14/10/2026 a UTMify saiu e a Conversions API nossa entrou. Desde então
-- a conversão que alimenta três conjuntos de anúncios depende de um caminho
-- que **ninguém observa**: se o token do Vault for revogado, se a Meta mudar
-- a resposta, se o `UPDATE` que marca o envio falhar, a campanha simplesmente
-- emagrece — e a primeira pessoa a notar seria ela, pelo CPA, dias depois.
--
-- A auditoria de 14/10 (99 agentes) formulou exatamente assim: "se a CAPI
-- parar amanhã, em quanto tempo e por qual tela alguém descobre? Se a
-- resposta for 'ninguém descobre', isso é gravidade alta." Era.
--
-- ===========================================================================
-- Por que aqui, e não numa tela nova
-- ===========================================================================
--
-- `vw_alertas` já existe, já tem 17 alertas, e já é lida pelo
-- `SaudeSistema` da página inicial — que renderiza qualquer `codigo` novo
-- sem mudar uma linha de front. Criar painel próprio para isto seria a
-- segunda armadilha: mais um lugar para não olhar.
--
-- ===========================================================================
-- Os três sinais, e por que cada um é preciso
-- ===========================================================================
--
-- 1. `capi_compra_nao_enviada` — venda PAGA com `meta_event_id` nulo e paga
--    há mais de 30 minutos. O envio é SÍNCRONO com o webhook, então essa
--    linha não deveria existir nunca: se existe, ou o envio falhou ou o
--    `UPDATE` que o marca falhou. É o sinal mais afiado que há, e quase não
--    dá falso positivo.
--
-- 2. `capi_envio_falhando` — tentativas que a Meta recusou. Desde o commit
--    de hoje a falha também grava `response_meta`, com `{"falha": …}`
--    dentro; antes dela o estado "quebrou" era byte a byte igual a
--    "desligado", e era por isso que não dava para alertar.
--
-- 3. `capi_desligada` — a chave geral `false` com venda paga no dia. Depois
--    da troca, desligada significa conversão perdida: é o estado em que um
--    rollback meu ficaria se eu esquecesse de religar.
--
-- A janela é de 24h e não de 7 dias de propósito: conversão perdida não se
-- recupera, então o alerta tem de aparecer no mesmo dia.
--
-- `security definer` porque `vw_alertas` roda com os direitos de quem lê
-- (`security_invoker=on`) e o schema `tracking` é fechado para
-- `authenticated`. A função devolve só contagens e motivos — nenhum dado
-- pessoal atravessa.

create or replace function public.fn_alerta_capi_muda()
returns table (codigo text, severidade text, titulo text, detalhe text)
language sql
stable
security definer
set search_path = public, tracking, pg_temp
as $$
  -- 1. venda paga que nao chegou a Meta
  select 'capi_compra_nao_enviada'::text,
         'critico'::text,
         count(*)::text || ' compra(s) paga(s) sem chegar ao Meta',
         'A Conversions API esta ligada e estas vendas continuam sem meta_event_id '
         || 'mais de 30 min depois de pagas — ' || fn_brl(coalesce(sum(p.valor), 0))
         || ' nas ultimas 24h. O envio e sincrono com o webhook, entao isto nao '
         || 'deveria existir: ou o POST para a Meta falhou, ou a marcacao falhou.'
    from tracking.purchases p
   where p.status = 'paid'
     and p.meta_event_id is null
     and coalesce(p.pago_em, p.criado_em) < now() - interval '30 minutes'
     and coalesce(p.pago_em, p.criado_em) > now() - interval '24 hours'
     and (select s.capi_ativa from tracking.settings s limit 1)
  having count(*) > 0

  union all

  -- 2. tentativas que a Meta recusou
  select 'capi_envio_falhando'::text,
         'critico'::text,
         count(*)::text || ' envio(s) recusado(s) pelo Meta',
         'Nas ultimas 24h, com o primeiro motivo sendo: '
         || coalesce(min(e.response_meta->>'falha'), 'sem motivo registrado')
         || '. Enquanto isso durar, o evento nao conta para a otimizacao.'
    from tracking.events_log e
   where e.criado_em > now() - interval '24 hours'
     and e.response_meta ? 'falha'
  having count(*) > 0

  union all

  -- 3. a chave geral desligada com venda acontecendo
  select 'capi_desligada'::text,
         'critico'::text,
         'A Conversions API esta DESLIGADA',
         'settings.capi_ativa = false e houve ' || count(*)::text
         || ' venda(s) paga(s) nas ultimas 24h. Desde a saida da UTMify em '
         || '14/10/2026 ninguem mais manda a compra para o Meta por nos — '
         || 'cada uma destas e conversao perdida, e perdida nao volta.'
    from tracking.purchases p
   where p.status = 'paid'
     and coalesce(p.pago_em, p.criado_em) > now() - interval '24 hours'
     and not (select s.capi_ativa from tracking.settings s limit 1)
  having count(*) > 0;
$$;

comment on function public.fn_alerta_capi_muda() is
  'Tres sinais de que a Conversions API do rastreamento parou: venda paga sem meta_event_id depois de 30 min (o envio e sincrono, entao isso nao deveria existir), envio recusado pelo Meta, e a chave geral desligada com venda acontecendo. Janela de 24h porque conversao perdida nao se recupera. security definer porque vw_alertas roda como quem le e o schema tracking e fechado; devolve so contagens.';

revoke all on function public.fn_alerta_capi_muda() from public, anon;
grant execute on function public.fn_alerta_capi_muda() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A view recebe o alerta novo
-- ---------------------------------------------------------------------------
--
-- `with (security_invoker = on)` escrito AQUI, na própria instrução, e não
-- numa migração à parte: `create or replace view` **redefine** as
-- reloptions, e omitir a opção APAGA a que estava lá. Foi assim que
-- `vw_alertas` e `vw_rev_tendencia` voltaram a rodar com os direitos do dono
-- em 04/10/2026, legíveis por `anon`, com faturamento dentro.

create or replace view public.vw_alertas
with (security_invoker = on) as
  select * from (
    select 'fonte_parada'::text as codigo,
           case when h.horas_atras > (h.limiar_horas * 4::numeric) then 'critico'::text
                else 'atencao'::text end as severidade,
           h.rotulo || ' sem atualizar'::text as titulo,
           coalesce(h.detalhe, 'Última entrada há '::text ||
             case when h.horas_atras < 48::numeric then round(h.horas_atras)::text || 'h'::text
                  else round(h.horas_atras / 24::numeric)::text || ' dias'::text end) as detalhe
      from vw_ingest_health h
     where h.defasado

    union all
    select 'conta_sem_produto'::text, 'critico'::text,
           count(*)::text || ' conta(s) de anúncio gastando sem produto definido'::text,
           (fn_brl(sum(x.gasto)) || ' nos últimos 7 dias não entram no cálculo: '::text) || string_agg(x.nome, ', '::text)
      from ( select a.nome, sum(m.investimento) as gasto
               from metricas_meta m
               join ad_accounts a on a.id = m.ad_account_id
              where m.nivel = 'campanha'::nivel_meta
                and m.data >= ((now() at time zone 'America/Sao_Paulo'::text)::date - 7)
                and a.produto is null
              group by a.nome
             having sum(m.investimento) > 0::numeric) x
    having count(*) > 0

    union all
    select 'receita_sem_rastreio'::text,
           case when y.pct > 40::numeric then 'critico'::text else 'atencao'::text end,
           round(y.pct)::text || '% da receita de origem desconhecida'::text,
           fn_brl(y.valor) || ' nos últimos 7 dias não vieram de anúncio rastreado nem de origem já identificada'::text
      from ( select 100.0 * sum(vendas.valor_sem_juros) filter (where vendas.ad_id_meta is null and vendas.trafego_pago is not true) / nullif(sum(vendas.valor_sem_juros), 0::numeric) as pct,
                    sum(vendas.valor_sem_juros) filter (where vendas.ad_id_meta is null and vendas.trafego_pago is not true) as valor
               from vendas
              where vendas.status = 'aprovada'::status_venda
                and vendas.is_upsell is not true
                and (vendas.data_venda at time zone 'America/Sao_Paulo'::text)::date >= ((now() at time zone 'America/Sao_Paulo'::text)::date - 7)) y
     where y.pct > 25::numeric

    union all
    select 'meta_divergente'::text, 'critico'::text,
           'Meta reporta mais conversões do que houve vendas'::text,
           ((('Meta: '::text || z.meta::text) || ' conversões · Payt: '::text) || z.total::text) || ' vendas no total nos últimos 7 dias. Sinal de contagem duplicada.'::text
      from ( select ( select coalesce(sum(metricas_meta.compras_meta), 0::bigint)
                        from metricas_meta
                       where metricas_meta.nivel = 'campanha'::nivel_meta
                         and metricas_meta.data >= ((now() at time zone 'America/Sao_Paulo'::text)::date - 7)) as meta,
                    ( select count(*)
                        from vendas
                       where vendas.status = 'aprovada'::status_venda
                         and (vendas.data_venda at time zone 'America/Sao_Paulo'::text)::date >= ((now() at time zone 'America/Sao_Paulo'::text)::date - 7)) as total) z
     where z.total > 0 and (z.meta::numeric / z.total::numeric) > 1.5

    union all select * from fn_alerta_venda_sem_categoria()
    union all select * from fn_alerta_webhook_pendente()

    union all
    select 'venda_sem_liquido'::text, 'atencao'::text,
           count(*)::text || ' venda(s) sem o líquido do produtor'::text,
           fn_brl(sum(vendas.valor_sem_juros)) || ' nos últimos 7 dias: a Payt mandou a comissão zerada, então o valor a receber fica de fora das somas'::text
      from vendas
     where vendas.status = 'aprovada'::status_venda
       and vendas.valor_liquido_produtor is null
       and (vendas.data_venda at time zone 'America/Sao_Paulo'::text)::date >= ((now() at time zone 'America/Sao_Paulo'::text)::date - 7)
    having count(*) > 0

    union all
    select 'venda_nao_normalizada'::text, 'critico'::text,
           count(*)::text || ' venda(s) recebidas da Payt que não viraram registro'::text,
           fn_brl(sum(p.valor)) || ' nos últimos 7 dias estão na camada bruta mas não em vendas'::text
      from vendas_payt p
     where p.status = 'paid'::text
       and p.data >= ((now() at time zone 'America/Sao_Paulo'::text)::date - 7)
       and not (exists (select 1 from vendas v where v.pedido_id = p.payt_id))
    having count(*) > 0

    union all select * from fn_alerta_conta_sem_venda()
    union all select * from fn_alerta_cron_falhando()
    union all select * from fn_alerta_rastreio_regredindo()
    union all select * from fn_alerta_payt_silencio()
    union all select * from fn_alerta_trafego_sem_anuncio()
    union all select * from fn_alerta_checkout_sem_rastreio()
    union all select * from fn_alerta_venda_empresa_errada()
    union all select * from fn_alerta_conta_anuncio_invisivel()
    union all select * from fn_alerta_cadastro_a_arrumar()
    union all select * from fn_alerta_avaliacao_parada()
    union all select * from fn_alerta_assinatura_ciclo_vencido()
    -- novo em 14/10/2026, junto com a entrada da Conversions API
    union all select * from fn_alerta_capi_muda()
  ) t;
