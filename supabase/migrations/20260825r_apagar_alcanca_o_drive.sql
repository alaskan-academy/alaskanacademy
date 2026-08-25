-- Apagar um documento tem de apagar a cópia também.
--
-- A remoção limpava o Storage e a tabela e deixava o arquivo no Drive. Numa nota
-- trocada por outra, a contabilidade veria as duas e não teria como saber qual
-- vale — exatamente o problema que o espelho existe para evitar.
--
-- Guarda-se o id, não só a URL: extrair o id de volta de
-- "drive.google.com/file/d/<id>/view?usp=drivesdk" por regex funcionaria hoje e
-- quebraria no dia em que o Google mudasse o formato do link.
alter table public.documentos_fiscais add column if not exists drive_id text;

comment on column public.documentos_fiscais.drive_id is
  'Id do arquivo no Drive. Necessário para apagar a cópia junto com o original.';

-- O `before delete` avisa a função de borda enquanto a linha ainda existe: no
-- `after` o id já teria ido embora.
create or replace function public.fn_apagar_espelho_drive()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  segredo text;
begin
  if old.drive_id is null then
    return old;
  end if;

  select decrypted_secret into segredo
    from vault.decrypted_secrets where name = 'drive_sync_secret';

  -- Sem segredo, apagar do banco não pode falhar: o registro é a fonte e o
  -- órfão no Drive é o mal menor. Fica o aviso no log.
  if segredo is null then
    raise warning '[drive-espelho] segredo ausente; arquivo % ficou orfao no Drive', old.drive_id;
    return old;
  end if;

  perform net.http_post(
    url     := 'https://prtkfwwqpcziexgipoqk.supabase.co/functions/v1/drive-espelho',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', segredo),
    body    := jsonb_build_object('acao', 'apagar', 'drive_id', old.drive_id),
    timeout_milliseconds := 30000
  );

  return old;
end;
$fn$;

drop trigger if exists trg_apagar_espelho on public.documentos_fiscais;
create trigger trg_apagar_espelho
  before delete on public.documentos_fiscais
  for each row execute function public.fn_apagar_espelho_drive();

comment on function public.fn_apagar_espelho_drive() is
  'Remove a cópia do Drive quando o documento é apagado. Nunca impede a remoção no banco.';

-- Reenvio manual, para quando o espelho falhou. A tela não pode carregar o
-- segredo, então quem chama é o banco.
create or replace function public.fn_reenviar_espelho(p_documento_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  segredo text;
  caminho text;
begin
  select storage_path into caminho
    from public.documentos_fiscais where id = p_documento_id;
  if caminho is null then
    return 'documento sem arquivo';
  end if;

  select decrypted_secret into segredo
    from vault.decrypted_secrets where name = 'drive_sync_secret';
  if segredo is null then
    return 'segredo do Drive não configurado';
  end if;

  perform net.http_post(
    url     := 'https://prtkfwwqpcziexgipoqk.supabase.co/functions/v1/drive-espelho',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', segredo),
    body    := jsonb_build_object('documento_id', p_documento_id),
    timeout_milliseconds := 60000
  );

  return 'reenviado';
end;
$fn$;

grant execute on function public.fn_reenviar_espelho(uuid) to authenticated;
