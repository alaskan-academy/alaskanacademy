-- A FONTE PRINCIPAL DE CADA CONTA
--
-- Qual `fonte` um lancamento MANUAL naquela conta recebe.
--
-- O lancamento manual gravava `fonte: 'manual'` fixo, e 'manual' nao pertence a
-- conta nenhuma: o dinheiro entrava no DRE e o saldo do banco nao se mexia.
-- Agora ele grava a fonte da conta escolhida.
--
-- A Conta Simples tem DUAS fontes (conta e cartao) e o lancamento tem de cair na
-- conta, nao no cartao. Marcar aqui, em vez de criar `contas.fonte_padrao`,
-- evita um segundo campo dizendo a mesma coisa: o indice unico parcial garante
-- exatamente uma principal por conta, e ela E uma das fontes da conta por
-- construcao.

ALTER TABLE conta_fontes
  ADD COLUMN IF NOT EXISTS principal boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS conta_fontes_uma_principal
  ON conta_fontes (conta_id) WHERE principal;

UPDATE conta_fontes SET principal = true
 WHERE fonte IN ('conta_simples', 'c6', 'inter');

COMMENT ON COLUMN conta_fontes.principal IS
  'A fonte que um lancamento manual nesta conta recebe. Uma por conta.';
