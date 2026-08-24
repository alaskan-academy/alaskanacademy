-- 2026-08-23 — atribuição de criativos, alertas e a aba de análise de Vendas
--
-- Primeira migration do projeto: até aqui o banco só existia no ambiente, e
-- reconstruí-lo a partir do repositório era impossível. Este arquivo cobre as
-- mudanças de estrutura desta data. As de dados — projetos criados, cards
-- importados do Notion, metas de ROAS — ficaram fora de propósito: valem para
-- este banco, não para um novo.

begin;

-- ---------------------------------------------------------------------------
-- 1. Alertas: a view morria em todas as páginas
-- ---------------------------------------------------------------------------
-- `fn_alerta_cron_falhando` lê o schema `cron`, mas rodava como SECURITY INVOKER,
-- ou seja, com os direitos de quem chama. `authenticated` não tem acesso a `cron`,
-- então toda página recebia 403 e o banner de alertas nunca aparecia.
--
-- A saída não é liberar o schema: `cron.job.command` guarda a chave do cs-sync em
-- texto puro. Só esta função passa a rodar com os direitos do dono, e ela devolve
-- apenas nome da tarefa e a mensagem de erro truncada.

create or replace function public.fn_alerta_cron_falhando()
 returns table(codigo text, severidade text, titulo text, detalhe text)
 language sql
 stable
 security definer
 set search_path = public, cron, pg_temp
as $function$
  with ultima as (
    select distinct on (j.jobname)
           j.jobname, d.status, d.return_message, d.start_time
      from cron.job j
      join cron.job_run_details d on d.jobid = j.jobid
     where j.active
     order by j.jobname, d.start_time desc
  )
  select 'cron_falhando'::text,
         'critico'::text,
         count(*)::text || ' tarefa(s) agendada(s) falhando',
         string_agg(jobname, ', ') || ' — último erro: ' ||
           left(regexp_replace(coalesce(max(return_message), 'sem mensagem'), '\s+', ' ', 'g'), 140)
    from ultima
   where status = 'failed'
  having count(*) > 0;
$function$;

revoke all on function public.fn_alerta_cron_falhando() from public;
grant execute on function public.fn_alerta_cron_falhando() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. RLS: nove tabelas eram legíveis sem login
-- ---------------------------------------------------------------------------
-- A política `anon_read` deixava o papel `anon` — a chave pública embutida no
-- JavaScript — ler `clientes` (10.043 linhas, 10.027 e-mails), `vendas` (13.394)
-- e mais sete tabelas. Nenhuma página do app consulta sem sessão: só o SetupPage
-- roda deslogado, e ele lê `perfis`, que nunca esteve exposta. Todas as nove já
-- tinham `authenticated_read`, então o `anon_read` era puro excedente.

drop policy if exists anon_read on public.ad_accounts;
drop policy if exists anon_read on public.assinaturas;
drop policy if exists anon_read on public.clientes;
drop policy if exists anon_read on public.configuracoes;
drop policy if exists anon_read on public.meta_sync_control;
drop policy if exists anon_read on public.metricas_meta;
drop policy if exists anon_read on public.ofertas;
drop policy if exists anon_read on public.venda_itens;
drop policy if exists anon_read on public.vendas;

-- ---------------------------------------------------------------------------
-- 3. A conta de anúncio passa a saber seu projeto
-- ---------------------------------------------------------------------------
-- `ad_accounts.produto` só distingue "velas" de "saponaria" e junta Workshop
-- Buquê, Lembrancinha e Desafios no mesmo balde — grosso demais para dizer de
-- qual projeto é um anúncio. Sem isso, o casamento anúncio→card ignorava a conta.

alter table public.ad_accounts
  add column if not exists projeto_id uuid references public.ofertas_editores(id) on delete set null;

comment on column public.ad_accounts.projeto_id is
  'Projeto ao qual a conta pertence. Restringe os cards candidatos em fn_criativos_meta: '
  'o nome do criativo se repete em dezenas de projetos, entao sem isso a data escolhia ao acaso.';

commit;

-- ---------------------------------------------------------------------------
-- 6. O alerta de ingestão do Meta disparava todo dia sem motivo
-- ---------------------------------------------------------------------------
-- `vw_ingest_health` media o Meta por `max(metricas_meta.data)` — a data A QUE O
-- DADO SE REFERE, não quando ele chegou. Como `data` é um DATE, virar timestamp a
-- coloca na meia-noite UTC: com limiar de 25h o alerta acendia todo dia entre a
-- virada e a chegada do dado novo. Media 27h com o sync tendo rodado há 4.
--
-- Medir por `criado_em`/`atualizado_em` também não serve: de madrugada os anúncios
-- não gastam, o sync roda e não altera linha nenhuma. A pergunta real é se a tarefa
-- rodou, e a resposta está em `cron.job_run_details`.
--
-- O ramo da Payt continua medindo o dado, e ali está certo: ela é webhook, não
-- tarefa agendada — se não chega venda há horas, é sinal legítimo.

create or replace function public.fn_ultima_execucao_cron(p_jobname text)
 returns timestamptz
 language sql
 stable
 security definer
 set search_path = public, cron, pg_temp
as $function$
  select max(d.start_time)
    from cron.job j
    join cron.job_run_details d on d.jobid = j.jobid
   where j.jobname = p_jobname and d.status = 'succeeded';
$function$;

revoke all on function public.fn_ultima_execucao_cron(text) from public;
grant execute on function public.fn_ultima_execucao_cron(text) to authenticated;

-- Limiar de 3h: `meta-sync-horario` roda de hora em hora, entao tolera duas perdas.
create or replace view public.vw_ingest_health as
select 'payt'::text as fonte,
       'Vendas (Payt)'::text as rotulo,
       max(criado_em) as ultimo_evento,
       count(*) as registros,
       round(extract(epoch from now() - max(criado_em)) / 3600::numeric, 1) as horas_atras,
       6::numeric as limiar_horas,
       (extract(epoch from now() - max(criado_em)) / 3600::numeric) > 6::numeric as defasado
  from vendas_payt
union all
select 'meta'::text,
       'Métricas de anúncios (Meta)'::text,
       public.fn_ultima_execucao_cron('meta-sync-horario'),
       count(*),
       round(extract(epoch from now() - public.fn_ultima_execucao_cron('meta-sync-horario')) / 3600::numeric, 1),
       3::numeric,
       (extract(epoch from now() - public.fn_ultima_execucao_cron('meta-sync-horario')) / 3600::numeric) > 3::numeric
  from metricas_meta;
