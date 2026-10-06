-- RECUPERADA: aplicada em 04/10/2026, arquivo escrito em 06/10/2026
-- ============================================================================
--
-- A versao `20261004210733` ("vw_rev_tendencia_explica") foi aplicada direto
-- no banco e nunca teve arquivo. Apareceu em 06/10 ao comparar a contagem de
-- migracoes por dia com a de arquivos.
--
-- O CLAUDE.md tem uma secao inteira sobre por que isso importa: "Migracao sem
-- arquivo passa por fora de TODA catraca" — varios testes deste projeto leem
-- as MIGRACOES, nao o banco, e continuam verdes sobre a definicao antiga.
--
-- -- Por que este arquivo nao repete o SQL -------------------------------------
--
-- Porque, neste caso especifico, ela foi SUBSTITUIDA 95 segundos depois:
--
--   20261004210733  vw_rev_tendencia_explica             <- esta, sem arquivo
--   20261004210908  vw_rev_tendencia_aov_e_explicacao    <- 20261004c, com arquivo
--
-- O estado final de `vw_rev_tendencia` vem da segunda, que TEM arquivo. Entao
-- as catracas que leem migracoes ja leem a definicao que vale, e o buraco aqui
-- e de registro, nao de comportamento.
--
-- Repetir o SQL da primeira criaria, num banco reconstruido do zero, um estado
-- intermediario que ninguem quer e que seria apagado na linha seguinte. O
-- arquivo existe para a lista bater e para a proxima pessoa nao gastar a
-- mesma meia hora descobrindo o que ele era.
--
-- O SQL original continua recuperavel, e o proprio CLAUDE.md diz como:
--
--   select array_to_string(statements, E'\n')
--     from supabase_migrations.schema_migrations
--    where version = '20261004210733';
--
-- Sao 4.774 caracteres, e o texto dela e sobre a mesma decisao que a
-- 20261004c documenta: os gatilhos do aviso de tendencia continuam sendo CPA
-- e ROAS, e as outras metricas entram para dizer ONDE olhar depois que o
-- alarme disparou, nao como alarme novo.
--
-- -- O nome do arquivo ---------------------------------------------------------
--
-- `20261004bb` e nao `20261004f`: ela rodou ENTRE a `b` e a `c`, e o nome tem
-- de ordenar no mesmo lugar. Com `f` ela viria depois da `c` num banco
-- reconstruido, e a versao mais velha venceria a mais nova.

DO $nada$
BEGIN
  -- Nao ha o que fazer: o estado de `vw_rev_tendencia` vem da 20261004c, logo
  -- abaixo nesta mesma pasta. Este arquivo e registro.
  --
  -- A unica verificacao que cabe e que a view existe e e legivel — se alguem
  -- a apagar, esta migracao passa a falhar e diz por que.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'vw_rev_tendencia'
  ) THEN
    RAISE EXCEPTION 'vw_rev_tendencia nao existe -- a 20261004c nao rodou?';
  END IF;
END
$nada$;
