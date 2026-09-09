-- O aviso da VSL diz QUAIS checkouts o REV tem
--
-- A tela dizia "Nenhum checkout marcado como o da VSL" num REV que tem dois
-- checkouts vinculados, um deles chamado "Workshop Buquê de Velas VSL 01
-- Rev01". A frase estava certa e mesmo assim enganava: ela fala de MARCAÇÃO e
-- foi lida como AUSÊNCIA — "fala que não tem, sendo que tem".
--
-- A diferença importa porque as duas situações pedem coisas diferentes:
--
--   REV sem checkout nenhum      vincular o checkout, em Funis
--   REV com checkout, sem marca  apertar "VSL" no que já está lá
--
-- Sem saber em qual das duas está, a pessoa vai procurar o que falta no lugar
-- errado. E o segundo caso é o comum: a marcação nasceu em 08/09 e nenhum REV
-- antigo a tem.
--
-- Então a função passa a devolver os checkouts do REV que NÃO estão marcados.
-- É a mesma regra da armadilha 2 aplicada a um aviso: a tela que pede uma ação
-- precisa mostrar sobre o que a ação é, senão o pedido fica no ar.
--
-- O `eh_vsl` continua sendo marcado À MÃO. Deduzir do título "VSL 01" seria a
-- armadilha 3 — um dia alguém chama o checkout do front de "VSL" e as vendas
-- inteiras do REV viram vendas da VSL sem ninguém ver. A tela aproxima o dedo
-- do botão; quem aperta é gente.
--
-- `candidatos` não depende do período, e ainda assim é calculado nos dois
-- blocos: a forma de `atual` e `anterior` é a mesma de propósito, e a tela lê
-- só o de `atual`.

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
    -- O que existe e nao foi marcado. Vazio quer dizer que o REV nao tem
    -- checkout nenhum, que e outro problema e outra tela.
    'candidatos',   (select coalesce(jsonb_agg(coalesce(fc.titulo, fc.url) order by fc.titulo), '[]'::jsonb)
                       from funil_checkouts fc
                      where fc.funil_id = p_funil_id and not fc.eh_vsl),
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

comment on function public.fn_vsl_do_rev_bloco(uuid, date, date) is
  'Um periodo do bloco da VSL. `candidatos` sao os checkouts do REV que ainda '
  'nao foram marcados — a tela usa para dizer O QUE marcar, em vez de so dizer '
  'que falta marcar.';
