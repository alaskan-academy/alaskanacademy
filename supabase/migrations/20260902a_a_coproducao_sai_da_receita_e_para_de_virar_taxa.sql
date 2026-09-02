-- A fatia do coprodutor deixa de ser invisível — e de ser contada como taxa.
--
-- ── O que a Payt manda, e o que o painel fazia com isso ───────────────────
--
-- Cada venda traz um array `commission` com três papéis:
--
--     platform     PAYT TECNOLOGIA          a taxa
--     producer     ALASKAN ACADEMY LTDA     o que é da empresa
--     coproducer   Helena Ribeiro da Costa  o que é do dono do curso
--
-- A tela da Payt mostra a mesma coisa, e foi o que fechou a conferência:
--
--     Valor da venda    R$ 96,03
--     Co-produção      −R$  9,02
--     Taxa Payt        −R$  5,79   (4,99% + R$ 1,00)
--     Você recebe       R$ 81,22
--
-- O painel não tinha lugar nenhum para a coprodução. Pior: `fn_atualizar_taxa_
-- plataforma` calculava a taxa como "tudo que não é do produtor" —
--
--     v_taxa := GREATEST(v_sem_juros - v_produtor, 0);
--
-- — então ela ENGOLIA a coprodução. Naquela venda, R$ 14,81 de "taxa da Payt"
-- onde a Payt cobrou R$ 5,79. No agregado:
--
--                              taxa exibida   taxa real   coprodução
--     20 vendas com coprodutor      14,78%       2,93%     R$ 580,12
--     6.411 sem coprodutor           6,13%       4,68%          —
--
-- ── Onde ela entra agora ──────────────────────────────────────────────────
--
-- Sai da RECEITA, no topo da cascata, junto com os juros de parcelamento — e
-- pelo mesmo motivo: a Payt divide na origem, e esse dinheiro nunca passa pela
-- conta da empresa. Não é custo; nunca foi nosso.
--
--     Pago pelos clientes        96,03
--       − Coprodução              9,02   <- discriminada
--     Receita                    87,01   <- daqui para baixo, tudo usa esta
--       − Taxa Payt               5,79
--
-- A consequência que vale dinheiro é o IMPOSTO: `receita_tributavel` passa a
-- ser líquida, então o Simples deixa de incidir sobre a fatia da Helena.
--
-- ── DESCONHECIDO não é zero ───────────────────────────────────────────────
--
-- A Payt só começou a mandar `commission` em maio/2026 — cobertura de 0% até
-- abril, 32% em maio, 97% em junho, 100% de julho em diante. Mês anterior a
-- isso não tem coprodução zero: tem coprodução ignorada.
--
-- Por isso `valor_coproducao` fica NULO quando não há `commission`, e a view
-- expõe `vendas_sem_dado_coproducao` para a tela dizer isso em vez de exibir
-- R$ 0,00. Mesmo princípio de `semDadosDeAnuncio`, que impede março e abril de
-- mostrarem margem falsa por falta de dado do Meta.
--
-- ── Quem tem coprodutor ───────────────────────────────────────────────────
--
--     Workshop Desafios na Sala de Aula   9,18%   Helena Ribeiro da Costa
--     Guia do Comportamento na Sala       9,39%   Helena Ribeiro da Costa
--     os outros 32 produtos                  0%
--
-- ── Conferido ─────────────────────────────────────────────────────────────
--
--     valor_sem_juros − coprodução − taxa − líquido do produtor = R$ 0,00
--     bruto − juros − coprodução − receita_tributável           = R$ 0,00

alter table vendas add column if not exists valor_coproducao numeric;

comment on column vendas.valor_coproducao is
  'Fatia da venda que a Payt paga direto ao COPRODUTOR — nunca passa pela conta '
  'da empresa. Sai da receita no topo da cascata, como os juros de parcelamento, '
  'e nao e custo. NULO = desconhecido (venda anterior a maio/2026, quando a Payt '
  'passou a mandar `commission`); ZERO = a Payt informou e nao ha coprodutor. '
  'Ver a migracao 20260902a.';

-- ── 1. A taxa para de engolir a coprodução ───────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_atualizar_taxa_plataforma(p_venda_id uuid, p_payload jsonb, p_total numeric)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_produtor  numeric;
  v_copro     numeric;
  v_sem_juros numeric;
  v_parcelas  integer;
  v_juros     numeric;
  v_taxa      numeric;
