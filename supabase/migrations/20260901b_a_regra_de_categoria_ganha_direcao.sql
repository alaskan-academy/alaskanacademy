-- Uma regra por NOME não sabe quem paga e quem recebe.
--
-- ── O caso ────────────────────────────────────────────────────────────────
--
-- Primeira transação da Aeliss, 01/09/2026: um PIX de R$ 2.000 ENTRANDO na
-- conta nova — a injeção de caixa que abre o projeto. Ele entrou no painel
-- como "Retirada de Lucro".
--
-- A Conta Simples não classificou nada (`category: null`, `costCenter: null`).
-- Quem classificou foi esta regra, aprendida da Alaskan:
--
--   padrão "JESSICA GAVAZZA PEISINO" → Retirada de Lucro, confiança 1.00
--
-- Na Alaskan ela sempre esteve certa, porque com esse nome só houve saída.
-- Numa conta sendo capitalizada, o mesmo nome significa o oposto. E confiança
-- 1.00 ganha de todas as outras fontes, inclusive da própria Conta Simples.
--
-- O sintoma no agregado: das 35 transações com "Retirada de Lucro", 34 eram
-- saídas e UMA era entrada. Sempre que um número parece estranho, ele é.
--
-- ── O que NÃO estava errado ───────────────────────────────────────────────
--
-- O DRE. `FinanceiroCaixaPage` já separa as categorias `socio` pelo SINAL:
-- negativas em "Distribuição aos Sócios", positivas em "Aportes de Sócios",
-- abaixo do Resultado Líquido. Os R$ 2.000 já estavam somando na linha certa
-- — só com o nome errado em cima. O conserto é de rótulo e de causa, não de
-- cálculo.
--
-- ── A unicidade precisou mudar junto ──────────────────────────────────────
--
-- `uq_regras_categoria_padrao` era (padrao, tipo_match): um nome só podia ter
-- UMA regra, então era impossível dizer "na saída é retirada, na entrada é
-- aporte". O índice passa a incluir `sinal`, com NULLS NOT DISTINCT para a
-- proteção antiga continuar valendo entre regras sem sinal.
--
-- ── E o campo morto que aproveitei ────────────────────────────────────────
--
-- `regras_categoria.centro_custo` estava preenchido em 99 das 112 regras e
-- NADA o lia — `aplicar_categorizacao` tirava o centro só do payload da CS. O
-- PIX de aporte chegou com `costCenter: null` e ficaria sem centro mesmo com a
-- regra dizendo "Sócios". Agora a regra preenche, mas SÓ onde a CS não mandou
-- nada: quem etiquetou na mão continua com a palavra final.

-- ── 1. A categoria que faltava ────────────────────────────────────────────
--
-- Criada com motivo medido, não por especulação: já existem R$ 2.000
-- esperando por ela, e conta nova recebe aporte mais de uma vez. É o espelho
-- de "Retirada de Lucro" — mesmo centro, sentido oposto —, e `tipo = socio`
-- faz o DRE colocá-la em "Aportes de Sócios" sozinho.

insert into categorias_centro (categoria, centro_custo, ordem, tipo, ativo)
values ('Aporte de Sócio', 'Sócios', 85, 'socio', true)
on conflict do nothing;

-- ── 2. A regra ganha direção ──────────────────────────────────────────────

alter table regras_categoria
  add column if not exists sinal text
  check (sinal in ('entrada','saida'));

comment on column regras_categoria.sinal is
  'Restringe a regra a um sentido do dinheiro. Nulo = vale para os dois, que era '
  'o comportamento antigo e continua sendo o de 110 das 112 regras. Existe porque '
  'uma regra por NOME nao distingue quem paga de quem recebe.';

drop index if exists uq_regras_categoria_padrao;
create unique index uq_regras_categoria_padrao
  on regras_categoria (padrao, tipo_match, sinal) nulls not distinct;

update regras_categoria set sinal = 'saida'
where padrao ilike 'JESSICA GAVAZZA PEISINO' and categoria = 'Retirada de Lucro';

