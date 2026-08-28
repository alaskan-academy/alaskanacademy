-- ── A recusa ganha a hora que a Payt sempre mandou ────────────────────────
--
-- A pergunta era de que lado estava a perda. Esta do nosso.
--
-- O `payload_raw` de uma venda recusada traz, com hora cheia:
--
--   started_at  2026-08-28 01:19:31
--   updated_at  2026-08-28 02:20:16
--   paid_at     null
--   data        2026-08-28   <- o que gravavamos, tipo `date`, sem hora
--
-- E a cascata de `fn_normalizar_venda_payt` era:
--
--   1. transaction.paid_at   -- tem hora, mas so existe em venda paga
--   2. vendas_payt.data      -- e `date`, entao vira 00:00:00
--   3. criado_em
--
-- Recusa nao tem `paid_at`, cai no degrau 2 e perde a hora. `started_at` nunca
-- foi olhado, embora estivesse ali desde sempre. Por isso 2.434 de 2.434
-- expiradas e 595 de 595 canceladas estavam gravadas em 00:00:00, e a taxa de
-- aprovacao por hora dava 100% em toda hora do dia.
--
-- POR QUE `started_at` E NAO `updated_at`
--
-- Descobrimos de quebra que `vendas_payt.data` e o dia do `updated_at` -- o dia
-- em que o Pix EXPIROU --, e um Pix leva 34,9 horas em media para expirar.
--
-- `started_at` e quando a pessoa chegou no checkout. E ele o par correto de
-- "venda aprovada as 8h": toda tela que poe aprovada e recusada lado a lado
-- pergunta "de todas as tentativas daquele momento, quantas viraram venda".
-- Comparar aprovadas por hora com expiradas por dia de expiracao mistura dois
-- eventos diferentes.
--
-- A consequencia, medida e aceita antes de aplicar: 345 das 1.456 recusas mudam
-- de dia e 36 mudam de mes. NENHUMA venda paga e afetada -- `paid_at` continua
-- sendo o primeiro degrau --, e conferido depois: agosto seguiu com
-- R$ 178.200,72 e 1.836 aprovadas, os mesmos numeros de antes.
--
-- A alteracao e feita por substituicao de texto na propria definicao, e nao
-- transcrevendo a funcao inteira: sao 130 linhas para acrescentar uma, e
-- transcrever e onde se perde um trecho sem perceber. O `IF` no comeco deixa a
-- migration idempotente.
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_normalizar_venda_payt';

  IF v_def LIKE '%started_at%AT TIME ZONE%'
     AND position('started_at' in v_def) < position('p_vp.data IS NOT NULL' in v_def) THEN
    RAISE NOTICE 'degrau ja presente, nada a fazer';
    RETURN;
  END IF;

  v_def := replace(
    v_def,
    E'    WHEN p_vp.data IS NOT NULL              THEN (p_vp.data::timestamp AT TIME ZONE ''America/Sao_Paulo'')',
    E'    -- A recusa nao tem paid_at, mas tem started_at: a hora em que a pessoa\n'
    || E'    -- chegou no checkout. Sem este degrau ela caia no `data`, que e `date`,\n'
    || E'    -- e virava meia-noite.\n'
    || E'    WHEN NULLIF(p_vp.payload_raw->>''started_at'', '''') IS NOT NULL\n'
    || E'      THEN ((p_vp.payload_raw->>''started_at'')::timestamp AT TIME ZONE ''America/Sao_Paulo'')\n'
    || E'    WHEN p_vp.data IS NOT NULL              THEN (p_vp.data::timestamp AT TIME ZONE ''America/Sao_Paulo'')'
  );

  EXECUTE v_def;
END $$;

-- ── E as recusas ja gravadas ganham a hora de volta ───────────────────────
--
-- A cascata corrigida vale para o que chegar de agora em diante. Este e o
-- passado: 1.456 recusas que tem `started_at` no payload e estavam em 00:00:00.
--
-- Cobertura por mes -- de julho em diante o payload esta completo, e antes de
-- maio nao ha o que recuperar (a importacao antiga nao guardou payload):
--
--   jan-abr/26   4.899 linhas       0 com started_at
--   mai/26       2.195            681      182 recuperaveis
--   jun/26       1.067          1.025      220
--   jul/26       1.844          1.844      477
--   ago/26       2.462          2.388      577
--
-- Sem tabela de backup de proposito: o valor antigo e reconstruivel a qualquer
-- momento a partir de `vendas_payt.data` a meia-noite de Brasilia, que e
-- exatamente a regra que produzia ele. Guardar copia de algo deterministico
-- seria mais uma tabela para conferir depois.
--
-- `hora_venda`, `dia_semana` e `mes_ano` se atualizam sozinhos: o gatilho
-- `trg_campos_data` e BEFORE INSERT OR UPDATE e recalcula os tres a partir de
-- `data_venda`. Conferido antes de rodar.
WITH alvo AS (
  SELECT vp.payt_id,
         ((vp.payload_raw->>'started_at')::timestamp AT TIME ZONE 'America/Sao_Paulo') AS novo
    FROM vendas_payt vp
   WHERE vp.payload_raw->'transaction'->>'paid_at' IS NULL
     AND NULLIF(vp.payload_raw->>'started_at', '') IS NOT NULL
)
UPDATE vendas v
   SET data_venda = a.novo
  FROM alvo a
 WHERE v.pedido_id = a.payt_id
   AND v.data_venda IS DISTINCT FROM a.novo;
