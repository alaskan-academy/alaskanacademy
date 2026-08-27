-- O Copy não tinha como saber o que ele já tem.
--
-- Para decidir o que escrever hoje, o Lucas precisa de uma resposta que o
-- Kanban da Produção não dá: quanto de estoque cada projeto tem, separado
-- entre "conceito novo" e "variação de algo que já validou". O Kanban mostra
-- 3.777 cards; a pergunta dele cabe em duas colunas.
--
-- ── O que é um AD ───────────────────────────────────────────────────────────
--
-- `AD nnn H%% V%%`. O `AD nnn` é o AD; o resto é variação. E o número é do
-- PROJETO, não global: existe AD 052 na Saponaria e AD 052 em outro projeto.
-- São 615 pares (projeto, número) para 3.777 cards — 5,9 cards por AD.
--
-- ── E por que o lote, e não o AD ────────────────────────────────────────────
--
-- Porque `tipo_teste` é por CARD, não por AD. A variação HERDA o número:
--
--   AD 077 H01 V01        Iteração
--   AD 077 H01 V02..V09   Vertical
--   AD 077 H01 V10..V11   Formato
--   AD 077 H02 V02..V03   Horizontal
--
-- 102 dos 615 ADs têm cards discordando de `tipo_teste`, e não é sujeira: é o
-- modelo funcionando. Contar "ADs distintos" fundiria o novo e a variação num
-- número só — exatamente a conta que o Copy não pode errar.
--
-- Então a unidade é o LOTE: (projeto, número do AD, tipo_teste). "AD 045 novo"
-- e "AD 045 vertical" são duas entregas, que é o que elas são na prática.

-- ── A lista que não pode envelhecer no código ───────────────────────────────
--
-- Trap #3 do CLAUDE.md: o DRE escondeu R$ 10.065 porque as categorias estavam
-- listadas à mão e uma nova não entrou. Aqui a lista vira tabela, e um
-- `tipo_teste` que ninguém mapeou não some — cai em 'outro' e APARECE na tela.
CREATE TABLE IF NOT EXISTS public.criativo_tipos_teste (
  nome    text PRIMARY KEY,
  familia text NOT NULL CHECK (familia IN ('novo','variacao')),
  ordem   int  NOT NULL DEFAULT 0
);

INSERT INTO public.criativo_tipos_teste (nome, familia, ordem) VALUES
  ('Novo','novo',1), ('Iteração','novo',2),
  ('Vertical','variacao',3), ('Horizontal','variacao',4),
  ('Formato','variacao',5), ('Corpo','variacao',6)
ON CONFLICT (nome) DO NOTHING;

ALTER TABLE public.criativo_tipos_teste ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS criativo_tipos_teste_auth ON public.criativo_tipos_teste;
CREATE POLICY criativo_tipos_teste_auth ON public.criativo_tipos_teste
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE public.criativo_tipos_teste IS
  'De/para de producoes.tipo_teste para familia (novo|variacao). E tabela, e nao lista no codigo, para um tipo novo aparecer na tela em vez de sumir da conta.';

-- ── Os pedaços do nome ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_ad_numero(nome text)
 RETURNS integer LANGUAGE sql IMMUTABLE AS $function$
  SELECT (regexp_match(upper(coalesce(nome,'')), '\mAD\s*0*([0-9]{1,4})\M'))[1]::int
$function$;

CREATE OR REPLACE FUNCTION public.fn_ad_hook(nome text)
 RETURNS integer LANGUAGE sql IMMUTABLE AS $function$
  SELECT (regexp_match(upper(coalesce(nome,'')), '\mH\s*0*([0-9]{1,3})\M'))[1]::int
$function$;

-- `funil_video` é texto livre e multivalorado, com separador inconsistente:
-- "TSL, VSL", "TSL,VSL" e "VSL,TSL" são TRÊS strings para a mesma coisa, e
-- agrupar por elas daria três linhas onde há uma. Normaliza para "TSL+VSL".
CREATE OR REPLACE FUNCTION public.fn_funil_video_norm(t text)
 RETURNS text LANGUAGE sql IMMUTABLE AS $function$
  SELECT nullif((
    SELECT string_agg(v, '+' ORDER BY v)
      FROM (SELECT DISTINCT upper(trim(p)) AS v
              FROM unnest(string_to_array(coalesce(t,''), ',')) AS p
             WHERE trim(p) <> '') s
  ), '')
$function$;

