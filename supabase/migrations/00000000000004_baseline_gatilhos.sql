-- BASELINE — gatilhos
--
-- Depende de 00000000000003_baseline_funcoes.sql: todo gatilho aponta para uma
-- funcao. Vale reparar em `trg_normalizar_venda_payt`: e ele que leva a venda de
-- `vendas_payt` para `vendas`, e foi ele que travou em 24/08/2026 quando um
-- CREATE INDEX bloqueou `vendas` -- o webhook estourou o tempo e um pagamento de
-- R$ 87,12 ficou registrado como pendente ate ser reprocessado a mao.

CREATE TRIGGER trg_auto_produto_assinatura BEFORE INSERT OR UPDATE ON public.assinaturas FOR EACH ROW EXECUTE FUNCTION fn_auto_produto_assinatura();
CREATE TRIGGER trg_copy_rotina_atualizado_em BEFORE UPDATE ON public.copy_rotina_cards FOR EACH ROW EXECUTE FUNCTION update_copy_rotina_atualizado_em();
CREATE TRIGGER trg_funis_timestamp BEFORE UPDATE ON public.funis FOR EACH ROW EXECUTE FUNCTION fn_update_funis_timestamp();
CREATE TRIGGER trg_metricas_meta_produto BEFORE INSERT OR UPDATE ON public.metricas_meta FOR EACH ROW EXECUTE FUNCTION fn_metricas_meta_produto();
CREATE TRIGGER trg_resolver_conta_apos_sync AFTER INSERT ON public.metricas_meta REFERENCING NEW TABLE AS novas FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_resolver_conta();
CREATE TRIGGER trg_preservar_produto_oferta BEFORE UPDATE ON public.ofertas FOR EACH ROW EXECUTE FUNCTION fn_preservar_produto_oferta();
CREATE TRIGGER trg_assinatura_venda AFTER INSERT OR UPDATE ON public.vendas FOR EACH ROW EXECUTE FUNCTION trg_fn_assinatura();
CREATE TRIGGER trg_auto_produto_venda BEFORE INSERT OR UPDATE ON public.vendas FOR EACH ROW EXECUTE FUNCTION fn_auto_produto_venda();
CREATE TRIGGER trg_campos_data BEFORE INSERT OR UPDATE ON public.vendas FOR EACH ROW EXECUTE FUNCTION fn_campos_data();
CREATE TRIGGER trg_cliente_venda AFTER INSERT OR UPDATE ON public.vendas FOR EACH ROW EXECUTE FUNCTION trg_fn_cliente();
CREATE TRIGGER trg_marcar_trafego_sem_utm BEFORE INSERT OR UPDATE OF link_titulo, ad_id_meta ON public.vendas FOR EACH ROW EXECUTE FUNCTION trg_fn_marcar_trafego_sem_utm();
CREATE TRIGGER trg_marcar_upsell BEFORE INSERT OR UPDATE ON public.vendas FOR EACH ROW EXECUTE FUNCTION fn_marcar_upsell();
CREATE TRIGGER trg_origem_venda BEFORE INSERT OR UPDATE ON public.vendas FOR EACH ROW EXECUTE FUNCTION trg_fn_origem();
CREATE TRIGGER trg_prejuizo BEFORE INSERT OR UPDATE OF valor_pago_plataforma, valor_reembolsado ON public.vendas FOR EACH ROW EXECUTE FUNCTION trg_fn_prejuizo();
CREATE TRIGGER trg_normalizar_venda_payt AFTER INSERT OR UPDATE ON public.vendas_payt FOR EACH ROW EXECUTE FUNCTION trg_fn_normalizar_venda_payt();
