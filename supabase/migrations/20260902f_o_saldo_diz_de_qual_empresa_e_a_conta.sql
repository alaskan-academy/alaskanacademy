-- O SALDO DIZ DE QUAL EMPRESA E A CONTA
--
-- Em "Ambas" as duas empresas tem uma conta chamada "Conta Simples", e a tela
-- mostrava duas linhas identicas — quem olha nao sabe qual saldo e de quem.
-- Era exatamente o "visualizar claramente" falhando, so que na empresa em vez
-- de no banco.
--
-- O nome e o slug vao junto para a lista marcar a empresa com o ponto de cor
-- (`--empresa-<slug>` em index.css), do mesmo jeito que o seletor no cabecalho.
-- Nunca hex dentro de componente.
--
-- Colunas novas vao no FIM: CREATE OR REPLACE VIEW so aceita assim.

CREATE OR REPLACE VIEW vw_saldo_contas AS
SELECT c.id, c.empresa_id, c.nome, c.tipo, c.saldo_inicial, c.data_referencia,
       c.ordem, c.ativo,
       COALESCE(m.movimento, 0)                   AS movimento,
       COALESCE(m.qtd, 0)                          AS qtd_movimentos,
       c.saldo_inicial + COALESCE(m.movimento, 0)  AS saldo,
       e.nome                                      AS empresa_nome,
       e.slug                                      AS empresa_slug
  FROM contas c
  JOIN empresas e ON e.id = c.empresa_id
  LEFT JOIN LATERAL (
    SELECT sum(t.valor) AS movimento, count(*) AS qtd
      FROM transacoes t
      JOIN conta_fontes cf
        ON cf.empresa_id = t.empresa_id AND cf.fonte = t.fonte
     WHERE cf.conta_id = c.id
       AND t.data > c.data_referencia
  ) m ON true;