-- ── A esteira, um lote por linha ────────────────────────────────────────────
--
-- `security_invoker` para a view NÃO virar um caminho por fora da RLS de
-- `producoes`: ela lê com a identidade de quem consulta, não a do dono.
--
-- Estoque = tudo que não está postado, como foi definido. Um lote entra com UM
-- hook pronto, mas a view mostra `hooks` e `hooks_totais` lado a lado, para
-- "AD 052: 2 de 5" não ler como "AD 052 pronto".
--
-- `dias_parado` sai de `data_inicio` e NÃO de `atualizado_em`: 100% dos cards
-- da esteira aparecem como mexidos nos últimos 30 dias, incluindo um cuja
-- `data_inicio` é 25/08/2025. Alguma coisa toca todas as linhas, então
-- `atualizado_em` não distingue nada. Essa coluna é o que impede o estoque de
-- mentir: Desafios "tem" 14 lotes de novo, e 10 deles pararam há um ANO.
--
-- E a fase entra por EXCLUSÃO, não por lista. Escrevi a lista primeiro e ela já
-- nascia com o defeito: `revisao_copy`, `revisao_gravacao`, `revisao_edicao` e
-- `alteracao` existem no Kanban e ficaram de fora. Hoje não há card em nenhuma
-- delas, então passaria — e no dia em que alguém movesse um card para "Revisão
-- Edição" ele sumiria da esteira sem nada na tela denunciando. Trap #3 de novo.
-- Assim, fase nova nasce visível.
CREATE OR REPLACE VIEW public.vw_esteira_lotes
WITH (security_invoker = true) AS
WITH base AS (
  SELECT p.id, p.projeto_id, p.fase, p.tipo_teste, p.data_inicio, p.responsavel_id,
         fn_ad_numero(p.nome)               AS ad_num,
         fn_ad_hook(p.nome)                 AS hook,
         fn_funil_video_norm(p.funil_video) AS funil,
         coalesce(t.familia,
                  CASE WHEN p.tipo_teste IS NULL THEN 'sem_tipo' ELSE 'outro' END) AS familia,
         CASE p.fase
           WHEN 'briefing'          THEN 1  WHEN 'producao_copy'    THEN 2
           WHEN 'revisao_copy'      THEN 3  WHEN 'gravacao'         THEN 4
           WHEN 'revisao_gravacao'  THEN 5  WHEN 'edicao'           THEN 6
           WHEN 'revisao_edicao'    THEN 7  WHEN 'alteracao'        THEN 8
           WHEN 'aprovado'          THEN 9  WHEN 'esteira_teste'    THEN 10
           ELSE 5 END AS fase_ordem
    FROM public.producoes p
    LEFT JOIN public.criativo_tipos_teste t ON t.nome = p.tipo_teste
   WHERE p.tipo = 'criativo'
     AND p.fase IS NOT NULL
     AND p.fase NOT IN ('postado','na_plataforma','arquivado','bloqueado')
), totais AS (
  SELECT p.projeto_id, fn_ad_numero(p.nome) AS ad_num, p.tipo_teste,
         count(*) AS cards_totais, count(DISTINCT fn_ad_hook(p.nome)) AS hooks_totais
    FROM public.producoes p
   WHERE p.tipo = 'criativo' AND fn_ad_numero(p.nome) IS NOT NULL
   GROUP BY 1,2,3
)
SELECT e.projeto_id,
       o.nome                              AS projeto,
       e.ad_num,
       e.tipo_teste,
       min(e.familia)                      AS familia,
       string_agg(DISTINCT e.funil, ' / ') AS funil,
       count(*)::int                       AS cards,
       count(DISTINCT e.hook)::int         AS hooks,
       max(t.cards_totais)::int            AS cards_totais,
       max(t.hooks_totais)::int            AS hooks_totais,
       (array_agg(e.fase ORDER BY e.fase_ordem DESC))[1] AS fase,
       array_agg(DISTINCT e.fase)          AS fases,
       min(e.data_inicio)                  AS comecou_em,
       max(e.data_inicio)                  AS mexido_em,
       -- clampado em zero: há cards com `data_inicio` no futuro (agendados), e
       -- "parado há -1 dias" não quer dizer nada na tela.
       greatest(current_date - max(e.data_inicio), 0) AS dias_parado,
       coalesce(o.ativo, false)            AS projeto_ativo
  FROM base e
  JOIN totais t ON t.projeto_id IS NOT DISTINCT FROM e.projeto_id
               AND t.ad_num = e.ad_num
               AND t.tipo_teste IS NOT DISTINCT FROM e.tipo_teste
  LEFT JOIN public.ofertas_editores o ON o.id = e.projeto_id
 WHERE e.ad_num IS NOT NULL
 GROUP BY e.projeto_id, o.nome, o.ativo, e.ad_num, e.tipo_teste;

COMMENT ON VIEW public.vw_esteira_lotes IS
  'Um lote por linha: (projeto, numero do AD, tipo_teste). Fase por EXCLUSAO (sai postado/na_plataforma/arquivado/bloqueado) para uma fase nova nascer visivel em vez de sumir.';

