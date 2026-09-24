-- "PAROU ONTEM" DEIXA DE SER O MESMO CINZA QUE "PAROU EM JUNHO"
--
-- O pedido dela: acusar anuncio que estava rodando e hoje nao esta mais. Hoje
-- a tela nao acusa — o anuncio desligado vira `parado`, cinza
-- (`bg-secondary text-muted-foreground`), do lado de `sem_dado`, tambem cinza.
--
-- POR QUE NAO BASTAVA PINTAR `parado` DE AMBAR
--
-- Porque a esmagadora maioria dos parados esta parada DE PROPOSITO, ha muito
-- tempo. Medido em 24/09/2026, sobre os 5.988 objetos em `parado`:
--
--     5.041  nunca entregaram uma impressao   (nasceram desligados)
--       845  pararam ha mais de 14 dias       (historia)
--        41  pararam ha 8 a 14 dias
--        61  pararam nos ultimos 7 dias       <-- isto e a noticia
--
-- Pintar os 5.988 de ambar seria trocar um cinza mudo por uma parede ambar,
-- que e igualmente muda: o olho para de ver aviso que esta sempre aceso. A
-- mesma razao pela qual o vermelho fica fora da interface no CLAUDE.md — sinal
-- que aparece sempre deixa de ser sinal.
--
-- O QUE ELA PEDIU E SOBRE A MUDANCA, NAO SOBRE O ESTADO
--
-- "estava rodando e hoje nao esta" e uma frase sobre transicao. Entao a
-- situacao nova e desligado E entregando ate pouco tempo atras:
--
--     status <> 'ACTIVE'  AND  ultima_entrega >= current_date - 7
--
-- Sete dias porque e o ritmo em que ela olha, e o mesmo corte que
-- `DIAS_DE_CARENCIA` ja usa na aba "O que eu aprovei". Quem nunca entregou fica
-- fora por construcao (`ultima_entrega is null`), que e o certo: nao parou, nunca
-- comecou — para esse ja existe `ativo_nunca_entregou` do outro lado.
--
-- POR QUE AS DUAS VIEWS MUDAM NA MESMA MIGRACAO
--
-- `vw_producao_estado_ads` resume os anuncios de um card com o vocabulario
-- desta view, e resume com a LISTA ESCRITA A MAO. Ela conta
-- `situacao = 'parado'` literal e o `case` final vai de `parados > 0` direto
-- para `sem_dado > 0`. Criar `parado_recente` so aqui faria o card cujo unico
-- anuncio acabou de parar escapar de TODAS as contagens e cair no `else` —
-- passando a dizer **"sem anuncio"**. Terceira armadilha do CLAUDE.md em estado
-- puro: lista fixa que envelhece em silencio, e em silencio mesmo, porque
-- "sem anuncio" e uma frase plausivel. A prova 4 la embaixo existe para isso.

-- ── 1. vw_meta_status: a situacao nova, antes do `parado` generico ──────────
CREATE OR REPLACE VIEW public.vw_meta_status
  WITH (security_invoker = on) AS
