-- As receitas da Payt, confirmadas.
--
-- Ela pediu para aprovar "todas da payt que está como receita -> produtos".
-- Dos 102 lançamentos que casam com "PAYT", só 22 estavam pendentes -- os
-- outros 76 já tinham sido confirmados antes.
--
-- Quatro ficaram DE FORA de propósito, e é a razão de o filtro ser tão
-- específico: `pg payt paytccrvhand` e `paytccngesca` são SAÍDAS de R$ 113,53
-- em "Cursos e Formações -> Ofertas". Casam com "%PAYT%" no descritor mas não
-- são receita nem produto -- são compras feitas na plataforma. Confirmar por
-- fornecedor sem olhar grupo e categoria as levaria junto.
--
-- Por isso as três condições: grupo Receitas, categoria Produtos, valor > 0.
update public.transacoes t
   set status_revisao = 'confirmado'
  from public.vw_transacoes_revisao v
 where v.id = t.id
   and t.status_revisao in ('pendente', 'auto_categorizado')
   and v.descricao ilike '%PAYT%'
   and v.grupo = 'Receitas'
   and v.categoria = 'Produtos'
   and v.valor > 0;
