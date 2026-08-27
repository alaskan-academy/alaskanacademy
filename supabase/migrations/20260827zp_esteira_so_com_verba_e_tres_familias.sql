-- Três correções na Esteira, todas vindas de olhar o número e desconfiar.
--
-- ── 1. Projeto sem verba não tem defasagem de criativo ─────────────────────
--
-- O alerta cobrava 5 projetos, e dois deles (Handify, Velarte Essencial) nunca
-- gastaram um centavo; um terceiro (Guia dos Comportamentos) parou. Cobrar
-- criativo de quem não está rodando tráfego é ruído, e ruído ensina a ignorar
-- o alerta inteiro.
--
-- O caminho é `metricas_meta` -> `producao_ads` -> `producoes` -> projeto.
-- `metricas_meta.produto` NÃO serve: só tem 'saponaria' e 'velas'.
-- Cobertura conferida: 95,4% do investimento dos últimos 7 dias tem card ligado.
--
-- Sobram 4: Saponaria R$ 22.603, Velas Lembrancinhas R$ 4.070, Workshop Buquê
-- R$ 1.963, Desafios R$ 357.
--
-- ── 2. Iteração sai de dentro de "novo" ────────────────────────────────────
--
-- Eram duas famílias e passam a ser três, porque a meta é 20% novo contra 80%
-- iteração e variação — e com iteração dentro de "novo" não dava para medir
-- isso. O mix real de hoje, nos projetos com verba:
--
--   Desafios       7 / 7 / 0    50% novo
--   Saponaria      5 / 2 / 5    42% novo
--   Velas Lembr.   2 / 0 / 2    50% novo
--   Workshop       0 / 0 / 3     0% novo
--
-- Três de quatro estão no dobro da meta. A escada de prioridade segue o 80/20:
-- falta de iteração vem antes de falta de variação, que vem antes de mix
-- estourado, que vem antes de falta de novo — novo é só 20% do alvo.
--
-- A meta em si mora em `configuracoes`, com os parâmetros fiscais: é número de
-- negócio, e muda sem deploy.
--
-- ── 3. A sugestão precisa ser de um AD que ainda recebe dinheiro ───────────
--
-- A tela sugeria "varie o AD 025 H01, validado em 15/05/2025". Dos 23 validados
-- órfãos, 13 não recebem verba há mais de 30 dias — e o AD 025 é um deles.
-- Variar aquilo não devolve nada.
--
-- Filtrando por investimento em 30 dias sobram 10, e a ordem passa a ser por
-- DINHEIRO e não por data: AD 045 H04 da Saponaria, R$ 6.659, rodou hoje. A
-- data de validação nunca diria isso.

-- ── Iteração vira família própria ───────────────────────────────────────────
ALTER TABLE public.criativo_tipos_teste DROP CONSTRAINT IF EXISTS criativo_tipos_teste_familia_check;
ALTER TABLE public.criativo_tipos_teste ADD CONSTRAINT criativo_tipos_teste_familia_check
  CHECK (familia IN ('novo','iteracao','variacao'));

UPDATE public.criativo_tipos_teste SET familia = 'iteracao' WHERE nome = 'Iteração';

INSERT INTO public.configuracoes (chave, valor) VALUES ('esteira_pct_novo_meta', 20)
ON CONFLICT (chave) DO NOTHING;

-- ── Quanto cada projeto está gastando ──────────────────────────────────────
--
-- `nivel = 'ad'` é obrigatório: campanha, adset e ad somam o MESMO total
-- (R$ 30.396,32 nos últimos 7 dias), então somar os três triplicaria o gasto.
-- Já errei exatamente isso nesta tabela.
CREATE OR REPLACE VIEW public.vw_projeto_investimento
WITH (security_invoker = true) AS
SELECT p.projeto_id,
       sum(m.investimento) FILTER (WHERE m.data >= current_date - 7)  AS inv_7d,
       sum(m.investimento) FILTER (WHERE m.data >= current_date - 30) AS inv_30d,
       max(m.data) FILTER (WHERE m.investimento > 0)                  AS ultimo_dia
  FROM public.metricas_meta m
  JOIN public.producao_ads a ON a.ad_id = m.ad_id
  JOIN public.producoes    p ON p.id    = a.producao_id
 WHERE m.nivel = 'ad' AND m.data >= current_date - 30 AND p.projeto_id IS NOT NULL
 GROUP BY 1;

COMMENT ON VIEW public.vw_projeto_investimento IS
  'Investimento Meta por projeto em 7 e 30 dias. Filtra nivel=ad porque os tres niveis somam o mesmo total.';

