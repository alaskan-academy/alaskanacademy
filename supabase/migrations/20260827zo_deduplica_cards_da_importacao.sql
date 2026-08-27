-- A importação de 23/08 recriou 126 cards que já existiam.
--
-- Naquele dia nasceram 1.554 linhas em `producoes` — 38% da tabela inteira, num
-- dia só. Não foi migração deste repositório e não foi job: nenhum cron e
-- nenhuma Edge Function escreve em `producoes` (a `sync-notion-criativos` grava
-- em `notion_criativos`, que é outra tabela). Foi carga manual.
--
-- E ninguém viu. Só apareceu porque alguém desconfiou de um número — a mesma
-- história de "283 vendas e só 8 order bumps" que está no CLAUDE.md.
--
-- ── Por que não são 201 ─────────────────────────────────────────────────────
--
-- A primeira contagem deu 201 excedentes, e o número era da CHAVE, não do dado:
-- `fn_nome_criativo` normaliza o nome, e isso junta o que alguém já tinha
-- separado à mão. Com o nome exatamente igual são 83. Os outros 118 vêm de uma
-- OUTRA importação ruim, a de 26/01/2026, que criou os cards com sufixo ` (1)`
-- (Cosmética Natural 103, Desafios 12, Flow to Fit 3). Nome distinto, então não
-- quebram contagem — ficam.
--
-- ── E por que não dá para apagar todos ──────────────────────────────────────
--
-- Só 6 dos 179 grupos são idênticos. O campo que MAIS diverge é o link:
--
--   125 grupos   só uma cópia tem vídeo   ← estes, a importação recriou
--    33 grupos   DOIS vídeos diferentes   ← não são duplicatas
--    21 grupos   nenhum tem vídeo
--
-- Os 33 são cards distintos com o mesmo nome (Segredos das Birras 22, Velas
-- Perfeitas 10, ambos inativos). Apagar destruiria trabalho. Ficam intocados.
--
-- ── O que esta migração faz ─────────────────────────────────────────────────
--
-- Apaga só quem: nasceu em 23/08, está sem vídeo, e tem no mesmo grupo um card
-- COM vídeo. São 126 cards em 123 grupos. Antes de apagar, salva o que só a
-- cópia tinha — 16 editores, 1 copy_url, 1 tipo_teste, 1 formato.
--
-- Conferido depois: 4.093 → 3.967, exatamente os 126 planejados; 0 vítimas
-- sobrando; a esteira intacta em 131 cards (nenhuma vítima estava nela).

-- Rede de segurança. Apagar quando a limpeza estiver conferida.
CREATE TABLE IF NOT EXISTS public.backup_producoes_20260827 AS
  SELECT * FROM public.producoes;
ALTER TABLE public.backup_producoes_20260827 ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.backup_producoes_20260827 IS
  'Copia de producoes em 27/08/2026, antes da deduplicacao dos cards recriados pela importacao de 23/08. Sem policy: so o service_role le.';

