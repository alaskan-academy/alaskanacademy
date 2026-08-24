-- BASELINE — tipos enumerados
--
-- Este arquivo e os outros `00000000000*_baseline_*` descrevem o banco como ele
-- estava em 24/08/2026, antes de existir qualquer migration. Ate aqui o Postgres
-- do dashboard vivia so no ambiente: 70 tabelas, 24 views, 48 funcoes, 137
-- politicas, 15 gatilhos e 156 indices sem uma linha no repositorio. Quem clonasse
-- o projeto nao conseguia levantar nada.
--
-- Gerados a partir do catalogo, nao escritos a mao. Conferidos por contagem de
-- bytes contra o que o banco reporta.

create type public.meio_pagamento as enum ('cartao_credito', 'cartao_debito', 'pix', 'boleto', 'dois_cartoes');
create type public.nivel_meta as enum ('campanha', 'adset', 'ad');
create type public.origem_venda as enum ('pago', 'organico', 'email', 'direto', 'desconhecido');
create type public.placement_tipo as enum ('feed', 'stories', 'reels', 'marketplace', 'search', 'audience_network', 'messenger', 'outro');
create type public.produto_tipo as enum ('velas', 'saponaria', 'cosmeticos', 'hormonal', 'velaroma', 'handify');
create type public.radar_resultado as enum ('positivo', 'negativo', 'inconclusivo');
create type public.radar_status as enum ('em_andamento', 'concluido', 'pausado', 'cancelado');
create type public.status_assinatura as enum ('ativa', 'cancelada', 'inadimplente', 'pausada', 'trial', 'expirada');
create type public.status_venda as enum ('pendente', 'aprovada', 'reembolsada', 'reembolso_parcial', 'chargeback', 'cancelada', 'expirada');
create type public.tipo_item_venda as enum ('oferta_principal', 'orderbump_1', 'orderbump_2', 'orderbump_3', 'orderbump_4', 'upsell');
