/*
  `configuracoes` era chave/valor global. Com duas empresas, isso vira mentira.

  A Aeliss é Simples também, mas com a alíquota DELA e o custo fixo DELA. Do jeito
  que estava, ela herdaria os 10% e os R$ 25.000 da Alaskan sem nada na tela
  dizendo — o DRE dela sairia com números de outra empresa, e com cara de certo.

  HERDAR CONTINUA PERMITIDO. O QUE MUDA É QUE APARECE.

  A tentação era exigir valor próprio por empresa. Seria pior: enquanto ninguém
  preenchesse, a alíquota da Aeliss seria ZERO, e imposto zero infla o lucro. Um
  número herdado está errado por uma diferença; um número zerado está errado pelo
  valor inteiro, e ninguém desconfia de um lucro alto.

  Então a regra é: `empresa_id` nulo vale para todas, `empresa_id` preenchido
  ganha da geral, e `vw_config_por_empresa` mostra qual é qual. Cadastro sem
  coluna de resultado envelhece — esta é a coluna de resultado.

  NENHUMA CHAVE É "ESPECIAL"

  Não existe lista de quais chaves podem variar por empresa. Toda chave pode.
  Uma lista dessas seria mais uma que envelhece calada quando aparecer a próxima
  chave fiscal — e o DRE do Financeiro já escondeu R$ 10.065 exatamente assim.
*/

ALTER TABLE configuracoes ADD COLUMN IF NOT EXISTS empresa_id uuid REFERENCES empresas(id);

COMMENT ON COLUMN configuracoes.empresa_id IS
  'Nulo = vale para todas as empresas. Preenchido = sobrepoe a geral para aquela '
  'empresa. Ler sempre por fn_config(chave, empresa), nunca direto da tabela.';

/*
  A unicidade passa a ser por (chave, empresa). NULLS NOT DISTINCT porque, sem
  ele, o Postgres deixaria existir duas linhas gerais da mesma chave — e aí
  qual das duas vale vira sorteio.
*/
ALTER TABLE configuracoes DROP CONSTRAINT IF EXISTS configuracoes_chave_key;
CREATE UNIQUE INDEX IF NOT EXISTS configuracoes_chave_empresa_key
  ON configuracoes (chave, empresa_id) NULLS NOT DISTINCT;

/**
 * O valor de uma chave para uma empresa.
 *
 * A especifica ganha da geral. Passar empresa nula devolve a geral — que e o
 * comportamento de hoje, para nada quebrar enquanto as telas nao passam empresa.
 *
 * Existe para que a regra "a especifica ganha" more em UM lugar. Repetida em
 * cada consulta, ela divergiria; e a versao errada seria a que ninguem olhou.
 */
CREATE OR REPLACE FUNCTION fn_config(p_chave text, p_empresa uuid DEFAULT NULL)
RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT c.valor
    FROM configuracoes c
   WHERE c.chave = p_chave
     AND (c.empresa_id = p_empresa OR c.empresa_id IS NULL)
   ORDER BY (c.empresa_id IS NOT NULL) DESC
   LIMIT 1;
$$;

/*
  Qual empresa esta usando qual numero, e se e dela ou emprestado.

  Sem esta view, "a Aeliss esta com a aliquota da Alaskan" e uma pergunta que so
  se responde lendo a tabela linha a linha — ou seja, uma pergunta que ninguem
  faz ate o contador reclamar.
*/
CREATE OR REPLACE VIEW vw_config_por_empresa AS
  SELECT e.id                       AS empresa_id,
         e.nome                     AS empresa,
         g.chave,
         g.descricao,
         fn_config(g.chave, e.id)   AS valor,
         CASE WHEN EXISTS (
                SELECT 1 FROM configuracoes p
                 WHERE p.chave = g.chave AND p.empresa_id = e.id
              ) THEN 'propria' ELSE 'herdada' END AS origem
    FROM empresas e
    CROSS JOIN (SELECT chave, descricao FROM configuracoes WHERE empresa_id IS NULL) g
   WHERE e.ativo;

COMMENT ON VIEW vw_config_por_empresa IS
  'Que numero cada empresa esta usando, e se e dela (propria) ou da configuracao '
  'geral (herdada). Herdar e permitido; herdar sem saber e que nao.';

REVOKE ALL ON vw_config_por_empresa FROM anon;
GRANT SELECT ON vw_config_por_empresa TO authenticated;
