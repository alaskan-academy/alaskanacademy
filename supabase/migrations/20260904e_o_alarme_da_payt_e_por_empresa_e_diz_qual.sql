-- O ALARME DA PAYT E POR EMPRESA, E DIZ QUAL
--
-- "Vendas (Payt) sem atualizar — ultima entrada ha 6h", com o webhook
-- recebendo venda no minuto anterior. Nada estava quebrado.
--
-- O QUE ACONTECIA
--
-- A view pega o MINIMO entre as empresas — e isso e certo: uma chave de
-- integracao quebrada numa empresa ficaria escondida pelo volume da outra.
-- O erro era o limiar UNICO de 6h, calibrado para quem vende a cada 6 minutos:
--
--                intervalo tipico   maior intervalo (14d)
--   Alaskan            0,1h                 5,2h
--   Aeliss             1,4h                10,0h
--
-- A Aeliss passar 6,5h de madrugada sem venda e rotina dela. O alarme
-- disparava toda noite, gastando atencao e ensinando a ignorar o proximo —
-- que pode ser verdadeiro.
--
-- E o texto nao dizia QUAL empresa, entao a leitura era "o webhook caiu".
--
-- O LIMIAR AGORA E DE CADA UMA
--
--   limiar = maior intervalo dos ultimos 14 dias x 1,5, entre 3h e 24h
--
-- Alaskan 7,8h · Aeliss 15,1h. Cada uma dispara quando ELA sai do proprio
-- normal, e recalibra sozinha quando o volume mudar — sem numero no codigo.
--
-- Por que o maior e nao um percentil: p95 x 2 daria 3h para a Alaskan, e o
-- maior intervalo normal dela e 5,2h. O percentil e apertado demais para quem
-- tem 1.236 intervalos e ruidoso demais para quem tem 16.
--
-- O QUE ISSO CUSTA, E POR QUE O TETO EXISTE
--
-- Limiar derivado do historico APRENDE uma queda como normal: 20h fora do ar
-- uma vez e o limiar sobe. Por isso o teto de 24h — a partir dele o alarme
-- volta a ser fixo, e em 14 dias a janela esquece o episodio. Detectar mais
-- devagar e o preco de nao gritar todo dia; gritar todo dia ja provou custar
-- mais.
--
-- O piso de 3h protege o contrario: empresa que vende a cada minuto nao pode
-- ter limiar de 12 minutos.
--
-- `vw_alertas` faz COALESCE(detalhe, 'Ultima entrada ha Xh'), entao o texto que
-- nomeia a empresa substitui o generico sozinho.
--
-- Conferido simulando o tempo passar: agora as duas em ok; daqui a 9h as duas
-- disparam, cada uma no proprio limiar.

