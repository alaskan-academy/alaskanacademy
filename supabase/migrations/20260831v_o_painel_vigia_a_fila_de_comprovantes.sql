-- O painel passa a vigiar a fila de comprovantes — e os alertas a dizer o porquê.
--
-- ── Por que existe ────────────────────────────────────────────────────────
--
-- `cs-comprovantes` foi consertada para várias empresas, mas o caminho novo
-- (tirar o prefixo do slug da referência antes de chamar a API) nunca rodou com
-- dados reais: a Aeliss ainda não movimentou a conta dela. Se estiver errado, a
-- falha é SILENCIOSA — a função devolve o motivo, a rodada segue, e o PIX volta
-- para a fila amanhã e falha de novo, para sempre.
--
-- "Confere quando o primeiro PIX da Aeliss entrar" não é vigilância: depende de
-- alguém lembrar, num dia que ninguém sabe qual é. Isto aqui é.
--
-- ── Por que a regra não fala em Aeliss ────────────────────────────────────
--
-- Vigiar "o primeiro PIX da Aeliss" vence no dia em que ele entra. A regra é
-- genérica: PIX preso na fila há mais de 3 dias, de qualquer empresa. O cron
-- roda 10:30 todo dia, então 3 dias são TRÊS tentativas falhadas — não um
-- atraso normal. E o `detalhe` nomeia a empresa, que é o que faz a mensagem
-- valer para o caso da Aeliss sem ter sido escrita para ele.
--
-- ── A segunda metade: o alerta dizia a coisa errada ───────────────────────
--
-- `vw_alertas` montava o texto do banner sozinho — sempre "Última entrada há
-- N dias" — e IGNORAVA o `detalhe` que `vw_ingest_health` já produzia. Quer
-- dizer que "credencial recusada: aeliss", escrito hoje de manhã, nunca chegou
-- à tela: quem lesse o banner veria "sem atualizar há 20h" e procuraria uma
-- fonte parada, não uma chave rejeitada.
--
-- O `coalesce` conserta as quatro fontes de uma vez.

-- ── 1. A quarta fonte ─────────────────────────────────────────────────────

create or replace view vw_ingest_health as
 WITH payt_por_empresa AS (
         SELECT vp.empresa_id, max(vp.criado_em) AS ultimo
           FROM vendas_payt vp GROUP BY vp.empresa_id
        ), cs_por_empresa AS (
         SELECT t.empresa_id, max(t.data)::timestamp with time zone AS ultimo
           FROM transacoes t GROUP BY t.empresa_id
        ), payt_chave_ruim AS (
         SELECT count(*) AS n FROM payt_webhook_raw r
          WHERE r.motivo like 'chave de integra%desconhecida%' AND r.recebido_em > (now() - '24:00:00'::interval)
        ), cs_credencial_ruim AS (
         SELECT count(*) AS n, string_agg(e.slug, ', ' ORDER BY e.slug) AS quais
           FROM cs_sync_estado e
          WHERE e.ultimo_erro IS NOT NULL AND (e.ultimo_sucesso IS NULL OR e.ultimo_erro > e.ultimo_sucesso)
        ), comprovantes_presos AS (
         /* PIX que a fila não consegue resolver. O cron roda 10:30 todo dia,
            então 3 dias são TRÊS tentativas falhadas — não um atraso normal. */
         SELECT count(*) AS n,
                min(v.data)::timestamp with time zone AS mais_antigo,
                string_agg(DISTINCT coalesce(e.slug, 'sem empresa'), ', ') AS quais
           FROM vw_pix_sem_comprovante v
           LEFT JOIN empresas e ON e.id = v.empresa_id
          WHERE v.data < (current_date - 3)
        )
 SELECT 'payt'::text AS fonte,
    'Vendas (Payt)'::text AS rotulo,
    (SELECT min(p.ultimo) FROM payt_por_empresa p) AS ultimo_evento,
    (SELECT count(*) FROM vendas_payt) AS registros,
    round(EXTRACT(epoch FROM now() - ((SELECT min(p.ultimo) FROM payt_por_empresa p))) / 3600::numeric, 1) AS horas_atras,
    6::numeric AS limiar_horas,
    COALESCE((EXTRACT(epoch FROM now() - ((SELECT min(p.ultimo) FROM payt_por_empresa p))) / 3600::numeric) > 6::numeric, false)
      OR ((SELECT payt_chave_ruim.n FROM payt_chave_ruim)) > 0 AS defasado,
        CASE WHEN ((SELECT payt_chave_ruim.n FROM payt_chave_ruim)) > 0
             THEN (((SELECT payt_chave_ruim.n FROM payt_chave_ruim))::text) || ' evento(s) recusado(s) por chave desconhecida nas ultimas 24h'::text
             ELSE NULL::text END AS detalhe
