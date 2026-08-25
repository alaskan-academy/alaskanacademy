-- Quem cria a pasta é decidido pelo banco, não por cada worker.
--
-- O código fazia: consulta o cache, não acha, cria no Drive, insere no cache.
-- Com cinco downloads em paralelo, os cinco passam pela consulta antes de
-- qualquer inserção — todos criam a pasta, e quatro inserções falham em
-- silêncio porque o erro não era verificado. Resultado real: TRÊS pastas
-- "comprovantes" no Drive, criadas com segundos de diferença, com os arquivos
-- espalhados entre elas.
--
-- O irônico é que a migration que criou esta tabela já dizia que isso
-- aconteceria. Escrevi o aviso e depois causei o problema ao paralelizar os
-- downloads para resolver um timeout.
--
-- Agora a inserção vem PRIMEIRO, com id nulo: quem conseguir inserir ganhou o
-- direito de criar no Drive; quem perder espera o vencedor preencher.
alter table public.drive_pastas alter column drive_id drop not null;

comment on column public.drive_pastas.drive_id is
  'Nulo enquanto a pasta está sendo criada no Drive. Quem inseriu a linha é quem cria.';

-- Devolve `true` para quem ganhou a corrida e deve criar a pasta.
create or replace function public.fn_reservar_pasta(p_caminho text)
returns boolean
language plpgsql
as $fn$
declare
  ganhou boolean;
begin
  insert into public.drive_pastas (caminho, drive_id)
  values (p_caminho, null)
  on conflict (caminho) do nothing;

  get diagnostics ganhou = row_count;
  return ganhou;
end;
$fn$;

grant execute on function public.fn_reservar_pasta(text) to authenticated;

-- Dreno do espelho: roda de 5 em 5 minutos enquanto houver fila, e não faz nada
-- quando não houver. Existe porque o espelho voltou a ser em SÉRIE — que é o
-- que garante uma pasta por caminho — e em série 142 documentos não cabem numa
-- invocação só, com o limite de 150s da borda.
select cron.schedule(
  'drive-espelho-dreno',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url     := 'https://prtkfwwqpcziexgipoqk.supabase.co/functions/v1/drive-espelho',
    headers := jsonb_build_object('Content-Type','application/json',
                 'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'drive_sync_secret')),
    body    := jsonb_build_object('lote', 30),
    timeout_milliseconds := 140000)
  where exists (select 1 from public.vw_documentos_sem_espelho);
  $cron$
);
