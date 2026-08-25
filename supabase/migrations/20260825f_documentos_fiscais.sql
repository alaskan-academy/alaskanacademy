-- Controle fiscal que nasce do extrato, e não de uma lista mantida à mão.
--
-- A versão anterior amarrava cada NF a `ferramentas_saas`, um cadastro que
-- alguém tinha de manter atualizado, e guardava o Drive como URL colada à mão.
-- Resultado: as duas tabelas ficaram com ZERO linhas — o recurso nunca chegou a
-- ser usado, porque exigia trabalho antes de dar qualquer retorno.
--
-- Agora a lista de quem deve NF sai de quem foi pago: se saiu dinheiro da conta
-- para um fornecedor no mês, ele aparece. Nada para cadastrar, e fornecedor
-- novo entra sozinho no dia seguinte.
drop table if exists public.notas_fiscais;
drop table if exists public.ferramentas_saas;

create table public.documentos_fiscais (
  id           uuid primary key default gen_random_uuid(),
  competencia  date not null,
  fornecedor   text not null,
  -- ferramenta  = NF/invoice de SaaS
  -- servico     = NF de prestador (editores)
  -- comprovante = comprovante de PIX, para controle contábil
  tipo         text not null check (tipo in ('ferramenta', 'servico', 'comprovante')),
  -- Editores mandam duas por mês: pagamento do mês corrente e comissão relativa
  -- à assertividade do mês anterior. São competências diferentes e por isso
  -- entram como linhas separadas, não como uma NF com dois valores.
  subtipo      text check (subtipo in ('pagamento', 'comissao')),
  storage_path text,
  nome_arquivo text,
  drive_url    text,
  valor        numeric(14,2),
  enviado_por  uuid references auth.users(id) default auth.uid(),
  criado_em    timestamptz not null default now()
);

comment on table public.documentos_fiscais is
  'NFs, invoices e comprovantes. A lista de pendências vem do extrato, não de cadastro.';

-- `coalesce` porque subtipo é nulo em ferramenta e comprovante, e nulo não
-- colide consigo mesmo em índice único comum — dois uploads da mesma ferramenta
-- passariam batido.
create unique index if not exists uq_documentos_fiscais
  on public.documentos_fiscais (competencia, fornecedor, tipo, coalesce(subtipo, ''));

create index if not exists idx_documentos_competencia
  on public.documentos_fiscais (competencia desc);

alter table public.documentos_fiscais enable row level security;

-- Editor vê e mexe só no que é dele; admin vê tudo. NF de prestador tem CPF e
-- valor de pagamento dentro, e um editor não deve ver quanto o outro recebe.
drop policy if exists documentos_fiscais_leitura on public.documentos_fiscais;
create policy documentos_fiscais_leitura on public.documentos_fiscais
  for select to authenticated
  using (enviado_por = auth.uid()
      or exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_admin));

drop policy if exists documentos_fiscais_escrita on public.documentos_fiscais;
create policy documentos_fiscais_escrita on public.documentos_fiscais
  for insert to authenticated
  with check (enviado_por = auth.uid()
           or exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_admin));

drop policy if exists documentos_fiscais_edicao on public.documentos_fiscais;
create policy documentos_fiscais_edicao on public.documentos_fiscais
  for update to authenticated
  using (enviado_por = auth.uid()
      or exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_admin));

drop policy if exists documentos_fiscais_remocao on public.documentos_fiscais;
create policy documentos_fiscais_remocao on public.documentos_fiscais
  for delete to authenticated
  using (enviado_por = auth.uid()
      or exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_admin));

grant select, insert, update, delete on public.documentos_fiscais to authenticated;

-- ── Bucket privado ──────────────────────────────────────────────────────────
-- NF de prestador tem CPF e valor de pagamento dentro; o bucket `referencias`
-- que já existia é público e não serve.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', false, 20971520,
        array['application/pdf','image/png','image/jpeg','image/webp'])
on conflict (id) do update
   set public = false,
       file_size_limit = 20971520,
       allowed_mime_types = array['application/pdf','image/png','image/jpeg','image/webp'];

drop policy if exists documentos_leitura on storage.objects;
create policy documentos_leitura on storage.objects
  for select to authenticated
  using (bucket_id = 'documentos'
     and ( owner = auth.uid()
        or exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_admin) ));

drop policy if exists documentos_envio on storage.objects;
create policy documentos_envio on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documentos' and owner = auth.uid());

drop policy if exists documentos_remocao on storage.objects;
create policy documentos_remocao on storage.objects
  for delete to authenticated
  using (bucket_id = 'documentos'
     and ( owner = auth.uid()
        or exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_admin) ));
