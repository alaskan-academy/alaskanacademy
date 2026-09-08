-- O QUE A VSL VENDEU, PELA PAYT
--
-- Numa PV com VSL, a VSL costuma ter checkout proprio — e e por ele que a Payt
-- separa. Medido em 08/09/2026, ultimos 30 dias na REV5: "Saponaria Brasil
-- Rev5" 216 vendas, "Saponaria Brasil VSL 03" 77. A segunda linha e a resposta
-- de "quanto a VSL trouxe", e ela ja estava no banco.
--
-- O casamento venda -> checkout e por `link_url` sem a query string, que e
-- exatamente o que `fn_venda_resolve_funil` usa para decidir o REV da venda.
-- Repetir a regra aqui manteria duas versoes dela; por isso mora numa funcao
-- so, e a tela nao reimplementa split nenhum.
--
-- A CONVERSAO AQUI E A DO CHECKOUT
--
-- aprovadas / pedidos: dos que iniciaram, quantos pagaram. Nao e "de cada 100
-- que viram o video, tantos compraram" — esse numero precisaria das views, que
-- so o VTurb tem, e cruzar as duas fontes num mesmo numero e o que ja produziu
-- "conversao de checkout: 202,9%" neste projeto.
--
-- QUANDO ISTO NAO SERVE
--
-- Teste A/B com duas VSLs: os dois players vao para o mesmo checkout, e a Payt
-- nao tem como saber qual lado a pessoa viu. La a medida e a do VTurb, e a tela
-- diz que trocou de fonte.

create or replace function public.fn_vsl_do_rev(
  p_funil_id uuid, p_inicio date, p_fim date
) returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_dias integer := (p_fim - p_inicio) + 1;
begin
  return jsonb_build_object(
    'dias',     v_dias,
    'atual',    public.fn_vsl_do_rev_bloco(p_funil_id, p_inicio, p_fim),
    'anterior', public.fn_vsl_do_rev_bloco(p_funil_id, p_inicio - v_dias, p_inicio - 1)
  );
end;
$function$;

create or replace function public.fn_vsl_do_rev_bloco(
  p_funil_id uuid, p_inicio date, p_fim date
) returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with checkouts as (
    select fc.url, fc.titulo
      from funil_checkouts fc
     where fc.funil_id = p_funil_id and fc.eh_vsl
  ), pedidos as (
    select v.status, coalesce(v.valor_sem_juros, v.valor_total) as valor
      from vendas v
      join checkouts c on c.url = split_part(v.link_url, '?', 1)
     where v.funil_id = p_funil_id
       and v.data_venda::date between p_inicio and p_fim
       and coalesce(v.is_upsell, false) = false
       and v.pedido_id not like 'TEST%' and v.pedido_id not like 'LC-%'
  )
  select jsonb_build_object(
    -- Nulo, e nao zero, quando nenhum checkout foi marcado: "nao sei" e "nao
    -- vendeu" sao coisas diferentes, e zerar o que falta e como uma media vira
    -- mentira.
    'tem_checkout', (select count(*) > 0 from checkouts),
    'checkouts',    (select coalesce(jsonb_agg(coalesce(titulo, url) order by titulo), '[]'::jsonb) from checkouts),
    'pedidos',      (select count(*) from pedidos),
    'vendas',       (select count(*) from pedidos where status = 'aprovada'),
    'faturamento',  (select coalesce(sum(valor) filter (where status = 'aprovada'), 0) from pedidos),
    'conv_checkout_pct', (
      select case when count(*) > 0
                  then round(100.0 * count(*) filter (where status = 'aprovada') / count(*), 2)
             end from pedidos
    )
  );
$function$;

comment on function public.fn_vsl_do_rev(uuid, date, date) is
  'O que a VSL do REV vendeu, pela PAYT, isolada pelo checkout marcado com '
  '`funil_checkouts.eh_vsl`. Mesma forma de `fn_metricas_do_rev`: atual e '
  'anterior de igual tamanho. `tem_checkout` false quer dizer que ninguem '
  'marcou ainda — a tela deve pedir a marcacao, nao mostrar zero.';