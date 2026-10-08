-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ O registro e a fila da mudança de pastas dos documentos fiscais         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Os 212 documentos saem de `tipo/competência/arquivo` para
-- `empresa/competência/tipo/arquivo` (docs/estrutura-de-pastas-dos-documentos.md),
-- e isso acontece em DOIS sistemas que não conversam: o Storage do Supabase, por
-- `documentos_fiscais.storage_path`, e o Google Drive, cujo caminho a edge
-- function `drive-espelho` monta por conta própria.
--
-- ── Por que o movimento NÃO está nesta migração ────────────────────────────
--
-- A primeira versão deste arquivo movia o Storage em SQL:
-- `update storage.objects set name = ...`, que é o que a API `.move()` faz na
-- parte do banco, numa transação só, sem 212 chamadas HTTP. Estava errado.
--
-- `storage.objects` tem uma coluna `version`, e na storage-api a chave do
-- objeto no armazenamento é `{bucket}/{name}/{version}` — o `name` É parte da
-- chave. Renomear a linha e não copiar o objeto deixaria o banco apontando para
-- um caminho que não tem arquivo: a tela mostraria a nota e o download daria
-- 404. Pior do que não ter mexido, e invisível até alguém clicar.
--
-- Então o movimento inteiro mora em `drive-espelho` (`acao: 'mover'`), que tem a
-- service role e pode usar `.move()`, a API que copia de verdade. Esta migração
-- é só o registro e a fila. Era a quarta armadilha chegando de novo pela porta
-- do SQL: espelho (o `name`) tratado como se fosse a coisa (o objeto).

create table if not exists public.documentos_movidos (
  id            uuid primary key default gen_random_uuid(),
  documento_id  uuid not null references public.documentos_fiscais(id) on delete cascade,
  sistema       text not null check (sistema in ('storage', 'drive')),
  de            text not null,
  para          text not null,
  -- `false` até o movimento voltar com sucesso. Linha com `ok = false` é passo
  -- que foi tentado e falhou — o que se quer ver, e não um registro que
  -- desaparece deixando a dúvida entre "não tentei" e "tentei e quebrou".
  ok            boolean not null default false,
  erro          text,
  movido_em     timestamptz not null default now()
);

comment on table public.documentos_movidos is
  'Onde cada documento estava antes de ser movido, por sistema (storage/drive). '
  'Gravada ANTES do movimento, com ok=false; vira true quando o passo volta. '
  'Linha com de = para é sentinela: olhou e já estava no lugar certo. '
  'O desfazer de verdade é `where ok and de <> para`.';

create index if not exists ix_documentos_movidos_documento
  on public.documentos_movidos (documento_id, sistema, ok);

alter table public.documentos_movidos enable row level security;

drop policy if exists documentos_movidos_interno on public.documentos_movidos;
create policy documentos_movidos_interno on public.documentos_movidos
  for all to authenticated using (true) with check (true);

-- ── A fila ─────────────────────────────────────────────────────────────────
--
-- Quem a edge function ainda não terminou: falta o passo do Storage, ou o do
-- Drive, ou os dois.
--
-- "Falta" é a ausência de linha com `ok`, e não posição na lista. A primeira
-- versão do lote pegava "os 60 primeiros por criado_em" e olharia os mesmos 60
-- em toda chamada, sem nunca alcançar o 61 — o cursor tem de ser o que já foi
-- feito. É também por isso que o passo que não precisou mexer grava sentinela
-- (`de = para`) em vez de não gravar nada: sem ela o documento certo trava a
-- fila atrás de si.

create or replace view public.vw_documentos_a_mover
with (security_invoker = on) as
select d.id, d.storage_path, d.criado_em,
       exists (select 1 from public.documentos_movidos m
                where m.documento_id = d.id and m.sistema = 'storage' and m.ok) as storage_pronto,
       exists (select 1 from public.documentos_movidos m
                where m.documento_id = d.id and m.sistema = 'drive' and m.ok)   as drive_pronto
from public.documentos_fiscais d
where d.storage_path is not null
  and not (
    exists (select 1 from public.documentos_movidos m
             where m.documento_id = d.id and m.sistema = 'storage' and m.ok)
    and
    exists (select 1 from public.documentos_movidos m
             where m.documento_id = d.id and m.sistema = 'drive' and m.ok)
  )
order by d.criado_em;

comment on view public.vw_documentos_a_mover is
  'Fila do `acao: mover` da drive-espelho: documento a que falta o passo do '
  'Storage, o do Drive, ou os dois. Esvazia quando a mudança de pastas acaba.';

-- ── A guarda: documento sem empresa não tem para onde ir ───────────────────
--
-- Sem `empresa_id` não há primeiro nível, e a edge function recusa — mas
-- recusaria 212 vezes em silêncio no meio do lote. Melhor saber agora. Desde
-- 07/10/2026 não deve haver nenhum, e as duas telas de upload passaram a
-- recusar sem empresa; quem garante é a conta, não a memória.

do $$
declare v_sem int;
begin
  select count(*) into v_sem
  from public.documentos_fiscais
  where storage_path is not null and empresa_id is null;

  if v_sem > 0 then
    raise exception 'Há % documento(s) sem empresa. Eles não têm primeiro nível e ficariam fora da estrutura nova — carimbe a empresa antes de mover.', v_sem;
  end if;

  raise notice 'OK: todo documento com arquivo tem empresa. A fila tem % na frente.',
    (select count(*) from public.vw_documentos_a_mover);
end $$;
