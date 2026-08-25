-- Os 208 anúncios pendentes, confirmados.
--
-- Depois de separar o que é WhatsApp, ela pediu para confirmar "todo os outros
-- que estão com anúncios - Anúncio (facebook ADs)".
--
-- A condição vive DENTRO do comando: `not ilike '%650-5434800%'` garante que
-- nenhuma cobrança de WhatsApp entre no lote, mesmo que uma tivesse escapado da
-- reclassificação. Conferido antes: dos 208, ZERO eram do padrão do WhatsApp.
--
--   SAO PAULO    BR   148 pendentes · R$ 115.308,82 · média R$ 779,11 · 12 cartões
--   +16505434947 BR    60 pendentes · R$  18.779,71 · média R$ 313,00 ·  6 cartões
update public.transacoes t
   set status_revisao = 'confirmado'
  from public.vw_transacoes_revisao v
 where v.id = t.id
   and t.status_revisao in ('pendente', 'auto_categorizado')
   and v.categoria = 'Anúncios (Facebook ADs)'
   and v.grupo = 'Anúncios'
   and v.descricao ilike '%FACEBK%'
   and v.descricao not ilike '%650-5434800%';
