-- A divergência só vale quando o CS concorda consigo mesmo.
--
-- A view comparava apenas `payload_raw->'category'` e ignorava o `costCenter`
-- que vem no mesmo payload. Só que a Conta Simples guarda os dois, e eles se
-- contradizem: as três transferências para ALASKAN ACADEMY têm
--
--    costCenter.description = "Reserva de Caixa"
--    category.description   = "Retirada de Lucro"
--
-- O painel classificou como Reserva de Caixa -- que é o que bate com o centro
-- de custo do PRÓPRIO CS e com os outros 12 lançamentos iguais. Ainda assim a
-- tela acusava R$ 7.000 de divergência, pedindo que ela decidisse algo que já
-- estava certo.
--
-- Acusar o que está certo é pior do que não acusar nada: gasta a atenção dela e
-- ensina a ignorar o aviso. Quando o centro de custo do CS já concorda com a
-- categoria do painel, a contradição é interna do CS e não há o que decidir.
--
-- Efeito medido: das 9 divergências, 4 somem (R$ 10.000 -- as 3 da ALASKAN
-- ACADEMY mais uma de Sócios) e sobram 5 de verdade, somando R$ 187,86.
create or replace view public.vw_divergencias_confirmadas as
select t.id,
       t.data,
       t.descricao,
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
   and lower(m.categoria) <> lower(coalesce(t.categoria, ''))
   -- O escape: o centro de custo do CS bate com o que o painel diz.
   and lower(coalesce(t.payload_raw->'costCenter'->>'description',
                      t.payload_raw->'costCenter'->>'name', ''))
       is distinct from lower(coalesce(t.categoria, ''));

comment on view public.vw_divergencias_confirmadas is
  'Confirmadas que discordam do CS -- exceto quando o centro de custo do próprio CS já concorda com o painel.';
