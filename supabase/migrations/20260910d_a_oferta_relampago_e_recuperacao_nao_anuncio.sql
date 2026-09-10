-- A Oferta Relâmpago é recuperação, não anúncio
--
-- O alerta `fn_alerta_checkout_sem_rastreio` acusava "Oferta Relâmpago -
-- Saponaria Brasil" com 0% rastreado em 10 vendas, como se o link tivesse
-- perdido os parâmetros do anúncio. Não perdeu: aquele checkout é recuperação
-- de venda pelo WhatsApp, e nunca recebeu anúncio nenhum.
--
-- O cadastro em `checkouts_origem` foi corrigido de `trafego_pago = true`
-- ("é tráfego, só perdeu a UTM", escrito em 21/08) para `false`, com origem
-- 'recuperação'. Isso calou o alerta.
--
-- ── O que a correção revelou ─────────────────────────────────────────────
--
-- `vendas.trafego_pago` NÃO deriva de `checkouts_origem`. São dois campos
-- dizendo a mesma coisa, preenchidos por caminhos diferentes — a primeira
-- armadilha do CLAUDE.md — e o segundo é o que o Resumo e as Tendências usam
-- para dizer o que veio de anúncio.
--
-- Medido: a Oferta Relâmpago tem 54 vendas aprovadas desde 06/06, somando
-- R$ 3.891,74, e NENHUMA delas tem `ad_id_meta`. Ainda assim 38 estavam
-- marcadas como tráfego pago:
--
--   junho    3 vendas   R$   111,66
--   julho   18 vendas   R$ 1.256,05
--   agosto  17 vendas   R$ 1.272,81
--
-- R$ 2.640,52 contando como receita de anúncio em três meses, inflando o ROAS
-- do tráfego pago e esvaziando o back-end.
--
-- ── Por que NULO e não FALSE ─────────────────────────────────────────────
--
-- A coluna só tem dois estados hoje: `true` em 2.385 vendas e nulo em 7.596.
-- Nenhum `false`. Gravar `false` criaria um terceiro estado que as consultas
-- tratam igual a nulo, mas que se lê como decisão — e a decisão mora em
-- `checkouts_origem`, que é onde ela foi tomada.
--
-- ── Por que só este checkout ─────────────────────────────────────────────
--
-- Outros dois casos divergem do cadastro, e os dois estão CERTOS: "Assinatura"
-- tem 28 vendas marcadas como tráfego e 26 delas carregam `ad_id_meta`. São
-- vendas de anúncio que caíram num checkout de upsell, não erro de marcação.
-- Por isso a correção é nominal e ainda exige `ad_id_meta is null`: se um dia
-- uma venda daquele checkout vier com anúncio, ela fica.

UPDATE public.vendas v
   SET trafego_pago = null
 WHERE v.link_titulo  = 'Oferta Relâmpago - Saponaria Brasil'
   AND v.trafego_pago is true
   AND v.ad_id_meta is null;

-- Não sobrou nenhuma. Se a conta estiver errada a migração falha aqui, em vez
-- de deixar meia correção gravada.
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n
    FROM public.vendas v
   WHERE v.link_titulo = 'Oferta Relâmpago - Saponaria Brasil'
     AND v.trafego_pago is true;
  IF n <> 0 THEN
    RAISE EXCEPTION 'ainda restam % vendas da Oferta Relampago como trafego pago', n;
  END IF;
END $$;
