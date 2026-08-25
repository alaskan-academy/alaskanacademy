-- As recorrências passam a agrupar por fornecedor, não por grafia.
--
-- Antes, Hostinger existia como 6 chaves diferentes e nenhuma atingia os 3
-- meses mínimos: um gasto recorrente de R$ 1.025 em 19 lançamentos ficava
-- invisível na previsão. Mesma coisa com Sellflux, UTMify, Vercel e CapCut.

-- `recorrencias_encerradas` guarda a chave antiga. Sem migrar, Membify e
-- Lovable voltariam a aparecer como "não veio" — o problema que a tabela existe
-- para resolver.
update public.recorrencias_encerradas e
   set chave = public.fn_fornecedor(e.descricao)
 where public.fn_fornecedor(e.descricao) is distinct from e.chave;