-- E quanto cada CARD gastou, para a sugestão poder ser ordenada por dinheiro e
-- para o pedido de variação mostrar o que está em jogo sem pedir que alguém
-- digite de novo o que o banco já sabe.
CREATE OR REPLACE VIEW public.vw_criativo_investimento
WITH (security_invoker = true) AS
SELECT a.producao_id,
       sum(m.investimento)          AS inv_30d,
       sum(m.faturamento_atribuido) AS fat_30d,
       max(m.data)                  AS ultimo_dia
  FROM public.metricas_meta m
  JOIN public.producao_ads a ON a.ad_id = m.ad_id
 WHERE m.nivel = 'ad' AND m.data >= current_date - 30
 GROUP BY 1;

COMMENT ON VIEW public.vw_criativo_investimento IS
  'Investimento e faturamento atribuido por card nos ultimos 30 dias.';

-- ── E a defasagem, reescrita ───────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_esteira_defasagem();

CREATE OR REPLACE FUNCTION public.fn_esteira_defasagem()
 RETURNS TABLE (
   projeto_id uuid, projeto text, empresa text,
   inv_7d numeric, inv_30d numeric,
   ads_novo int, ads_iteracao int, ads_variacao int,
   cards_novo int, cards_iteracao int, cards_variacao int,
   novo_dias int, iteracao_dias int, variacao_dias int,
   falta_novo boolean, falta_iteracao boolean, falta_variacao boolean,
   pct_novo int, pct_novo_meta int, mix_estourado boolean,
   prioridade int,
   sug_ad int, sug_hook int, sug_funil text, sug_validado_em date,
   sug_investido numeric, sug_total int,
   funis_projeto text
 )
 LANGUAGE sql STABLE
 SET search_path TO 'public'
