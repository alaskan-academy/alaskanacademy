-- Espelho dos documentos fiscais no Drive.
--
-- O Storage é a fonte: privado, com RLS por dono, e é de onde a tela lê. O Drive
-- é a cópia para a contabilidade, que trabalha lá e não vai entrar no dashboard.

-- ── Cache dos ids de pasta ──────────────────────────────────────────────────
-- A API do Drive não tem caminho: cada pasta é um id, e achar
-- "ferramentas/2026-08" exigiria duas buscas por nome a cada upload. Pior, duas
-- execuções simultâneas criariam duas pastas com o mesmo nome — o Drive
-- permite, e a contabilidade acharia metade das notas em cada uma.
create table if not exists public.drive_pastas (
  caminho   text primary key,
  drive_id  text not null,
  criado_em timestamptz not null default now()
);

comment on table public.drive_pastas is
  'Id das pastas do Drive por caminho. Evita busca por nome e pasta duplicada.';

alter table public.drive_pastas enable row level security;
drop policy if exists drive_pastas_leitura on public.drive_pastas;
create policy drive_pastas_leitura on public.drive_pastas
  for select to authenticated using (true);

grant select on public.drive_pastas to authenticated;

-- ── O disparo vem do banco ──────────────────────────────────────────────────
-- A função de borda exige `x-sync-secret`, e o navegador não pode carregar esse
-- segredo — qualquer pessoa com o dashboard aberto o leria no devtools. O
-- gatilho roda como `postgres`, lê do vault e chama.
--
-- Também é o que garante que o espelho aconteça independentemente de por onde o
-- documento entrou: tela, importação ou correção manual no banco.
create or replace function public.fn_disparar_espelho_drive()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  segredo text;
begin
  if new.storage_path is null or new.drive_url is not null then
    return new;
  end if;

  select decrypted_secret into segredo
    from vault.decrypted_secrets where name = 'drive_sync_secret';

  -- Sem segredo configurado o upload não pode falhar: o arquivo já está no
  -- Storage, que é a fonte. O espelho é cópia, e cópia que falta se resolve
  -- depois — derrubar o upload por causa dela seria trocar o essencial pelo
  -- acessório.
  if segredo is null then
    raise warning '[drive-espelho] segredo ausente no vault; documento % ficou sem espelho', new.id;
    return new;
  end if;

  perform net.http_post(
    url     := 'https://prtkfwwqpcziexgipoqk.supabase.co/functions/v1/drive-espelho',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', segredo),
    body    := jsonb_build_object('documento_id', new.id),
    timeout_milliseconds := 30000
  );

  return new;
end;
$fn$;

drop trigger if exists trg_espelho_drive on public.documentos_fiscais;
create trigger trg_espelho_drive
  after insert or update of storage_path on public.documentos_fiscais
  for each row execute function public.fn_disparar_espelho_drive();

comment on function public.fn_disparar_espelho_drive() is
  'Chama a função de borda que copia o documento para o Drive. Nunca derruba o upload: o Storage é a fonte.';

-- Quem ficou sem espelho, para a tela poder mostrar e reenviar.
create or replace view public.vw_documentos_sem_espelho as
select id, competencia, fornecedor, tipo, nome_arquivo, criado_em
  from public.documentos_fiscais
 where storage_path is not null and drive_url is null;

grant select on public.vw_documentos_sem_espelho to authenticated;

-- O segredo compartilhado é gerado direto no vault, nunca por conversa:
--   select vault.create_secret(encode(gen_random_bytes(32),'hex'), 'drive_sync_secret', '…');
-- e o mesmo valor precisa ir para a variável DRIVE_SYNC_SECRET das Edge
-- Functions, junto de DRIVE_PASTA_RAIZ (id da pasta compartilhada com a conta
-- de serviço).
