-- BASELINE — tabelas
--
-- Depende de 00000000000000_baseline_tipos.sql (os enums usados nas colunas).
-- As constraints (chave primária, estrangeira, unicidade e check) vêm no arquivo
-- seguinte, 00000000000002_baseline_constraints.sql, para que a ordem de criação
-- das tabelas não esbarre em referência circular.
--
-- Gerado do catálogo em 24/08/2026 e conferido por contagem de bytes. Duas tabelas
-- aqui são de trabalho e podem ser descartadas num banco novo:
-- `backup_metas_20260823` e `backup_projeto_20260823` guardam o estado anterior à
-- migração do Notion daquele dia.

create table if not exists public.acessos (
  id uuid not null default gen_random_uuid(),
  ferramenta text not null,
  setor text not null,
  url text,
  login text,
  senha text,
  status text not null default 'ativo'::text,
  notas text,
  criado_em timestamp with time zone not null default now(),
  atualizado_em timestamp with time zone not null default now()
);

create table if not exists public.ad_accounts (
  id uuid not null default gen_random_uuid(),
  account_id text not null,
  nome text not null,
  produto produto_tipo,
  ativo boolean default true,
  criado_em timestamp with time zone default now(),
  atualizado_em timestamp with time zone default now(),
  funil_id uuid,
  produto_payt text,
  status_meta text,
  moeda text,
  descoberto_em timestamp with time zone,
  visto_em timestamp with time zone,
  origem_token text,
  roas_meta numeric(6,2),
  cpa_meta numeric(10,2),
  projeto_id uuid
);

create table if not exists public.assinaturas (
  id uuid not null default gen_random_uuid(),
  subscription_id_payt text not null,
  cliente_id uuid,
  produto produto_tipo,
  oferta_id uuid,
  plano_nome text,
  plano_preco numeric(10,2),
  ciclo_dias integer,
  status status_assinatura default 'ativa'::status_assinatura,
  data_inicio timestamp with time zone,
  data_cancelamento timestamp with time zone,
  data_proximo_ciclo timestamp with time zone,
  ultima_renovacao timestamp with time zone,
  parcelas_pagas integer default 0,
  parcelas_em_atraso integer default 0,
  total_recebido numeric(14,2) default 0,
  motivo_cancelamento text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  criado_em timestamp with time zone default now(),
  atualizado_em timestamp with time zone default now()
);

create table if not exists public.avaliacoes_criativos (
  id uuid not null default gen_random_uuid(),
  editor_id uuid,
  ad_id_meta text,
  nota integer,
  status_criativo text,
  observacao text,
  criado_em timestamp with time zone not null default now(),
  mes_referencia date,
  empresa text,
  oferta text,
  ads_testados integer not null default 0,
  ads_validados integer not null default 0,
  taxa_assertividade numeric
);

