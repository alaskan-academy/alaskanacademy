-- PARA QUAL FUNIL ESTE CARD FOI FEITO
--
-- Ela autorizou recriar a ligação card→funil, que é a coluna apagada em
-- 21/09/2026 depois de derrubar a Produção duas vezes. Três coisas mudam em
-- relação àquela, e cada uma é o motivo de ela ter morrido.
--
-- ── 1. O NOME, PORQUE SÃO DUAS PERGUNTAS DIFERENTES ────────────────────────
--
-- `funil_alvo_id`, e não `funil_id`. Já existe `vw_criativo_funil`, que diz de
-- qual REV a VENDA daquele anúncio veio — isso é FATO, derivado do dinheiro.
-- Este campo é INTENÇÃO: para qual funil o card foi FEITO.
--
-- Os dois discordam de propósito, e é justamente na discordância que mora o
-- pedido dela: "fiz ad do funil X, o funil X não foi testado, o ad acabou
-- rodando contra a página Y e foi descartado". Alvo = X, fato = Y.
--
-- Chamar os dois de `funil_id` seria a primeira armadilha do CLAUDE.md com o
-- desfecho já conhecido — é o mesmo par de `status_veiculacao` (intenção) com
-- `vw_producao_estado_ads` (fato), que já custou R$ 3.581 em 7 dias antes de
-- alguém notar que 32% dos "Pausado" estavam rodando.
--
-- ── 2. NASCE COM O FORMULÁRIO, SENÃO É A MESMA COLUNA VAZIA ────────────────
--
-- `producoes.funil_id` morreu com 0 de 4.098 linhas preenchidas porque NADA a
-- preenchia: não havia campo no formulário. Cadastro sem quem cadastre é a
-- segunda armadilha, e a condição que ela pôs para autorizar foi exatamente
-- esta — o campo entra no `CriativoFormModal` na mesma leva.
--
-- ── 3. SEM BACKFILL, E ISSO É DECISÃO ──────────────────────────────────────
--
-- Dava para preencher o passado a partir de `vw_criativo_funil`. Seria errado:
-- copiar o FATO para dentro da INTENÇÃO apaga a distinção que o campo existe
-- para guardar, e apaga logo nos cards que mais importam — os que rodaram
-- contra a página errada ficariam registrados como se tivessem sido feitos
-- para ela.
--
-- Inventar a intenção de alguém é pior que o campo vazio: o vazio se vê, e o
-- errado não. Os 3.794 criativos existentes ficam com alvo nulo, e a tela
-- mostra "sem funil alvo" como grupo nomeado em vez de escondê-los.
--
-- ── A ORDEM DO DEPLOY ──────────────────────────────────────────────────────
--
-- ACRESCENTAR é o lado seguro: código antigo que não conhece a coluna continua
-- funcionando, e a chave estrangeira nova não é usada por nenhum embed do
-- PostgREST ainda. Foi APAGAR que derrubou a Produção, não adicionar.

ALTER TABLE producoes
  ADD COLUMN IF NOT EXISTS funil_alvo_id uuid REFERENCES funis(id) ON DELETE SET NULL;

COMMENT ON COLUMN producoes.funil_alvo_id IS
  'INTENCAO: para qual funil este card foi feito. Nao confundir com vw_criativo_funil, que e FATO (de qual REV veio a venda do anuncio). Ver 20260924e.';

/* O indice serve a pergunta que o campo existe para responder — "quais cards
   sao deste funil" — e ignora os nulos, que sao a maioria e nao interessam. */
CREATE INDEX IF NOT EXISTS idx_producoes_funil_alvo
  ON producoes (funil_alvo_id) WHERE funil_alvo_id IS NOT NULL;

-- A prateleira passa a saber o alvo.
CREATE OR REPLACE VIEW public.vw_criativo_por_angulo AS
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
       CASE
         WHEN p.avaliacao IN ('Validado', 'Escalado')    THEN 'validado'
         WHEN p.avaliacao = 'Não validado'                THEN 'descartado'
         WHEN p.fase IN ('aprovado', 'esteira_teste')     THEN 'pronto'
         WHEN p.fase = 'arquivado'                        THEN 'arquivado'
         WHEN p.fase = 'postado'                          THEN 'rodou_sem_veredito'
         ELSE 'em_producao'
       END AS estado,
       p.funil_alvo_id,
       fa.nome             AS funil_alvo,
       fa.produto          AS funil_alvo_produto
  FROM producoes p
  LEFT JOIN ofertas_editores oe ON oe.id = p.projeto_id
  LEFT JOIN perfis pe           ON pe.id = p.responsavel_id
  LEFT JOIN funis fa            ON fa.id = p.funil_alvo_id
  LEFT JOIN vw_producao_estado_ads e ON e.producao_id = p.id
 WHERE p.tipo = 'criativo';

-- ── As provas ───────────────────────────────────────────────────────────────
DO $prova$
DECLARE
  v_n int; v_view int; v_base int;
BEGIN
  -- 1. A coluna existe e é NULA em todo mundo. Se vier preenchida, alguém
  --    fez backfill — e backfill aqui inventa intenção que ninguém teve.
  SELECT count(*) INTO v_n FROM producoes WHERE funil_alvo_id IS NOT NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% cards ja nascem com funil_alvo_id — houve backfill, e ele inventa intencao', v_n;
  END IF;

  -- 2. A chave estrangeira existe. Sem ela, `funil_alvo_id` vira texto com
  --    cara de uuid e aponta para funil apagado sem nada reclamar.
  SELECT count(*) INTO v_n
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'producoes' AND c.contype = 'f'
     AND pg_get_constraintdef(c.oid) ILIKE '%funil_alvo_id%REFERENCES funis%';
  IF v_n = 0 THEN
    RAISE EXCEPTION 'funil_alvo_id nasceu sem chave estrangeira para funis';
  END IF;

  -- 3. A view continua sem perder card: ela existe para NAO perder ad feito, e
  --    o join novo com `funis` e LEFT justamente porque o alvo e quase sempre
  --    nulo hoje. Um INNER aqui apagaria 3.794 criativos da prateleira.
  SELECT count(*) INTO v_view FROM public.vw_criativo_por_angulo;
  SELECT count(*) INTO v_base FROM producoes WHERE tipo = 'criativo';
  IF v_view <> v_base THEN
    RAISE EXCEPTION 'view tem % criativos e a tabela tem % — o join do alvo comeu card', v_view, v_base;
  END IF;

  -- 4. As colunas novas chegaram na view.
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_name = 'vw_criativo_por_angulo'
     AND column_name IN ('funil_alvo_id', 'funil_alvo');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'a view nao expos funil_alvo_id e funil_alvo (achei %)', v_n;
  END IF;

  RAISE NOTICE 'funil_alvo_id criado, % criativos na prateleira, nenhum com alvo (correto)', v_view;
END
$prova$;

NOTIFY pgrst, 'reload schema';
