-- Notas fiscais: serviço x ferramenta decidido pelo GRUPO, não por nome.
--
-- Ela desconfiou que faltava fornecedor na tela. Conferi os 24 que foram pagos
-- em agosto: 23 aparecem. O único de fora é "Impostos (DARF)" -- e está certo,
-- imposto não tem nota fiscal, o comprovante é a própria guia.
--
-- Mas ao conferir achei outro estrago da renomeação de categoria. A função
-- decidia o tipo assim:
--
--   case when p.categoria in ('Departamento Pessoal','Edição de Vídeo','Freelancer')
--        then 'servico' else 'ferramenta' end
--
-- "Edição de Vídeo" virou "Editor de Vídeo" no campo, o nome parou de casar, e
-- as duas editoras viraram 'ferramenta'. Consequência real: a NF delas iria
-- para `ferramentas/2026-08/` com sufixo `_NF` em vez de `servicos/2026-08/`
-- com `_pagamento` -- pasta errada e nome errado, e a contabilidade recebendo
-- nota de prestador misturada com fatura de software.
--
-- Agora vem do grupo: se a categoria mora em "Departamento Pessoal", é serviço.
-- Renomear categoria não quebra mais isto.
--
-- A exclusão de sócio e reserva também passou a ser por TIPO. Era lista de
-- nomes, e uma categoria nova de sócio pediria nota fiscal de uma retirada.
create or replace function public.fn_checklist_fiscal(
  p_competencia date default (date_trunc('month', (now() at time zone 'America/Sao_Paulo')))::date
)
returns table(fornecedor text, pais text, categoria text, tipo text, valor numeric,
              lancamentos integer, primeiro_dia date, tem_documento boolean,
              documento_id uuid, drive_url text, nome_arquivo text)
language sql
stable
as $fn$
  with pagos as (
    select public.fn_fornecedor(t.descricao, -t.valor) as fornecedor,
           (array_agg(public.fn_pais_fornecedor(t.descricao, t.fonte)
                      order by t.data desc))[1] as pais,
           mode() within group (order by t.categoria) as categoria,
           sum(-t.valor)::numeric(14,2) as valor,
           count(*)::int as lancamentos,
           min(t.data) as primeiro_dia
      from public.transacoes t
      left join public.categorias_centro cc on cc.categoria = trim(t.categoria)
     where t.valor < 0
       and t.data >= p_competencia
       and t.data <  (p_competencia + interval '1 month')::date
       and coalesce(cc.tipo, 'custo') = 'custo'
       and coalesce(t.categoria, '') <> 'Impostos e Tributos'
     group by 1
  )
  select p.fornecedor, p.pais, p.categoria,
         case when cc.centro_custo = 'Departamento Pessoal'
              then 'servico' else 'ferramenta' end as tipo,
         p.valor, p.lancamentos, p.primeiro_dia,
         (d.id is not null) as tem_documento,
         d.id, d.drive_url, d.nome_arquivo
    from pagos p
    left join public.categorias_centro cc on cc.categoria = p.categoria
    left join public.documentos_fiscais d
           on d.competencia = p_competencia
          and d.fornecedor  = p.fornecedor
          and d.tipo <> 'comprovante'
   order by (d.id is not null), p.valor desc;
$fn$;

revoke execute on function public.fn_checklist_fiscal(date) from public, anon;
grant  execute on function public.fn_checklist_fiscal(date) to authenticated;