-- ── O alerta, que sugere o conserto ─────────────────────────────────────────
--
-- Aviso que só aponta o buraco vira ruído — foi a lição dos 9 anúncios órfãos
-- em Criativos Meta, onde "nenhum card com este nome" calou por meses um card
-- que estava a um caractere de distância.
--
-- Então esta função não diz apenas "falta variação em Workshop Buquê". Ela diz
-- QUAL validado variar: são 19 pares (AD, hook) validados nos projetos ativos
-- que nunca receberam nenhuma variação.
CREATE OR REPLACE FUNCTION public.fn_esteira_defasagem()
 RETURNS TABLE (
   projeto_id uuid, projeto text, empresa text,
   ads_novo int, cards_novo int, novo_dias int,
   ads_variacao int, cards_variacao int, variacao_dias int,
   falta_novo boolean, falta_variacao boolean, prioridade int,
   sug_ad int, sug_hook int, sug_funil text, sug_validado_em date, sug_total int
 )
 LANGUAGE sql STABLE
 SET search_path TO 'public'
AS $function$
  WITH proj AS (
    SELECT o.id, o.nome, e.nome AS empresa
      FROM ofertas_editores o LEFT JOIN empresas e ON e.id = o.empresa_id
     WHERE o.ativo
  ), est AS (
    SELECT l.projeto_id, l.familia,
           count(*)::int           AS ads,
           sum(l.cards)::int       AS cards,
           min(l.dias_parado)::int AS dias
      FROM vw_esteira_lotes l
     WHERE l.familia IN ('novo','variacao')
     GROUP BY 1,2
  ),
  -- Um (AD, hook) validado é a matéria-prima de uma variação: é dele que sai a
  -- vertical, a horizontal, o formato. Se nunca recebeu nenhuma, está parado.
  -- O hook entra na chave porque a variação é do hook, não do AD inteiro: no
  -- AD 077 o H01 virou Vertical e o H02 virou Horizontal, separadamente.
  val AS (
    SELECT p.projeto_id, fn_ad_numero(p.nome) AS ad, fn_ad_hook(p.nome) AS hook,
           max(p.data_inicio) AS validado_em,
           max(fn_funil_video_norm(p.funil_video)) AS funil
      FROM producoes p
     WHERE p.tipo = 'criativo' AND p.avaliacao IN ('Validado','Escalado')
       AND fn_ad_numero(p.nome) IS NOT NULL
     GROUP BY 1,2,3
  ), var AS (
    SELECT DISTINCT p.projeto_id, fn_ad_numero(p.nome) AS ad, fn_ad_hook(p.nome) AS hook
      FROM producoes p JOIN criativo_tipos_teste t ON t.nome = p.tipo_teste
     WHERE p.tipo = 'criativo' AND t.familia = 'variacao'
  ), orfaos AS (
    SELECT v.* FROM val v
     WHERE NOT EXISTS (
       SELECT 1 FROM var
        WHERE var.projeto_id IS NOT DISTINCT FROM v.projeto_id
          AND var.ad = v.ad AND var.hook IS NOT DISTINCT FROM v.hook)
  )
  SELECT pr.id, pr.nome, pr.empresa,
         coalesce(n.ads,0), coalesce(n.cards,0), n.dias,
         coalesce(v.ads,0), coalesce(v.cards,0), v.dias,
         coalesce(n.ads,0) = 0, coalesce(v.ads,0) = 0,
         CASE WHEN coalesce(n.ads,0) = 0 AND coalesce(v.ads,0) = 0 THEN 0
              WHEN coalesce(n.ads,0) = 0 OR  coalesce(v.ads,0) = 0 THEN 1
              ELSE 2 END,
         s.ad, s.hook, s.funil, s.validado_em,
         (SELECT count(*)::int FROM orfaos o2 WHERE o2.projeto_id = pr.id)
    FROM proj pr
    LEFT JOIN est n ON n.projeto_id = pr.id AND n.familia = 'novo'
    LEFT JOIN est v ON v.projeto_id = pr.id AND v.familia = 'variacao'
    -- `desc nulls last`: em Postgres o DESC puro joga os NULL para o TOPO, e um
    -- validado sem data ganharia de "o mais recente" para sempre.
    LEFT JOIN LATERAL (
      SELECT o.ad, o.hook, o.funil, o.validado_em FROM orfaos o
       WHERE o.projeto_id = pr.id
       ORDER BY o.validado_em DESC NULLS LAST, o.ad DESC LIMIT 1
    ) s ON true
   ORDER BY 12, pr.nome;
$function$;

COMMENT ON FUNCTION public.fn_esteira_defasagem() IS
  'Uma linha por projeto ativo: quanto ha de novo e de variacao em estoque, o que falta, e QUAL validado variar. O alerta sugere o conserto em vez de so apontar o buraco.';
