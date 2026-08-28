-- ── O swipe separa criativo interno de externo ────────────────────────────
--
-- NENHUM CAMPO NOVO: `source` FOI DESENHADO PARA ISSO E NUNCA FOI USADO
--
-- `copytrack_ad_swipe.source` já existe e já tinha até um CHECK declarando o
-- vocabulário:
--
--   CHECK (source = ANY (ARRAY['proprio', 'concorrente', 'referencia']))
--
-- Ou seja: alguém pensou exatamente nesta separação quando criou a tabela. E
-- as 35 linhas estão todas em 'proprio' — o formulário nunca escreveu o campo
-- e a tela nunca o mostrou. Não é campo faltando, é campo abandonado; o mesmo
-- feitio de `venda_itens.converteu`, aposentado horas atrás.
--
-- Antes de criar coluna, procurar se alguma existente já responde aquilo é a
-- primeira armadilha da CLAUDE.md. Esta responde.
--
-- POR QUE DOIS VALORES E NÃO OS TRÊS
--
-- 'concorrente' e 'referencia' têm ZERO linhas, e a separação pedida é binária:
-- é nosso ou não é. Manter três opções num formulário para uma pergunta de
-- duas obriga a decidir toda vez entre "concorrente" e "referência" — decisão
-- que ninguém pediu e que, sem tela que a use, envelheceria igual ao campo.
--
-- Se um dia a distinção importar, é um valor a mais no CHECK e uma opção a
-- mais no seletor. Tirar depois é que seria caro.
--
-- A CLASSIFICAÇÃO POR NOME ACONTECE UMA VEZ, AQUI, E NUNCA MAIS
--
-- Os criativos internos têm "AD xxx" no título. Isso classifica os 35:
--
--   30 com "AD" seguido de número   ->  interno
--    5 sem                          ->  externo
--
-- Os cinco externos, conferidos um a um: "Conteúdo Gratuito Converte Mais",
-- "Estrutura de Resultados Clássicos" e "Robô de IA Gera Leads" (os três do
-- Intent Based Branding), "Venda Silenciosa TikTok Shop" e "Google Paga R$1200
-- Sem Investir - Ingressos 10x". Os cinco são anúncio de terceiro.
--
-- **O último merece um olhar seu**: ele tem `ad_code = 'AD 059 (adaptado)'`.
-- Pelo título é externo, e o código registra que ele virou o nosso AD 059 --
-- que é justamente o uso certo de um swipe. Se a intenção era marcá-lo como
-- interno, é um clique no formulário.
--
-- A regra do nome NÃO fica no código. Ela roda uma vez, neste arquivo, e daí
-- em diante quem decide é a pessoa no formulário. Manter a derivação viva ao
-- lado do campo seria a armadilha 1 de novo: duas fontes para a mesma
-- resposta, esperando divergir no primeiro ad que fuja do padrão de nome.
--
-- ORDEM DAS INSTRUÇÕES
--
-- O CHECK antigo cai ANTES do UPDATE. Na primeira tentativa ele veio depois, e
-- o UPDATE para 'interno' bateu no CHECK que ainda exigia 'proprio' -- a
-- migration inteira voltou atrás, sem deixar nada pela metade.
ALTER TABLE copytrack_ad_swipe
  DROP CONSTRAINT IF EXISTS copytrack_ad_swipe_source_check;

UPDATE copytrack_ad_swipe
   SET source = CASE
         WHEN title ~* '(^|[^a-z])ad[ _-]?[0-9]' THEN 'interno'
         ELSE 'externo'
       END;

ALTER TABLE copytrack_ad_swipe
  ALTER COLUMN source SET DEFAULT 'interno',
  ALTER COLUMN source SET NOT NULL;

-- O CHECK é o que impede o campo de morrer de novo: com dois valores possíveis
-- e `NOT NULL`, não há estado em branco nem terceiro valor entrando de fininho.
ALTER TABLE copytrack_ad_swipe
  ADD CONSTRAINT copytrack_ad_swipe_source_check
  CHECK (source IN ('interno', 'externo'));

COMMENT ON COLUMN copytrack_ad_swipe.source IS
  'interno = criativo nosso; externo = anuncio de terceiro guardado como referencia. Preenchido pelo formulario -- a classificacao pelo "AD xxx" do titulo rodou uma vez, na migration 20260828zl, e nao vive no codigo.';
