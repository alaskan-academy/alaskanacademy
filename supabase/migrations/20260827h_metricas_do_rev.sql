-- As métricas de um REV num período, com a honestidade de cada número junto.
--
-- É a fundação da rodada de análise — a etapa onde estão as 3 horas quinzenais.
-- A tese do módulo é que quase nada ali precisa ser digitado: o dado já está no
-- banco, e o que falta é juntá-lo. Esta função é esse "juntar".
--
-- Só existe porque a revisão de Funis ligou venda a REV. Antes disto,
-- `vendas.funil_id` estava preenchido em 0 de 13.552 linhas e nenhuma métrica
-- por REV era possível.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- O QUE ESTA FUNÇÃO SE RECUSA A FINGIR
--
-- O investimento é um PISO, não o total. O elo anúncio↔REV só existe através da
-- venda: sabemos que o anúncio X pertence ao REV Y porque uma venda do REV Y
-- veio dele. Anúncio que gastou e não vendeu nada fica invisível.
--
-- Medido em 30 dias: R$ 107.893 gastos, R$ 75.263 atribuíveis — 69,8%. Calcular
-- ROAS com investimento incompleto o deixa ~43% otimista, e ROAS inflado é pior
-- que ROAS nenhum: decide errado com cara de certo.
--
-- Por isso cada bloco vem com a sua cobertura, e a tela tem a obrigação de
-- mostrá-la ao lado do número. Este percentual sobe conforme os checkouts vão
-- sendo atribuídos.
--
-- O bom acaso que torna isso possível: dos 145 anúncios com venda atribuída,
-- ZERO servem mais de um REV. Não há investimento a ratear entre REVs — o que
-- seria arbitrário e, portanto, inventado.
--
-- Retenção de VSL não entra aqui: vem da API do VTurb, que a tela busca pelo
-- `vsl_id` do REV. Trazer para o SQL exigiria espelhar métrica que muda todo
-- dia, e retrato velho é pior que consulta ao vivo.