AS $function$
  WITH meta AS (
    SELECT coalesce((SELECT valor FROM configuracoes WHERE chave = 'esteira_pct_novo_meta'), 20)::int AS pct
  ),
  -- Só projeto que está rodando tráfego.
  proj AS (
    SELECT o.id, o.nome, e.nome AS empresa, i.inv_7d, i.inv_30d
      FROM ofertas_editores o
      LEFT JOIN empresas e ON e.id = o.empresa_id
      JOIN vw_projeto_investimento i ON i.projeto_id = o.id
     WHERE o.ativo AND coalesce(i.inv_7d, 0) > 0
  ), est AS (
    SELECT l.projeto_id, l.familia,
           count(*)::int           AS ads,
           sum(l.cards)::int       AS cards,
           min(l.dias_parado)::int AS dias
      FROM vw_esteira_lotes l
     WHERE l.familia IN ('novo','iteracao','variacao')
     GROUP BY 1,2
  ), funis AS (
    SELECT p.projeto_id,
           string_agg(DISTINCT fn_funil_video_norm(p.funil_video), ' / ') AS fv
      FROM producoes p
     WHERE p.tipo = 'criativo'
       AND fn_funil_video_norm(p.funil_video) IS NOT NULL
       AND (p.avaliacao IN ('Validado','Escalado')
            OR p.fase NOT IN ('postado','na_plataforma','arquivado','bloqueado'))
     GROUP BY 1
  ), val AS (
    SELECT p.id, p.projeto_id, fn_ad_numero(p.nome) AS ad, fn_ad_hook(p.nome) AS hook,
           max(p.data_inicio) AS validado_em,
           max(fn_funil_video_norm(p.funil_video)) AS funil
      FROM producoes p
     WHERE p.tipo = 'criativo' AND p.avaliacao IN ('Validado','Escalado')
       AND fn_ad_numero(p.nome) IS NOT NULL
     GROUP BY 1,2,3,4
  ), var AS (
    SELECT DISTINCT p.projeto_id, fn_ad_numero(p.nome) AS ad, fn_ad_hook(p.nome) AS hook
      FROM producoes p JOIN criativo_tipos_teste t ON t.nome = p.tipo_teste
     WHERE p.tipo = 'criativo' AND t.familia = 'variacao'
  ),
  -- Onde já existe PEDIDO humano aberto, a inferência se cala.
  --
  -- São duas fontes de "o que variar": a sugestão (validado com verba e sem
  -- variação) e a decisão (alguém apertou o botão). Sem isto o mesmo AD 045 H04
  -- aparecia DUAS vezes na mesma tela — uma na faixa de alerta e outra na fila
  -- — com dois textos diferentes. O pedido tem um porquê escrito por uma
  -- pessoa; a inferência não. Quem tem dono ganha.
  pedidos AS (
    SELECT DISTINCT p.projeto_id, fn_ad_numero(p.nome) AS ad, fn_ad_hook(p.nome) AS hook
      FROM pedidos_variacao pv JOIN producoes p ON p.id = pv.producao_id
     WHERE pv.status = 'aberto'
  ), orfaos AS (
    SELECT v.projeto_id, v.ad, v.hook, v.validado_em, v.funil, ci.inv_30d
      FROM val v
      JOIN vw_criativo_investimento ci ON ci.producao_id = v.id AND ci.inv_30d > 0
     WHERE NOT EXISTS (
       SELECT 1 FROM var
        WHERE var.projeto_id IS NOT DISTINCT FROM v.projeto_id
          AND var.ad = v.ad AND var.hook IS NOT DISTINCT FROM v.hook)
       AND NOT EXISTS (
       SELECT 1 FROM pedidos pe
        WHERE pe.projeto_id IS NOT DISTINCT FROM v.projeto_id
          AND pe.ad = v.ad AND pe.hook IS NOT DISTINCT FROM v.hook)
  ), tot AS (
    SELECT pr.id,
           coalesce(n.ads,0) AS n, coalesce(it.ads,0) AS i, coalesce(v.ads,0) AS v
      FROM proj pr
      LEFT JOIN est n  ON n.projeto_id  = pr.id AND n.familia  = 'novo'
      LEFT JOIN est it ON it.projeto_id = pr.id AND it.familia = 'iteracao'
      LEFT JOIN est v  ON v.projeto_id  = pr.id AND v.familia  = 'variacao'
  )
  SELECT pr.id, pr.nome, pr.empresa,
         round(pr.inv_7d, 2), round(pr.inv_30d, 2),
         t.n, t.i, t.v,
         coalesce(n.cards,0), coalesce(it.cards,0), coalesce(v.cards,0),
         n.dias, it.dias, v.dias,
         t.n = 0, t.i = 0, t.v = 0,
         CASE WHEN (t.n+t.i+t.v) = 0 THEN 0
              ELSE round(100.0 * t.n / (t.n+t.i+t.v))::int END,
         m.pct,
         (t.n+t.i+t.v) > 0 AND (100.0 * t.n / (t.n+t.i+t.v)) > m.pct,
         -- A escada de prioridade sai do 80/20: o balde de 80% é iteração +
         -- variação, e dentro dele a iteração vem primeiro, como pedido.
         -- Falta de "novo" é o menos urgente — ele é só 20% da meta.
         CASE WHEN (t.n+t.i+t.v) = 0                                     THEN 0
              WHEN t.i = 0                                               THEN 1
              WHEN t.v = 0                                               THEN 2
              WHEN (100.0 * t.n / (t.n+t.i+t.v)) > m.pct                 THEN 3
              WHEN t.n = 0                                               THEN 4
              ELSE 5 END,
         s.ad, s.hook, s.funil, s.validado_em, round(s.inv_30d, 2),
         (SELECT count(*)::int FROM orfaos o2 WHERE o2.projeto_id = pr.id),
         f.fv
    FROM proj pr
    CROSS JOIN meta m
    JOIN tot t ON t.id = pr.id
    LEFT JOIN est n   ON n.projeto_id  = pr.id AND n.familia  = 'novo'
    LEFT JOIN est it  ON it.projeto_id = pr.id AND it.familia = 'iteracao'
    LEFT JOIN est v   ON v.projeto_id  = pr.id AND v.familia  = 'variacao'
    LEFT JOIN funis f ON f.projeto_id  = pr.id
    -- Ordenado por DINHEIRO, não por data de validação.
    LEFT JOIN LATERAL (
      SELECT o.ad, o.hook, o.funil, o.validado_em, o.inv_30d FROM orfaos o
       WHERE o.projeto_id = pr.id
       ORDER BY o.inv_30d DESC NULLS LAST, o.validado_em DESC NULLS LAST LIMIT 1
    ) s ON true
   ORDER BY 21, pr.inv_7d DESC;
$function$;

COMMENT ON FUNCTION public.fn_esteira_defasagem() IS
  'Uma linha por projeto ativo COM investimento nos ultimos 7 dias: estoque em novo/iteracao/variacao, o mix contra a meta de 80/20, e qual validado variar -- o que mais recebeu verba em 30 dias e que ainda nao tem pedido humano aberto.';
