-- As vendas que a função já sabia classificar e ninguém aplicou.
--
-- O alerta dizia "1 venda sem categoria de produto, R$ 46,53 nos últimos 7
-- dias". Ao revisar, são 201 no total -- e são DOIS problemas, não um:
--
--   10 vendas -> a função mapeia certo e o `produto` nunca foi gravado.
--                `mapear_produto_por_nome('Loja de Velas Online Original')`
--                devolve 'velas' quando chamada à mão, e a coluna está nula.
--                Vendas antigas, de antes de o gatilho existir.
--
--  191 vendas -> a função realmente não conhece o produto: Manual de Incensos
--                (123 vendas), Embalagens que Encantam (47), Sistema de
--                Decoração de Balões, cursos de venda em marketplace. Não é
--                erro de código: são linhas de produto que ninguém mapeou.
--                Decidir onde cada uma entra é dela.
--
-- Esta migration resolve só as 10. As 191 ficam para ela dizer o que são.
update public.vendas v
   set produto = public.mapear_produto_por_nome(v.produto_nome)
 where v.produto is null
   and v.produto_nome is not null
   and public.mapear_produto_por_nome(v.produto_nome) is not null;
