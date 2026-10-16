-- vw_alertas volta a nomear as colunas de cada ramo
--
-- Ontem, ao acrescentar `fn_alerta_capi_muda` à view (20261014h), eu
-- reescrevi os 14 ramos de função que já existiam, trocando
--
--     select r.codigo, r.severidade, r.titulo, r.detalhe
--       from fn_alerta_rastreio_regredindo() r(codigo, severidade, titulo, detalhe)
--
-- por `union all select * from fn_alerta_rastreio_regredindo()`.
--
-- A view continuou **funcionalmente idêntica** — mesmas 4 linhas, mesmas
-- colunas, conferido na hora. Mas foi reescrita gratuita de código que
-- funcionava, e ela quebrou `rastreio-que-regride-acusa.test.ts`, que lê o
-- FONTE da última migração que define a view e exige a forma com apelido.
--
-- O teste está certo, e eu só descobri hoje porque ontem rodei só o teste de
-- RLS em vez da suíte inteira. Duas lições, e a segunda é a que importa:
--
--   • rodar a suíte toda depois de mexer em objeto compartilhado;
--   • **não reescrever o que não se veio mudar.** Eu vim adicionar um ramo;
--     os outros 14 não eram da minha conta.
--
-- Esta migração restaura a forma em todos os ramos, inclusive no novo, e não
-- muda nada do que a view devolve.
--
-- O `with (security_invoker = on)` vai na própria instrução, como sempre: o
-- replace REDEFINE as reloptions, e omitir apaga a que estava lá.

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

    union all
    select a.codigo, a.severidade, a.titulo, a.detalhe
      from fn_alerta_venda_sem_categoria() a(codigo, severidade, titulo, detalhe)

    union all
    select a.codigo, a.severidade, a.titulo, a.detalhe
      from fn_alerta_webhook_pendente() a(codigo, severidade, titulo, detalhe)

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

    union all
    select a.codigo, a.severidade, a.titulo, a.detalhe
      from fn_alerta_conta_sem_venda() a(codigo, severidade, titulo, detalhe)

    union all
    select a.codigo, a.severidade, a.titulo, a.detalhe
      from fn_alerta_cron_falhando() a(codigo, severidade, titulo, detalhe)

    union all
    select r.codigo, r.severidade, r.titulo, r.detalhe
      from fn_alerta_rastreio_regredindo() r(codigo, severidade, titulo, detalhe)

    union all
    select s.codigo, s.severidade, s.titulo, s.detalhe
      from fn_alerta_payt_silencio() s(codigo, severidade, titulo, detalhe)

    union all
    select t.codigo, t.severidade, t.titulo, t.detalhe
      from fn_alerta_trafego_sem_anuncio() t(codigo, severidade, titulo, detalhe)

    union all
    select c.codigo, c.severidade, c.titulo, c.detalhe
      from fn_alerta_checkout_sem_rastreio() c(codigo, severidade, titulo, detalhe)

    union all
    select x.codigo, x.severidade, x.titulo, x.detalhe
      from fn_alerta_venda_empresa_errada() x(codigo, severidade, titulo, detalhe)

    union all
    select x.codigo, x.severidade, x.titulo, x.detalhe
      from fn_alerta_conta_anuncio_invisivel() x(codigo, severidade, titulo, detalhe)

    union all
    select x.codigo, x.severidade, x.titulo, x.detalhe
      from fn_alerta_cadastro_a_arrumar() x(codigo, severidade, titulo, detalhe)

    union all
    select a.codigo, a.severidade, a.titulo, a.detalhe
      from fn_alerta_avaliacao_parada() a(codigo, severidade, titulo, detalhe)

    union all
    select x.codigo, x.severidade, x.titulo, x.detalhe
      from fn_alerta_assinatura_ciclo_vencido() x(codigo, severidade, titulo, detalhe)

    -- novo em 14/10/2026, junto com a entrada da Conversions API
    union all
    select m.codigo, m.severidade, m.titulo, m.detalhe
      from fn_alerta_capi_muda() m(codigo, severidade, titulo, detalhe)
  ) t;