BEGIN
  IF p_total IS NULL OR p_total <= 0 THEN
    RETURN;
  END IF;

  v_sem_juros := COALESCE(
    NULLIF(p_payload->'transaction'->>'price_without_installments', '')::numeric / 100,
    p_total);
  v_parcelas := COALESCE(NULLIF(p_payload->'transaction'->>'installments', '')::int, 1);
  v_juros    := GREATEST(p_total - v_sem_juros, 0);

  UPDATE vendas
     SET valor_sem_juros        = v_sem_juros,
         juros_parcelamento     = v_juros,
         parcelas               = v_parcelas,
         valor_oferta_principal = GREATEST(v_sem_juros - COALESCE(valor_obs, 0), 0)
   WHERE id = p_venda_id;

  IF jsonb_typeof(p_payload->'commission') <> 'array' THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(NULLIF(c.v->>'amount', '')::numeric) / 100, 0)
    INTO v_produtor
    FROM jsonb_array_elements(p_payload->'commission') AS c(v)
   WHERE c.v->>'type' = 'producer';

  -- Comissão zerada acontece quando a Payt ainda não a calculou no momento do
  -- postback. Deixa nulo em vez de gravar zero: nulo é "não sei", zero seria mentira.
  IF v_produtor IS NULL OR v_produtor <= 0 THEN
    RETURN;
  END IF;

  /* A COPRODUCAO nao e taxa. A conta antiga era `sem_juros - produtor`, o que
     jogava a fatia do coprodutor dentro da taxa da Payt: o Desafios aparecia com
     14,78% de taxa contra 6,13% dos outros produtos, e os 9,2% de diferenca eram
     a Helena. Ver o topo da migracao 20260902a. */
  SELECT COALESCE(SUM(NULLIF(c.v->>'amount', '')::numeric) / 100, 0)
    INTO v_copro
    FROM jsonb_array_elements(p_payload->'commission') AS c(v)
   WHERE c.v->>'type' = 'coproducer';

  v_taxa := GREATEST(v_sem_juros - v_produtor - v_copro, 0);

  UPDATE vendas
     SET valor_liquido_produtor = v_produtor,
         valor_coproducao       = v_copro,
         taxa_plataforma_valor  = v_taxa,
         taxa_plataforma_pct    = CASE WHEN v_sem_juros > 0
                                       THEN (v_taxa / v_sem_juros) * 100 END
   WHERE id = p_venda_id;
END;
$function$;

-- ── 2. O que já estava gravado ───────────────────────────────────────────

with c as (
  select vp.payt_id,
    (select coalesce(sum((x->>'amount')::numeric),0)/100
       from jsonb_array_elements(vp.payload_raw->'commission') x
      where x->>'type'='coproducer') copro,
    (select sum((x->>'amount')::numeric)/100
       from jsonb_array_elements(vp.payload_raw->'commission') x
      where x->>'type'='producer') prod
  from vendas_payt vp
  where jsonb_typeof(vp.payload_raw->'commission') = 'array'
)
update vendas v
   set valor_coproducao      = c.copro,
       taxa_plataforma_valor = greatest(coalesce(v.valor_sem_juros, v.valor_total) - c.prod - c.copro, 0),
       taxa_plataforma_pct   = case when coalesce(v.valor_sem_juros, v.valor_total) > 0
         then greatest(coalesce(v.valor_sem_juros, v.valor_total) - c.prod - c.copro, 0)
              / coalesce(v.valor_sem_juros, v.valor_total) * 100 end
  from c
 where v.pedido_id = c.payt_id
   and c.prod is not null and c.prod > 0;

-- ── 3. A view: `receita_tributavel` fica LÍQUIDA, e a coprodução ganha coluna
--
-- Reescrita ancorada porque a view tem dezenas de colunas, e copiá-las aqui
-- criaria uma segunda cópia que envelhece.

