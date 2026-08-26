-- Duas correções na view de desempenho dos links, achadas ao ligar a tela.

-- 1. `links_com_mesma_utm` — a atribuição por UTM é AMBÍGUA e precisa dizer isso.
--
-- Nove combinações de UTM se repetem entre 18 dos 134 links. Quando isso
-- acontece, a mesma venda é contada para cada link do grupo — somar a coluna dá
-- um total inflado e nada denuncia.
--
-- A maioria é duplicata acidental (o mesmo link criado duas vezes), mas há erro
-- real: "Recuperação 20% Off - Velaroma" está com `campaign=saponaria`,
-- provavelmente copiado do link da Saponária sem trocar o campo. Ou seja: o
-- aviso não é só defensivo, ele já encontrou um problema de cadastro.

-- 2. `url_base` e `term` faltavam, e o modal de edição lê os dois.
--
-- O cast `as UtmLink[]` no front escondia isso do TypeScript. Abrir "Editar"
-- traria os campos vazios, e salvar apagaria a URL base do link — perda de dado
-- silenciosa, do tipo que só aparece quando alguém vai usar o link e ele está
-- quebrado.

drop view if exists public.vw_utm_links_desempenho;

create view public.vw_utm_links_desempenho as
select
  l.id,
  l.nome,
  l.url_base,
  l.url_final,
  l.source,
  l.medium,
  l.campaign,
  l.content,
  l.term,
  l.projeto_id,
  l.criado_em,
  l.arquivado,
  coalesce(s.vendas, 0)      as vendas,
  coalesce(s.faturamento, 0) as faturamento,
  s.primeira_venda,
  s.ultima_venda,
  -- Separa "link novo, ainda sem dados" de "link velho que nunca vendeu".
  -- Olhando só o zero os dois parecem iguais, e pedem reações opostas.
  (current_date - l.criado_em::date) as dias_de_vida,
  (select count(*) from public.utm_links o
    where not o.arquivado
      and o.source   is not distinct from l.source
      and o.medium   is not distinct from l.medium
      and o.campaign is not distinct from l.campaign
      and o.content  is not distinct from l.content
  ) as links_com_mesma_utm
from public.utm_links l
left join lateral (
  select
    count(*)                        as vendas,
    sum(v.valor_total)              as faturamento,
    min(v.data_venda)::date         as primeira_venda,
    max(v.data_venda)::date         as ultima_venda
  from public.vendas v
  where v.status = 'aprovada'
    -- `is not distinct from` e não `=`: `content` é nulo em boa parte dos links
    -- e das vendas, e com `=` todo par com nulo sairia da conta em silêncio.
    and v.utm_source   is not distinct from l.source
    and v.utm_medium   is not distinct from l.medium
    and v.utm_campaign is not distinct from l.campaign
    and v.utm_content  is not distinct from l.content
) s on true;

comment on view public.vw_utm_links_desempenho is
  'Cada link de UTM com as vendas que trouxe. links_com_mesma_utm > 1 significa '
  'que a atribuição é ambígua: vários links têm a mesma combinação e a mesma '
  'venda conta para todos.';

alter view public.vw_utm_links_desempenho set (security_invoker = on);
