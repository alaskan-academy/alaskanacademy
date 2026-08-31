/*
  Os parâmetros fiscais nunca tiveram como serem conferidos.

  É a segunda armadilha do CLAUDE.md em estado puro: a tela de cadastro existia,
  a de resultado não — e sem resultado ninguém volta, então o número envelhece e
  vira ficção. Medido em 31/08/2026, com a base CERTA:

      Simples          10% configurado  ·  7,84% pago (jul+ago)
      Custo fixo   R$ 25.000 configurado ·  R$ 21.145 com sócios (jul+ago)

  Nenhum dos dois é absurdo — e é justamente isso que os manteve intocados.

  A BASE DO IMPOSTO É A RECEITA DO MÊS ANTERIOR

  O Simples é pago no mês seguinte, sobre a receita do mês anterior. Dividir o
  imposto pago pela receita do MESMO mês dava 4,23% — quase metade do real, e um
  número que convidaria a baixar a alíquota e inflar o lucro. A conta certa é
  imposto do mês M sobre receita de M−1, e é a que esta função faz.

  DUAS DEFINIÇÕES DE CUSTO FIXO, PORQUE SÃO DUAS PERGUNTAS

  Sem sócios é o custo de operar. Com sócios é o que a empresa desembolsa por
  mês. Os R$ 25.000 configurados batem com "com sócios" de março a junho
  (25.527 / 25.386 / 24.774 / 24.138) — o parâmetro foi definido assim, e o que
  mudou foi a retirada cair de R$ 12.000 para R$ 9.000.

  Qual das duas o "lucro depois do custo fixo" deve usar é decisão de quem olha,
  não da função. Ela devolve as duas.

  O IMPOSTO DO META NÃO ENTRA AQUI

  Seria tentador: o extrato mostra o banco cobrando 11% a 22% a mais do que a
  Meta reporta como campanha. Mas gasto de um mês é debitado no seguinte, então
  esse percentual mistura imposto com atraso de cobrança e não separa os dois.
  Sugestão que não sabe o que está medindo é pior que nenhuma. A fonte para
  aquele número é a fatura da Meta, que traz a linha de imposto em separado.

  MESES FECHADOS, NUNCA O EM CURSO

  Incluir mês pela metade faria a sugestão despencar todo dia 1º. O preço é que
  no último dia de um mês ele ainda não conta — assumido de propósito.
*/

CREATE OR REPLACE FUNCTION public.fn_sugestao_parametros(p_empresa uuid DEFAULT NULL)
RETURNS TABLE(
  chave   text,
  mes_a   date,
  valor_a numeric,
  mes_b   date,
  valor_b numeric,
  media   numeric
)
LANGUAGE sql STABLE AS $fn$
  WITH janela AS (
    SELECT (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') - interval '2 months')::date AS mes_a,
           (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') - interval '1 month')::date  AS mes_b
  ),
  receita AS (
    SELECT date_trunc('month', (v.data_venda AT TIME ZONE 'America/Sao_Paulo'))::date AS mes,
           sum(coalesce(v.valor_sem_juros, v.valor_total)) AS receita
      FROM vendas v
     WHERE v.status = 'aprovada'
       AND v.pedido_id NOT LIKE 'TEST%'
       AND v.pedido_id NOT LIKE 'LC-%'
       AND (p_empresa IS NULL OR v.empresa_id = p_empresa)
     GROUP BY 1
  ),
  saidas AS (
    SELECT date_trunc('month', t.data)::date AS mes,
           sum(-t.valor) FILTER (WHERE trim(t.categoria) = 'Impostos e Tributos') AS imposto,
           /* Anúncios, WhatsApp e imposto ficam de fora: não são fixos. Sócio e
              reserva também, por `tipo` e não por lista de nomes — categoria
              nova de sócio criada no campo entraria como custo. */
           sum(-t.valor) FILTER (WHERE coalesce(cc.tipo, 'custo') = 'custo'
                AND trim(t.categoria) NOT IN ('Anúncios (Facebook ADs)', 'WhatsApp', 'Impostos e Tributos')) AS fixo,
           sum(-t.valor) FILTER (WHERE cc.tipo = 'socio') AS socios
      FROM transacoes t
      LEFT JOIN categorias_centro cc ON cc.categoria = trim(t.categoria)
     WHERE t.valor < 0
       AND (p_empresa IS NULL OR t.empresa_id = p_empresa)
     GROUP BY 1
  ),
  m AS (
    SELECT j.mes_a, j.mes_b,
           100.0 * (SELECT s.imposto FROM saidas s WHERE s.mes = j.mes_a)
                 / nullif((SELECT r.receita FROM receita r
                            WHERE r.mes = (j.mes_a - interval '1 month')::date), 0) AS imp_a,
           100.0 * (SELECT s.imposto FROM saidas s WHERE s.mes = j.mes_b)
                 / nullif((SELECT r.receita FROM receita r
                            WHERE r.mes = (j.mes_b - interval '1 month')::date), 0) AS imp_b,
           (SELECT s.fixo FROM saidas s WHERE s.mes = j.mes_a) AS fixo_a,
           (SELECT s.fixo FROM saidas s WHERE s.mes = j.mes_b) AS fixo_b,
           (SELECT coalesce(s.fixo,0) + coalesce(s.socios,0) FROM saidas s WHERE s.mes = j.mes_a) AS cs_a,
           (SELECT coalesce(s.fixo,0) + coalesce(s.socios,0) FROM saidas s WHERE s.mes = j.mes_b) AS cs_b
      FROM janela j
  ),
  /* A média ignora o mês sem dado em vez de virar nulo junto. Junho de 2026 não
     teve pagamento de imposto nenhum: numa média ingênua, um mês assim apagaria
     a sugestão inteira. */
  linhas AS (
    SELECT 'imposto_simples_nacional_pct'::text AS chave, mes_a, imp_a AS va, mes_b, imp_b AS vb FROM m
    UNION ALL
    SELECT 'custo_fixo_mensal',            mes_a, fixo_a, mes_b, fixo_b FROM m
    UNION ALL
    SELECT 'custo_fixo_mensal_com_socios', mes_a, cs_a,   mes_b, cs_b   FROM m
  )
  SELECT l.chave, l.mes_a, round(l.va, 2), l.mes_b, round(l.vb, 2),
         round(((coalesce(l.va, 0) + coalesce(l.vb, 0))
                / nullif((l.va IS NOT NULL)::int + (l.vb IS NOT NULL)::int, 0))::numeric, 2)
    FROM linhas l;
$fn$;

COMMENT ON FUNCTION public.fn_sugestao_parametros(uuid) IS
  'O que os parametros fiscais foram DE VERDADE nos dois ultimos meses fechados. '
  'O imposto sai sobre a receita do mes ANTERIOR, que e a base legal do Simples: '
  'sobre o mes corrente o numero da quase metade e convidaria a baixar a aliquota.';

REVOKE ALL ON FUNCTION public.fn_sugestao_parametros(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_parametros(uuid) TO authenticated;
