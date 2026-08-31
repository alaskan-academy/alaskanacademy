-- DUAS COISAS QUE FALTARAM QUANDO A CONTA ENTROU EM CARÊNCIA
--
-- Em 29/08 a "Workshop Buquê - TSL" virou de `account_status` 1 para 9 (cobrança
-- recusada). Em 31/08 ela perguntou "já foi pago, por que não atualizou" — e a
-- resposta só existiu porque alguém tinha acompanhado ao vivo os dois dias.
--
-- Faltavam o "desde quando" e o "quanto".

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. O HISTÓRICO, COM GATILHO
--
-- `ad_accounts.status_meta` é sobrescrito a cada rodada do sync: a tabela sabe o
-- que a conta É, nunca o que ela ERA.
--
-- Quarta armadilha do CLAUDE.md: a carga inicial preenche o passado, o gatilho é
-- que mantém o presente. Aqui tem os dois.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.meta_conta_status_historico (
  id uuid primary key default gen_random_uuid(),
  ad_account_id uuid not null references public.ad_accounts(id) on delete cascade,
  status_anterior text,
  status_meta text,
  -- Nulo em `status_anterior` significa "primeira observação", não "estava sem
  -- status": é a linha da carga inicial.
  mudou_em timestamptz not null default now()
);

create index if not exists meta_conta_status_hist_conta
  on public.meta_conta_status_historico (ad_account_id, mudou_em desc);

alter table public.meta_conta_status_historico enable row level security;

drop policy if exists meta_conta_status_hist_auth on public.meta_conta_status_historico;
create policy meta_conta_status_hist_auth on public.meta_conta_status_historico
  for all to authenticated using (true) with check (true);

create or replace function public.fn_registrar_status_da_conta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- `is distinct from` e não `<>`: com nulo dos dois lados, `<>` devolve nulo e
  -- a mudança passaria batida. O sync grava string vazia quando a API não manda
  -- status, e essa transição também interessa.
  if new.status_meta is distinct from old.status_meta then
    insert into public.meta_conta_status_historico
      (ad_account_id, status_anterior, status_meta)
    values (new.id, old.status_meta, new.status_meta);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_status_da_conta on public.ad_accounts;
create trigger trg_status_da_conta
  after update of status_meta on public.ad_accounts
  for each row execute function public.fn_registrar_status_da_conta();

-- A carga inicial: o estado de agora, para o histórico não nascer vazio. O
-- `mudou_em` é o `visto_em` da conta — quando o sync confirmou este status pela
-- última vez, que é a data mais honesta que existe sem histórico anterior.
insert into public.meta_conta_status_historico (ad_account_id, status_anterior, status_meta, mudou_em)
select a.id, null, a.status_meta, coalesce(a.visto_em, a.atualizado_em, now())
from public.ad_accounts a
where not exists (
  select 1 from public.meta_conta_status_historico h where h.ad_account_id = a.id
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. O SALDO DA CONTA
--
-- "Cobrança recusada" não diz QUANTO, e sem o valor a única saída é abrir o
-- Gerenciador de Anúncios.
--
-- O nome NÃO é "saldo devedor". A primeira leitura mostrou contas saudáveis com
-- saldo alto — Desafios na Sala com R$ 1.314,99 e status 1, Saponaria com
-- R$ 707,65 e status 1. O `balance` da Meta é gasto acumulado ainda não cobrado,
-- não dívida: quem indica problema é o `status_meta`, e o saldo só diz quanto
-- está em jogo. "Devedor" faria toda conta normal parecer inadimplente.
--
-- Os três campos são opcionais: se o escopo `ads_read` não der acesso, ficam
-- nulos e o resto do sync continua igual — um campo de faturamento não pode
-- custar a leitura de métrica. (Medido: o escopo dá acesso aos três.)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.ad_accounts
  add column if not exists saldo_conta numeric,
  add column if not exists total_gasto numeric,
  add column if not exists motivo_desativacao text;

comment on column public.ad_accounts.saldo_conta is
  'O `balance` da Meta em reais: gasto acumulado ainda não cobrado. Positivo em conta saudável também — quem indica problema é status_meta.';
comment on column public.ad_accounts.motivo_desativacao is
  'O `disable_reason` da Meta, cru. Nulo quando a conta não está desativada ou quando o campo não é legível.';
