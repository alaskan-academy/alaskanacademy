-- A matriz ganha o centro de custo, que é o nível que o CS preenche e o DRE
-- soma. A categoria continua ali dentro, como detalhe — é o modelo de dois
-- níveis ficando visível em vez de existir só na cabeça de quem escreveu.
--
-- "(sem centro)" em vez de esconder: linha sem centro é trabalho pendente no
-- CS, e escondê-la faria o total da tela não fechar com o extrato.
--
-- `drop` antes de recriar: Postgres não deixa `create or replace view` mudar o
-- nome de uma coluna existente, e a segunda coluna deixou de ser `categoria`.
drop view if exists public.vw_custos_categoria_mes;

create view public.vw_custos_categoria_mes as
select
  date_trunc('month', t.data)::date as mes,
  coalesce(nullif(trim(t.centro_custo), ''), '(sem centro)') as centro_custo,
  coalesce(nullif(trim(t.categoria), ''), 'Sem categoria')   as categoria,
  sum(-t.valor)::numeric(14,2) as gasto,
  count(*)::int as lancamentos
from public.transacoes t
where t.valor < 0
  and coalesce(t.categoria, '') not in
      ('Pró-labore', 'Retirada de Lucro', 'Sócios', 'Reserva de Caixa')
group by 1, 2, 3;

comment on view public.vw_custos_categoria_mes is
  'Custo operacional por centro de custo, categoria e mês. Exclui sócio e reserva, que são movimentação.';

grant select on public.vw_custos_categoria_mes to authenticated;
