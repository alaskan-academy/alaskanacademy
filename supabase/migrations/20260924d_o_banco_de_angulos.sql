-- O BANCO DE ÂNGULOS: o ad que já foi feito não pode se perder
--
-- Pedido dela: "quando for subir a página do ângulo correto, mostrar os ads que
-- já foram descartados ou usados". O cenário que ela descreveu: fez ads de um
-- funil, o funil não foi testado, os ads acabaram rodando contra OUTRA página,
-- foram mal porque o ângulo era incongruente, e foram descartados. Quando a
-- página do ângulo certo subir, eles deveriam voltar à mesa.
--
-- ── O QUE NÃO DAVA PARA FAZER ──────────────────────────────────────────────
--
-- Ela pediu "ads daquele funil". Essa ligação NÃO EXISTE: era
-- `producoes.funil_id`, apagada em 21/09/2026 por estar vazia em 4.098 de
-- 4.098 linhas. E não dá para reconstruí-la: casar por `projeto_id + metodo`
-- devolve o MESMO conjunto para REVs irmãos — REV9 e REV5, ambos Saponaria/TSL,
-- dão os mesmos 197 cards. Isso responde "ads do projeto com este método", que
-- é outra pergunta.
--
-- Então esta view não usa funil. Usa o eixo que o cenário dela realmente tem:
-- o ÂNGULO. `producoes.angulo_teste` existe em 1.784 criativos, com 213 valores
-- distintos. É texto livre e está vazio em 2.010 — por isso a tela mostra
-- "sem ângulo" como um grupo, em vez de escondê-los.
--
-- ── "JÁ RODOU" NÃO SE MEDE PELO VÍNCULO DE ANÚNCIO ─────────────────────────
--
-- A tentação era `ads_ligados > 0`. Medido: dos 2.913 cards em `postado`, só
-- 521 têm vínculo — porque `fn_fixar_vinculo_ads` só liga quando há
-- EXATAMENTE um card candidato para o anúncio. Os outros 2.392 rodaram e
-- ficaram sem vínculo.
--
-- O que prova que o card rodou é o VEREDITO: 2.377 postados estão marcados
-- "Não validado", e ninguém julga o que não rodou. Por isso o estado sai da
-- avaliação e da fase, não do vínculo.

CREATE OR REPLACE VIEW public.vw_criativo_por_angulo
  WITH (security_invoker = on) AS
SELECT p.id                AS producao_id,
       p.nome,
       p.projeto_id,
       oe.nome             AS projeto,
       oe.empresa_id,
       coalesce(nullif(btrim(p.angulo_teste), ''), '— sem ângulo —') AS angulo,
       p.metodo_video,
       p.formato,
       p.nivel_consciencia,
       p.fase,
       p.avaliacao,
       p.responsavel_id,
       pe.nome             AS responsavel,
       p.data_inicio,
       coalesce(e.ads_ligados, 0) AS ads_ligados,
       e.ultimo_gasto,
       /* A ORDEM IMPORTA: o veredito ganha da fase, porque um card "Não
          validado" rodou, qualquer que seja a fase em que ele parou. */
       CASE
         WHEN p.avaliacao IN ('Validado', 'Escalado')    THEN 'validado'
         WHEN p.avaliacao = 'Não validado'                THEN 'descartado'
         WHEN p.fase IN ('aprovado', 'esteira_teste')     THEN 'pronto'
         WHEN p.fase = 'arquivado'                        THEN 'arquivado'
         WHEN p.fase = 'postado'                          THEN 'rodou_sem_veredito'
         ELSE 'em_producao'
       END AS estado
  FROM producoes p
  LEFT JOIN ofertas_editores oe ON oe.id = p.projeto_id
  LEFT JOIN perfis pe           ON pe.id = p.responsavel_id
  LEFT JOIN vw_producao_estado_ads e ON e.producao_id = p.id
 WHERE p.tipo = 'criativo';

COMMENT ON VIEW public.vw_criativo_por_angulo IS
  'Todo criativo com o angulo dele e o que aconteceu: pronto (nunca rodou), descartado, validado, arquivado. Serve para reencontrar ad ja feito quando a pagina do angulo certo sobe. Ver 20260924d.';

-- ── As provas ───────────────────────────────────────────────────────────────
DO $prova$
DECLARE
  v_view int; v_base int; v_ruim int; v_prontos int; v_desc int;
BEGIN
  -- 1. Nenhum criativo pode sumir: a view existe para NÃO perder ad feito, e
  --    perder card aqui seria a falha exata que ela quer evitar.
  SELECT count(*) INTO v_view FROM public.vw_criativo_por_angulo;
  SELECT count(*) INTO v_base FROM producoes WHERE tipo = 'criativo';
  IF v_view <> v_base THEN
    RAISE EXCEPTION 'view tem % criativos e a tabela tem % — a view esta perdendo card', v_view, v_base;
  END IF;

  -- 2. Todo card tem estado. Nulo aqui viraria linha sem coluna na tela.
  SELECT count(*) INTO v_ruim FROM public.vw_criativo_por_angulo WHERE estado IS NULL;
  IF v_ruim <> 0 THEN RAISE EXCEPTION '% cards sem estado', v_ruim; END IF;

  -- 3. Todo card tem angulo — os sem angulo viram um grupo nomeado, e nao NULL
  --    que a tela teria de tratar em cada lugar.
  SELECT count(*) INTO v_ruim FROM public.vw_criativo_por_angulo WHERE angulo IS NULL OR angulo = '';
  IF v_ruim <> 0 THEN RAISE EXCEPTION '% cards com angulo vazio', v_ruim; END IF;

  -- 4. `pronto` quer dizer NUNCA RODOU. Card com veredito nao pode estar la:
  --    seria oferecer para testar o que ja foi testado.
  SELECT count(*) INTO v_ruim FROM public.vw_criativo_por_angulo
   WHERE estado = 'pronto' AND avaliacao IS NOT NULL AND avaliacao <> 'Sem dados';
  IF v_ruim <> 0 THEN RAISE EXCEPTION '% cards "pronto" com veredito', v_ruim; END IF;

  -- 5. Os dois grupos que a tela existe para mostrar nao podem estar vazios,
  --    senao a tela nasce sem serventia.
  SELECT count(*) INTO v_prontos FROM public.vw_criativo_por_angulo WHERE estado = 'pronto';
  SELECT count(*) INTO v_desc    FROM public.vw_criativo_por_angulo WHERE estado = 'descartado';
  IF v_prontos = 0 THEN RAISE EXCEPTION 'nenhum card pronto — a regra de "pronto" nunca casa'; END IF;
  IF v_desc = 0    THEN RAISE EXCEPTION 'nenhum card descartado — a regra de "descartado" nunca casa'; END IF;

  RAISE NOTICE 'vw_criativo_por_angulo: % criativos, % prontos, % descartados', v_view, v_prontos, v_desc;
END
$prova$;

NOTIFY pgrst, 'reload schema';
