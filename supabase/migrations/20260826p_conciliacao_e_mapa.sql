-- A conciliação com nome, descritor e meio de pagamento.
--
-- Ela pediu: mostrar o nome original E o que ela deu, e que os dois saiam no
-- export junto com data, meio de pagamento e valor. A tela lia `transacoes`
-- cru -- só tinha o descritor do banco, sem apelido, sem cartão, sem forma de
-- pagamento. E não tinha export nenhum.
--
-- O meio vem de dois lugares porque a Conta Simples separa assim:
--   cartão -> `card.maskedNumber`, e o número diz qual cartão
--   conta   -> `transactionType.description`, já em português: "PIX Enviado",
--              "Recebimento via PIX", "Rentabilidade CDI", "Pagamento de
--              Contas", "Cashback recebido"
create or replace view public.vw_conciliacao as
select t.id,
       t.data,
       fn_fornecedor(t.descricao, - t.valor) as nome,
       t.descricao as descricao_original,
       case
         when t.payload_raw->'card'->>'maskedNumber' is not null
           then 'Cartão ' || (t.payload_raw->'card'->>'maskedNumber')
         when t.payload_raw->'transactionType'->>'description' is not null
           then t.payload_raw->'transactionType'->>'description'
         else 'Conta'
       end as meio_pagamento,
       t.valor,
       t.categoria,
       coalesce(cc.centro_custo, nullif(trim(t.centro_custo), '')) as grupo,
       t.status_revisao,
       t.payload_raw->'card'->>'maskedNumber' as cartao
  from public.transacoes t
  left join public.categorias_centro cc on cc.categoria = trim(t.categoria);

comment on view public.vw_conciliacao is
  'O extrato para a contabilidade: nome dado e descritor original lado a lado, meio de pagamento por extenso, e o grupo resolvido pelo plano de contas.';

grant select on public.vw_conciliacao to authenticated;

-- O mapa de custos excluía sócios e reserva por LISTA FIXA de nomes.
--
-- Funcionava, mas é a mesma armadilha que acabou de esconder R$ 10 mil no DRE:
-- uma categoria nova de sócio ou reserva criada no campo vazaria para dentro
-- dos custos, e o mapa somaria retirada de lucro como se fosse despesa.
--
-- Agora exclui por `tipo`. Conferido antes e depois: agosto fecha em
-- R$ 119.656,77 nos dois.
create or replace view public.vw_custos_categoria_mes as
select date_trunc('month', t.data::timestamptz)::date as mes,
       coalesce(cc.centro_custo, nullif(trim(t.centro_custo), ''), '(sem centro)') as centro_custo,
       coalesce(nullif(trim(t.categoria), ''), 'Sem categoria') as categoria,
       min(coalesce(cc.ordem, 999)) as ordem,
       sum(- t.valor)::numeric(14,2) as gasto,
       count(*)::integer as lancamentos
  from public.transacoes t
  left join public.categorias_centro cc on cc.categoria = trim(t.categoria)
 where t.valor < 0
   and coalesce(cc.tipo, 'custo') = 'custo'
 group by 1, 2, 3;

comment on view public.vw_custos_categoria_mes is
  'Custo operacional por categoria e mês. Exclui sócio e reserva pelo TIPO da categoria, não por lista de nomes.';