WITH entrega AS (
  SELECT metricas_meta.nivel,
         COALESCE(metricas_meta.ad_id, metricas_meta.adset_id, metricas_meta.campanha_id) AS objeto_id,
         max(metricas_meta.data) FILTER (WHERE metricas_meta.impressoes > 0)      AS ultima_entrega,
         max(metricas_meta.data) FILTER (WHERE metricas_meta.investimento > 0::numeric) AS ultimo_gasto,
         sum(metricas_meta.investimento) FILTER (WHERE metricas_meta.data >= (CURRENT_DATE - 30)) AS inv_30d
    FROM metricas_meta
   GROUP BY metricas_meta.nivel, (COALESCE(metricas_meta.ad_id, metricas_meta.adset_id, metricas_meta.campanha_id))
)
SELECT o.id,
       o.ad_account_id,
       c.nome AS conta,
       o.nivel,
       o.objeto_id,
       o.nome,
       o.pai_id,
       CASE o.nivel
         WHEN 'campanha'::nivel_meta THEN o.objeto_id
         WHEN 'adset'::nivel_meta    THEN o.pai_id
         WHEN 'ad'::nivel_meta       THEN pai.pai_id
         ELSE NULL::text
       END AS campanha_id,
       o.status,
       o.effective_status,
       o.orcamento_diario,
       o.orcamento_total,
       o.objetivo,
       o.effective_status = 'ACTIVE'::text AS ativo,
       e.ultima_entrega,
       e.ultimo_gasto,
       e.inv_30d,
       CASE WHEN e.ultima_entrega IS NULL THEN NULL::integer
            ELSE CURRENT_DATE - e.ultima_entrega
       END AS dias_sem_entregar,
       CASE
         WHEN o.visto_em < (now() - '2 days'::interval) THEN 'sem_dado'::text
         /* A NOVA, e ela vem ANTES do `parado` porque e uma fatia dele: sem
            isto o `parado` generico casa primeiro e a fatia nunca aparece. */
         WHEN o.status IS DISTINCT FROM 'ACTIVE'::text
              AND e.ultima_entrega >= (CURRENT_DATE - 7) THEN 'parado_recente'::text
         WHEN o.status IS DISTINCT FROM 'ACTIVE'::text THEN 'parado'::text
         WHEN o.effective_status = 'ACTIVE'::text AND e.ultima_entrega IS NULL THEN 'ativo_nunca_entregou'::text
         WHEN o.effective_status = 'ACTIVE'::text AND e.ultima_entrega < (CURRENT_DATE - 1) THEN 'ativo_sem_entregar'::text
         WHEN o.effective_status = 'ACTIVE'::text THEN 'rodando'::text
         WHEN o.effective_status = ANY (ARRAY['DISAPPROVED'::text, 'WITH_ISSUES'::text]) THEN 'bloqueado'::text
         WHEN o.effective_status = ANY (ARRAY['PENDING_REVIEW'::text, 'IN_PROCESS'::text]) THEN 'em_analise'::text
         WHEN o.effective_status = ANY (ARRAY['CAMPAIGN_PAUSED'::text, 'ADSET_PAUSED'::text]) THEN 'barrado_pelo_pai'::text
         ELSE 'desconhecido'::text
       END AS situacao,
       o.visto_em,
       o.atualizado_em
  FROM meta_objetos o
  LEFT JOIN ad_accounts c ON c.id = o.ad_account_id
  LEFT JOIN meta_objetos pai ON pai.ad_account_id = o.ad_account_id
                            AND pai.nivel = 'adset'::nivel_meta
                            AND pai.objeto_id = o.pai_id
                            AND o.nivel = 'ad'::nivel_meta
  LEFT JOIN entrega e ON e.nivel = o.nivel AND e.objeto_id = o.objeto_id;

-- ── 2. vw_producao_estado_ads: o card tambem precisa saber ──────────────────
CREATE OR REPLACE VIEW public.vw_producao_estado_ads
  WITH (security_invoker = on) AS
WITH gasto AS (
  SELECT m.ad_id, max(m.data) FILTER (WHERE m.investimento > 0::numeric) AS ultimo_dia
    FROM metricas_meta m
   WHERE m.nivel = 'ad'::nivel_meta
   GROUP BY m.ad_id
), por_card AS (
  SELECT pa.producao_id,
         count(*)                AS ads_ligados,
         count(ms.objeto_id)     AS ads_conhecidos,
         count(*) FILTER (WHERE ms.situacao = 'rodando'::text) AS rodando,
         count(*) FILTER (WHERE ms.situacao = ANY (ARRAY['bloqueado'::text, 'ativo_nunca_entregou'::text,
                                                         'ativo_sem_entregar'::text, 'barrado_pelo_pai'::text,
                                                         'em_analise'::text])) AS pede_acao,
         count(*) FILTER (WHERE ms.situacao = 'parado_recente'::text) AS parados_recentes,
         count(*) FILTER (WHERE ms.situacao = 'parado'::text)         AS parados,
         count(*) FILTER (WHERE ms.situacao = 'sem_dado'::text)       AS sem_dado,
         min(array_position(ARRAY['bloqueado'::text, 'ativo_nunca_entregou'::text, 'ativo_sem_entregar'::text,
                                  'barrado_pelo_pai'::text, 'em_analise'::text], ms.situacao)) AS pior,
         max(ms.visto_em)        AS visto_em,
         max(g.ultimo_dia)       AS ultimo_gasto
    FROM producao_ads pa
    LEFT JOIN vw_meta_status ms ON ms.nivel = 'ad'::nivel_meta AND ms.objeto_id = pa.ad_id
    LEFT JOIN gasto g ON g.ad_id = pa.ad_id
   GROUP BY pa.producao_id
)
SELECT producao_id,
       ads_ligados,
       ads_conhecidos,
       rodando,
       pede_acao,
       parados,
       sem_dado,
       visto_em,
       /* A PRECEDENCIA NAO E A ORDEM DA TELA DO META ADS, e continua nao sendo.
          Aqui a pergunta e "este criativo ainda esta no ar?", entao `rodando`
          ganha de tudo. `parado_recente` entra entre o que pede acao e o
          `parado` velho: nao esta ligado (logo nao e `pede_acao`), mas e a
          unica fatia de parado sobre a qual ha o que fazer hoje. */
       CASE
         WHEN ads_conhecidos = 0      THEN 'sem_anuncio'::text
         WHEN rodando > 0             THEN 'rodando'::text
         WHEN pede_acao > 0           THEN (ARRAY['bloqueado'::text, 'ativo_nunca_entregou'::text,
                                                  'ativo_sem_entregar'::text, 'barrado_pelo_pai'::text,
                                                  'em_analise'::text])[pior]
         WHEN parados_recentes > 0    THEN 'parado_recente'::text
         WHEN parados > 0             THEN 'parado'::text
         WHEN sem_dado > 0            THEN 'sem_dado'::text
         ELSE 'sem_anuncio'::text
       END AS estado,
       ultimo_gasto,
       parados_recentes
  FROM por_card;

