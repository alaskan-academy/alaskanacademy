-- As cinco divergências reais, decididas por ela, e um jeito de decidir uma só.
--
-- Decisões:
--   Lucas R$ 97      -> Swipe, em Softwares e Ferramentas (categoria nova)
--   Jessica R$ 40    -> Recarga e Chip, que passa de "Outros" para Softwares
--   JK Workspace R$40 -> fica em Endereço Fiscal ("isso mesmo")
--   Meta 2x R$ 5,43  -> nada a fazer, ver abaixo
--
-- Os dois do Meta não são gasto: são uma compra (-5,43, PURCHASE_INTERNATIONAL)
-- e o estorno dela (+5,43, REFUND) no mesmo dia. Somam zero. Ela cogitou criar
-- uma categoria "Automações" para eles; não há gasto para classificar.
--
-- O botão "manter" que já existia marca a CATEGORIA INTEIRA do CS como
-- imprecisa. Serve para o caso ALASKAN ACADEMY, em que o CS erra sempre naquele
-- nome. Aqui seria destruidor: silenciaria "Impostos e Tributos" e
-- "Contabilidade" em todos os lançamentos por causa de R$ 97 e R$ 40.
--
-- Por isso a decisão passa a caber num lançamento só.
alter table public.transacoes
  add column if not exists divergencia_decidida boolean not null default false;

comment on column public.transacoes.divergencia_decidida is
  'Ela olhou a divergência com o CS e decidiu manter a categoria daqui. Para de ser acusada.';

insert into public.categorias_centro (categoria, centro_custo, tipo, ordem)
values ('Swipe', 'Softwares e Ferramentas', 'custo', 500)
on conflict (categoria) do update set centro_custo = excluded.centro_custo;

update public.categorias_centro
   set centro_custo = 'Softwares e Ferramentas'
 where categoria = 'Recarga e Chip';

update public.transacoes
   set categoria = 'Swipe'
 where descricao ilike '%LUCAS DOS SANTOS VEIGA%'
   and data = date '2026-03-19' and valor = -97.00;

create or replace view public.vw_divergencias_confirmadas as
select t.id, t.data, t.descricao,
       fn_fornecedor(t.descricao, - t.valor) as fornecedor,
       t.valor,
       t.categoria as categoria_dash,
       m.categoria as categoria_cs,
       t.centro_custo,
       t.status_revisao
  from public.transacoes t
  join public.categorias_mapa m
    on m.nome_cs = coalesce(t.payload_raw->'category'->>'name',
                            t.payload_raw->'category'->>'description')
 where t.status_revisao = any (array['confirmado','revisado'])
   and m.preciso
   and not t.divergencia_decidida
   and lower(m.categoria) <> lower(coalesce(t.categoria, ''))
   and lower(coalesce(t.payload_raw->'costCenter'->>'description',
                      t.payload_raw->'costCenter'->>'name', ''))
       is distinct from lower(coalesce(t.categoria, ''));

comment on view public.vw_divergencias_confirmadas is
  'Confirmadas que discordam do CS -- menos as já decididas e as em que o centro de custo do próprio CS concorda com o painel.';