do $$
declare def text; antigo text;
begin
  def := pg_get_viewdef('vw_faturamento_liquido'::regclass, true);
  if position('coproducao' in def) > 0 then raise notice 'ja separado'; return; end if;

  antigo := E'            sum(\n                CASE\n                    WHEN v.status = ''aprovada''::status_venda THEN COALESCE(v.valor_sem_juros, v.valor_total)\n                    ELSE 0::numeric\n                END) AS receita_tributavel,\n';
  if position(antigo in def) = 0 then raise exception 'ancora 1 (receita_tributavel)'; end if;
  def := replace(def, antigo,
      E'            sum(\n                CASE\n                    WHEN v.status = ''aprovada''::status_venda THEN COALESCE(v.valor_sem_juros, v.valor_total) - COALESCE(v.valor_coproducao, 0::numeric)\n                    ELSE 0::numeric\n                END) AS receita_tributavel,\n'
   || E'            sum(\n                CASE\n                    WHEN v.status = ''aprovada''::status_venda THEN COALESCE(v.valor_coproducao, 0::numeric)\n                    ELSE 0::numeric\n                END) AS coproducao,\n'
   || E'            count(\n                CASE\n                    WHEN v.status = ''aprovada''::status_venda AND v.valor_coproducao IS NULL THEN 1\n                    ELSE NULL::integer\n                END) AS vendas_sem_dado_coproducao,\n');

  antigo := E'            COALESCE(v.receita_tributavel, 0::numeric) AS receita_tributavel,\n';
  if position(antigo in def) = 0 then raise exception 'ancora 2 (juntos)'; end if;
  def := replace(def, antigo,
      E'            COALESCE(v.receita_tributavel, 0::numeric) AS receita_tributavel,\n'
   || E'            COALESCE(v.coproducao, 0::numeric) AS coproducao,\n'
   || E'            COALESCE(v.vendas_sem_dado_coproducao, 0::bigint) AS vendas_sem_dado_coproducao,\n');

  antigo := E'            j.receita_tributavel,\n';
  if position(antigo in def) = 0 then raise exception 'ancora 3 (com_cfg)'; end if;
  def := replace(def, antigo,
      E'            j.receita_tributavel,\n            j.coproducao,\n            j.vendas_sem_dado_coproducao,\n');

  antigo := E'    empresa_id,\n    perda_reembolso,\n    perda_chargeback\n   FROM com_cfg c;';
  if position(antigo in def) = 0 then raise exception 'ancora 4 (fim)'; end if;
  def := replace(def, antigo,
      E'    empresa_id,\n    perda_reembolso,\n    perda_chargeback,\n    coproducao,\n    vendas_sem_dado_coproducao\n   FROM com_cfg c;');

  execute 'create or replace view vw_faturamento_liquido as ' || def;
end $$;

-- ── 4. `fn_overview`: a base do imposto e a receita exibida ──────────────

do $$
declare def text; antigo text;
begin
  def := pg_get_functiondef('fn_overview'::regproc);
  if position('valor_coproducao' in def) > 0 then raise notice 'ja separado'; return; end if;

  antigo := E'  receita_empresa AS (\n    SELECT empresa_id, sum(coalesce(valor_sem_juros, valor_total)) AS receita\n      FROM aprovadas GROUP BY 1\n  ),\n';
  if position(antigo in def) = 0 then raise exception 'ancora receita_empresa'; end if;
  def := replace(def, antigo,
      E'  /* LIQUIDA de coproducao: a fatia do coprodutor a Payt paga direto a ele e\n'
   || E'     nunca passa pela conta da empresa — cobrar Simples sobre ela seria pagar\n'
   || E'     imposto sobre dinheiro de terceiro. Ver a migracao 20260902a. */\n'
   || E'  receita_empresa AS (\n'
   || E'    SELECT empresa_id,\n'
   || E'           sum(coalesce(valor_sem_juros, valor_total) - coalesce(valor_coproducao, 0)) AS receita\n'
   || E'      FROM aprovadas GROUP BY 1\n'
   || E'  ),\n');

  antigo := E'    ''receita'',     coalesce((SELECT sum(coalesce(valor_sem_juros, valor_total)) FROM aprovadas), 0),\n';
  if position(antigo in def) = 0 then raise exception 'ancora receita'; end if;
  def := replace(def, antigo,
      E'    ''receita'',     coalesce((SELECT sum(coalesce(valor_sem_juros, valor_total) - coalesce(valor_coproducao, 0)) FROM aprovadas), 0),\n'
   || E'    ''coproducao'', coalesce((SELECT sum(coalesce(valor_coproducao, 0)) FROM aprovadas), 0),\n'
   || E'    ''vendas_sem_dado_coproducao'', (SELECT count(*) FROM aprovadas WHERE valor_coproducao IS NULL),\n');

  execute def;
end $$;
