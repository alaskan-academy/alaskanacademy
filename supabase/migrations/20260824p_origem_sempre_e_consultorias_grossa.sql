-- O CS marca o Endereço Fiscal (ASA*JK WORKSPACE) como "Consultorias e
-- Mentorias". É engano de marcação lá, igual ao da ALASKAN ACADEMY. Passa a
-- grosso: só vale se nenhuma regra do dashboard tiver algo a dizer.
update public.categorias_mapa
   set preciso = false,
       observacao = 'CS usa este nome para o endereço fiscal — engano de marcação lá.'
 where nome_cs = 'Consultorias e Mentorias';

-- Versão final da categorização. `categoria_origem` só era gravada quando a
-- categoria MUDAVA, então a maioria das linhas ficava sem — inclusive as que o
-- CS já tinha acertado. A origem é sobre quem decidiu, não sobre ter mudado.
create or replace function public.aplicar_categorizacao()
returns jsonb
language plpgsql
as $fn$
declare
  n_centro int;
  n_cat    int;
  n_origem int;
begin
  -- ── 1. Centro de custo: a Conta Simples manda, sempre.
  -- Ela preenche antes de transacionar e o dashboard não tem editor para este
  -- campo. Não há segunda opinião a respeitar. Hoje 945 das 975 saídas vêm de lá.
  with cs as (
    select id,
           coalesce(payload_raw->'costCenter'->>'name',
                    payload_raw->'costCenter'->>'description') as centro
      from public.transacoes
     where payload_raw is not null
  )
  update public.transacoes t
     set centro_custo = cs.centro
    from cs
   where t.id = cs.id
     and cs.centro is not null
     and t.centro_custo is distinct from cs.centro;
  get diagnostics n_centro = row_count;

  drop table if exists _decidido;
  create temp table _decidido on commit drop as
  with candidatos as (
    select t.id,
           t.categoria as categoria_atual,
           m.categoria as cat_cs,
           m.preciso   as cs_preciso,
           r.categoria as cat_regra,
           r.confianca as conf_regra
      from public.transacoes t
      left join lateral (
        select mm.categoria, mm.preciso
          from public.categorias_mapa mm
         where mm.nome_cs = coalesce(t.payload_raw->'category'->>'name',
                                     t.payload_raw->'category'->>'description')
      ) m on true
      left join lateral (
        select rr.categoria, rr.confianca
          from public.regras_categoria rr
         where rr.ativo
           and ( (rr.tipo_match = 'contains'    and lower(t.descricao) like '%' || lower(rr.padrao) || '%')
              or (rr.tipo_match = 'starts_with' and lower(t.descricao) like lower(rr.padrao) || '%')
              or (rr.tipo_match = 'exact'       and lower(t.descricao) = lower(rr.padrao))
              or (rr.tipo_match = 'regex'       and t.descricao ~* rr.padrao) )
         order by rr.confianca desc, length(rr.padrao) desc
         limit 1
      ) r on true
     -- Transação que passou por olho humano não se mexe.
     where t.status_revisao not in ('confirmado', 'revisado')
  )
  select id, categoria_atual,
         case
           -- Regra que ELA ensinou (confiança 1,00) ganha de tudo. É o que
           -- preserva os R$ 26.500 da ALASKAN ACADEMY como Reserva de Caixa,
           -- que no CS estão marcados como Retirada de Lucro por engano.
           when conf_regra >= 1.0     then cat_regra
           -- Depois o CS, quando o nome dele é tão específico quanto o nosso.
           when cs_preciso            then cat_cs
           -- Depois qualquer regra.
           when cat_regra is not null then cat_regra
           -- Por último o nome grosso do CS, melhor que deixar em branco.
           else cat_cs
         end as categoria_nova,
         case
           when conf_regra >= 1.0     then 'regra'
           when cs_preciso            then 'cs'
           when cat_regra is not null then 'regra'
           when cat_cs is not null    then 'mapa'
           else null
         end as origem
    from candidatos;

  update public.transacoes t
     set categoria      = d.categoria_nova,
         status_revisao = 'auto_categorizado'
    from _decidido d
   where t.id = d.id
     and d.categoria_nova is not null
     and t.categoria is distinct from d.categoria_nova;
  get diagnostics n_cat = row_count;

  -- Origem em toda linha avaliada, tenha mudado ou não.
  update public.transacoes t
     set categoria_origem = d.origem
    from _decidido d
   where t.id = d.id
     and d.origem is not null
     and t.categoria_origem is distinct from d.origem;
  get diagnostics n_origem = row_count;

  return jsonb_build_object('centros', n_centro, 'categorias', n_cat, 'origens', n_origem);
end;
$fn$;

comment on function public.aplicar_categorizacao() is
  'Categoriza na ordem: regra ensinada > CS preciso > regra > CS grosso. Não toca em confirmado/revisado.';

grant execute on function public.aplicar_categorizacao() to authenticated;
