-- BASELINE — índices
--
-- Só os índices próprios: os que sustentam chave primária e restrição de unicidade
-- nascem junto com as constraints, em 00000000000001_baseline_tabelas.sql.
--
-- Depende de 00000000000002_baseline_funcoes.sql: `producoes_nome_criativo` indexa
-- o resultado de `fn_nome_criativo(nome)`, entao a funcao precisa existir antes.
--
-- Dois deles sao de 24/08/2026 e vale saber por que existem: `idx_meta_ad_data`
-- serve o min(data) por anuncio, que antes varria a tabela inteira; e
-- `idx_vendas_data_sp` indexa a data ja convertida para Sao Paulo, porque o filtro
-- usa essa expressao e o indice em `data_venda` nunca era aproveitado.
--
-- Ao recriar num banco com trafego, use CREATE INDEX CONCURRENTLY: a forma comum
-- bloqueia escritas na tabela enquanto constroi. Foi assim que um pagamento da
-- Payt estourou o tempo do gatilho em 24/08.

CREATE UNIQUE INDEX ad_accounts_account_id_unico ON public.ad_accounts USING btree (account_id);
CREATE INDEX idx_assinatura_cliente ON public.assinaturas USING btree (cliente_id);
CREATE INDEX idx_assinatura_produto ON public.assinaturas USING btree (produto);
CREATE INDEX idx_assinatura_status ON public.assinaturas USING btree (status);
CREATE INDEX idx_avaliacoes_editor ON public.avaliacoes_criativos USING btree (editor_id);
CREATE INDEX idx_avaliacoes_mes ON public.avaliacoes_criativos USING btree (mes_referencia);
CREATE INDEX idx_av_mensais_editor ON public.avaliacoes_mensais USING btree (editor_id);
CREATE INDEX idx_av_mensais_mes ON public.avaliacoes_mensais USING btree (mes_referencia);
CREATE UNIQUE INDEX checkouts_origem_chave ON public.checkouts_origem USING btree (COALESCE(link_titulo, ''::text), COALESCE(produto_nome, ''::text));
CREATE UNIQUE INDEX clientes_email_unico ON public.clientes USING btree (lower(TRIM(BOTH FROM email))) WHERE (NULLIF(TRIM(BOTH FROM email), ''::text) IS NOT NULL);
CREATE INDEX idx_clientes_cohort ON public.clientes USING btree (cohort_semana);
CREATE INDEX idx_clientes_cpf_hash ON public.clientes USING btree (cpf_hash);
CREATE INDEX idx_clientes_email ON public.clientes USING btree (email) WHERE (email IS NOT NULL);
CREATE INDEX idx_clientes_telefone ON public.clientes USING btree (telefone) WHERE (telefone IS NOT NULL);
CREATE INDEX conferencias_payt_recentes ON public.conferencias_payt USING btree (criado_em DESC);
CREATE INDEX idx_comentarios_criativo ON public.criativo_comentarios USING btree (criativo_id, criado_em);
CREATE INDEX idx_criterio_opcoes_criterio ON public.criterio_opcoes USING btree (criterio_id);
CREATE INDEX idx_editor_comissoes_editor ON public.editor_comissoes USING btree (editor_id);
CREATE INDEX idx_editor_folgas_editor ON public.editor_folgas USING btree (editor_id);
CREATE INDEX idx_editor_promocoes_editor ON public.editor_promocoes USING btree (editor_id);
CREATE INDEX idx_meta_ativos_bm_id ON public.meta_ativos USING btree (bm_id);
CREATE INDEX idx_meta_ativos_tipo ON public.meta_ativos USING btree (tipo);
CREATE INDEX idx_meta_raw_data ON public.meta_insights_raw USING btree (data DESC);
CREATE INDEX idx_meta_ad ON public.metricas_meta USING btree (ad_id);
CREATE INDEX idx_meta_ad_account ON public.metricas_meta USING btree (ad_account_id);
CREATE INDEX idx_meta_ad_data ON public.metricas_meta USING btree (ad_id, data) WHERE ((nivel = 'ad'::nivel_meta) AND (ad_id IS NOT NULL));
CREATE INDEX idx_meta_adset ON public.metricas_meta USING btree (adset_id);
CREATE INDEX idx_meta_campanha ON public.metricas_meta USING btree (campanha_id);
CREATE INDEX idx_meta_data ON public.metricas_meta USING btree (data);
CREATE INDEX idx_meta_hora ON public.metricas_meta USING btree (hora);
CREATE INDEX idx_meta_nivel ON public.metricas_meta USING btree (nivel);
CREATE INDEX idx_meta_produto ON public.metricas_meta USING btree (produto);
CREATE UNIQUE INDEX metricas_meta_unique ON public.metricas_meta USING btree (data, ad_account_id, nivel, campanha_id_key, adset_id_key, ad_id_key);
CREATE INDEX notificacoes_usuario_lida_idx ON public.notificacoes USING btree (usuario_id, lida, criado_em DESC);
CREATE INDEX idx_payt_raw_payt_id ON public.payt_webhook_raw USING btree (payt_id) WHERE (payt_id IS NOT NULL);
CREATE INDEX idx_payt_raw_pendente ON public.payt_webhook_raw USING btree (recebido_em DESC) WHERE (NOT processado);
CREATE INDEX idx_producoes_especialista_id ON public.producoes USING btree (especialista_id);
CREATE UNIQUE INDEX producoes_ad_id_meta_unico ON public.producoes USING btree (ad_id_meta) WHERE (ad_id_meta IS NOT NULL);
CREATE INDEX producoes_nome_criativo ON public.producoes USING btree (fn_nome_criativo(nome)) WHERE (fase = 'postado'::text);
CREATE INDEX idx_radar_testes_deletado_em ON public.radar_testes USING btree (deletado_em) WHERE (deletado_em IS NULL);
CREATE INDEX idx_radar_testes_fonte ON public.radar_testes USING btree (fonte, fonte_id);
CREATE INDEX idx_testes_funis_pipeline ON public.testes_funis USING btree (pipeline_status);
CREATE INDEX idx_vi_tipo ON public.venda_itens USING btree (tipo);
CREATE INDEX idx_vi_venda ON public.venda_itens USING btree (venda_id);
CREATE INDEX idx_vendas_ad_account ON public.vendas USING btree (ad_account_id) WHERE (ad_account_id IS NOT NULL);
CREATE INDEX idx_vendas_assinatura ON public.vendas USING btree (assinatura_id);
CREATE INDEX idx_vendas_cart_id ON public.vendas USING btree (cart_id) WHERE (cart_id IS NOT NULL);
CREATE INDEX idx_vendas_cliente ON public.vendas USING btree (cliente_id);
CREATE INDEX idx_vendas_data ON public.vendas USING btree (data_venda);
CREATE INDEX idx_vendas_data_sp ON public.vendas USING btree ((((data_venda AT TIME ZONE 'America/Sao_Paulo'::text))::date));
CREATE INDEX idx_vendas_funil ON public.vendas USING btree (funil_id);
CREATE INDEX idx_vendas_hora ON public.vendas USING btree (hora_venda);
CREATE INDEX idx_vendas_link_titulo ON public.vendas USING btree (link_titulo);
CREATE INDEX idx_vendas_mes ON public.vendas USING btree (mes_ano);
CREATE INDEX idx_vendas_origem ON public.vendas USING btree (origem);
CREATE INDEX idx_vendas_produto ON public.vendas USING btree (produto);
CREATE INDEX idx_vendas_produto_nome ON public.vendas USING btree (produto_nome);
CREATE INDEX idx_vendas_semana ON public.vendas USING btree (semana_iso);
CREATE INDEX idx_vendas_status ON public.vendas USING btree (status);
CREATE INDEX idx_vendas_trafego_pago ON public.vendas USING btree (trafego_pago) WHERE trafego_pago;
CREATE INDEX idx_vendas_upsell ON public.vendas USING btree (upsell_de);
CREATE INDEX idx_vendas_utm_camp ON public.vendas USING btree (utm_campaign);
CREATE INDEX idx_vendas_utm_content ON public.vendas USING btree (utm_content);
CREATE INDEX idx_vendas_utm_source ON public.vendas USING btree (utm_source);
CREATE INDEX idx_vendas_payt_data ON public.vendas_payt USING btree (data);
CREATE INDEX idx_vendas_payt_status ON public.vendas_payt USING btree (status);
CREATE INDEX idx_vendas_payt_tipo ON public.vendas_payt USING btree (tipo_venda);
CREATE INDEX idx_vendas_payt_utm_content ON public.vendas_payt USING btree (utm_content);
CREATE INDEX idx_windsor_staging_processado ON public.windsor_meta_staging USING btree (processado) WHERE (processado = false);