UNION ALL
 SELECT 'meta'::text, 'Métricas de anúncios (Meta)'::text,
    (SELECT min(s.ultimo_sucesso) FROM vw_meta_sync_saude s),
    (SELECT count(*) FROM metricas_meta),
    (SELECT COALESCE(max(COALESCE(s.horas_sem_sucesso, 9999::numeric)), 0::numeric) FROM vw_meta_sync_saude s),
    3::numeric,
    (SELECT COALESCE(bool_or(s.saude <> 'ok'::text), false) FROM vw_meta_sync_saude s),
    (SELECT string_agg(s.conta, ', ') FROM vw_meta_sync_saude s WHERE s.saude <> 'ok'::text)
UNION ALL
 SELECT 'conta_simples'::text, 'Extrato (Conta Simples)'::text,
    (SELECT min(c.ultimo) FROM cs_por_empresa c),
    (SELECT count(*) FROM transacoes),
    round(COALESCE(EXTRACT(epoch FROM now() - ((SELECT min(c.ultimo) FROM cs_por_empresa c))) / 3600::numeric, 0::numeric), 1),
    96::numeric,
    COALESCE((EXTRACT(epoch FROM now() - ((SELECT min(c.ultimo) FROM cs_por_empresa c))) / 3600::numeric) > 96::numeric, false)
      OR ((SELECT cs_credencial_ruim.n FROM cs_credencial_ruim)) > 0,
        CASE WHEN ((SELECT cs_credencial_ruim.n FROM cs_credencial_ruim)) > 0
             THEN 'credencial recusada: '::text || ((SELECT cs_credencial_ruim.quais FROM cs_credencial_ruim))
             ELSE NULL::text END
UNION ALL
 SELECT 'comprovantes'::text, 'Comprovantes de PIX'::text,
    (SELECT max(d.criado_em) FROM documentos_fiscais d WHERE d.tipo = 'comprovante'),
    (SELECT count(*) FROM documentos_fiscais d WHERE d.tipo = 'comprovante'),
    /*
      Duas perguntas, uma coluna, na ordem de importância.

      Preso: a idade do PIX mais velho da fila — é dela que sai a severidade do
      alerta, e é ela que cresce enquanto ninguém resolve.

      Nada preso: o tempo desde o último comprovante buscado. A primeira versão
      punha zero aqui, e a tela lia "há 0 min" como se tivesse acabado de
      sincronizar. Verde e mentindo é pior que vermelho.

      O limiar de 72h NÃO se aplica ao segundo caso: uma semana calma não tem
      PIX, e `defasado` é quem decide a cor — não a comparação com o limiar.
    */
    round(COALESCE(
      EXTRACT(epoch FROM now() - ((SELECT p.mais_antigo FROM comprovantes_presos p))) / 3600::numeric,
      EXTRACT(epoch FROM now() - ((SELECT max(d2.criado_em) FROM documentos_fiscais d2 WHERE d2.tipo = 'comprovante'))) / 3600::numeric,
      0::numeric), 1),
    72::numeric,
    COALESCE(((SELECT p.n FROM comprovantes_presos p)) > 0, false),
        CASE WHEN ((SELECT p.n FROM comprovantes_presos p)) > 0
             THEN ((SELECT p.n FROM comprovantes_presos p))::text
                  || ' PIX sem comprovante há mais de 3 dias ('
                  || ((SELECT p.quais FROM comprovantes_presos p)) || ')'
             ELSE NULL::text END;

-- ── 2. O alerta passa a dizer a causa ─────────────────────────────────────
--
-- Reescrita ancorada em vez do texto inteiro: `vw_alertas` tem catorze ramos, e
-- copiá-los aqui criaria uma segunda cópia que envelhece. A âncora falha alto
-- se alguém mudar a forma do ramo — que é o comportamento certo para isto.

do $$
declare
  def text;
  novo text;
  antigo text := $velho$    'Última entrada há '::text ||
        CASE
            WHEN h.horas_atras < 48::numeric THEN round(h.horas_atras)::text || 'h'::text
            ELSE round(h.horas_atras / 24::numeric)::text || ' dias'::text
        END AS detalhe$velho$;
  troca text := $novo$    COALESCE(h.detalhe, 'Última entrada há '::text ||
        CASE
            WHEN h.horas_atras < 48::numeric THEN round(h.horas_atras)::text || 'h'::text
            ELSE round(h.horas_atras / 24::numeric)::text || ' dias'::text
        END) AS detalhe$novo$;
begin
  def := pg_get_viewdef('vw_alertas'::regclass, true);

  /* Já aplicado? Sai sem erro: a migração precisa poder rodar duas vezes. */
  if position('COALESCE(h.detalhe' in def) > 0 then
    return;
  end if;

  if position(antigo in def) = 0 then
    raise exception 'ancora nao encontrada em vw_alertas — o ramo fonte_parada mudou de forma, revisar a mao';
  end if;

  novo := replace(def, antigo, troca);
  execute 'create or replace view vw_alertas as ' || novo;
end $$;
