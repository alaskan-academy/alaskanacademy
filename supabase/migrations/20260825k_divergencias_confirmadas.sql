-- Transação confirmada que discorda da Conta Simples.
--
-- Confirmado é intocável pela recategorização, e isso é certo: o que passou por
-- olho humano não deve ser sobrescrito por regra. Mas o efeito colateral é que
-- um erro confirmado fica congelado para sempre, invisível — as 682 transações
-- de dezembro a junho nunca passaram pela lógica nova, e ninguém saberia se
-- alguma estava errada.
--
-- Esta view não corrige nada. Mostra onde as duas fontes discordam para a
-- decisão ser de quem sabe, porque nem sempre o CS é o certo: as transferências
-- ALASKAN ACADEMY estão lá como "Retirada de Lucro" e são Reserva de Caixa, e
-- foi ela quem soube disso.
create or replace view public.vw_divergencias_confirmadas as
select
  t.id,
  t.data,
  t.descricao,
  public.fn_fornecedor(t.descricao, -t.valor) as fornecedor,
  t.valor,
  t.categoria      as categoria_dash,
  m.categoria      as categoria_cs,
  t.centro_custo,
  t.status_revisao
from public.transacoes t
join public.categorias_mapa m
  on m.nome_cs = coalesce(t.payload_raw->'category'->>'name',
                          t.payload_raw->'category'->>'description')
where t.status_revisao in ('confirmado', 'revisado')
  -- Só onde o CS é tão específico quanto nós. Nos nomes grossos ("Outros",
  -- "Software e Ferramentas") a divergência é esperada e não quer dizer erro.
  and m.preciso
  and lower(m.categoria) <> lower(coalesce(t.categoria, ''));

comment on view public.vw_divergencias_confirmadas is
  'Transações confirmadas cuja categoria discorda da marcada na Conta Simples. Não corrige — expõe.';

grant select on public.vw_divergencias_confirmadas to authenticated;
