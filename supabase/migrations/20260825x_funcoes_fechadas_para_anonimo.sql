-- Fechar as funções novas para quem não fez login.
--
-- O Postgres concede EXECUTE a PUBLIC por padrão em toda função criada, e
-- PUBLIC inclui `anon`. Meus `grant execute ... to authenticated` só somavam a
-- permissão que já existia -- nunca tiravam a de ninguém. Resultado: as 24
-- funções desta leva ficaram acessíveis pela API REST sem login.
--
-- Na maioria a RLS segurava o estrago (testei `fn_checklist_fiscal` sem
-- autenticação e volta `[]` vazio, sem vazar dado financeiro). Mas
-- `fn_reenviar_espelho` é SECURITY DEFINER -- ela ignora a RLS de propósito --
-- e respondia HTTP 200 para uma requisição anônima:
--
--   POST /rest/v1/rpc/fn_reenviar_espelho  ->  200  "documento sem arquivo"
--
-- Com um id de documento real, qualquer um na internet mandaria o servidor
-- buscar o arquivo e empurrar para o Drive da empresa.
--
-- O molde certo já existia aqui: `fn_gravar_payloads` foi criada com revoke e
-- grant só para `service_role`. Só não foi aplicado às demais.

-- ── Gatilhos ────────────────────────────────────────────────────────────────
-- Rodam como dono da tabela quando o gatilho dispara; ninguém precisa chamá-las
-- pela API. Chamar uma função de gatilho direto nem funciona, mas o certo é ela
-- não estar exposta.
revoke execute on function public.fn_apagar_espelho_drive()   from public, anon, authenticated;
revoke execute on function public.fn_disparar_espelho_drive() from public, anon, authenticated;
revoke execute on function public.fn_eventos_touch()          from public, anon, authenticated;
revoke execute on function public.fn_recado_notifica()        from public, anon, authenticated;

-- ── Só as edge functions chamam, com a chave de serviço ─────────────────────
revoke execute on function public.aplicar_regras_categoria() from public, anon, authenticated;
grant  execute on function public.aplicar_regras_categoria() to service_role;

revoke execute on function public.fn_reservar_pasta(text) from public, anon, authenticated;
grant  execute on function public.fn_reservar_pasta(text) to service_role;

-- ── O app chama, logado ─────────────────────────────────────────────────────
-- `revoke from public` é o que fecha de verdade; o `grant to authenticated`
-- depois é o que devolve o acesso a quem deve ter. Sem o revoke, o grant não
-- muda nada -- foi esse o erro original.
revoke execute on function public.fn_categoria_em_uso(text)          from public, anon;
grant  execute on function public.fn_categoria_em_uso(text)          to authenticated;

revoke execute on function public.fn_centro_em_uso(text)             from public, anon;
grant  execute on function public.fn_centro_em_uso(text)             to authenticated;

revoke execute on function public.fn_checklist_fiscal(date)          from public, anon;
grant  execute on function public.fn_checklist_fiscal(date)          to authenticated;

revoke execute on function public.fn_meu_editor()                    from public, anon;
grant  execute on function public.fn_meu_editor()                    to authenticated;

revoke execute on function public.fn_nfs_do_editor(uuid, date)       from public, anon;
grant  execute on function public.fn_nfs_do_editor(uuid, date)       to authenticated;

revoke execute on function public.fn_previsao_custos(date, integer)  from public, anon;
grant  execute on function public.fn_previsao_custos(date, integer)  to authenticated;

revoke execute on function public.fn_recorrencias(date, integer, integer) from public, anon;
grant  execute on function public.fn_recorrencias(date, integer, integer) to authenticated;

revoke execute on function public.fn_reenviar_espelho(uuid)          from public, anon;
grant  execute on function public.fn_reenviar_espelho(uuid)          to authenticated;

revoke execute on function public.fn_renomear_centro(text, text)     from public, anon;
grant  execute on function public.fn_renomear_centro(text, text)     to authenticated;

-- ── Usadas dentro de views que o app lê ─────────────────────────────────────
-- `vw_transacoes_revisao` e `vw_divergencias_confirmadas` chamam
-- `fn_fornecedor`; `vw_alertas` chama as duas de alerta. Tirar de
-- `authenticated` aqui quebraria as telas de Revisão e de Alertas.
revoke execute on function public.fn_fornecedor(text, numeric)       from public, anon;
grant  execute on function public.fn_fornecedor(text, numeric)       to authenticated;

revoke execute on function public.fn_alerta_payt_silencio()          from public, anon;
grant  execute on function public.fn_alerta_payt_silencio()          to authenticated;

revoke execute on function public.fn_alerta_webhook_pendente()       from public, anon;
grant  execute on function public.fn_alerta_webhook_pendente()       to authenticated;

-- ── Auxiliares internas ─────────────────────────────────────────────────────
-- Fecham para anônimo e seguem disponíveis para quem está logado: são chamadas
-- de dentro de outras funções e de views, e uma revogação larga demais aqui
-- apagaria dado da tela sem erro nenhum aparecer.
revoke execute on function public.fn_fornecedor_info(text, numeric)  from public, anon;
grant  execute on function public.fn_fornecedor_info(text, numeric)  to authenticated;

revoke execute on function public.fn_pais_fornecedor(text, text)     from public, anon;
grant  execute on function public.fn_pais_fornecedor(text, text)     to authenticated;

revoke execute on function public.fn_chave_recorrencia(text)         from public, anon;
grant  execute on function public.fn_chave_recorrencia(text)         to authenticated;

revoke execute on function public.aplicar_categorizacao()            from public, anon;
grant  execute on function public.aplicar_categorizacao()            to authenticated;

revoke execute on function public.fn_fixar_vinculo_ads()             from public, anon;
grant  execute on function public.fn_fixar_vinculo_ads()             to authenticated;

revoke execute on function public.fn_resolver_cliente(text, text, text, timestamptz)
  from public, anon;
grant  execute on function public.fn_resolver_cliente(text, text, text, timestamptz)
  to authenticated;
