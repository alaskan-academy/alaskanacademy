-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ A chave antiga sai, e as duas empresas passam a conviver                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Terceiro e último passo da troca começada em `20261008c`. A ordem era, e foi:
--
--   1. criar `uq_documentos_fiscais_por_empresa` (6 colunas) AO LADO do antigo;
--   2. deployar o código declarando as 6 colunas no `onConflict`;
--   3. **aqui:** largar `uq_documentos_fiscais` (5 colunas).
--
-- O passo 2 foi confirmado por ela em 08/10/2026 — e é por isso que este
-- arquivo é separado, e não o fim do `20261008c`. É a regra do banco
-- compartilhado do CLAUDE.md: a migração vale na hora para todo mundo, o
-- código vive em commits que podem não ter sido empurrados, e quem paga a
-- diferença é quem está usando o painel.
--
-- Entre o passo 1 e este, a colisão entre empresas dava ERRO (o `onConflict` de
-- 6 colunas não achava a linha da outra empresa, tentava `INSERT` e batia no
-- índice antigo). Depois daqui ela vira o que sempre deveria ter sido: uma
-- LINHA PRÓPRIA. Erro alto era a melhoria intermediária; conviver é o destino.

-- Antes de largar o antigo, o novo tem de estar lá e válido. Sem esta guarda,
-- um `drop` num banco onde o passo 1 falhou deixaria a tabela SEM unicidade
-- nenhuma — e aí o mesmo documento entraria quantas vezes mandassem.
do $$
begin
  if not exists (
    select 1 from pg_index x
      join pg_class i on i.oid = x.indexrelid
      join pg_class t on t.oid = x.indrelid
     where t.relname = 'documentos_fiscais'
       and i.relname = 'uq_documentos_fiscais_por_empresa'
       and x.indisunique and x.indisvalid
  ) then
    raise exception 'O indice de 6 colunas nao existe ou nao esta valido. Rode 20261008c antes.';
  end if;
end $$;

alter table public.documentos_fiscais
  drop constraint if exists uq_documentos_fiscais;

-- ── A prova ────────────────────────────────────────────────────────────────
-- Que as duas empresas agora CONVIVEM como linhas próprias — e, logo em
-- seguida, que a unicidade continua valendo dentro de cada uma. As duas metades
-- importam: largar a chave antiga sem a nova no lugar seria trocar um defeito
-- por outro pior.

do $$
declare
  v_alaskan uuid;
  v_aeliss  uuid;
  v_linhas  int;
  v_repetiu boolean := false;
begin
  select id into v_alaskan from public.empresas where slug = 'alaskan';
  select id into v_aeliss  from public.empresas where slug = 'aeliss';
  if v_alaskan is null or v_aeliss is null then
    raise notice 'Sem as duas empresas para provar; constraint antiga removida.';
    return;
  end if;

  -- 1. A mesma chave de 5 colunas, duas empresas. Antes de 20261008c isto era
  --    um UPDATE silencioso; entre 20261008c e agora, um erro; agora, duas
  --    linhas.
  insert into public.documentos_fiscais
    (competencia, fornecedor, tipo, subtipo, referencia_externa, empresa_id, storage_path, nome_arquivo)
  values ('2099-01-01', 'TESTE DA CHAVE', 'servico', 'pagamento', '', v_alaskan, 'x/2099-01/servicos/a.pdf', 'a.pdf'),
         ('2099-01-01', 'TESTE DA CHAVE', 'servico', 'pagamento', '', v_aeliss,  'y/2099-01/servicos/b.pdf', 'b.pdf');

  select count(*) into v_linhas
  from public.documentos_fiscais where fornecedor = 'TESTE DA CHAVE';

  -- 2. E DENTRO de uma empresa a unicidade continua: a terceira, repetindo a
  --    Alaskan, tem de ser recusada.
  begin
    insert into public.documentos_fiscais
      (competencia, fornecedor, tipo, subtipo, referencia_externa, empresa_id, storage_path, nome_arquivo)
    values ('2099-01-01', 'TESTE DA CHAVE', 'servico', 'pagamento', '', v_alaskan, 'z/2099-01/servicos/c.pdf', 'c.pdf');
  exception when unique_violation then
    v_repetiu := true;
  end;

  delete from public.documentos_fiscais where fornecedor = 'TESTE DA CHAVE';

  if v_linhas <> 2 then
    raise exception 'PROVA FALHOU: esperava 2 linhas (uma por empresa), vieram %.', v_linhas;
  end if;
  if not v_repetiu then
    raise exception 'PROVA FALHOU: a repetida DENTRO da mesma empresa passou — a tabela ficou sem unicidade.';
  end if;

  raise notice 'PROVA OK: duas empresas convivem como linhas proprias, e repetir dentro de uma continua recusado.';
end $$;
