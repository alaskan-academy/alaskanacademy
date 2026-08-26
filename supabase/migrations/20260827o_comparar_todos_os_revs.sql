-- Todos os REVs lado a lado, na mesma janela.
--
-- A rodada mostra um REV de cada vez, e isso é certo para analisar: as 3 horas
-- quinzenais são sobre entender um funil por vez. Mas a pergunta "qual funil eu
-- corto" é de COMPARAÇÃO, e respondê-la percorrendo seis telas exige guardar
-- seis conjuntos de números na cabeça — que é exatamente como se decide errado.
--
-- Uma linha por REV ativo, com o que decide: se o front se paga, o ROAS do
-- front, a adesão ao upsell e o ROAS total. O par (front, total) lado a lado é
-- o que impede as duas leituras erradas de sempre — matar funil lucrativo
-- porque o front é fraco, ou deixar front doente rodando porque o total fecha.
--
-- Uma chamada só em vez de N: seis chamadas separadas do front atrasariam a
-- tela sem ganhar nada, e as janelas poderiam divergir se alguém trocasse o
-- período no meio do carregamento.

create or replace function public.fn_comparar_revs(
  p_inicio date,
  p_fim    date
)
returns table (
  funil_id  uuid,
  rev       text,
  projeto   text,
  metodo    text,
  atual     jsonb,
  anterior  jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with dias as (select (p_fim - p_inicio) + 1 as n)
  select
    r.id,
    r.rev,
    r.projeto,
    f.metodo,
    public.fn_metricas_do_rev_bloco(r.id, p_inicio, p_fim),
    -- Mesmo tamanho, colado atrás: é a única comparação que não mente.
    public.fn_metricas_do_rev_bloco(r.id, p_inicio - (select n from dias), p_inicio - 1)
  from public.vw_mapa_revs r
  join public.funis f on f.id = r.id
  where r.status = 'ativo';
$$;

comment on function public.fn_comparar_revs(date, date) is
  'Uma linha por REV ativo na mesma janela, para a tela de comparação. '
  'Existe para a pergunta "qual funil eu corto", que a rodada não responde.';

revoke execute on function public.fn_comparar_revs(date, date) from public, anon;
grant  execute on function public.fn_comparar_revs(date, date) to authenticated, service_role;
