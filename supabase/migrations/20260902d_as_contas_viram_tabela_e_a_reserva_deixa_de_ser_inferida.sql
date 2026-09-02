-- AS CONTAS VIRAM TABELA, E A RESERVA DEIXA DE SER INFERIDA
--
-- Ate aqui existia UMA reserva por empresa (`caixa_config`), e o saldo dela era
-- DEDUZIDO do extrato da Conta Simples: pegava a foto manual e somava, com o
-- sinal invertido, tudo que saiu da CS categorizado como reserva. Funcionava
-- enquanto havia um lugar so para o dinheiro morar.
--
-- Agora sao tres bancos na Alaskan e um na Aeliss, e a pergunta virou outra:
-- QUANTO TEM EM CADA CONTA. Deduzir isso do extrato de outra conta deixaria o
-- numero do C6 dependendo do extrato da CS — dois numeros para a mesma coisa,
-- que e a armadilha 1 e sempre divergem.
--
-- O MODELO
--
--   contas         uma linha por conta bancaria, com a FOTO do saldo
--   conta_fontes   quais `fonte` de `transacoes` caem naquela conta
--
-- Duas classes, que e a divisao que ela pediu:
--
--   fluxo   o dinheiro que gira — Conta Simples
--   caixa   o dinheiro parado —  C6 e Inter
--
-- POR QUE O CARTAO NAO E CONTA
--
-- Na Conta Simples o cartao DEBITA a propria conta; nao e fatura a pagar
-- depois. A Aeliss prova ao centavo, porque a conta nasceu do zero:
--
--     conta_simples        +2.000,00
--     conta_simples_cartao     -8,06
--                          ─────────
--                           1.991,94   = o saldo que ela informou
--
-- Por isso `conta_fontes` e uma tabela e nao uma coluna em `contas`: uma conta
-- tem VARIAS fontes. E por isso nao existe `transacoes.conta_id` — `fonte` ja
-- diz de onde a linha veio, e ja e metade da chave de deduplicacao. Um segundo
-- campo dizendo a mesma coisa precisaria de gatilho para nao divergir.
--
-- POR QUE O SALDO E UMA FOTO, E NAO A SOMA DO HISTORICO
--
-- O extrato da Alaskan comeca em 01/12/2025 sem saldo de abertura. Somando tudo
-- da R$ 7.844,09; o saldo real e R$ 1.578,42. A diferenca e o que existia antes
-- do primeiro registro, e ela nao esta em lugar nenhum. A foto ancora o numero
-- no que o banco mostra HOJE, e so os movimentos POSTERIORES a ela somam —
-- mesma regra que `caixa_config` ja usava, e pelo mesmo motivo: movimento
-- anterior a foto e o que PRODUZIU a foto, e contaria duas vezes.
--
-- `caixa_config` fica de pe, sem leitor, ate ela conferir os numeros novos.

CREATE TABLE IF NOT EXISTS contas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id),
  nome            text NOT NULL,
  /* `fluxo` = o dinheiro que gira; `caixa` = o dinheiro parado. A tela soma
     por esta coluna, entao banco novo entra escolhendo o lado — sem lista de
     nomes escrita no codigo. */
  tipo            text NOT NULL CHECK (tipo IN ('fluxo', 'caixa')),
  saldo_inicial   numeric NOT NULL DEFAULT 0,
  /* A data da foto. Movimento ANTERIOR a ela nao soma: ele ja esta embutido. */
  data_referencia date NOT NULL,
  ordem           int  NOT NULL DEFAULT 0,
  ativo           boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, nome),
  /* Alvo do FK composto de `conta_fontes`: garante que a fonte e a conta
     pertencem a MESMA empresa. Sem isso, `conta_simples` da Aeliss poderia
     apontar para a conta da Alaskan e o saldo somaria dinheiro alheio. */
  UNIQUE (id, empresa_id)
);

CREATE TABLE IF NOT EXISTS conta_fontes (
  empresa_id uuid NOT NULL,
  fonte      text NOT NULL,
  conta_id   uuid NOT NULL,
  PRIMARY KEY (empresa_id, fonte),
  FOREIGN KEY (conta_id, empresa_id) REFERENCES contas(id, empresa_id) ON DELETE CASCADE
);

COMMENT ON TABLE contas IS
  'Uma linha por conta bancaria, com a FOTO do saldo e a data dela. '
  'Substitui caixa_config, que so sabia de uma reserva por empresa.';
COMMENT ON TABLE conta_fontes IS
  'Quais valores de transacoes.fonte caem em cada conta. E tabela e nao coluna '
  'porque uma conta tem varias fontes: na Conta Simples o cartao debita a '
  'propria conta.';

ALTER TABLE contas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE conta_fontes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contas_authenticated ON contas;
CREATE POLICY contas_authenticated ON contas
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS conta_fontes_authenticated ON conta_fontes;
CREATE POLICY conta_fontes_authenticated ON conta_fontes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

/* O saldo de cada conta: a foto mais o que se mexeu DEPOIS dela.

   `movimento` fica exposto ao lado do saldo de proposito — quando o numero da
   tela nao bater com o do aplicativo do banco, e a primeira coisa a olhar:
   ou a foto envelheceu, ou entrou lancamento que nao devia. */
CREATE OR REPLACE VIEW vw_saldo_contas AS
SELECT c.id, c.empresa_id, c.nome, c.tipo, c.saldo_inicial, c.data_referencia,
       c.ordem, c.ativo,
       COALESCE(m.movimento, 0)                   AS movimento,
       COALESCE(m.qtd, 0)                          AS qtd_movimentos,
       c.saldo_inicial + COALESCE(m.movimento, 0)  AS saldo
  FROM contas c
  LEFT JOIN LATERAL (
    SELECT sum(t.valor) AS movimento, count(*) AS qtd
      FROM transacoes t
      JOIN conta_fontes cf
        ON cf.empresa_id = t.empresa_id AND cf.fonte = t.fonte
     WHERE cf.conta_id = c.id
       AND t.data > c.data_referencia
  ) m ON true;

COMMENT ON VIEW vw_saldo_contas IS
  'Saldo por conta = foto + movimentos posteriores a data da foto. '
  'Expoe `movimento` separado para dar onde olhar quando nao bater com o banco.';
