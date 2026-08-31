/*
  O painel "Meta: campanha × conta" somava as duas empresas.

  Ele confere o gasto que a Meta reporta contra o que saiu do banco, e casava os
  dois lados só por MÊS. Com a Aeliss, isso conferiria o cartão de uma empresa
  contra a campanha da outra — e o resíduo, que é o número que a tela existe
  para mostrar, viraria a soma de dois erros.

  A empresa entra na chave dos dois lados. Aqui ela vem do CARIMBO, e não do
  projeto, porque os dois lados são dinheiro: `metricas_meta.empresa_id` de um
  lado, `transacoes.empresa_id` do outro. O carimbo do banco é a única coisa que
  sabe de quem é o cartão — "FACEBK" na descrição não diz.

  `FULL JOIN` com `IS NOT DISTINCT FROM` na empresa, para que um mês que só
  exista de um dos lados continue aparecendo, como já acontecia com o mês.
*/

CREATE OR REPLACE VIEW public.vw_conciliacao_meta AS
  WITH meta AS (
    SELECT date_trunc('month', m.data::timestamptz)::date AS mes,
           m.empresa_id,
           sum(m.investimento)::numeric(14,2) AS ads_meta
      FROM metricas_meta m
     WHERE m.nivel::text = 'campanha'
     GROUP BY 1, 2
  ), banco AS (
    SELECT date_trunc('month', t.data::timestamptz)::date AS mes,
           t.empresa_id,
           sum(- t.valor) FILTER (WHERE COALESCE(c.finalidade, 'ads') <> 'whatsapp')::numeric(14,2) AS ads_banco,
           sum(- t.valor) FILTER (WHERE c.finalidade = 'whatsapp')::numeric(14,2) AS whatsapp,
           sum(- t.valor)::numeric(14,2) AS saiu_banco,
           count(*)::integer AS lancamentos
      FROM transacoes t
      LEFT JOIN cartoes c ON c.masked_number = ((t.payload_raw -> 'card') ->> 'maskedNumber')
     WHERE t.valor < 0 AND t.descricao ILIKE 'FACEBK%'
     GROUP BY 1, 2
  )
  SELECT COALESCE(m.mes, b.mes) AS mes,
         m.ads_meta,
         COALESCE(b.ads_banco, 0::numeric) AS ads_banco,
         COALESCE(b.whatsapp, 0::numeric) AS whatsapp,
         b.saiu_banco,
         b.lancamentos,
         (COALESCE(b.ads_banco, 0::numeric) - m.ads_meta)::numeric(14,2) AS residuo,
         CASE WHEN m.ads_meta > 0
              THEN round(100.0 * (COALESCE(b.ads_banco, 0::numeric) - m.ads_meta) / m.ads_meta, 1)
              ELSE NULL::numeric END AS pct_residuo,
         date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date = COALESCE(m.mes, b.mes) AS mes_em_curso,
         COALESCE(m.empresa_id, b.empresa_id) AS empresa_id
    FROM meta m
    FULL JOIN banco b
           ON b.mes = m.mes
          AND b.empresa_id IS NOT DISTINCT FROM m.empresa_id
   WHERE m.ads_meta IS NOT NULL OR b.saiu_banco IS NOT NULL;

COMMENT ON VIEW public.vw_conciliacao_meta IS
  'Gasto da Meta contra o que saiu do banco, por mes e EMPRESA. A empresa entra '
  'na chave do casamento desde 31/08/2026: sem ela, o cartao de uma empresa '
  'seria conferido contra a campanha da outra.';