create or replace function public.fn_metricas_do_rev(
  p_funil_id uuid,
  p_inicio   timestamptz,
  p_fim      timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dias     integer := greatest(1, (p_fim::date - p_inicio::date));
  v_ini_ant  timestamptz := p_inicio - make_interval(days => v_dias);
  v_atual    jsonb;
  v_anterior jsonb;
begin
  -- Período anterior do MESMO tamanho. "ROAS 1,9" não diz nada; "1,7 → 1,9"
  -- diz. Comparar com período de tamanho diferente seria pior que não comparar.
  v_atual    := public.fn_metricas_do_rev_bloco(p_funil_id, p_inicio, p_fim);
  v_anterior := public.fn_metricas_do_rev_bloco(p_funil_id, v_ini_ant, p_inicio);

  return jsonb_build_object(
    'dias',     v_dias,
    'atual',    v_atual,
    'anterior', v_anterior
  );
end;
$$;

comment on function public.fn_metricas_do_rev(uuid, timestamptz, timestamptz) is
  'Métricas de um REV no período, com o período anterior de mesmo tamanho ao '
  'lado. O investimento é PISO: anúncio que gastou sem vender fica de fora.';

-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_metricas_do_rev_bloco(
  p_funil_id uuid,
  p_inicio   timestamptz,
  p_fim      timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with vendas_rev as (
    select v.*
    from public.vendas v
    where v.funil_id = p_funil_id
      and v.status = 'aprovada'
      and v.data_venda >= p_inicio
      and v.data_venda <  p_fim
      -- Mesma exclusão que o resto do dash usa para pedido de teste.
      and v.pedido_id not like 'TEST%'
      and v.pedido_id not like 'LC-%'
  ),
  principais as (
    select * from vendas_rev where not coalesce(is_upsell, false)
  ),
  bumps as (
    select count(*)                        as qtd,
           sum(vi.valor)                   as faturamento,
           count(distinct vi.venda_id)     as vendas_com_bump
    from public.venda_itens vi
    join vendas_rev v on v.id = vi.venda_id
    where vi.converteu
      and vi.tipo::text <> 'oferta_principal'
  ),
  ups as (
    select count(*) as qtd, sum(valor_total) as faturamento
    from vendas_rev where coalesce(is_upsell, false)
  ),
  -- Os anúncios deste REV são os que produziram venda dele em QUALQUER época,
  -- e não só no período: um anúncio que vendeu mês passado e continua gastando
  -- pertence a este REV hoje, e ignorá-lo subestimaria ainda mais o piso.
  ads_do_rev as (
    select distinct v.ad_id_meta as ad_id
    from public.vendas v
    where v.funil_id = p_funil_id
      and v.ad_id_meta is not null
      and v.status = 'aprovada'
  ),
  invest as (
    select coalesce(sum(m.investimento), 0) as total
    from public.metricas_meta m
    where m.nivel = 'ad'
      and m.ad_id in (select ad_id from ads_do_rev)
      and m.data >= p_inicio::date
      and m.data <  p_fim::date
  ),
  -- Quanto do gasto TOTAL da janela conseguimos amarrar a algum REV. É o número
  -- que diz o quanto confiar no ROAS abaixo.
  cobertura as (
    select
      coalesce(sum(m.investimento), 0) as gasto_total,
      coalesce(sum(m.investimento) filter (
        where m.ad_id in (
          select distinct ad_id_meta from public.vendas
          where funil_id is not null and ad_id_meta is not null and status = 'aprovada'
        )), 0) as gasto_atribuido
    from public.metricas_meta m
    where m.nivel = 'ad' and m.data >= p_inicio::date and m.data < p_fim::date
  )
  select jsonb_build_object(
    'vendas',        (select count(*) from principais),
    'faturamento',   coalesce((select sum(valor_total) from vendas_rev), 0),
    'receita',       coalesce((select sum(coalesce(valor_sem_juros, valor_total)) from vendas_rev), 0),
    'ticket_medio',  (select round(avg(valor_total), 2) from principais),

    'bump_qtd',          coalesce((select qtd from bumps), 0),
    'bump_faturamento',  coalesce((select faturamento from bumps), 0),
    -- Adesão: quantas vendas levaram ao menos um bump. A media do dash e ~39%.
    'bump_adesao_pct',   case when (select count(*) from principais) > 0
                           then round(100.0 * coalesce((select vendas_com_bump from bumps), 0)
                                      / (select count(*) from principais), 1)
                         end,

    'upsell_qtd',         coalesce((select qtd from ups), 0),
    'upsell_faturamento', coalesce((select faturamento from ups), 0),

    'investimento',       (select total from invest),
    'investimento_e_piso', true,
    'roas',               case when (select total from invest) > 0
                            then round(coalesce((select sum(coalesce(valor_sem_juros, valor_total)) from vendas_rev), 0)
                                       / (select total from invest), 2)
                          end,
    -- Este numero e da CONTA inteira, nao deste REV: o investimento do REV cobre
    -- 100% dos anuncios que sabemos serem dele, por construcao. O nome precisa
    -- dizer isso, senao alguem le a variacao entre janelas (69,7% x 35,8%) como
    -- se um dos ROAS fosse menos confiavel que o outro -- e descarta uma queda
    -- real.
    'cobertura_geral_pct',
      (select case when gasto_total > 0
                then round(100.0 * gasto_atribuido / gasto_total, 1) end from cobertura),

    -- Venda sem anuncio nao e erro: 45% do faturamento vem de area de membros,
    -- WhatsApp e organico. Mas o denominador do ROAS so vale para a parte paga,
    -- e a tela precisa saber separar.
    'vendas_de_anuncio',  (select count(*) from principais where ad_id_meta is not null),
    'vendas_organicas',   (select count(*) from principais where ad_id_meta is null)
  );
$$;

comment on function public.fn_metricas_do_rev_bloco(uuid, timestamptz, timestamptz) is
  'Um periodo so. Existe separada porque fn_metricas_do_rev a chama duas vezes, '
  'para o periodo e para o anterior de mesmo tamanho.';

revoke execute on function public.fn_metricas_do_rev(uuid, timestamptz, timestamptz) from public, anon;
grant  execute on function public.fn_metricas_do_rev(uuid, timestamptz, timestamptz) to authenticated, service_role;
revoke execute on function public.fn_metricas_do_rev_bloco(uuid, timestamptz, timestamptz) from public, anon;
grant  execute on function public.fn_metricas_do_rev_bloco(uuid, timestamptz, timestamptz) to authenticated, service_role;
