-- Cada alerta na tela onde se resolve.
--
-- O banner mostrava os 13 alertas em TODAS as paginas. O efeito e o oposto do
-- pretendido: "1 venda sem categoria de produto" aparecia no Financeiro, onde
-- nao ha nada a fazer a respeito, e quem esta no Financeiro aprende a ignorar a
-- faixa amarela -- inclusive quando ela for sobre o Financeiro.
--
-- O mapa e tabela e nao `case` dentro da view porque alerta novo nasce numa
-- migracao e o autor dele tem de dizer onde mora. Sem linha aqui, o alerta cai
-- em `inicio`, que e a area de saude do sistema -- visivel, mas fora do caminho.
create table if not exists public.alertas_area (
  codigo    text primary key,
  area      text not null,
  criado_em timestamptz not null default now()
);

comment on table public.alertas_area is
  'Em que pagina cada alerta deve aparecer. Sem linha, o alerta vai para o Inicio.';

alter table public.alertas_area enable row level security;
drop policy if exists alertas_area_leitura on public.alertas_area;
create policy alertas_area_leitura on public.alertas_area
  for select to authenticated using (true);

insert into public.alertas_area (codigo, area) values
  ('fonte_parada',           'inicio'),
  ('cron_falhando',          'inicio'),
  ('webhook_pendente',       'inicio'),
  ('payt_silencio',          'inicio'),
  ('venda_sem_categoria',    'vendas'),
  ('venda_sem_liquido',      'vendas'),
  ('venda_nao_normalizada',  'vendas'),
  ('conta_sem_produto',      'meta-ads'),
  ('conta_sem_venda',        'meta-ads'),
  ('meta_divergente',        'meta-ads'),
  ('receita_sem_rastreio',   'utm'),
  ('remendo_utm_resolvido',  'utm')
on conflict (codigo) do update set area = excluded.area;

create or replace view public.vw_alertas_por_area as
select a.codigo,
       a.severidade,
       a.titulo,
       a.detalhe,
       coalesce(m.area, 'inicio') as area
  from public.vw_alertas a
  left join public.alertas_area m on m.codigo = a.codigo;

comment on view public.vw_alertas_por_area is
  'Alertas com a pagina onde devem aparecer. O banner filtra por aqui.';

grant select on public.vw_alertas_por_area to authenticated;
grant select on public.alertas_area to authenticated;
