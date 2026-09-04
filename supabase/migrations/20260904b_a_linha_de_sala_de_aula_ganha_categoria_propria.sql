-- A LINHA DE SALA DE AULA GANHA CATEGORIA PROPRIA
--
-- Dois alarmes apontavam para o mesmo lugar:
--
--     1 conta de anuncio gastando sem produto definido   R$   354,37
--     9 vendas sem categoria de produto                  R$ 1.147,66
--
-- As duas eram do "Guia do Comportamento na Sala de Aula", da Aeliss.
--
-- A CAUSA
--
-- `mapear_produto_por_nome` e uma lista de palavras escrita a mao que so
-- conhece vela, saponaria e cosmetico. Qualquer outro nome devolve NULL. Ela ja
-- estava atrasada em relacao ao proprio enum: `hormonal`, `velaroma` e
-- `handify` existem como valores e a funcao nunca os devolve.
--
-- E O RESTO ESTAVA ROTULADO ERRADO
--
-- As contas irmas da Aeliss (Desafios na Sala, Guia do Comportamento pela BM
-- Lumii) estavam marcadas como `velas`. Nao e imprecisao: `velas` e a linha de
-- velas da ALASKAN, com 3.470 vendas e R$ 248.633. Guia de comportamento em
-- sala de aula nao e vela, e somar os dois num agrupamento seria misturar duas
-- operacoes num rotulo so — que e a razao de o CLAUDE.md dizer "nunca casar
-- dinheiro por produto: produto e rotulo, nao dono".
--
-- O nome `sala_de_aula` vem dos proprios produtos: Desafios na Sala de Aula,
-- Guia do Comportamento na Sala de Aula, Limites Respeitosos. E rotulo de
-- exibicao — trocar depois custa um UPDATE.
--
-- O valor do enum entra em migracao separada porque `ALTER TYPE ... ADD VALUE`
-- precisa estar comitado antes de ser usado:
--
--     ALTER TYPE produto_tipo ADD VALUE IF NOT EXISTS 'sala_de_aula';

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

  IF n LIKE '%vela%'   OR n LIKE '%aromatiz%' OR n LIKE '%difusor%'  THEN RETURN 'velas';      END IF;
  IF n LIKE '%sapon%'  OR n LIKE '%sabao%'    OR n LIKE '%sabonete%' THEN RETURN 'saponaria';  END IF;
  IF n LIKE '%cosmet%' OR n LIKE '%beleza%'   OR n LIKE '%pele%'
  OR n LIKE '%skin%'   OR n LIKE '%dermato%'                         THEN RETURN 'cosmeticos'; END IF;
  RETURN NULL;
END;
$function$;

-- Corrige o passado: o que e da Aeliss e nao e vela. O recorte e por EMPRESA
-- somado ao nome, e nao so pelo nome, para nao arrastar nada da Alaskan.
UPDATE vendas v
   SET produto = 'sala_de_aula'
  FROM empresas e
 WHERE e.id = v.empresa_id AND e.nome ILIKE 'Aeliss%'
   AND (v.produto IS NULL OR v.produto::text = 'velas')
   AND mapear_produto_por_nome(v.produto_nome) = 'sala_de_aula';

UPDATE metricas_meta m
   SET produto = 'sala_de_aula'
  FROM empresas e
 WHERE e.id = m.empresa_id AND e.nome ILIKE 'Aeliss%'
   AND (m.produto IS NULL OR m.produto::text = 'velas');

UPDATE ad_accounts a
   SET produto = 'sala_de_aula', atualizado_em = now()
  FROM ofertas_editores o, empresas e
 WHERE o.id = a.projeto_id AND e.id = o.empresa_id AND e.nome ILIKE 'Aeliss%'
   AND (a.produto IS NULL OR a.produto::text = 'velas');