insert into regras_categoria (padrao, tipo_match, categoria, centro_custo, confianca, ativo, sinal)
values ('JESSICA GAVAZZA PEISINO', 'contains', 'Aporte de Sócio', 'Sócios', 1.00, true, 'entrada')
on conflict (padrao, tipo_match, sinal) do nothing;

-- ── 3. A função respeita o sinal, e usa o centro da regra ─────────────────

CREATE OR REPLACE FUNCTION public.aplicar_categorizacao()
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  n_centro int; n_cat int; n_origem int; n_centro_regra int;
begin
  /* 1. O centro que a Conta Simples mandou tem a palavra final. */
  with cs as (
    select id, coalesce(payload_raw->'costCenter'->>'name',
                        payload_raw->'costCenter'->>'description') as centro
      from public.transacoes where payload_raw is not null
  )
  update public.transacoes t set centro_custo = cs.centro
    from cs
   where t.id = cs.id and cs.centro is not null
     and t.centro_custo is distinct from cs.centro;
  get diagnostics n_centro = row_count;

  drop table if exists _decidido;
  create temp table _decidido on commit drop as
  with candidatos as (
    select t.id, t.categoria as categoria_atual,
           m.categoria as cat_cs, m.preciso as cs_preciso,
           r.categoria as cat_regra, r.confianca as conf_regra,
           r.centro_custo as centro_regra
      from public.transacoes t
      left join lateral (
        select mm.categoria, mm.preciso from public.categorias_mapa mm
         where mm.nome_cs = coalesce(t.payload_raw->'category'->>'name',
                                     t.payload_raw->'category'->>'description')
      ) m on true
      left join lateral (
        select rr.categoria, rr.confianca, rr.centro_custo
          from public.regras_categoria rr
         where rr.ativo
           and ( (rr.tipo_match = 'contains'    and lower(t.descricao) like '%' || lower(rr.padrao) || '%')
              or (rr.tipo_match = 'starts_with' and lower(t.descricao) like lower(rr.padrao) || '%')
              or (rr.tipo_match = 'exact'       and lower(t.descricao) = lower(rr.padrao))
              or (rr.tipo_match = 'regex'       and t.descricao ~* rr.padrao) )
           /* O SENTIDO do dinheiro, desde 01/09/2026. Ver o topo da migração
              20260901b: um PIX_IN de R$ 2.000 entrou como "Retirada de Lucro"
              porque a regra casava pelo nome e ignorava a direção. */
           and (rr.sinal is null
                or rr.sinal = case when t.valor >= 0 then 'entrada' else 'saida' end)
         order by rr.confianca desc, length(rr.padrao) desc limit 1
      ) r on true
     where t.status_revisao not in ('confirmado', 'revisado')
  )
  select id, categoria_atual, centro_regra,
         case when conf_regra >= 1.0     then cat_regra
              when cs_preciso            then cat_cs
              when cat_regra is not null then cat_regra
              else cat_cs end as categoria_nova,
         case when conf_regra >= 1.0     then 'regra'
              when cs_preciso            then 'cs'
              when cat_regra is not null then 'regra'
              when cat_cs is not null    then 'mapa'
              else null end as origem
    from candidatos;

  update public.transacoes t
     set categoria = d.categoria_nova, status_revisao = 'auto_categorizado'
    from _decidido d
   where t.id = d.id and d.categoria_nova is not null
     and t.categoria is distinct from d.categoria_nova;
  get diagnostics n_cat = row_count;

  /* 2. O centro da REGRA, só onde a Conta Simples não mandou nenhum. */
  update public.transacoes t
     set centro_custo = d.centro_regra
    from _decidido d
   where t.id = d.id and d.centro_regra is not null
     and t.centro_custo is null;
  get diagnostics n_centro_regra = row_count;

  update public.transacoes t set categoria_origem = d.origem
    from _decidido d
   where t.id = d.id and d.origem is not null
     and t.categoria_origem is distinct from d.origem;
  get diagnostics n_origem = row_count;

  return jsonb_build_object('centros', n_centro, 'centros_por_regra', n_centro_regra,
                            'categorias', n_cat, 'origens', n_origem);
end;
$function$;

select public.aplicar_categorizacao();
