-- O desempenho dos editores, agregado no banco.
--
-- A tela fazia isso no navegador: puxava os 2.916 cards postados, disparava
-- ~10 consultas em blocos de 300 ids para descobrir a data de postagem em
-- `criativo_historico`, e só então agrupava em JavaScript. Três problemas
-- juntos:
--
--   1. Tráfego. São 2.916 linhas com relação embutida para produzir 13 linhas
--      de resultado.
--   2. A paginação. Até hoje ela parava em 2.000 e perdia 916 cards em
--      silêncio; consertei no cliente, mas o conserto certo é não trazer.
--   3. A RLS. Ela valia sobre as 2.916 linhas soltas, e não sobre o que a tela
--      mostra. Agregar aqui é o único jeito de a regra valer sobre o número.
--
-- Devolve as duas metades da história já unidas: `avaliacoes_criativos` para
-- os meses até jun/2026, e `producoes` de jul/2026 em diante. O corte existe
-- porque foi quando a Produção passou a ser a fonte — antes disso os números
-- eram digitados.
--
-- Conferido contra o que a tela dizia ANTES da troca, mês a mês:
--   agosto     143 testados,  0 validados,  0 escalados
--   julho      158,          14,            5
--   junho       63,           6
--   jun→ago    364,          20

CREATE OR REPLACE FUNCTION public.fn_desempenho_editores(p_ini date, p_fim date)
 RETURNS TABLE (
   editor_id      uuid,
   mes_referencia date,
   empresa        text,
   oferta         text,
   tipo           text,
   ads_testados   bigint,
   ads_validados  bigint,
   ads_escalados  bigint
 )
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with corte as (select date '2026-07-01' as a_partir_de),

  -- A data em que o card virou 'postado'. Um card pode ter sido postado mais
  -- de uma vez (voltou para alteração e foi de novo); vale a PRIMEIRA, que é
  -- quando ele estreou.
  postagem as (
    select h.criativo_id, min(h.criado_em)::date as data_postagem
      from criativo_historico h
     where h.campo_alterado = 'fase' and h.valor_novo = 'postado'
     group by h.criativo_id
  ),

  -- De jul/2026 em diante: derivado dos cards.
  novos as (
    select e.id as editor_id,
           (date_trunc('month', coalesce(pg.data_postagem, p.data_inicio))::date) as mes_referencia,
           'Alaskan Academy'::text as empresa,
           coalesce(o.nome, '— sem projeto —') as oferta,
           coalesce(p.tipo, 'criativo') as tipo,
           count(*)                                          as ads_testados,
           count(*) filter (where p.avaliacao = 'Validado')  as ads_validados,
           count(*) filter (where p.avaliacao = 'Escalado')  as ads_escalados
      from producoes p
      join editores e on e.usuario_id = p.responsavel_id
      left join postagem pg on pg.criativo_id = p.id
      left join ofertas_editores o on o.id = p.projeto_id
     cross join corte
     where p.fase = 'postado'
       and coalesce(pg.data_postagem, p.data_inicio) >= corte.a_partir_de
       and coalesce(pg.data_postagem, p.data_inicio) between p_ini and p_fim
     group by 1, 2, 3, 4, 5
  ),

  -- Até jun/2026: o que foi digitado na época. `ads_escalados` não existe
  -- nessa tabela — não era um conceito ainda —, então vai zero, e não null:
  -- zero é o que aconteceu, null diria "não sei".
  antigos as (
    select a.editor_id,
           a.mes_referencia,
           coalesce(a.empresa, 'Alaskan Academy') as empresa,
           coalesce(a.oferta, '— sem projeto —')  as oferta,
           'criativo'::text                       as tipo,
           coalesce(a.ads_testados, 0)::bigint    as ads_testados,
           coalesce(a.ads_validados, 0)::bigint   as ads_validados,
           0::bigint                              as ads_escalados
      from avaliacoes_criativos a
     cross join corte
     where a.mes_referencia is not null
       and a.mes_referencia < corte.a_partir_de
       and a.mes_referencia between date_trunc('month', p_ini)::date and p_fim
  )

  select * from novos
  union all
  select * from antigos;
$function$;

COMMENT ON FUNCTION public.fn_desempenho_editores(date, date) IS
  'Desempenho por editor/mes/oferta/tipo, com as duas fontes ja unidas: avaliacoes_criativos ate jun/2026 e producoes depois. Existe para a tela nao puxar 2.916 cards e agregar no navegador.';
