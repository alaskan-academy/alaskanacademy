-- 2026-08-24 — o criativo como unidade, e a funcao que estourava o tempo
--
-- Depende de 20260823b (fn_criativos_meta com estreia real e filtro por projeto).
-- A agregacao por card acontece no front; aqui esta o que o banco precisou.

begin;

-- ---------------------------------------------------------------------------
-- 1. Indices que faltavam
-- ---------------------------------------------------------------------------
-- `estreia_real` calcula min(data) por anuncio e varria a tabela inteira.
create index if not exists idx_meta_ad_data
  on metricas_meta (ad_id, data) where nivel = 'ad' and ad_id is not null;

-- O filtro de vendas usa a data convertida para Sao Paulo; o indice em `data_venda`
-- nao serve para uma expressao, entao a consulta caia em varredura sequencial.
create index if not exists idx_vendas_data_sp
  on vendas (((data_venda at time zone 'America/Sao_Paulo')::date));

commit;

-- ---------------------------------------------------------------------------
-- 2. fn_criativos_meta em PL/pgSQL, com plano customizado forcado
-- ---------------------------------------------------------------------------
-- Em `language sql` a funcao era embutida na consulta que o PostgREST prepara com
-- parametros. Sem conhecer as datas, o planejador estimava 1 linha em cada CTE,
-- escolhia lacos aninhados e reexecutava a janela do ranqueamento 83.521 vezes:
-- 20 segundos, contra 1,3 do plano customizado. Como `authenticated` tem
-- statement_timeout de 8s, qualquer janela maior que um dia morria na tela.
--
-- Em PL/pgSQL a consulta tem plano proprio, e `force_custom_plan` faz o Postgres
-- replanejar a cada chamada com as datas de verdade.
--
-- Cuidado ao mexer: PL/pgSQL confere os tipos que `language sql` coagia calado.
-- `impressoes` e bigint, e sum(bigint) devolve numeric — sem o cast a funcao morre
-- com "structure of query does not match function result type".
--
-- Medido depois: 1 dia 597ms, agosto 383ms, 30 dias 1169ms, quatro meses (787
-- anuncios) 711ms. Antes, tudo acima de um dia estourava.
--
-- O corpo completo esta na definicao aplicada ao banco; reproduzi-lo aqui em dobro
-- so criaria duas fontes para a mesma verdade. Quem for recriar do zero deve usar
-- 20260823b e aplicar por cima:
--   ALTER FUNCTION public.fn_criativos_meta(date,date,uuid)
--     SET plan_cache_mode = 'force_custom_plan';
-- e converter para plpgsql com os casts ::bigint nas somas de `impressoes`.
