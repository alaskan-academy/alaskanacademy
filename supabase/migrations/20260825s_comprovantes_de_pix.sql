-- Comprovantes de PIX, buscados na Conta Simples.
--
-- Ela pediu para guardar o comprovante de pagamento dos PIX, e minha primeira
-- conclusão foi que teria de anexar um a um. Estava errada.
--
-- O payload traz `showReceipt: true` em 100% dos PIX enviados, e sondando a API
-- (a documentação é fechada — 403 no site de ajuda) achamos:
--
--   GET /statements/v1/banking/{id}/receipt -> { downloadUrl: "<S3 assinado>" }
--
-- A Conta Simples gera o PDF sozinha. Ninguém anexa nada — o trabalho some, que
-- é melhor do que o trabalho ficar fácil.
--
-- O arquivo é baixado e guardado, não o link: a URL do S3 é assinada e expira em
-- horas, então guardar o link daria um comprovante que morre.
create table if not exists public.comprovantes_buscados (
  referencia_externa text primary key,
  storage_path       text not null,
  buscado_em         timestamptz not null default now()
);

comment on table public.comprovantes_buscados is
  'PIX cujo comprovante já foi baixado. Evita rebuscar e gastar chamada à toa.';

alter table public.comprovantes_buscados enable row level security;
drop policy if exists comprovantes_buscados_leitura on public.comprovantes_buscados;
create policy comprovantes_buscados_leitura on public.comprovantes_buscados
  for select to authenticated using (true);

grant select on public.comprovantes_buscados to authenticated;

-- O que falta buscar.
--
-- `left join` em vez de `not in`: a lista de já-buscados cresce todo mês, e o
-- `not in` ficaria mais lento a cada rodada.
create or replace view public.vw_pix_sem_comprovante as
select t.referencia_externa,
       t.data,
       t.descricao,
       t.valor
  from public.transacoes t
  left join public.comprovantes_buscados c
         on c.referencia_externa = t.referencia_externa
 where t.fonte = 'conta_simples'
   and t.valor < 0
   and t.payload_raw->>'showReceipt' = 'true'
   and c.referencia_externa is null
 order by t.data desc;

comment on view public.vw_pix_sem_comprovante is
  'PIX enviados com comprovante disponível na Conta Simples e ainda não baixado.';

grant select on public.vw_pix_sem_comprovante to authenticated;

-- Roda meia hora depois do sync diário: o comprovante só interessa depois que a
-- transação foi sincronizada.
select cron.schedule(
  'cs-comprovantes-diario',
  '30 10 * * *',
  $cron$
  select net.http_post(
    url     := 'https://prtkfwwqpcziexgipoqk.supabase.co/functions/v1/cs-comprovantes',
    headers := jsonb_build_object('Content-Type','application/json',
                 'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cs_sync_secret')),
    body    := jsonb_build_object('limite', 100),
    timeout_milliseconds := 180000);
  $cron$
);
