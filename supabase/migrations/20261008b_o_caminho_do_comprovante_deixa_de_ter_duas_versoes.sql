-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ `comprovantes_buscados.storage_path` para de ser uma segunda verdade    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Achado ao mover os 212 documentos para `{empresa}/{competência}/{tipo}` em
-- 08/10/2026: a migração atualizou `documentos_fiscais.storage_path` e
-- `comprovantes_buscados` ficou com o caminho velho nas **168 linhas**. Cem por
-- cento de divergência, e nenhuma tela acusando, porque ninguém lê essa coluna.
--
-- É a primeira armadilha na forma mais pura que apareceu neste projeto até
-- agora: dois campos dizendo a mesma coisa, um deles sem leitor. O que a tabela
-- precisa saber é "este PIX já teve o comprovante baixado?", e isso quem
-- responde é a chave primária — `vw_pix_sem_comprovante` faz
-- `left join ... on c.referencia_externa = t.referencia_externa` e não toca no
-- caminho. A coluna é `not null` desde a criação (`20260825s`), então não dá
-- para simplesmente parar de escrevê-la: isso é um DROP, e DROP espera a ordem
-- do deploy.
--
-- O que o CLAUDE.md prescreve para os dois que têm de coexistir por
-- compatibilidade é exatamente isto: **derivar um do outro por gatilho, nunca
-- deixar os dois editáveis.** A carga abaixo conserta o passado; o gatilho é o
-- que mantém o presente — a quarta armadilha, cujo erro é justamente parar na
-- carga.

-- ── O passado ──────────────────────────────────────────────────────────────

update public.comprovantes_buscados cb
   set storage_path = d.storage_path
  from public.documentos_fiscais d
 where d.referencia_externa = cb.referencia_externa
   and d.storage_path is not null
   and d.storage_path <> cb.storage_path;

-- ── O presente ─────────────────────────────────────────────────────────────

create or replace function public.fn_sincronizar_caminho_do_comprovante()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Sem `referencia_externa` não há linha a acertar: nota fiscal enviada pela
  -- tela não vem de PIX nenhum e nunca aparece em `comprovantes_buscados`.
  if new.referencia_externa is null or new.storage_path is null then
    return new;
  end if;

  update public.comprovantes_buscados
     set storage_path = new.storage_path
   where referencia_externa = new.referencia_externa
     and storage_path <> new.storage_path;

  return new;
end;
$function$;

comment on function public.fn_sincronizar_caminho_do_comprovante() is
  'Mantém comprovantes_buscados.storage_path igual ao de documentos_fiscais. '
  'A coluna é um espelho sem leitor; o gatilho existe para ela não voltar a '
  'mentir enquanto o DROP espera a ordem do deploy.';

drop trigger if exists trg_caminho_do_comprovante on public.documentos_fiscais;
create trigger trg_caminho_do_comprovante
  after update of storage_path on public.documentos_fiscais
  for each row execute function public.fn_sincronizar_caminho_do_comprovante();

-- ── A prova ────────────────────────────────────────────────────────────────

do $$
declare
  v_divergem int;
  v_teste    text;
  v_antes    text;
  v_ref      text;
begin
  select count(*) into v_divergem
  from public.comprovantes_buscados cb
  join public.documentos_fiscais d on d.referencia_externa = cb.referencia_externa
  where d.storage_path is not null and d.storage_path <> cb.storage_path;

  if v_divergem > 0 then
    raise exception 'PROVA FALHOU: % linha(s) ainda divergem depois da carga.', v_divergem;
  end if;

  -- O gatilho é provado MEXENDO, e não lido: a carga inicial passaria nesta
  -- conta mesmo sem gatilho nenhum, que é o engano da quarta armadilha.
  select cb.referencia_externa, cb.storage_path into v_ref, v_antes
  from public.comprovantes_buscados cb limit 1;

  if v_ref is null then
    raise notice 'Sem comprovante para testar o gatilho; a carga passou.';
    return;
  end if;

  update public.documentos_fiscais
     set storage_path = storage_path || '.teste-do-gatilho'
   where referencia_externa = v_ref;

  select storage_path into v_teste
  from public.comprovantes_buscados where referencia_externa = v_ref;

  -- Desfaz antes de julgar, para a tabela não ficar com o sufixo se falhar.
  update public.documentos_fiscais
     set storage_path = replace(storage_path, '.teste-do-gatilho', '')
   where referencia_externa = v_ref;

  if v_teste <> v_antes || '.teste-do-gatilho' then
    raise exception 'PROVA FALHOU: o gatilho nao propagou (esperava %, veio %).',
      v_antes || '.teste-do-gatilho', v_teste;
  end if;

  select storage_path into v_teste
  from public.comprovantes_buscados where referencia_externa = v_ref;
  if v_teste <> v_antes then
    raise exception 'PROVA FALHOU: o desfazer nao voltou (esperava %, veio %).', v_antes, v_teste;
  end if;

  raise notice 'PROVA OK: carga em zero e gatilho propagou e desfez (%).', v_ref;
end $$;
