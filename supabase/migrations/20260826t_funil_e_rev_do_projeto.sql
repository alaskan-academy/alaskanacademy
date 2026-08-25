-- O funil é um REV de um projeto, e os campos que se contradiziam viram derivados.
--
-- Três coisas, e as duas primeiras são correção de bug, não arrumação:
--
-- 1. `oferta_id` sempre apontou para `ofertas_editores` (os projetos), em 22 de
--    23 funis, e a própria interface já o chama de projeto (`projetoMap`,
--    `filterProjetoIds`). Só o nome da coluna mentia. Ganha o nome certo.
--
-- 2. `ativo` e `status` se contradiziam: 4 funis com `status = 'ativo'` e
--    `ativo = false`. Isso não é cosmético — `.eq('ativo', true)` aparece em
--    `dataCache.ts`, `KanbanView.tsx` e `CriativoFormModal.tsx`, então esses 4
--    funis estavam INVISÍVEIS em Produção. Era o motivo de o sistema mostrar
--    "1 funil ativo" quando havia 5. `ativo` passa a ser derivado de `status` e
--    a contradição deixa de ser possível.
--
-- 3. `produto` era texto livre, nulo em 14 de 23, e com grafia divergente do
--    projeto ("Saponária" × "Saponaria Brasil"). Passa a ser derivado do nome do
--    projeto. Os 14 nulos somem sem ninguém digitar.
--
-- Por que derivar em vez de largar as colunas: as três são lidas por código que
-- está no ar. Removê-las agora quebraria Produção até o próximo deploy. Assim o
-- código existente continua funcionando e já lê o valor certo; as colunas podem
-- ser removidas depois, quando quem as lê passar a usar `status` e `projeto_id`.

-- 1 ─────────────────────────────────────────────────────────────────────────
-- Renomear preserva a chave estrangeira e os dados; recriar não preservaria.
alter table public.funis rename column oferta_id to projeto_id;

comment on column public.funis.projeto_id is
  'Projeto (ofertas_editores) ao qual este REV pertence. Era `oferta_id`, nome '
  'que sugeria `ofertas` e escondia o modelo real: projeto → REV.';

-- Compatibilidade: o app publicado ainda escreve e lê `oferta_id`. Uma view
-- não serve (o app faz insert e update direto na tabela), então a coluna antiga
-- continua existindo e é mantida em sincronia pelo gatilho abaixo. Sai quando o
-- deploy com o nome novo estiver no ar.
alter table public.funis add column if not exists oferta_id uuid;
update public.funis set oferta_id = projeto_id;

-- 2 e 3 ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_funil_campos_derivados()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  nome_projeto text;
begin
  -- Sincroniza os dois nomes da mesma coluna enquanto ambos existirem. Quem
  -- mudou manda: assim funciona tanto para o código antigo quanto para o novo,
  -- sem precisar que os dois subam ao mesmo tempo.
  if tg_op = 'INSERT' then
    new.projeto_id := coalesce(new.projeto_id, new.oferta_id);
    new.oferta_id  := new.projeto_id;
  else
    if new.projeto_id is distinct from old.projeto_id then
      new.oferta_id := new.projeto_id;
    elsif new.oferta_id is distinct from old.oferta_id then
      new.projeto_id := new.oferta_id;
    end if;
  end if;

  -- `ativo` deixa de ser um segundo lugar para dizer a mesma coisa.
  new.ativo := (new.status = 'ativo');

  -- `produto` passa a vir do projeto. Quando não há projeto (1 funil hoje), o
  -- texto que já estava lá é preservado — apagá-lo perderia a única informação
  -- que esse registro tem sobre o que ele vende.
  if new.projeto_id is not null then
    select nome into nome_projeto from public.ofertas_editores where id = new.projeto_id;
    if nome_projeto is not null then
      new.produto := nome_projeto;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.fn_funil_campos_derivados() is
  'Mantém ativo, produto e oferta_id derivados de status e projeto_id. Existe '
  'para que dois campos não possam mais discordar entre si — foi o que fez 4 '
  'funis sumirem de Produção.';

drop trigger if exists trg_funil_campos_derivados on public.funis;
create trigger trg_funil_campos_derivados
  before insert or update on public.funis
  for each row execute function public.fn_funil_campos_derivados();

-- Aplica aos 23 registros existentes. É este update que devolve os 4 funis
-- sumidos e preenche os 14 `produto` nulos.
update public.funis set status = status;

-- 4 ─────────────────────────────────────────────────────────────────────────
-- A VSL. Espelho do VTurb, não cadastro: ninguém digita aqui.
create table if not exists public.vsls (
  -- O id é o do player no VTurb. Usar o id de lá como chave primária torna o
  -- espelho idempotente: sincronizar duas vezes não duplica nada.
  id                text primary key,
  nome              text not null,
  duracao_seg       integer,
  -- `pitch_time > 0` é o que separa VSL de aula gravada: 88 dos 162 players.
  -- Não é um campo pensado para isso, mas é o sinal mais limpo que o VTurb dá.
  pitch_seg         integer,
  criado_em_vturb   timestamptz,
  sincronizado_em   timestamptz not null default now()
);

comment on table public.vsls is
  'Espelho dos players do VTurb. Não é cadastro manual: é preenchido pela edge '
  'function `vturb`. Existe como tabela, e não como texto no funil, porque a '
  'mesma VSL roda em vários REVs e a pergunta é "onde está rodando a h07" — '
  'com chave estrangeira isso é exato, com texto digitado erra na grafia.';

alter table public.vsls enable row level security;

drop policy if exists vsls_all on public.vsls;
create policy vsls_all on public.vsls
  for all to authenticated using (true) with check (true);

alter table public.funis
  add column if not exists vsl_id text references public.vsls(id) on delete set null;

comment on column public.funis.vsl_id is
  'VSL que está rodando neste REV, vinda do VTurb.';

create index if not exists idx_funis_vsl on public.funis (vsl_id) where vsl_id is not null;