-- O plano, materializado antes de mexer: é o registro auditável de qual card
-- ficou, qual saiu, e o que migrou entre eles.
CREATE TABLE IF NOT EXISTS public.dedup_producoes_20260827 AS
WITH c AS (
  SELECT p.*, fn_nome_criativo(p.nome) AS base FROM public.producoes p WHERE p.tipo = 'criativo'
),
-- Quem fica: dentro do grupo, o card que TEM vídeo (o mais antigo, se houver mais de um).
guardado AS (
  SELECT DISTINCT ON (projeto_id, base) * FROM c
   WHERE video_editado_url IS NOT NULL
   ORDER BY projeto_id, base, criado_em
),
vitima AS (
  SELECT c.* FROM c
   JOIN guardado g ON g.projeto_id IS NOT DISTINCT FROM c.projeto_id AND g.base = c.base
   WHERE c.id <> g.id
     AND c.criado_em::date = '2026-08-23'
     AND c.video_editado_url IS NULL
)
SELECT v.id AS vitima_id, g.id AS guardado_id, g.projeto_id, g.base,
       g.nome AS nome_guardado, v.nome AS nome_vitima, v.notas,
       CASE WHEN g.copy_url          IS NULL THEN v.copy_url          END AS copy_url,
       CASE WHEN g.responsavel_id    IS NULL THEN v.responsavel_id    END AS responsavel_id,
       CASE WHEN g.tipo_teste        IS NULL THEN v.tipo_teste        END AS tipo_teste,
       CASE WHEN g.formato           IS NULL THEN v.formato           END AS formato,
       CASE WHEN g.funil_video       IS NULL THEN v.funil_video       END AS funil_video,
       CASE WHEN g.avaliacao         IS NULL THEN v.avaliacao         END AS avaliacao,
       CASE WHEN g.data_inicio       IS NULL THEN v.data_inicio       END AS data_inicio,
       CASE WHEN g.ad_id_meta        IS NULL THEN v.ad_id_meta        END AS ad_id_meta,
       CASE WHEN g.gestor_id         IS NULL THEN v.gestor_id         END AS gestor_id,
       CASE WHEN g.copy_id           IS NULL THEN v.copy_id           END AS copy_id,
       CASE WHEN g.especialista_id   IS NULL THEN v.especialista_id   END AS especialista_id,
       CASE WHEN g.video_gravado_url IS NULL THEN v.video_gravado_url END AS video_gravado_url,
       CASE WHEN g.video_story_url   IS NULL THEN v.video_story_url   END AS video_story_url,
       CASE WHEN g.plataforma        IS NULL THEN v.plataforma        END AS plataforma,
       CASE WHEN g.nivel_consciencia IS NULL THEN v.nivel_consciencia END AS nivel_consciencia,
       CASE WHEN g.angulo_teste      IS NULL THEN v.angulo_teste      END AS angulo_teste,
       CASE WHEN g.status_veiculacao IS NULL THEN v.status_veiculacao END AS status_veiculacao
  FROM vitima v JOIN guardado g
    ON g.projeto_id IS NOT DISTINCT FROM v.projeto_id AND g.base = v.base;

ALTER TABLE public.dedup_producoes_20260827 ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.dedup_producoes_20260827 IS
  'Plano da deduplicacao de 27/08/2026: qual card ficou, qual saiu, e que campos migraram. Par com backup_producoes_20260827.';

-- O gatilho fica DESLIGADO durante o reparo: estas linhas não foram editadas no
-- mundo real, e carimbar `atualizado_em` em 126 cards sujaria justamente o sinal
-- de "parado há X" que o gatilho de 20260827zn existe para tornar confiável.
ALTER TABLE public.producoes DISABLE TRIGGER trg_producoes_atualizado_em;

-- 1. Campos que só a cópia tinha, para o card que fica
UPDATE public.producoes g SET
  copy_url          = coalesce(g.copy_url,          d.copy_url),
  responsavel_id    = coalesce(g.responsavel_id,    d.responsavel_id),
  tipo_teste        = coalesce(g.tipo_teste,        d.tipo_teste),
  formato           = coalesce(g.formato,           d.formato),
  funil_video       = coalesce(g.funil_video,       d.funil_video),
  avaliacao         = coalesce(g.avaliacao,         d.avaliacao),
  data_inicio       = coalesce(g.data_inicio,       d.data_inicio),
  ad_id_meta        = coalesce(g.ad_id_meta,        d.ad_id_meta),
  gestor_id         = coalesce(g.gestor_id,         d.gestor_id),
  copy_id           = coalesce(g.copy_id,           d.copy_id),
  especialista_id   = coalesce(g.especialista_id,   d.especialista_id),
  video_gravado_url = coalesce(g.video_gravado_url, d.video_gravado_url),
  video_story_url   = coalesce(g.video_story_url,   d.video_story_url),
  plataforma        = coalesce(g.plataforma,        d.plataforma),
  nivel_consciencia = coalesce(g.nivel_consciencia, d.nivel_consciencia),
  angulo_teste      = coalesce(g.angulo_teste,      d.angulo_teste),
  status_veiculacao = coalesce(g.status_veiculacao, d.status_veiculacao)
FROM public.dedup_producoes_20260827 d
WHERE g.id = d.guardado_id;

-- 2. `funil_video` escrito como prosa dentro da nota, no único caso em que o
--    campo estruturado do card que fica estava vazio.
UPDATE public.producoes g
   SET funil_video = trim((regexp_match(d.notas, 'Funil:\s*([^\n]+)'))[1])
  FROM public.dedup_producoes_20260827 d
 WHERE g.id = d.guardado_id AND g.funil_video IS NULL AND d.notas ~ 'Funil:';

