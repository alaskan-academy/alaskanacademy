-- `vw_faturamento_liquido` somava reembolso e chargeback numa coluna só.
--
-- ── Por que separar ───────────────────────────────────────────────────────
--
-- São perdas de naturezas diferentes e com causas diferentes. Reembolso é o
-- cliente desistindo — mexe em oferta, promessa, entrega. Chargeback é o
-- cliente contestando na operadora — mexe em cobrança, descrição na fatura,
-- suporte. Somados, a tela diz "1,4% voltou atrás" e não diz o que fazer.
--
-- Em agosto/2026, Alaskan: 23 reembolsos de R$ 2.415,28 e 2 chargebacks de
-- R$ 399,96. Proporções muito diferentes, escondidas atrás de um total.
--
-- ── E o que isso conserta na cascata do Resultado ─────────────────────────
--
-- A venda reembolsada muda de `status` e sai de `faturamento_bruto`, que só
-- soma `aprovada`. A tela de Resultado a subtraía DE NOVO, punindo o mesmo
-- evento duas vezes — R$ 2.815,24 em agosto, sobre uma receita que nunca a
-- continha.
--
-- O conserto não é apagar a linha: é somar o que voltou atrás de volta ao topo
-- ("pago pelos clientes") e descontá-lo UMA vez, com o motivo visível. Aí o
-- primeiro número é de verdade tudo que entrou, e a cascata mostra onde o
-- dinheiro se perde — que é a pergunta que a tela existe para responder.
--
-- ── A coluna antiga continua ─────────────────────────────────────────────
--
-- `reembolsos` fica, sendo a soma das duas novas. Não é a primeira armadilha:
-- as três saem da MESMA expressão, no mesmo CTE, na mesma passada — não há como
-- divergirem. O que não pode é alguém somar `reembolsos + perda_reembolso`
-- achando que são coisas diferentes; por isso o comentário na coluna diz.

do $$
declare
  def text;
  antigo text;
begin
  def := pg_get_viewdef('vw_faturamento_liquido'::regclass, true);

  if position('perda_chargeback' in def) > 0 then
    raise notice 'ja separado; nada a fazer';
    return;
  end if;

  /* 1. As duas somas novas, ao lado da que ja existe. */
  antigo := E'                END) AS reembolsos,\n';
  if position(antigo in def) = 0 then
    raise exception 'ancora 1 (soma de reembolsos) nao encontrada';
  end if;
  def := replace(def, antigo,
      E'                END) AS reembolsos,\n'
   || E'            sum(\n'
   || E'                CASE\n'
   || E'                    WHEN v.status = ''reembolsada''::status_venda THEN fn_perda_da_venda(v.valor_total, v.valor_reembolsado)\n'
   || E'                    ELSE 0::numeric\n'
   || E'                END) AS perda_reembolso,\n'
   || E'            sum(\n'
   || E'                CASE\n'
   || E'                    WHEN v.status = ''chargeback''::status_venda THEN fn_perda_da_venda(v.valor_total, v.valor_reembolsado)\n'
   || E'                    ELSE 0::numeric\n'
   || E'                END) AS perda_chargeback,\n');

  /* 2. Atravessam o FULL JOIN. */
  antigo := E'            COALESCE(v.reembolsos, 0::numeric) AS reembolsos,\n';
  if position(antigo in def) = 0 then
    raise exception 'ancora 2 (coalesce em juntos) nao encontrada';
  end if;
  def := replace(def, antigo,
      E'            COALESCE(v.reembolsos, 0::numeric) AS reembolsos,\n'
   || E'            COALESCE(v.perda_reembolso, 0::numeric) AS perda_reembolso,\n'
   || E'            COALESCE(v.perda_chargeback, 0::numeric) AS perda_chargeback,\n');

  /* 3. Atravessam o CTE de configuracao. */
  antigo := E'            j.reembolsos,\n';
  if position(antigo in def) = 0 then
    raise exception 'ancora 3 (passagem em com_cfg) nao encontrada';
  end if;
  def := replace(def, antigo,
      E'            j.reembolsos,\n'
   || E'            j.perda_reembolso,\n'
   || E'            j.perda_chargeback,\n');

  /* 4. Saem no fim: `CREATE OR REPLACE VIEW` so aceita coluna nova no final. */
  antigo := E'    empresa_id\n   FROM com_cfg c;';
  if position(antigo in def) = 0 then
    raise exception 'ancora 4 (fim do SELECT) nao encontrada';
  end if;
  def := replace(def, antigo,
      E'    empresa_id,\n    perda_reembolso,\n    perda_chargeback\n   FROM com_cfg c;');

  execute 'create or replace view vw_faturamento_liquido as ' || def;
end $$;

comment on view vw_faturamento_liquido is
  'Faturamento, taxas, impostos e investimento por dia/produto/empresa. '
  'ATENCAO: `reembolsos` e a SOMA de `perda_reembolso` e `perda_chargeback` — '
  'as tres saem da mesma expressao e somar a total com uma das partes conta '
  'duas vezes. E venda reembolsada NAO esta em `faturamento_bruto` nem em '
  '`receita_tributavel`, que so somam status `aprovada`: quem for descontar '
  'perda de uma dessas bases esta punindo o mesmo evento duas vezes.';
