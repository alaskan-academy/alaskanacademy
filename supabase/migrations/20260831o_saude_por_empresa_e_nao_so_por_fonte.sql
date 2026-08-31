/*
  O painel de saúde estava verde enquanto a conta da Aeliss recusava com 401.

  Ele media `max()` sobre a tabela inteira: as vendas e o extrato da Alaskan
  mantinham o relógio fresco, e a Aeliss podia estar morta que ninguém veria. É
  o MESMO defeito que já corrigimos uma vez — uma fonte saudável mascarando as
  mortas —, agora com a máscara sendo a outra empresa.

  A linha da Meta já era por conta (`bool_or(saude <> 'ok')`); ela é o
  precedente que as outras duas passam a seguir.

  SÃO DUAS PERGUNTAS DIFERENTES, E O PAINEL SÓ FAZIA UMA

    1. PAROU DE ENTREGAR?   dado que envelheceu
    2. A CREDENCIAL FUNCIONA?  chamada que é recusada

  A segunda não se responde pela primeira: a Aeliss tem ZERO transações, então
  não há o que ficar velho — o 401 de hoje seria invisível para qualquer medida
  de defasagem. Foi exatamente o que aconteceu.

  `cs_sync_estado` é o espelho de `meta_sync_estado` para a Conta Simples. Para
  a Payt não precisa de tabela nova: o webhook já grava o evento de chave
  desconhecida em `payt_webhook_raw`, com motivo — basta olhar.

  EMPRESA QUE NUNCA ENTREGOU NADA NÃO CONTA COMO ATRASADA

  A Aeliss começa amanhã. Cobrá-la de vendas hoje seria um alarme permanente que
  se aprende a ignorar — e alarme ignorado é pior que alarme nenhum. Ela entra
  na conta sozinha no dia da primeira venda, sem configuração e sem lista.
*/

-- ── 1. O estado do sync da Conta Simples, por conta ──────────────────────────

CREATE TABLE IF NOT EXISTS public.cs_sync_estado (
  slug            text PRIMARY KEY,
  empresa_id      uuid REFERENCES empresas(id),
  ultimo_sucesso  timestamptz,
  ultimo_erro     timestamptz,
  mensagem_erro   text,
  linhas_ultima_execucao integer,
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cs_sync_estado IS
  'Espelho de meta_sync_estado para a Conta Simples: uma linha por conta '
  'bancaria. Existe porque credencial recusada NAO produz dado velho — produz '
  'dado nenhum, e ausencia nao dispara alarme de defasagem.';

ALTER TABLE public.cs_sync_estado ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cs_sync_estado_leitura ON public.cs_sync_estado;
CREATE POLICY cs_sync_estado_leitura ON public.cs_sync_estado
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS cs_sync_estado_servico ON public.cs_sync_estado;
CREATE POLICY cs_sync_estado_servico ON public.cs_sync_estado
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 2. O painel passa a perguntar por empresa ────────────────────────────────

CREATE OR REPLACE VIEW public.vw_ingest_health AS
  WITH
  /* Uma linha por empresa que JÁ entregou alguma coisa. Quem nunca entregou
     fica de fora — ver o comentário do topo. */
  payt_por_empresa AS (
    SELECT vp.empresa_id, max(vp.criado_em) AS ultimo
      FROM vendas_payt vp
     GROUP BY vp.empresa_id
  ),
  cs_por_empresa AS (
    SELECT t.empresa_id, max(t.data)::timestamptz AS ultimo
      FROM transacoes t
     GROUP BY t.empresa_id
  ),
  /* Camada 2: a chave que o webhook não reconheceu. O evento já é gravado
     desde 31/08/2026 — antes o 401 sumia sem deixar nada para achar. */
  payt_chave_ruim AS (
    SELECT count(*) AS n
      FROM payt_webhook_raw r
     WHERE r.motivo LIKE 'chave de integra%desconhecida%'
       AND r.recebido_em > now() - interval '24 hours'
  ),
  cs_credencial_ruim AS (
    SELECT count(*) AS n,
           string_agg(e.slug, ', ' ORDER BY e.slug) AS quais
      FROM cs_sync_estado e
     WHERE e.ultimo_erro IS NOT NULL
       AND (e.ultimo_sucesso IS NULL OR e.ultimo_erro > e.ultimo_sucesso)
  )
  SELECT 'payt'::text AS fonte,
         'Vendas (Payt)'::text AS rotulo,
         (SELECT min(p.ultimo) FROM payt_por_empresa p) AS ultimo_evento,
         (SELECT count(*) FROM vendas_payt) AS registros,
         round(EXTRACT(epoch FROM now() - (SELECT min(p.ultimo) FROM payt_por_empresa p)) / 3600::numeric, 1) AS horas_atras,
         6::numeric AS limiar_horas,
         COALESCE(
           EXTRACT(epoch FROM now() - (SELECT min(p.ultimo) FROM payt_por_empresa p)) / 3600::numeric > 6::numeric,
           false
         ) OR (SELECT n FROM payt_chave_ruim) > 0 AS defasado,
         CASE WHEN (SELECT n FROM payt_chave_ruim) > 0
              THEN (SELECT n FROM payt_chave_ruim)::text || ' evento(s) recusado(s) por chave desconhecida nas ultimas 24h'
              END AS detalhe
  UNION ALL
  SELECT 'meta', 'Métricas de anúncios (Meta)',
         (SELECT min(s.ultimo_sucesso) FROM vw_meta_sync_saude s),
         (SELECT count(*) FROM metricas_meta),
         (SELECT COALESCE(max(COALESCE(s.horas_sem_sucesso, 9999::numeric)), 0::numeric) FROM vw_meta_sync_saude s),
         3::numeric,
         (SELECT COALESCE(bool_or(s.saude <> 'ok'::text), false) FROM vw_meta_sync_saude s),
         (SELECT string_agg(s.conta, ', ') FROM vw_meta_sync_saude s WHERE s.saude <> 'ok')
  UNION ALL
  SELECT 'conta_simples', 'Extrato (Conta Simples)',
         (SELECT min(c.ultimo) FROM cs_por_empresa c),
         (SELECT count(*) FROM transacoes),
         COALESCE(EXTRACT(epoch FROM now() - (SELECT min(c.ultimo) FROM cs_por_empresa c)) / 3600::numeric, 0),
         96::numeric,
         COALESCE(
           EXTRACT(epoch FROM now() - (SELECT min(c.ultimo) FROM cs_por_empresa c)) / 3600::numeric > 96::numeric,
           false
         ) OR (SELECT n FROM cs_credencial_ruim) > 0,
         CASE WHEN (SELECT n FROM cs_credencial_ruim) > 0
              THEN 'credencial recusada: ' || (SELECT quais FROM cs_credencial_ruim)
              END;

COMMENT ON VIEW public.vw_ingest_health IS
  'Saude das tres fontes, medida POR EMPRESA desde 31/08/2026 — antes o max() '
  'sobre a tabela toda deixava a Alaskan mascarar a Aeliss. Responde duas '
  'perguntas: parou de entregar (dado velho) e a credencial funciona (chamada '
  'recusada). A segunda nao se deduz da primeira.';
