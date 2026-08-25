-- A revisão passa a mostrar o fornecedor, não o descritor cru.
--
-- Conferir 1.200 linhas de "FACEBK *ZXLVNXDAY2 SAO PAULO BR" é conferir ruído.
-- O que ela precisa ler é "Meta Ads", "Hostinger (domínio)", "Vibe
-- Contabilidade" — e é justamente no nome que um erro se denuncia.
--
-- `padrao_sugerido` existe para consertar como as regras nascem. Hoje confirmar
-- uma transação grava regra com o descritor INTEIRO e confiança 1,00, o que
-- produz duas patologias: no Facebook cada id único vira uma regra inútil, e um
-- clique errado vira lei — foi assim que "LUCAS DOS SANTOS VEIGA -> Aplicativos
-- e Ferramentas" ganhou de todas as outras e desviou R$ 13.940. Quando existe
-- apelido, o padrão dele é a sugestão, porque é o recorte que já se sabe certo.
create or replace view public.vw_transacoes_revisao as
select
  t.id,
  t.data,
  t.descricao,
  t.valor,
  t.categoria,
  t.centro_custo,
  t.status_revisao,
  t.categoria_origem,
  t.fonte,
  t.created_at,
  public.fn_fornecedor(t.descricao, -t.valor) as fornecedor,
  (select f.definido
     from public.fornecedores f
    where f.ativo and f.nome = public.fn_fornecedor(t.descricao, -t.valor)
    order by f.definido, f.prioridade limit 1) as fornecedor_definido,
  coalesce(
    (select f.padrao
       from public.fornecedores f
      where f.ativo and f.tipo_match = 'contains'
        and f.nome = public.fn_fornecedor(t.descricao, -t.valor)
      order by f.prioridade limit 1),
    t.descricao
  ) as padrao_sugerido,
  t.payload_raw->'card'->>'maskedNumber' as cartao
from public.transacoes t;

comment on view public.vw_transacoes_revisao is
  'Transações com o nome do fornecedor resolvido, para a tela de revisão ler nome e não descritor.';

grant select on public.vw_transacoes_revisao to authenticated;