-- 3. A nota da importação era "Funil: TSL" — o mesmo dado do campo, em prosa, em
--    TODAS as 126. Não migra: poluiria 126 cards com uma cópia de um campo
--    estruturado. Só o "Hook: X%" é informação que o card que fica não tem, e
--    são 20 deles.
UPDATE public.producoes g
   SET notas = trim((regexp_match(d.notas, '(Hook:\s*[^\n]+)'))[1])
  FROM public.dedup_producoes_20260827 d
 WHERE g.id = d.guardado_id AND g.notas IS NULL AND d.notas ~ 'Hook:';

-- 4. O vínculo com o Meta, antes do CASCADE levar embora.
--    `producao_ads.producao_id` tem ON DELETE CASCADE. A ligação foi feita por
--    `origem = 'automatico'`, batendo por nome — e o nome era idêntico nos dois,
--    então pegou o gêmeo errado, o que não tem vídeo. Repontar para o card que
--    fica é a correção, não um efeito colateral.
UPDATE public.producao_ads a
   SET producao_id = d.guardado_id
  FROM public.dedup_producoes_20260827 d
 WHERE a.producao_id = d.vitima_id
   AND NOT EXISTS (SELECT 1 FROM public.producao_ads b WHERE b.producao_id = d.guardado_id);

-- 5. E então as cópias saem
DELETE FROM public.producoes
 WHERE id IN (SELECT vitima_id FROM public.dedup_producoes_20260827);

ALTER TABLE public.producoes ENABLE TRIGGER trg_producoes_atualizado_em;

-- ── O índice único seria o certo, e não dá para criar ───────────────────────
--
-- `unique (projeto_id, lower(trim(nome)))` impediria a próxima importação de
-- recriar card existente. Mas 61 cards de nome idêntico continuam na tabela por
-- decisão — os 33 pares de vídeos diferentes. Com eles ali, a criação falha.
--
-- Então no lugar do bloqueio, a denúncia. Sem isto a próxima importação ruim
-- passaria calada de novo.
CREATE OR REPLACE VIEW public.vw_producoes_duplicadas
WITH (security_invoker = true) AS
WITH c AS (
  SELECT p.id, p.projeto_id, p.nome, p.fase, p.tipo_teste, p.criado_em,
         p.video_editado_url, p.copy_url, p.responsavel_id,
         fn_nome_criativo(p.nome) AS base
    FROM public.producoes p
   WHERE p.tipo = 'criativo'
), g AS (
  SELECT projeto_id, base,
         count(*)                          AS cards,
         count(DISTINCT video_editado_url) AS videos_distintos,
         count(video_editado_url)          AS com_video,
         min(criado_em)                    AS primeiro,
         max(criado_em)                    AS ultimo
    FROM c GROUP BY 1,2 HAVING count(*) > 1
)
SELECT g.projeto_id,
       o.nome                    AS projeto,
       coalesce(o.ativo, false)  AS projeto_ativo,
       g.base                    AS nome_normalizado,
       g.cards,
       (g.cards - 1)             AS excedentes,
       g.primeiro::date          AS primeiro_criado,
       g.ultimo::date            AS ultimo_criado,
       -- A leitura que decide o que fazer com o grupo, e a mesma que separou os
       -- 126 apagáveis dos 33 intocáveis.
       CASE WHEN g.videos_distintos > 1                          THEN 'videos diferentes'
            WHEN g.videos_distintos = 1 AND g.com_video < g.cards THEN 'copia sem video'
            WHEN g.videos_distintos = 0                          THEN 'nenhum tem video'
            ELSE 'mesmo video' END AS natureza,
       (SELECT array_agg(c.nome ORDER BY c.criado_em) FROM c
         WHERE c.projeto_id IS NOT DISTINCT FROM g.projeto_id AND c.base = g.base) AS nomes
  FROM g LEFT JOIN public.ofertas_editores o ON o.id = g.projeto_id;

COMMENT ON VIEW public.vw_producoes_duplicadas IS
  'Cards criativos com o mesmo nome dentro do mesmo projeto, classificados por natureza. Existe porque o indice unico nao pode ser criado enquanto houver duplicatas legitimas -- entao a proxima importacao ruim precisa pelo menos APARECER.';
