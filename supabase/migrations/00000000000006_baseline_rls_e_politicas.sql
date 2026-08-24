-- BASELINE — RLS e políticas
--
-- Último arquivo do baseline: as políticas referenciam tabelas e funções.
--
-- Em 24/08/2026 removi de nove tabelas a política `anon_read`, que deixava o papel
-- `anon` — a chave pública embutida no JavaScript — ler `clientes` (10.043 linhas,
-- 10.027 e-mails) e `vendas` (13.394) sem login. Este arquivo já sai sem elas.

alter table public.acessos enable row level security;
alter table public.ad_accounts enable row level security;
alter table public.assinaturas enable row level security;
alter table public.avaliacoes_criativos enable row level security;
alter table public.avaliacoes_mensais enable row level security;
alter table public.backup_metas_20260823 enable row level security;
alter table public.backup_projeto_20260823 enable row level security;
alter table public.caixa_config enable row level security;
alter table public.cargos enable row level security;
alter table public.checkouts_origem enable row level security;
alter table public.clientes enable row level security;
alter table public.conferencias_payt enable row level security;
alter table public.configuracoes enable row level security;
alter table public.configuracoes_texto enable row level security;
alter table public.copy_rotina_cards enable row level security;
alter table public.copytrack_ad_swipe enable row level security;
alter table public.copytrack_daily_quotes enable row level security;
alter table public.copytrack_filter_options enable row level security;
alter table public.copytrack_hooks enable row level security;
alter table public.copytrack_offer_tracking enable row level security;
alter table public.copytrack_offers enable row level security;
alter table public.criativo_campos_opcoes enable row level security;
alter table public.criativo_comentarios enable row level security;
alter table public.criativo_historico enable row level security;
alter table public.criterio_opcoes enable row level security;
alter table public.criterios_avaliacao enable row level security;
alter table public.dominios enable row level security;
alter table public.editor_comissoes enable row level security;
alter table public.editor_folgas enable row level security;
alter table public.editor_promocoes enable row level security;
alter table public.editores enable row level security;
alter table public.empresas enable row level security;
alter table public.ferramentas_saas enable row level security;
alter table public.funil_subofertas enable row level security;
alter table public.funis enable row level security;
alter table public.funis_producao enable row level security;
alter table public.import_a_20260823 enable row level security;
alter table public.links_trafego_sem_utm enable row level security;
alter table public.meta_ativos enable row level security;
alter table public.meta_insights_raw enable row level security;
alter table public.meta_sync_control enable row level security;
alter table public.meta_sync_estado enable row level security;
alter table public.metricas_diarias enable row level security;
alter table public.metricas_meta enable row level security;
alter table public.notas_fiscais enable row level security;
alter table public.notificacoes enable row level security;
alter table public.notion_criativos enable row level security;
alter table public.ofertas enable row level security;
alter table public.ofertas_editores enable row level security;
alter table public.payt_webhook_raw enable row level security;
alter table public.perfis enable row level security;
alter table public.permissoes_paginas enable row level security;
alter table public.processos_artigos enable row level security;
alter table public.processos_categorias enable row level security;
alter table public.producao_membros enable row level security;
alter table public.producoes enable row level security;
alter table public.radar_areas enable row level security;
alter table public.radar_testes enable row level security;
alter table public.referencias enable row level security;
alter table public.regras_categoria enable row level security;
alter table public.setor_permissoes enable row level security;
alter table public.setores enable row level security;
alter table public.testes_funis enable row level security;
alter table public.transacoes enable row level security;
alter table public.utm_links enable row level security;
alter table public.venda_itens enable row level security;
alter table public.vendas enable row level security;
alter table public.vendas_hotmart enable row level security;
alter table public.vendas_payt enable row level security;
alter table public.windsor_meta_staging enable row level security;
create policy acessos_select_authenticated on public.acessos for SELECT to authenticated using (true);
create policy acessos_write_admin on public.acessos for ALL to authenticated using ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = auth.uid()) AND (perfis.is_admin = true))))) with check ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = auth.uid()) AND (perfis.is_admin = true)))));
create policy authenticated_read on public.ad_accounts for SELECT to authenticated using (true);
create policy authenticated_write on public.ad_accounts for ALL to authenticated using (true) with check (true);
create policy service_all on public.ad_accounts for ALL to service_role using (true) with check (true);
create policy authenticated_read on public.assinaturas for SELECT to authenticated using (true);
create policy service_all on public.assinaturas for ALL to service_role using (true) with check (true);
create policy anon_read on public.avaliacoes_criativos for SELECT to public using (true);
create policy authenticated_read on public.avaliacoes_criativos for SELECT to authenticated using (true);
create policy authenticated_write on public.avaliacoes_criativos for ALL to authenticated using (true) with check (true);
create policy anon_read on public.avaliacoes_mensais for SELECT to public using (true);
create policy authenticated_read on public.avaliacoes_mensais for SELECT to authenticated using (true);
create policy authenticated_write on public.avaliacoes_mensais for ALL to authenticated using (true) with check (true);
create policy backup_metas_auth on public.backup_metas_20260823 for ALL to authenticated using (true) with check (true);
create policy backup_projeto_auth on public.backup_projeto_20260823 for ALL to authenticated using (true) with check (true);
create policy authenticated_read on public.caixa_config for SELECT to authenticated using (true);
create policy authenticated_write on public.caixa_config for ALL to authenticated using (true) with check (true);
create policy service_all on public.caixa_config for ALL to service_role using (true) with check (true);
create policy anon_read on public.cargos for SELECT to public using (true);
create policy authenticated_read on public.cargos for SELECT to authenticated using (true);
create policy authenticated_write on public.cargos for ALL to authenticated using (true) with check (true);
create policy checkouts_origem_admin on public.checkouts_origem for ALL to authenticated using (true) with check (true);
create policy authenticated_read on public.clientes for SELECT to authenticated using (true);
create policy service_all on public.clientes for ALL to service_role using (true) with check (true);
create policy conferencias_payt_admin on public.conferencias_payt for ALL to authenticated using (true) with check (true);
create policy authenticated_read on public.configuracoes for SELECT to authenticated using (true);
create policy authenticated_write on public.configuracoes for ALL to authenticated using (true) with check (true);
create policy service_all on public.configuracoes for ALL to service_role using (true) with check (true);
create policy authenticated_read on public.configuracoes_texto for SELECT to authenticated using (true);
create policy authenticated_write on public.configuracoes_texto for ALL to authenticated using (true) with check (true);
create policy copy_rotina_all_authenticated on public.copy_rotina_cards for ALL to authenticated using (true) with check (true);
create policy copytrack_ad_swipe_auth on public.copytrack_ad_swipe for ALL to authenticated using (true) with check (true);
create policy copytrack_daily_quotes_auth on public.copytrack_daily_quotes for ALL to authenticated using (true) with check (true);
create policy copytrack_filter_options_auth on public.copytrack_filter_options for ALL to authenticated using (true) with check (true);
create policy copytrack_hooks_auth on public.copytrack_hooks for ALL to authenticated using (true) with check (true);
create policy copytrack_offer_tracking_auth on public.copytrack_offer_tracking for ALL to authenticated using (true) with check (true);
create policy copytrack_offers_auth on public.copytrack_offers for ALL to authenticated using (true) with check (true);
create policy "authenticated read" on public.criativo_campos_opcoes for SELECT to authenticated using (true);
create policy "authenticated write" on public.criativo_campos_opcoes for ALL to authenticated using (true) with check (true);
create policy comentarios_auth on public.criativo_comentarios for ALL to authenticated using (true) with check (true);
create policy criativo_historico_auth on public.criativo_historico for ALL to authenticated using (true) with check (true);
create policy anon_read on public.criterio_opcoes for SELECT to public using (true);
create policy authenticated_read on public.criterio_opcoes for SELECT to authenticated using (true);
create policy authenticated_write on public.criterio_opcoes for ALL to authenticated using (true) with check (true);
create policy anon_read on public.criterios_avaliacao for SELECT to public using (true);
create policy authenticated_read on public.criterios_avaliacao for SELECT to authenticated using (true);
create policy authenticated_write on public.criterios_avaliacao for ALL to authenticated using (true) with check (true);
create policy dominios_all on public.dominios for ALL to authenticated using (true) with check (true);
create policy anon_read on public.editor_comissoes for SELECT to public using (true);
create policy authenticated_read on public.editor_comissoes for SELECT to authenticated using (true);
create policy authenticated_write on public.editor_comissoes for ALL to authenticated using (true) with check (true);
create policy anon_read on public.editor_folgas for SELECT to public using (true);
create policy authenticated_read on public.editor_folgas for SELECT to authenticated using (true);
create policy authenticated_write on public.editor_folgas for ALL to authenticated using (true) with check (true);
create policy anon_read on public.editor_promocoes for SELECT to public using (true);
create policy authenticated_read on public.editor_promocoes for SELECT to authenticated using (true);
create policy authenticated_write on public.editor_promocoes for ALL to authenticated using (true) with check (true);
create policy anon_read on public.editores for SELECT to public using (true);
create policy authenticated_read on public.editores for SELECT to authenticated using (true);
create policy authenticated_write on public.editores for ALL to authenticated using (true) with check (true);
create policy anon_read on public.empresas for SELECT to public using (true);
create policy authenticated_read on public.empresas for SELECT to authenticated using (true);
create policy authenticated_write on public.empresas for ALL to authenticated using (true) with check (true);
create policy authenticated_all on public.ferramentas_saas for ALL to authenticated using (true) with check (true);
create policy funil_subofertas_all on public.funil_subofertas for ALL to authenticated using (true) with check (true);
create policy authenticated_all on public.funis for ALL to authenticated using (true) with check (true);
create policy funis_producao_auth on public.funis_producao for ALL to authenticated using (true) with check (true);
create policy import_a_auth on public.import_a_20260823 for ALL to authenticated using (true) with check (true);
create policy authenticated_read on public.links_trafego_sem_utm for SELECT to authenticated using (true);
create policy authenticated_read on public.meta_ativos for SELECT to authenticated using (true);
create policy authenticated_write on public.meta_ativos for ALL to authenticated using (true) with check (true);
create policy leitura_autenticados on public.meta_ativos for SELECT to public using ((auth.uid() IS NOT NULL));
create policy authenticated_read on public.meta_insights_raw for SELECT to authenticated using (true);
create policy service_all on public.meta_insights_raw for ALL to service_role using (true) with check (true);
create policy authenticated_read on public.meta_sync_control for SELECT to authenticated using (true);
create policy service_all on public.meta_sync_control for ALL to service_role using (true) with check (true);
create policy authenticated_read on public.meta_sync_estado for SELECT to authenticated using (true);
create policy service_all on public.meta_sync_estado for ALL to service_role using (true) with check (true);
create policy authenticated_all on public.metricas_diarias for ALL to authenticated using (true) with check (true);
create policy authenticated_read on public.metricas_meta for SELECT to authenticated using (true);
create policy service_all on public.metricas_meta for ALL to service_role using (true) with check (true);
create policy authenticated_all on public.notas_fiscais for ALL to authenticated using (true) with check (true);
create policy notificacoes_insert_auth on public.notificacoes for INSERT to authenticated with check (true);
create policy notificacoes_select_own on public.notificacoes for SELECT to authenticated using ((usuario_id = auth.uid()));
create policy notificacoes_update_own on public.notificacoes for UPDATE to authenticated using ((usuario_id = auth.uid())) with check ((usuario_id = auth.uid()));
create policy authenticated_read on public.notion_criativos for SELECT to authenticated using (true);
create policy service_all on public.notion_criativos for ALL to service_role using (true);
create policy authenticated_read on public.ofertas for SELECT to authenticated using (true);
create policy service_all on public.ofertas for ALL to service_role using (true) with check (true);
create policy anon_read on public.ofertas_editores for SELECT to public using (true);
create policy authenticated_read on public.ofertas_editores for SELECT to authenticated using (true);
create policy authenticated_write on public.ofertas_editores for ALL to authenticated using (true) with check (true);
create policy authenticated_read on public.payt_webhook_raw for SELECT to authenticated using (true);
create policy perfis_delete on public.perfis for DELETE to authenticated using (is_current_user_admin());
create policy perfis_insert on public.perfis for INSERT to authenticated with check (is_current_user_admin());
create policy perfis_select on public.perfis for SELECT to authenticated using (true);
create policy perfis_update on public.perfis for UPDATE to authenticated using ((is_current_user_admin() OR (id = auth.uid())));
create policy permissoes_all on public.permissoes_paginas for ALL to authenticated using (is_current_user_admin()) with check (is_current_user_admin());
create policy permissoes_select on public.permissoes_paginas for SELECT to authenticated using (((auth.uid() = usuario_id) OR is_current_user_admin()));
create policy authenticated_read on public.processos_artigos for SELECT to authenticated using (true);
create policy authenticated_write on public.processos_artigos for ALL to authenticated using (true) with check (true);
create policy processos_art_select on public.processos_artigos for SELECT to public using (true);
create policy authenticated_read on public.processos_categorias for SELECT to authenticated using (true);
create policy authenticated_write on public.processos_categorias for ALL to authenticated using (true) with check (true);
create policy processos_cat_select on public.processos_categorias for SELECT to public using (true);
create policy producao_membros_auth on public.producao_membros for ALL to authenticated using (true) with check (true);
create policy criativos_auth on public.producoes for ALL to authenticated using (true) with check (true);
create policy radar_areas_admin_write on public.radar_areas for ALL to authenticated using ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = auth.uid()) AND (perfis.is_admin = true)))));
create policy radar_areas_select on public.radar_areas for SELECT to authenticated using (true);
create policy radar_testes_delete on public.radar_testes for DELETE to authenticated using (((criado_por = auth.uid()) OR (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = auth.uid()) AND (perfis.is_admin = true))))));
create policy radar_testes_insert on public.radar_testes for INSERT to authenticated with check ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = auth.uid()) AND (perfis.radar_pode_criar = true)))));
create policy radar_testes_select on public.radar_testes for SELECT to authenticated using (true);
create policy radar_testes_update on public.radar_testes for UPDATE to authenticated using (((criado_por = auth.uid()) OR (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = auth.uid()) AND (perfis.is_admin = true))))));
create policy referencias_insert on public.referencias for INSERT to authenticated with check (true);
create policy referencias_select on public.referencias for SELECT to authenticated using (true);
create policy referencias_update on public.referencias for UPDATE to authenticated using (true) with check (true);
create policy authenticated_all on public.regras_categoria for ALL to authenticated using (true) with check (true);
create policy setor_permissoes_admin_write on public.setor_permissoes for ALL to authenticated using ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = auth.uid()) AND (perfis.is_admin = true))))) with check ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = auth.uid()) AND (perfis.is_admin = true)))));
create policy setor_permissoes_all_service on public.setor_permissoes for ALL to service_role using (true);
create policy setor_permissoes_select on public.setor_permissoes for SELECT to authenticated using (true);
create policy setores_admin_write on public.setores for ALL to authenticated using ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = auth.uid()) AND (perfis.is_admin = true))))) with check ((EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = auth.uid()) AND (perfis.is_admin = true)))));
create policy setores_select on public.setores for SELECT to authenticated using (true);
create policy testes_funis_all on public.testes_funis for ALL to authenticated using (true) with check (true);
create policy authenticated_all on public.transacoes for ALL to authenticated using (true) with check (true);
create policy allow_authenticated on public.utm_links for ALL to authenticated using (true) with check (true);
create policy authenticated_read on public.venda_itens for SELECT to authenticated using (true);
create policy service_all on public.venda_itens for ALL to service_role using (true) with check (true);
create policy authenticated_read on public.vendas for SELECT to authenticated using (true);
create policy service_all on public.vendas for ALL to service_role using (true) with check (true);
create policy anon_read on public.vendas_hotmart for SELECT to public using (true);
create policy authenticated_read on public.vendas_hotmart for SELECT to authenticated using (true);
create policy authenticated_write on public.vendas_hotmart for ALL to authenticated using (true) with check (true);
create policy authenticated_read on public.vendas_payt for SELECT to authenticated using (true);
create policy service_all on public.vendas_payt for ALL to service_role using (true) with check (true);
create policy anon_read on public.windsor_meta_staging for SELECT to public using (true);
create policy authenticated_read on public.windsor_meta_staging for SELECT to authenticated using (true);
create policy authenticated_write on public.windsor_meta_staging for ALL to authenticated using (true) with check (true);