-- 2026-08-24 (parte 6) — mural de recados no Início
--
-- Escrito por sócio, lido por todos. É a peça mais fácil de apodrecer no
-- produto: ninguém escreve, o último recado envelhece, e um mês depois a equipe
-- lê aviso vencido como se fosse novidade. `editor_folgas` acabou com zero
-- linhas exatamente assim.
--
-- Por isso a tela faz o mural denunciar o próprio abandono: passados sete dias
-- o recado desbota e ganha a idade escrita ao lado ("há uma semana — pode estar
-- desatualizado"). Melhor parecer velho do que se passar por novo. Nada disso
-- está no banco: a idade sai de `criado_em`, e a regra vive no componente.

begin;

create table if not exists public.recados (
  id            uuid primary key default gen_random_uuid(),
  texto         text not null,
  criado_por    uuid references public.perfis(id) on delete set null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- A tela lê os três mais recentes; o índice serve exatamente a esse order by.
create index if not exists idx_recados_criado on public.recados (criado_em desc);

alter table public.recados enable row level security;
create policy recados_read  on public.recados for select to authenticated using (true);
create policy recados_write on public.recados for all    to authenticated using (true) with check (true);

-- Quem pode escrever é decidido na tela (só admin vê o botão), e não aqui: é o
-- mesmo arranjo de `eventos`, onde a política é ampla e a interface é que
-- restringe. Se um dia isso precisar valer para qualquer cliente do banco, a
-- política é o lugar de apertar.

drop trigger if exists trg_recados_touch on public.recados;
create trigger trg_recados_touch before update on public.recados
  for each row execute function public.fn_eventos_touch();

-- Recado é conversa interna: exige login. O `anon` recebe privilégio por
-- padrão do schema, então a revogação é explícita.
revoke all on public.recados from anon;

-- ---------------------------------------------------------------------------
-- Recado novo avisa a equipe inteira
-- ---------------------------------------------------------------------------
-- No banco e não na tela: assim o aviso sai mesmo que o recado entre por outro
-- caminho, e não depende de alguém lembrar de disparar junto.
--
-- A mensagem leva o texto do recado, não um "há um novo recado": quem vê o sino
-- já sabe do que se trata sem precisar abrir. Corta em 140 para não estourar o
-- popover.
--
-- Não notifica em `update`: corrigir uma vírgula no recado não é notícia, e
-- avisar de novo ensinaria a ignorar o sino.
create or replace function public.fn_recado_notifica()
 returns trigger
 language plpgsql
as $function$
begin
  insert into public.notificacoes (usuario_id, tipo, mensagem, referencia_id, referencia_tipo)
  select p.id,
         'recado_novo',
         case when length(new.texto) > 140
              then left(new.texto, 140) || '…'
              else new.texto end,
         new.id,
         'recado'
    from public.perfis p
   where p.ativo
     -- quem escreveu não precisa ser avisado do próprio recado
     and p.id is distinct from new.criado_por;
  return new;
end;
$function$;

drop trigger if exists trg_recado_notifica on public.recados;
create trigger trg_recado_notifica after insert on public.recados
  for each row execute function public.fn_recado_notifica();

commit;