create table if not exists public.avaliacoes_mensais (
  id uuid not null default gen_random_uuid(),
  editor_id uuid not null,
  mes_referencia date not null,
  avaliador text,
  perfil text,
  responsabilidade text,
  bonus_responsabilidade numeric default 0,
  refacoes text,
  bonus_refacoes numeric default 0,
  aderencia_briefing text,
  bonus_aderencia numeric default 0,
  performance_criativos text,
  bonus_performance numeric default 0,
  proatividade text,
  bonus_proatividade numeric default 0,
  performance_grupo text,
  bonus_grupo numeric default 0,
  evolucao text,
  bonus_evolucao numeric default 0,
  meta_time text,
  bonus_meta_time numeric default 0,
  criativos_escalados integer default 0,
  bonus_escalados numeric default 0,
  vsl_escaladas integer default 0,
  bonus_vsl numeric default 0,
  bonus_estimado numeric default 0,
  bonus_total numeric default 0,
  folgas numeric default 0,
  feedback text,
  resumo_ai text,
  sugestao_ai text,
  criado_em timestamp with time zone not null default now(),
  respostas jsonb default '{}'::jsonb,
  data_lancamento date,
  multiplicador_snapshot numeric(5,2) default NULL::numeric,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.backup_metas_20260823 (
  id uuid,
  nome text,
  roas_meta numeric(6,2),
  cpa_meta numeric(10,2),
  gravado_em timestamp with time zone
);

create table if not exists public.backup_projeto_20260823 (
  card_id uuid,
  projeto_antes uuid,
  gravado_em timestamp with time zone
);

create table if not exists public.caixa_config (
  id uuid not null default gen_random_uuid(),
  saldo_inicial numeric(14,2) not null default 0,
  data_referencia date not null default '2026-01-01'::date,
  updated_at timestamp with time zone default now()
);

create table if not exists public.cargos (
  id uuid not null default gen_random_uuid(),
  nome text not null,
  multiplicador numeric not null default 1.0,
  cor text,
  ordem integer not null default 0,
  criado_em timestamp with time zone not null default now(),
  setor_id uuid,
  gap_salarial_min numeric(10,2) default NULL::numeric,
  tempo_permanencia_min integer,
  gap_salarial_max numeric(10,2) default NULL::numeric,
  tempo_permanencia_max integer,
  multiplicador_min numeric(5,2) default NULL::numeric,
  multiplicador_max numeric(5,2) default NULL::numeric,
  comissao_time_pct numeric(5,2) default NULL::numeric,
  pode_aprovar boolean not null default false
);

create table if not exists public.checkouts_origem (
  id uuid not null default gen_random_uuid(),
  link_titulo text,
  produto_nome text,
  origem text not null,
  trafego_pago boolean not null default false,
  observacao text,
  criado_em timestamp with time zone not null default now()
);

create table if not exists public.clientes (
  id uuid not null default gen_random_uuid(),
  cpf_hash text,
  nome text,
  email text,
  telefone text,
  fake_email boolean default false,
  primeira_compra timestamp with time zone,
  ultima_compra timestamp with time zone,
  cohort_semana text,
  cohort_mes text,
  criado_em timestamp with time zone default now(),
  atualizado_em timestamp with time zone default now()
);

create table if not exists public.conferencias_payt (
  id uuid not null default gen_random_uuid(),
  periodo_ini date not null,
  periodo_fim date not null,
  receita_dashboard numeric not null,
  receita_payt numeric not null,
  vendas_dashboard integer,
  vendas_payt integer,
  diferenca_pct numeric not null,
  observacao text,
  conferido_por uuid,
  criado_em timestamp with time zone not null default now()
);

create table if not exists public.configuracoes (
  id uuid not null default gen_random_uuid(),
  chave text not null,
  valor numeric(10,4),
  descricao text,
  atualizado_em timestamp with time zone default now()
);

create table if not exists public.configuracoes_texto (
  chave text not null,
  valor text not null,
  atualizado_em timestamp with time zone default now()
);

create table if not exists public.copy_rotina_cards (
  id uuid not null default gen_random_uuid(),
  titulo text not null,
  data_inicio date not null,
  data_fim date not null,
  notas jsonb default '{}'::jsonb,
  cor text default 'blue'::text,
  criado_por uuid,
  criado_em timestamp with time zone default now(),
  atualizado_em timestamp with time zone default now(),
  recorrencia_tipo text,
  recorrencia_dias_semana integer[],
  recorrencia_fim date,
  recorrencia_pai_id uuid
);

create table if not exists public.copytrack_ad_swipe (
  id uuid not null default gen_random_uuid(),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  title text,
  niche text,
  source text,
  body text,
  headline text,
  cta text,
  format text,
  angle text,
  hook_type text,
  notes text,
  is_validated boolean default false,
  is_favorite boolean default false,
  ad_code text
);

create table if not exists public.copytrack_daily_quotes (
  id uuid not null default gen_random_uuid(),
  created_at timestamp with time zone default now(),
  quote text not null,
  author text,
  source text,
  category text
);

create table if not exists public.copytrack_filter_options (
  id uuid not null default gen_random_uuid(),
  created_at timestamp with time zone default now(),
  filter_key text not null,
  label text not null,
  sort_order integer default 0
);

create table if not exists public.copytrack_hooks (
  id uuid not null default gen_random_uuid(),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  hook_text text not null,
  hook_type text,
  objective text,
  format text[],
  example text,
  notes text,
  is_favorite boolean default false
);

create table if not exists public.copytrack_offer_tracking (
  id uuid not null default gen_random_uuid(),
  created_at timestamp with time zone default now(),
  offer_id uuid,
  day_number integer,
  tracked_date date,
  active_ads_count integer default 0,
  notes text
);

create table if not exists public.copytrack_offers (
  id uuid not null default gen_random_uuid(),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  name text not null,
  niche text,
  ad_library_url text,
  page_url text,
  notes text,
  is_archived boolean default false,
  status text default 'monitorando'::text
);

create table if not exists public.criativo_campos_opcoes (
  id uuid not null default gen_random_uuid(),
  campo text not null,
  valor text not null,
  ordem integer not null default 0
);

create table if not exists public.criativo_comentarios (
  id uuid not null default gen_random_uuid(),
  criativo_id uuid not null,
  autor_id uuid,
  autor_nome text,
  texto text not null,
  tipo text not null default 'comentario'::text,
  resposta_a uuid,
  criado_em timestamp with time zone not null default now()
);

create table if not exists public.criativo_historico (
  id uuid not null default gen_random_uuid(),
  criativo_id uuid not null,
  usuario_id uuid,
  tipo_alteracao text not null,
  campo_alterado text,
  valor_anterior text,
  valor_novo text,
  criado_em timestamp with time zone not null default now()
);

create table if not exists public.criterio_opcoes (
  id uuid not null default gen_random_uuid(),
  criterio_id uuid not null,
  label text not null,
  valor numeric not null default 0,
  ordem integer not null default 0,
  ativo boolean not null default true,
  folgas numeric(4,1) not null default 0
);

create table if not exists public.criterios_avaliacao (
  id uuid not null default gen_random_uuid(),
  chave text not null,
  label text not null,
  tipo text not null default 'single'::text,
  ordem integer not null default 0,
  ativo boolean not null default true,
  created_at timestamp with time zone not null default now(),
  categoria text not null default 'individual'::text,
  arquivado boolean not null default false
);

create table if not exists public.dominios (
  id uuid not null default gen_random_uuid(),
  nome text not null,
  funil_id uuid,
  ativo boolean default true,
  vencimento date,
  registrador text,
  notas text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  funil_ids text[] not null default '{}'::text[]
);

create table if not exists public.editor_comissoes (
  id uuid not null default gen_random_uuid(),
  editor_id uuid not null,
  mes_referencia date not null,
  valor numeric not null default 0,
  observacao text,
  criado_em timestamp with time zone not null default now()
);

create table if not exists public.editor_folgas (
  id uuid not null default gen_random_uuid(),
  editor_id uuid not null,
  data date not null,
  quantidade numeric not null default 1,
  motivo text,
  criado_em timestamp with time zone not null default now()
);

create table if not exists public.editor_promocoes (
  id uuid not null default gen_random_uuid(),
  editor_id uuid not null,
  cargo_id uuid not null,
  data date not null,
  observacao text,
  criado_em timestamp with time zone not null default now()
);

create table if not exists public.editores (
  id uuid not null default gen_random_uuid(),
  nome text not null,
  criado_em timestamp with time zone not null default now(),
  cargo_id uuid,
  data_inicio date,
  ativo boolean not null default true,
  observacoes text,
  usuario_id uuid,
  multiplicador numeric,
  percentual_lideranca numeric(5,2) default NULL::numeric
);

create table if not exists public.empresas (
  id uuid not null default gen_random_uuid(),
  nome text not null,
  ativo boolean not null default true,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.ferramentas_saas (
  id uuid not null default gen_random_uuid(),
  nome text not null,
  categoria text,
  valor_mensal numeric(10,2),
  moeda text default 'BRL'::text,
  renovacao_dia integer,
  ativo boolean default true,
  created_at timestamp with time zone default now()
);

create table if not exists public.funil_subofertas (
  id uuid not null default gen_random_uuid(),
  funil_id uuid not null,
  oferta_id uuid,
  created_at timestamp with time zone default now(),
  preco numeric,
  link text,
  nome text,
  tipo text default 'upsell'::text
);

create table if not exists public.funis (
  id uuid not null default gen_random_uuid(),
  nome text not null,
  produto text,
  payt_key text,
  ativo boolean not null default true,
  criado_em timestamp with time zone default now(),
  atualizado_em timestamp with time zone default now(),
  oferta_id uuid,
  status text default 'ativo'::text,
  preco numeric,
  link_checkout text,
  metodo text,
  notas text,
  criado_por uuid,
  url_page text
);

create table if not exists public.funis_producao (
  funil_id uuid not null,
  descricao text,
  links jsonb not null default '[]'::jsonb,
  brand_guidelines_url text,
  status_producao text not null default 'ativo'::text,
  notas text,
  atualizado_em timestamp with time zone not null default now()
);

create table if not exists public.import_a_20260823 (
  card_id uuid not null,
  criado_em timestamp with time zone default now()
);

create table if not exists public.links_trafego_sem_utm (
  link_titulo text not null,
  motivo text,
  criado_em timestamp with time zone not null default now()
);

create table if not exists public.meta_ativos (
  id uuid not null default gen_random_uuid(),
  tipo text not null,
  nome text not null,
  asset_id text not null,
  bm_id text,
  status text not null default 'active'::text,
  perfis text not null default ''::text,
  notas text not null default ''::text,
  criado_em timestamp with time zone default now(),
  atualizado_em timestamp with time zone default now()
);

create table if not exists public.meta_insights_raw (
  id uuid not null default gen_random_uuid(),
  ad_account_id uuid not null,
  data date not null,
  nivel nivel_meta not null,
  objeto_id text not null,
  payload jsonb not null,
  sincronizado_em timestamp with time zone not null default now()
);

create table if not exists public.meta_sync_control (
  id uuid not null default gen_random_uuid(),
  ad_account_id uuid not null,
  ultima_sync timestamp with time zone default now(),
  proxima_sync timestamp with time zone default now(),
  intervalo_seg integer default 60,
  em_andamento boolean default false,
  erros integer default 0,
  ultimo_erro text
);

create table if not exists public.meta_sync_estado (
  ad_account_id uuid not null,
  ultimo_sucesso timestamp with time zone,
  ultimo_erro timestamp with time zone,
  mensagem_erro text,
  dias_sincronizados integer not null default 0,
  linhas_ultima_execucao integer not null default 0,
  uso_api_pct numeric,
  atualizado_em timestamp with time zone not null default now()
);

create table if not exists public.metricas_diarias (
  id uuid not null default gen_random_uuid(),
  data date not null,
  produto text,
  gasto_ads numeric(12,2),
  receita numeric(12,2),
  leads integer,
  cpl numeric(10,2),
  origem text default 'utmify'::text,
  created_at timestamp with time zone default now()
);

create table if not exists public.metricas_meta (
  id uuid not null default gen_random_uuid(),
  data date not null,
  hora integer,
  ad_account_id uuid not null,
  nivel nivel_meta not null,
  produto produto_tipo,
  campanha_id text not null,
  campanha_nome text,
  adset_id text,
  adset_nome text,
  ad_id text,
  ad_nome text,
  impressoes bigint default 0,
  alcance bigint default 0,
  frequencia numeric(8,4),
  cliques integer default 0,
  cliques_link integer default 0,
  ctr numeric(12,6),
  ctr_link numeric(12,6),
  cpm numeric(10,2),
  cpc numeric(10,2),
  cpp numeric(10,2),
  video_plays integer default 0,
  video_3s integer default 0,
  video_75pct integer default 0,
  video_100pct integer default 0,
  taxa_video_3s numeric(12,6),
  taxa_video_75pct numeric(12,6),
  taxa_video_compra numeric(12,6),
  visualizacoes_pagina integer default 0,
  initiate_checkout integer default 0,
  add_to_cart integer default 0,
  compras_meta integer default 0,
  investimento numeric(12,2) default 0,
  faturamento_atribuido numeric(12,2) default 0,
  criado_em timestamp with time zone default now(),
  atualizado_em timestamp with time zone default now(),
  campanha_id_key text default COALESCE(campanha_id, ''::text),
  adset_id_key text default COALESCE(adset_id, ''::text),
  ad_id_key text default COALESCE(ad_id, ''::text)
);

create table if not exists public.notas_fiscais (
  id uuid not null default gen_random_uuid(),
  ferramenta_id uuid,
  mes date not null,
  status text default 'pendente'::text,
  drive_url text,
  observacoes text,
  created_at timestamp with time zone default now()
);

create table if not exists public.notificacoes (
  id uuid not null default gen_random_uuid(),
  usuario_id uuid not null,
  tipo text not null,
  mensagem text not null,
  referencia_id uuid,
  referencia_tipo text,
  lida boolean not null default false,
  criado_em timestamp with time zone not null default now()
);

create table if not exists public.notion_criativos (
  id text not null,
  nome text not null,
  editor_nome text,
  projeto_nome text,
  synced_at timestamp with time zone default now()
);

create table if not exists public.ofertas (
  id uuid not null default gen_random_uuid(),
  code_payt text not null,
  produto produto_tipo,
  tipo tipo_item_venda not null,
  nome text not null,
  meta_taxa numeric(5,2),
  ativo boolean default true,
  primeira_vez timestamp with time zone default now(),
  atualizado_em timestamp with time zone default now()
);

create table if not exists public.ofertas_editores (
  id uuid not null default gen_random_uuid(),
  nome text not null,
  empresa_id uuid,
  ativo boolean not null default true,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.payt_webhook_raw (
  id bigint not null default nextval('payt_webhook_raw_id_seq'::regclass),
  recebido_em timestamp with time zone not null default now(),
  payt_id text,
  processado boolean not null default false,
  motivo text,
  body jsonb not null
);

create table if not exists public.perfis (
  id uuid not null,
  nome text not null default ''::text,
  is_admin boolean not null default false,
  created_at timestamp with time zone not null default now(),
  radar_pode_criar boolean default true,
  cargo_id uuid,
  setor_id uuid,
  ativo boolean not null default true
);

create table if not exists public.permissoes_paginas (
  id uuid not null default gen_random_uuid(),
  usuario_id uuid not null,
  pagina text not null,
  permitido boolean not null default true
);

create table if not exists public.processos_artigos (
  id uuid not null default gen_random_uuid(),
  titulo text not null,
  categoria_id uuid not null,
  video_url text,
  conteudo text,
  imagens text[] not null default '{}'::text[],
  ativo boolean not null default true,
  criado_por uuid,
  criado_em timestamp with time zone not null default now(),
  atualizado_por uuid,
  atualizado_em timestamp with time zone not null default now(),
  categorias_adicionais uuid[] default '{}'::uuid[]
);

create table if not exists public.processos_categorias (
  id uuid not null default gen_random_uuid(),
  nome text not null,
  icone text not null default '📋'::text,
  descricao text,
  ativo boolean not null default true,
  criado_em timestamp with time zone not null default now(),
  atualizado_em timestamp with time zone not null default now()
);

create table if not exists public.producao_membros (
  id uuid not null default gen_random_uuid(),
  perfil_id uuid not null,
  setor text not null,
  nivel text not null,
  criado_em timestamp with time zone not null default now()
);

create table if not exists public.producoes (
  id uuid not null default gen_random_uuid(),
  nome text not null,
  tipo text not null,
  fase text not null default 'producao_copy'::text,
  funil_id uuid,
  responsavel_id uuid,
  formato text,
  plataforma text,
  tipo_teste text,
  nivel_consciencia text,
  angulo_teste text,
  variacao_de uuid,
  modulo text,
  ordem integer,
  copy_url text,
  video_gravado_url text,
  video_editado_url text,
  data_prazo date,
  notas text,
  criado_em timestamp with time zone not null default now(),
  atualizado_em timestamp with time zone not null default now(),
  data_inicio date,
  copy_id uuid,
  gestor_id uuid,
  editor_nome_historico text,
  status_veiculacao text,
  avaliacao text,
  funil_video text,
  projeto_id uuid,
  video_story_url text,
  funil_ids uuid[] not null default '{}'::uuid[],
  especialista_id uuid,
  ad_id_meta text
);

create table if not exists public.radar_areas (
  id uuid not null default gen_random_uuid(),
  slug text not null,
  nome text not null,
  categoria text not null,
  descricao text[] default '{}'::text[],
  icone text,
  ordem integer default 0,
  ativo boolean default true,
  criado_em timestamp with time zone default now()
);

create table if not exists public.radar_testes (
  id uuid not null default gen_random_uuid(),
  titulo text not null,
  area_id uuid,
  hipotese text,
  metodologia text,
  data_inicio date,
  data_fim date,
  status radar_status default 'em_andamento'::radar_status,
  resultado radar_resultado,
  metricas jsonb default '{}'::jsonb,
  conclusao text,
  aprendizado text,
  tags text[] default '{}'::text[],
  responsavel_id uuid,
  criado_por uuid,
  criado_em timestamp with time zone default now(),
  atualizado_em timestamp with time zone default now(),
  obsidian_path text,
  obsidian_synced_at timestamp with time zone,
  sheets_synced_at timestamp with time zone,
  projeto_ids uuid[] default '{}'::uuid[],
  deletado_em timestamp with time zone,
  deletado_por uuid,
  atualizado_por uuid,
  fonte text,
  fonte_id uuid
);

create table if not exists public.referencias (
  id uuid not null default gen_random_uuid(),
  titulo text not null,
  descricao text,
  area_id uuid,
  links text[] not null default '{}'::text[],
  imagens text[] not null default '{}'::text[],
  tags text[] not null default '{}'::text[],
  criado_por uuid,
  criado_em timestamp with time zone not null default now(),
  atualizado_por uuid,
  atualizado_em timestamp with time zone,
  deletado_em timestamp with time zone,
  deletado_por uuid,
  arquivado boolean not null default false
);

create table if not exists public.regras_categoria (
  id uuid not null default gen_random_uuid(),
  padrao text not null,
  tipo_match text default 'contains'::text,
  categoria text not null,
  centro_custo text,
  confianca numeric(3,2) default 1.0,
  ativo boolean default true,
  created_at timestamp with time zone default now()
);

create table if not exists public.setor_permissoes (
  setor_id uuid not null,
  pagina text not null
);

create table if not exists public.setores (
  id uuid not null default gen_random_uuid(),
  nome text not null,
  pagina_key text,
  cor text default '#6366f1'::text,
  ordem integer not null default 0
);

create table if not exists public.testes_funis (
  id uuid not null default gen_random_uuid(),
  funil_id uuid,
  titulo text not null,
  tipo text not null,
  variante_a text,
  variante_b text,
  metrica text,
  resultado_a text,
  resultado_b text,
  vencedor text,
  validado boolean default false,
  data_inicio date,
  data_fim date,
  notas text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  pipeline_status text not null default 'planejado'::text,
  categoria text,
  impacto text,
  dificuldade text,
  kpi text,
  link_ad text,
  comentario_ad text,
  nome_ad text,
  data_prevista date,
  radar_teste_id uuid,
  criado_por uuid,
  funil_ids text[] default '{}'::text[],
  arquivado boolean not null default false
);

create table if not exists public.transacoes (
  id uuid not null default gen_random_uuid(),
  data date not null,
  descricao text not null,
  valor numeric(12,2) not null,
  categoria text,
  centro_custo text,
  status_revisao text default 'pendente'::text,
  fonte text default 'conta_simples'::text,
  referencia_externa text,
  created_at timestamp with time zone default now()
);

create table if not exists public.utm_links (
  id uuid not null default gen_random_uuid(),
  nome text not null,
  url_base text not null,
  url_final text not null,
  source text not null,
  medium text not null,
  campaign text not null,
  content text,
  term text,
  projeto_id uuid,
  criado_por uuid,
  criado_em timestamp with time zone default now(),
  arquivado boolean not null default false
);

create table if not exists public.venda_itens (
  id uuid not null default gen_random_uuid(),
  venda_id uuid not null,
  oferta_id uuid,
  code_payt text,
  tipo tipo_item_venda not null,
  nome text not null,
  valor numeric(10,2) not null,
  converteu boolean default true,
  pedido_id_payt text
);

create table if not exists public.vendas (
  id uuid not null default gen_random_uuid(),
  pedido_id text not null,
  pedido_id_payt text,
  upsell_de uuid,
  assinatura_id uuid,
  cliente_id uuid,
  produto produto_tipo,
  data_venda timestamp with time zone not null,
  hora_venda integer,
  dia_semana integer,
  semana_iso text,
  mes_ano text,
  status status_venda default 'pendente'::status_venda,
  data_aprovacao timestamp with time zone,
  data_reembolso timestamp with time zone,
  data_chargeback timestamp with time zone,
  cart_recovered boolean default false,
  meio_pagamento meio_pagamento,
  parcelas integer default 1,
  taxa_plataforma_pct numeric(8,4),
  taxa_plataforma_valor numeric(12,2),
  valor_oferta_principal numeric(12,2) not null,
  valor_obs numeric(12,2) default 0,
  valor_total numeric(12,2) not null,
  valor_pago_plataforma numeric(12,2),
  valor_reembolsado numeric(12,2) default 0,
  prejuizo_parcelamento numeric(12,2) default 0,
  motivo_reembolso text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  utm_placement placement_tipo,
  utm_extra jsonb,
  origem origem_venda default 'desconhecido'::origem_venda,
  ad_id_meta text,
  payload_webhook jsonb,
  criado_em timestamp with time zone default now(),
  atualizado_em timestamp with time zone default now(),
  is_upsell boolean default false,
  funil_id uuid,
  produto_nome text,
  valor_sem_juros numeric,
  juros_parcelamento numeric not null default 0,
  valor_liquido_produtor numeric,
  link_titulo text,
  link_url text,
  ad_account_id uuid,
  trafego_pago boolean,
  cart_id text
);

create table if not exists public.vendas_hotmart (
  id uuid not null default gen_random_uuid(),
  hotmart_id text not null,
  data date,
  valor numeric(10,2),
  faturamento_liquido numeric(10,2),
  status text,
  produto text,
  tipo_pagamento text,
  tipo_oferta text,
  cliente_nome text,
  cliente_email text,
  tem_coprod boolean default false,
  criado_em timestamp with time zone default now()
);

create table if not exists public.vendas_payt (
  id uuid not null default gen_random_uuid(),
  payt_id text not null,
  data date not null,
  valor numeric(12,2) not null,
  status text not null,
  produto text,
  utm_content text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  cliente_nome text,
  cliente_email text,
  payload_raw jsonb,
  criado_em timestamp with time zone default now(),
  tipo_venda text,
  utm_ad_id text
);

create table if not exists public.windsor_meta_staging (
  date date,
  ad_id text,
  ad_name text,
  spend double precision,
  impressions double precision,
  cpm double precision,
  actions_video_view double precision,
  video_thruplay_watched_actions_video_view double precision,
  unique_link_clicks_ctr text,
  criado_em timestamp with time zone not null default now(),
  processado boolean not null default false,
  erro text,
  account_id text,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  clicks double precision,
  unique_link_clicks double precision,
  ctr double precision,
  cpc double precision,
  video_3_second_views double precision,
  actions_purchase double precision,
  action_values_purchase double precision,
  actions_initiate_checkout double precision,
  actions_landing_page_view double precision,
  actions_add_to_cart double precision,
  account_name text,
  campaign text,
  unique_actions_link_click bigint,
  video_p75_watched_actions_video_view text,
  video_p3_watched_actions_video_view text,
  actions_offsite_conversion_fb_pixel_purchase text,
  action_values_omni_purchase numeric,
  actions_offsite_conversion_fb_pixel_initiate_checkout text,
  unique_clicks bigint
);