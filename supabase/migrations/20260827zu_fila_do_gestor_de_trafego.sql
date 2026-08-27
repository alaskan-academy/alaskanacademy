-- A fila do Gestor de Tráfego, e o fim da gambiarra dos bloquinhos.
--
-- Para saber quantos ADs tinha de cada projeto e funil, ele arrastava os cards
-- aprovados para datas diferentes no calendário e lia os "bloquinhos" que se
-- formavam. Só que o calendário posiciona por `data_prazo ?? data_inicio`, e
-- arrastar mexe nos DOIS — ou seja, para montar um agrupamento visual ele
-- reescrevia o prazo que o editor combinou. Depois de duas semanas nada estava
-- mais no lugar, e cards se perdiam.
--
-- ── Por que ele chegou a isso ──────────────────────────────────────────────
--
-- Duas causas, as duas no banco.
--
-- 1. `aprovado` estava com `setor_id` NULO em `producao_fases`. O "Meu Painel"
--    filtra pelas fases do setor, então a fila de aprovados — que é o trabalho
--    dele — nem aparecia no painel dele.
--
-- 2. E as fases que ele TEM (`esteira_teste`, `postado`) usam
--    `campo_dono = gestor_id`, que filtra por pessoa. Só que apenas 1 dos 69
--    cards em `esteira_teste` tem esse campo preenchido: o painel mostrava
--    1 de 69. Por isso `aprovado` ganha setor mas NÃO ganha `campo_dono` — a
--    fila é do setor, não de uma pessoa, e há um gestor só.

UPDATE public.producao_fases
   SET setor_id = (SELECT id FROM public.setores WHERE nome = 'Gestor de Tráfego'),
       campo_dono = NULL
 WHERE chave = 'aprovado';

-- ── As duas fases dele, um card por linha ──────────────────────────────────
--
-- Uma view para as duas, e não duas quase iguais: a diferença entre
-- "esperando" e "em teste" é uma coluna, e duplicar a resolução de
-- projeto/funil/família seria a primeira armadilha do CLAUDE.md.
--
-- A classificação vem de `criativo_tipos_teste` e `fn_funil_video_norm` — as
-- MESMAS da Esteira do Copy. Se este painel decidisse por conta própria o que
-- é iteração, em três meses os dois discordariam.
--
-- Os tipos aceitos saem de `producao_fases_tipo` e não de uma lista aqui:
-- `esteira_teste` aceita `criativo` e `vsl`, e `aula` não passa por teste. Tipo
-- novo entra sozinho.
CREATE OR REPLACE VIEW public.vw_gestor_fila
WITH (security_invoker = true) AS
SELECT p.id,
       p.nome,
       p.fase,
       p.tipo,
       p.tipo_teste,
       coalesce(t.familia,
                CASE WHEN p.tipo_teste IS NULL THEN 'sem_tipo' ELSE 'outro' END) AS familia,
       fn_funil_video_norm(p.funil_video) AS funil,
       fn_ad_numero(p.nome)               AS ad_num,
       fn_ad_hook(p.nome)                 AS hook,
       p.projeto_id,
       o.nome                             AS projeto,
       coalesce(o.ativo, false)           AS projeto_ativo,
       p.data_inicio,
       p.data_prazo,
       resp.nome                          AS editor,
       p.video_editado_url,
       -- Desde quando está parado. Sai do HISTÓRICO da entrada na fase, e não
       -- de `atualizado_em` — aquele campo foi reescrito por três cargas em
       -- massa e não distingue nada antes de 27/08/2026.
       entrou.em::date                    AS entrou_na_fase_em,
       greatest(current_date - coalesce(entrou.em::date, p.data_inicio), 0) AS dias_na_fase
  FROM public.producoes p
  LEFT JOIN public.criativo_tipos_teste t ON t.nome = p.tipo_teste
  LEFT JOIN public.ofertas_editores o    ON o.id = p.projeto_id
  LEFT JOIN public.perfis resp           ON resp.id = p.responsavel_id
  LEFT JOIN LATERAL (
    SELECT min(h.criado_em) AS em FROM public.criativo_historico h
     WHERE h.criativo_id = p.id AND h.campo_alterado = 'fase' AND h.valor_novo = p.fase
  ) entrou ON true
 WHERE p.fase IN ('aprovado', 'esteira_teste')
   AND p.tipo IN (SELECT tipo FROM public.producao_fases_tipo WHERE fase_chave = 'esteira_teste');

COMMENT ON VIEW public.vw_gestor_fila IS
  'As duas fases do Gestor de Trafego -- aprovado (esperando) e esteira_teste (em teste) -- com projeto, funil e familia resolvidos. Os tipos aceitos saem de producao_fases_tipo.';

-- ── O envio para a esteira, em lote e com data ─────────────────────────────
--
-- Grava `data_inicio` e NÃO toca em `data_prazo`. Essa é a metade do conserto:
-- o prazo de produção deixa de ser reescrito para fazer agrupamento visual.
--
-- `data_inicio` porque ele já significa isso na prática — medido: em 147 de
-- 184 cards (80%) é exatamente o dia em que o card virou `postado`, e 96%
-- dentro de um dia. Não é campo novo dizendo o que outro já diz.
--
-- Conferido num begin/rollback com o AD 061 (5 hooks): fase aprovado →
-- esteira_teste, `data_inicio` 26/08 → 01/09, `data_prazo` 26/08 → 26/08
-- intocado, e uma linha de histórico por card.
CREATE OR REPLACE FUNCTION public.fn_enviar_para_esteira(
  p_ids uuid[], p_data date, p_usuario uuid
) RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_n integer;
BEGIN
  WITH antes AS (
    SELECT id, fase FROM producoes WHERE id = ANY(p_ids) AND fase = 'aprovado'
  ), movidos AS (
    UPDATE producoes p
       SET fase = 'esteira_teste', data_inicio = p_data
      FROM antes a WHERE p.id = a.id
    RETURNING p.id, a.fase AS de
  ), reg AS (
    INSERT INTO criativo_historico
      (criativo_id, usuario_id, tipo_alteracao, campo_alterado, valor_anterior, valor_novo)
    SELECT m.id, p_usuario, 'fase', 'fase', m.de, 'esteira_teste' FROM movidos m
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM reg;
  RETURN v_n;
END;
$function$;

COMMENT ON FUNCTION public.fn_enviar_para_esteira(uuid[], date, uuid) IS
  'Move cards aprovados para esteira_teste com a data de teste em data_inicio, e grava o historico. Nao toca em data_prazo.';