CREATE OR REPLACE VIEW vw_ingest_health AS
WITH payt_por_empresa AS (
  SELECT vp.empresa_id, max(vp.criado_em) AS ultimo
    FROM vendas_payt vp
   WHERE vp.empresa_id IS NOT NULL
   GROUP BY vp.empresa_id
  HAVING max(vp.criado_em) > (now() - '7 days'::interval)
), payt_ritmo AS (
  /* O ritmo de cada empresa, medido nela mesma. */
  SELECT x.empresa_id,
         max(x.h) AS maior_gap,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY x.h) AS gap_tipico
    FROM ( SELECT vp.empresa_id,
                  EXTRACT(epoch FROM (vp.criado_em
                    - lag(vp.criado_em) OVER (PARTITION BY vp.empresa_id ORDER BY vp.criado_em))) / 3600 AS h
             FROM vendas_payt vp
            WHERE vp.criado_em > (now() - '14 days'::interval) AND vp.empresa_id IS NOT NULL
         ) x
   WHERE x.h IS NOT NULL
   GROUP BY x.empresa_id
), payt_estado AS (
  SELECT p.empresa_id, e.nome, p.ultimo,
         round((EXTRACT(epoch FROM (now() - p.ultimo)) / 3600)::numeric, 1) AS horas,
         /* 12h de default para empresa nova, que ainda nao tem ritmo medido:
            comecar apertado faria a integracao nascer gritando. */
         round(least(greatest(COALESCE(r.maior_gap, 12) * 1.5, 3), 24)::numeric, 1) AS limiar,
         round(COALESCE(r.gap_tipico, 0)::numeric, 1) AS tipico
    FROM payt_por_empresa p
    JOIN empresas e ON e.id = p.empresa_id
    LEFT JOIN payt_ritmo r ON r.empresa_id = p.empresa_id
), payt_atrasadas AS (
  SELECT * FROM payt_estado WHERE horas > limiar
), payt_pior AS (
  /* A mais PERTO de alarmar, nao a mais silenciosa: o cartao responde "quao
     perto estamos de um problema", e 6h de silencio valem coisas diferentes
     em cada empresa. */
  SELECT * FROM payt_estado ORDER BY horas - limiar DESC LIMIT 1
), cs_por_empresa AS (
  SELECT t.empresa_id, max(t.data)::timestamp with time zone AS ultimo
    FROM transacoes t GROUP BY t.empresa_id
), payt_chave_ruim AS (
  SELECT count(*) AS n FROM payt_webhook_raw r
   WHERE r.motivo LIKE 'chave de integra%desconhecida%' AND r.recebido_em > (now() - '24:00:00'::interval)
), cs_credencial_ruim AS (
  SELECT count(*) AS n, string_agg(e.slug, ', ' ORDER BY e.slug) AS quais
    FROM cs_sync_estado e
   WHERE e.ultimo_erro IS NOT NULL AND (e.ultimo_sucesso IS NULL OR e.ultimo_erro > e.ultimo_sucesso)
), comprovantes_presos AS (
  SELECT count(*) AS n, min(v.data)::timestamp with time zone AS mais_antigo,
         string_agg(DISTINCT COALESCE(e.slug, 'sem empresa'), ', ') AS quais
    FROM vw_pix_sem_comprovante v LEFT JOIN empresas e ON e.id = v.empresa_id
   WHERE v.data < (CURRENT_DATE - 3)
)
SELECT 'payt'::text AS fonte,
  'Vendas (Payt)'::text AS rotulo,
  (SELECT min(p.ultimo) FROM payt_estado p) AS ultimo_evento,
  (SELECT count(*) FROM vendas_payt) AS registros,
  COALESCE((SELECT p.horas FROM payt_pior p), 0::numeric) AS horas_atras,
  COALESCE((SELECT p.limiar FROM payt_pior p), 6::numeric) AS limiar_horas,
  (EXISTS (SELECT 1 FROM payt_atrasadas)) OR ((SELECT n FROM payt_chave_ruim) > 0) AS defasado,
  NULLIF(concat_ws(' · ',
    /* Nomeia a empresa e o ritmo dela: sem isso, "sem atualizar ha 6h" se le
       como "o webhook caiu" e manda procurar problema que nao existe. */
    (SELECT string_agg(a.nome || ' sem entrada há ' || a.horas || 'h (normal até ' || a.limiar || 'h)', '; ' ORDER BY a.nome)
       FROM payt_atrasadas a),
    CASE WHEN (SELECT n FROM payt_chave_ruim) > 0
         THEN (SELECT n FROM payt_chave_ruim)::text || ' evento(s) recusado(s) por chave desconhecida nas últimas 24h'
    END
  ), '') AS detalhe
UNION ALL
SELECT 'meta'::text, 'Métricas de anúncios (Meta)'::text,
  (SELECT min(s.ultimo_sucesso) FROM vw_meta_sync_saude s),
  (SELECT count(*) FROM metricas_meta),
  (SELECT COALESCE(max(COALESCE(s.horas_sem_sucesso, 9999::numeric)), 0::numeric) FROM vw_meta_sync_saude s),
  3::numeric,
  (SELECT COALESCE(bool_or(s.saude <> 'ok'), false) FROM vw_meta_sync_saude s),
  (SELECT string_agg(s.conta, ', ') FROM vw_meta_sync_saude s WHERE s.saude <> 'ok')
UNION ALL
SELECT 'conta_simples'::text, 'Extrato (Conta Simples)'::text,
  (SELECT min(c.ultimo) FROM cs_por_empresa c),
  (SELECT count(*) FROM transacoes),
  round(COALESCE(EXTRACT(epoch FROM now() - (SELECT min(c.ultimo) FROM cs_por_empresa c)) / 3600::numeric, 0::numeric), 1),
  96::numeric,
  COALESCE((EXTRACT(epoch FROM now() - (SELECT min(c.ultimo) FROM cs_por_empresa c)) / 3600::numeric) > 96::numeric, false)
    OR ((SELECT n FROM cs_credencial_ruim) > 0),
  CASE WHEN (SELECT n FROM cs_credencial_ruim) > 0
       THEN 'credencial recusada: ' || (SELECT quais FROM cs_credencial_ruim) END
UNION ALL
SELECT 'comprovantes'::text, 'Comprovantes de PIX'::text,
  (SELECT max(d.criado_em) FROM documentos_fiscais d WHERE d.tipo = 'comprovante'),
  (SELECT count(*) FROM documentos_fiscais d WHERE d.tipo = 'comprovante'),
  round(COALESCE(EXTRACT(epoch FROM now() - (SELECT p.mais_antigo FROM comprovantes_presos p)) / 3600::numeric,
                 EXTRACT(epoch FROM now() - (SELECT max(d2.criado_em) FROM documentos_fiscais d2 WHERE d2.tipo = 'comprovante')) / 3600::numeric,
                 0::numeric), 1),
  72::numeric,
  COALESCE((SELECT p.n FROM comprovantes_presos p) > 0, false),
  CASE WHEN (SELECT p.n FROM comprovantes_presos p) > 0
       THEN (SELECT p.n FROM comprovantes_presos p)::text || ' PIX sem comprovante há mais de 3 dias ('
            || (SELECT p.quais FROM comprovantes_presos p) || ')' END;
