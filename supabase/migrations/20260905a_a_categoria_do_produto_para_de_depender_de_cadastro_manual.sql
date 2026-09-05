-- A CATEGORIA DO PRODUTO PARA DE DEPENDER DE CADASTRO MANUAL
--
-- O alarme "4 vendas sem categoria de produto" voltou no dia seguinte ao
-- conserto. Ontem eu corrigi `mapear_produto_por_nome` e escrevi que precisava
-- achar quem PREENCHE o campo — achei a funcao e nao verifiquei se alguem a
-- CHAMA. Ninguem chamava.
--
-- AS DUAS LOGICAS PARA A MESMA DECISAO
--
--   fn_auto_produto_venda      gatilho real: le `ofertas.produto` pelo
--                              `code_payt` do payload
--   mapear_produto_por_nome    regra por palavra no nome — CODIGO MORTO,
--                              nenhuma funcao, tela ou Edge Function a usava
--
-- Armadilha 1 na forma mais cara: consertei a que ninguem usa, o dado antigo
-- melhorou e o novo continuou entrando nulo. O teste que escrevi ontem guardava
-- uma funcao que nao fazia nada.
--
-- E POR QUE FALHOU AGORA
--
-- `ofertas` nao se alimenta: nenhum insert no app nem nas Edge Functions. A
-- oferta RAOJGY (Guia do Comportamento) simplesmente nao existe la, entao o
-- gatilho nao tinha onde buscar. Todo produto novo da Payt nasce sem categoria
-- e ninguem descobre — armadilha 4, espelho sem gatilho.
--
-- O QUE MUDA
--
-- O gatilho ganha FALLBACK: se a oferta nao diz, a regra por nome decide.
-- `ofertas.produto` continua ganhando quando existe — e a escolha explicita
-- dela, e o especifico vence o generico, mesma logica de `fn_config`.
--
-- A funcao morta vira viva, entao o teste que a guarda passa a guardar algo.
--
-- O QUE NAO FACO: CRIAR A OFERTA SOZINHO
--
-- `ofertas.tipo` e NOT NULL e e decisao dela — upsell, order bump ou oferta
-- principal nao se deduz do nome. Inventar ali seria o chute que vira erro
-- silencioso. Em vez disso `vw_ofertas_faltando` mostra o que vendeu sem
-- cadastro: a maquina resolve o que da para derivar, a pessoa decide o resto,
-- e o buraco fica VISIVEL em vez de silencioso.
--
-- Sao 6 hoje, R$ 12.008,43 — o maior e o "Handify Artesanato Completo", com 31
-- vendas desde 01/08 e nenhuma linha em `ofertas`.
--
-- `saboaria` entra na regra porque e sinonimo real de saponaria e nenhum padrao
-- existente o alcancava: "Combo Mestre da Saboaria em Casa" caia fora.
--
-- CONFERIDO FAZENDO O GATILHO AGIR
--
-- Tres vendas de teste com `code_payt` inexistente:
--   "Guia do Comportamento na Sala de Aula"        -> sala_de_aula
--   "Combo Mestre da Saboaria em Casa"             -> saponaria
--   "Produto Totalmente Novo Sem Palavra Conhecida"-> NULO, de proposito
-- O terceiro e o caso importante: "Outros" honesto vale mais que chute.

CREATE OR REPLACE FUNCTION public.mapear_produto_por_nome(p_nome text)
 RETURNS produto_tipo
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  n TEXT := LOWER(UNACCENT(COALESCE(p_nome, '')));
BEGIN
  /* A linha de sala de aula vem PRIMEIRO de proposito. "Guia das Velas de
     Intencao" e vela; "Guia do Comportamento na Sala de Aula" nao e, e se a
     regra de vela rodasse antes, um produto novo com a palavra "vela" no meio
     do nome cairia no balde errado sem ninguem ver. */
  IF n LIKE '%sala de aula%' OR n LIKE '%comportamento%'
  OR n LIKE '%berrinche%'    OR n LIKE '%limites respeitosos%' THEN RETURN 'sala_de_aula'; END IF;

  IF n LIKE '%vela%'    OR n LIKE '%aromatiz%' OR n LIKE '%difusor%'  THEN RETURN 'velas';      END IF;
  IF n LIKE '%sapon%'   OR n LIKE '%sabao%'    OR n LIKE '%sabonete%'
  OR n LIKE '%saboaria%'                                              THEN RETURN 'saponaria';  END IF;
  IF n LIKE '%cosmet%'  OR n LIKE '%beleza%'   OR n LIKE '%pele%'
  OR n LIKE '%skin%'    OR n LIKE '%dermato%'                         THEN RETURN 'cosmeticos'; END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_auto_produto_venda()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_produto produto_tipo;
  v_code_payt text;
BEGIN
  IF NEW.produto IS NOT NULL THEN
    RETURN NEW;
  END IF;

  /* 1) A oferta cadastrada, que e a escolha EXPLICITA dela. Ganha sempre. */
  v_code_payt := NEW.payload_webhook->'product'->>'code';
  IF v_code_payt IS NOT NULL THEN
    SELECT produto INTO v_produto
      FROM ofertas
     WHERE code_payt = v_code_payt AND produto IS NOT NULL
     LIMIT 1;
  END IF;

  /* 2) Sem cadastro, a regra pelo nome. Antes daqui a venda ficava nula para
        sempre, e nulo vira "Outros" na tela sem dizer por que. */
  IF v_produto IS NULL THEN
    v_produto := public.mapear_produto_por_nome(NEW.produto_nome);
  END IF;

  NEW.produto := v_produto;
  RETURN NEW;
END;
$function$;

-- O que vendeu sem ter oferta cadastrada. `tipo` e NOT NULL e e decisao dela,
-- entao nao da para criar a linha sozinho — mas o buraco tem de aparecer.
CREATE OR REPLACE VIEW vw_ofertas_faltando AS
SELECT v.payload_webhook->'product'->>'code' AS code_payt,
       max(v.produto_nome)                    AS nome_visto,
       count(*)                               AS vendas,
       round(sum(v.valor_total), 2)           AS faturamento,
       min(v.data_venda)                      AS primeira_venda,
       max(v.data_venda)                      AS ultima_venda,
       mapear_produto_por_nome(max(v.produto_nome)) AS categoria_derivavel
  FROM vendas v
 WHERE v.status = 'aprovada'
   AND v.payload_webhook->'product'->>'code' IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM ofertas o WHERE o.code_payt = v.payload_webhook->'product'->>'code')
 GROUP BY 1
 ORDER BY sum(v.valor_total) DESC;

COMMENT ON VIEW vw_ofertas_faltando IS
  'Produtos que venderam e nao tem linha em `ofertas`. Sem isso, produto novo '
  'da Payt nasce sem categoria e ninguem descobre. Nao da para criar a oferta '
  'sozinho porque `tipo` (upsell/orderbump/principal) e decisao humana.';

-- Corrige o que ja entrou nulo, so onde a regra decide.
UPDATE vendas v
   SET produto = mapear_produto_por_nome(v.produto_nome)
 WHERE v.produto IS NULL
   AND mapear_produto_por_nome(v.produto_nome) IS NOT NULL;

-- E as ofertas cadastradas sem categoria, pelo mesmo criterio.
UPDATE ofertas o
   SET produto = mapear_produto_por_nome(o.nome), atualizado_em = now()
 WHERE o.produto IS NULL
   AND mapear_produto_por_nome(o.nome) IS NOT NULL;
