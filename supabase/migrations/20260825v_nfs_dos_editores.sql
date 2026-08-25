-- Notas fiscais dos editores, cada um vendo só a sua.
--
-- São duas por mês, e ela explicou por quê: o PAGAMENTO do mês trabalhado, que
-- cai no dia 5 do mês seguinte, e a COMISSÃO relativa à assertividade do mês
-- ANTERIOR, paga na semana em que a NF chega. Vão juntas, mas são competências
-- diferentes — em agosto o editor manda o pagamento de agosto e a comissão de
-- julho.
--
-- Por isso são duas linhas e não uma NF com dois valores: a contabilidade
-- precisa de cada uma no seu mês de competência.
alter table public.documentos_fiscais
  add column if not exists editor_id uuid references public.editores(id);

comment on column public.documentos_fiscais.editor_id is
  'Preenchido nas NFs de prestador. É o que permite ao editor ver só a dele.';

create index if not exists idx_documentos_editor
  on public.documentos_fiscais (editor_id, competencia desc)
  where editor_id is not null;

-- A leitura por dono agora alcança o editor: antes olhava só `enviado_por`, e
-- uma NF que a administração subisse pelo editor ficaria invisível para ele.
--
-- A separação vive AQUI, no banco, e não em esconder o seletor na tela: a NF
-- tem CPF e valor de pagamento dentro, e um editor não deve saber quanto o
-- outro recebe nem por acidente.
drop policy if exists documentos_fiscais_leitura on public.documentos_fiscais;
create policy documentos_fiscais_leitura on public.documentos_fiscais
  for select to authenticated
  using (
    enviado_por = auth.uid()
    or exists (select 1 from public.editores e
                where e.id = documentos_fiscais.editor_id and e.usuario_id = auth.uid())
    or exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_admin)
  );

drop policy if exists documentos_fiscais_escrita on public.documentos_fiscais;
create policy documentos_fiscais_escrita on public.documentos_fiscais
  for insert to authenticated
  with check (
    enviado_por = auth.uid()
    or exists (select 1 from public.editores e
                where e.id = documentos_fiscais.editor_id and e.usuario_id = auth.uid())
    or exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_admin)
  );

drop policy if exists documentos_fiscais_edicao on public.documentos_fiscais;
create policy documentos_fiscais_edicao on public.documentos_fiscais
  for update to authenticated
  using (
    enviado_por = auth.uid()
    or exists (select 1 from public.editores e
                where e.id = documentos_fiscais.editor_id and e.usuario_id = auth.uid())
    or exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_admin)
  );

drop policy if exists documentos_fiscais_remocao on public.documentos_fiscais;
create policy documentos_fiscais_remocao on public.documentos_fiscais
  for delete to authenticated
  using (
    enviado_por = auth.uid()
    or exists (select 1 from public.editores e
                where e.id = documentos_fiscais.editor_id and e.usuario_id = auth.uid())
    or exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_admin)
  );

-- As duas NFs esperadas de cada editor num mês de envio.
--
-- `p_mes` é o mês em que as notas são ENVIADAS. O pagamento tem competência
-- desse mês; a comissão, do anterior. Devolver as duas sempre — mesmo sem
-- documento — é o que faz a tela ser um checklist e não um arquivo.
create or replace function public.fn_nfs_do_editor(
  p_editor_id uuid,
  p_mes date default date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date
)
returns table (
  subtipo      text,
  competencia  date,
  rotulo       text,
  quando_paga  text,
  documento_id uuid,
  nome_arquivo text,
  drive_url    text,
  enviada_em   timestamptz
)
language sql
stable
as $fn$
  with esperadas as (
    select 'pagamento'::text as subtipo,
           p_mes as competencia,
           'Pagamento'::text as rotulo,
           'no dia 5 do mês seguinte'::text as quando_paga
    union all
    select 'comissao',
           (p_mes - interval '1 month')::date,
           'Comissão',
           'na semana em que a NF chega'
  )
  select e.subtipo, e.competencia, e.rotulo, e.quando_paga,
         d.id, d.nome_arquivo, d.drive_url, d.criado_em
    from esperadas e
    left join public.documentos_fiscais d
           on d.editor_id   = p_editor_id
          and d.tipo        = 'servico'
          and d.subtipo     = e.subtipo
          and d.competencia = e.competencia
   order by e.subtipo desc;
$fn$;

comment on function public.fn_nfs_do_editor(uuid, date) is
  'As duas NFs esperadas do editor no mês de envio: pagamento do mês e comissão do anterior.';

grant execute on function public.fn_nfs_do_editor(uuid, date) to authenticated;

-- Quem é o editor de quem está logado. `security definer` porque a RLS de
-- `editores` pode barrar o próprio editor de se ler, e sem isto ele não
-- conseguiria nem descobrir que é ele mesmo.
create or replace function public.fn_meu_editor()
returns table (id uuid, nome text)
language sql
stable
security definer
set search_path = public
as $fn$
  select e.id, e.nome from public.editores e
   where e.usuario_id = auth.uid() and e.ativo
   limit 1;
$fn$;

grant execute on function public.fn_meu_editor() to authenticated;
