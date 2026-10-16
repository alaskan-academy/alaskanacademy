-- O GA4 também grita quando emudece
--
-- O Measurement Protocol subiu hoje e nasceu **sem alarme**. A segunda
-- armadilha da casa é exatamente isso: canal criado sem a coluna de
-- resultado ao lado. A CAPI ganhou o dela em 14/10, depois de duas compras
-- falsas irem para produção sem ninguém notar; o GA4 não devia repetir o
-- caminho.
--
-- ── O que torna este canal especialmente silencioso ───────────────────
--
-- O MP **nunca devolve erro HTTP**: payload malformado responde 2xx igual.
-- Então "o Google aceitou" não significa nada por si. O que temos é a
-- resposta do validador, gravada em `purchases.response_ga4` antes do
-- envio — e é nela que este alarme olha.
--
-- E há um buraco que nenhum dos dois cobre, dito aqui para ninguém achar
-- que está coberto: o validador **não confere o `api_secret` nem o
-- `measurement_id`**. Credencial errada passa limpa pelos dois lados, e o
-- único jeito de descobrir é a venda não aparecer no GA4. Por isso o
-- primeiro sinal abaixo é sobre AUSÊNCIA, não sobre erro.
--
-- ── Por que um quarto ramo, e não uma função nova ─────────────────────
--
-- Função nova exigiria recriar `vw_alertas` para acrescentar o `union`, e
-- foi recriando essa view que eu quebrei `rastreio-que-regride-acusa` em
-- 15/10 — reescrita gratuita de 14 ramos que funcionavam. Aqui a view não
-- é tocada: só o corpo da função que ela já chama. Os três ramos que já
-- existiam estão copiados do arquivo `20261014h`, não redigitados.

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
  having count(*) > 0

  union all

  -- 4. NOVO em 16/10: a compra que nao chegou ao GA4
  --
  -- `response_ga4` nulo depois de 30 min quer dizer que o caminho nem foi
  -- tentado — webhook que morreu antes, ou deploy velho ainda no ar. E
  -- `response_ga4 ? 'falha'` e tentativa que nao passou: credencial que o
  -- Vault nao devolveu, validador recusando a estrutura, rede caindo.
  --
  -- Nao se alarma por compra sem `client_id`: visitante que nao casou nao
  -- tem GA4 para alimentar, e isso ja aparece como `nao_casou` na Visao
  -- geral. Alarmar aqui dobraria o mesmo aviso.
  select 'ga4_compra_nao_enviada'::text,
         'critico'::text,
         count(*)::text || ' compra(s) paga(s) sem chegar ao GA4',
         'O Measurement Protocol nao registrou envio para estas vendas — '
         || fn_brl(coalesce(sum(p.valor), 0)) || ' nas ultimas 24h'
         || case when count(*) filter (where p.response_ga4 ? 'falha') > 0
                 then ', e o primeiro motivo e: '
                      || coalesce(min(p.response_ga4->>'falha'), 'sem motivo')
                 else ', e sem motivo registrado — o caminho nem foi tentado' end
         || '. Lembrando que o MP nunca devolve erro HTTP: o que o painel sabe '
         || 'vem do validador, e ele NAO confere a credencial. Credencial errada '
         || 'aparece aqui como silencio, nao como erro.'
    from tracking.purchases p
   where p.status = 'paid'
     and p.trck_user_id is not null
     and (p.response_ga4 is null or p.response_ga4 ? 'falha')
     and coalesce(p.pago_em, p.criado_em) < now() - interval '30 minutes'
     /* O piso do deploy, e ele se APAGA sozinho: a partir de 17/10 a janela
        de 24h e sempre a mais recente das duas, e a constante deixa de
        importar. Sem ela, o alarme passaria a primeira noite gritando por
        9 compras que sao anteriores ao Measurement Protocol existir —
        verdade que nao e acionavel, que e como se ensina alguem a ignorar
        alarme vermelho. */
     and coalesce(p.pago_em, p.criado_em) > greatest(now() - interval '24 hours',
                                                     timestamptz '2026-10-16 13:00-03')
  having count(*) > 0;
$$;

comment on function public.fn_alerta_capi_muda() is
  'Quatro sinais de que o envio do rastreamento parou. Meta: venda paga sem meta_event_id depois de 30 min (o envio e sincrono, entao isso nao deveria existir), envio recusado, e a chave geral desligada com venda acontecendo. GA4 (desde 16/10): compra paga sem registro de envio pelo Measurement Protocol. O MP nunca devolve erro HTTP e o validador dele NAO confere a credencial — entao credencial errada aparece como silencio, e e por isso que o sinal e sobre ausencia e nao sobre erro. Janela de 24h porque conversao perdida nao se recupera. security definer porque vw_alertas roda como quem le e o schema tracking e fechado; devolve so contagens.';

revoke all on function public.fn_alerta_capi_muda() from public, anon;
grant execute on function public.fn_alerta_capi_muda() to authenticated, service_role;