-- ── As provas ───────────────────────────────────────────────────────────────
DO $prova$
DECLARE
  v_antes int; v_depois int; v_rec int; v_n int; v_txt text;
BEGIN
  -- 1. `parado_recente` e uma FATIA de `parado`, e nao um roubo de outra
  --    situacao. Conferido pela REGRA, nao por um total: um literal medido hoje
  --    envelheceria no proximo sync horario, e prova que envelhece e prova que
  --    um dia falha sozinha e ensina a ignorar o arquivo.
  SELECT count(*) FILTER (WHERE situacao IN ('parado','parado_recente')),
         count(*) FILTER (WHERE situacao = 'parado_recente')
    INTO v_depois, v_rec
    FROM public.vw_meta_status;

  SELECT count(*) INTO v_n
    FROM public.vw_meta_status ms
    JOIN meta_objetos o ON o.id = ms.id
   WHERE ms.situacao = 'parado_recente'
     AND (o.status IS NOT DISTINCT FROM 'ACTIVE'
          OR o.visto_em < (now() - '2 days'::interval));
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% objetos em parado_recente que a regra antiga NAO chamaria de parado', v_n;
  END IF;

  -- 2. A fatia tem de ser pequena, senao o ambar vira parede e nao avisa nada.
  IF v_rec = 0 THEN
    RAISE EXCEPTION 'nenhum parado_recente: a condicao nunca casa e o aviso nasce morto';
  END IF;
  IF v_rec > 400 THEN
    RAISE EXCEPTION '% objetos em parado_recente — ambar demais para ser aviso', v_rec;
  END IF;

  -- 3. Ninguem em `parado_recente` pode estar sem entrega: o aviso fala de quem
  --    PAROU, e quem nunca entregou nao parou.
  SELECT count(*) INTO v_n FROM public.vw_meta_status
   WHERE situacao = 'parado_recente' AND ultima_entrega IS NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% objetos em parado_recente nunca entregaram', v_n;
  END IF;

  -- 4. A ARMADILHA QUE ESTA MIGRACAO EXISTE PARA NAO CAIR.
  --    Card cujo unico anuncio acabou de parar tem de ler `parado_recente`.
  --    Se `vw_producao_estado_ads` nao tivesse sido mexida junto, ele cairia no
  --    `else` e diria "sem anuncio" — com anuncio vinculado na ponte.
  SELECT count(*) INTO v_n
    FROM public.vw_producao_estado_ads
   WHERE estado = 'sem_anuncio' AND ads_conhecidos > 0;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% cards com anuncio conhecido lendo "sem_anuncio" — a lista fixa comeu uma situacao', v_n;
  END IF;

  -- 5. O vocabulario do card continua fechado (a Meta inventa status sem avisar).
  SELECT string_agg(DISTINCT estado, ', ') INTO v_txt
    FROM public.vw_producao_estado_ads
   WHERE estado NOT IN ('rodando','parado','parado_recente','barrado_pelo_pai','bloqueado',
                        'ativo_nunca_entregou','ativo_sem_entregar','em_analise','sem_dado','sem_anuncio');
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'estado fora do vocabulario conhecido: %', v_txt;
  END IF;

  -- 6. A view do card nao perdeu nem ganhou card.
  SELECT count(*) INTO v_antes FROM public.vw_producao_estado_ads;
  SELECT count(DISTINCT producao_id) INTO v_n FROM producao_ads;
  IF v_antes <> v_n THEN
    RAISE EXCEPTION 'vw_producao_estado_ads: % cards na view contra % na ponte', v_antes, v_n;
  END IF;

  RAISE NOTICE 'parado_recente: % objetos (de % parados no total), % cards conferidos', v_rec, v_depois, v_antes;
END
$prova$;

NOTIFY pgrst, 'reload schema';
