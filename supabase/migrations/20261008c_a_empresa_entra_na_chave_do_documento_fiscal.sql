-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ A empresa entra na chave do documento fiscal                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- `uq_documentos_fiscais` é `UNIQUE (competencia, fornecedor, tipo, subtipo,
-- referencia_externa)` — **sem `empresa_id`**. Com `upsert`, dois CNPJs que
-- recebem nota do mesmo fornecedor na mesma competência caem na MESMA linha: a
-- segunda nota faz `UPDATE` na primeira, troca `empresa_id` e `storage_path`, e
-- o arquivo da primeira fica órfão na pasta da outra empresa sem nada apontando
-- para ele. O `upsert` devolve sucesso.
--
-- ── Quão perto isso está ───────────────────────────────────────────────────
--
-- Medido em 08/10/2026:
--
--   tipo         linhas  com referência própria  com referência vazia
--   comprovante     168                     168                     0
--   ferramenta       34                      34                     0
--   servico          10                       0                    10
--
-- As notas de **serviço** (as que o editor manda) gravam
-- `referencia_externa: ''` sempre. A chave delas é, na prática,
-- `(competência, fornecedor, 'servico', subtipo)`: se as duas empresas pagarem
-- o mesmo editor na mesma competência, a colisão é **garantida**.
--
-- Na tela do Financeiro a referência é o nome do arquivo
-- (`chaveDoArquivo`), então lá a colisão depende de os dois arquivos terem o
-- mesmo nome — o que é plausível, porque fornecedor costuma baixar
-- `nota-fiscal.pdf`.
--
-- E a condição já existe nos dados: **J. A. BATISTA JUNIOR recebeu das duas
-- contas no mesmo mês**, em 2026-09 e em 2026-10 (10 pagamentos Alaskan, 2
-- Aeliss). Com ele são comprovantes, que têm referência própria e não colidem.
-- Basta ele emitir nota.
--
-- ── Por que o índice novo nasce AO LADO do antigo ──────────────────────────
--
-- Porque trocar a chave antes do código já derrubou a gravação de notas neste
-- projeto, e o comentário em `FinanceiroNotasFiscaisPage` registra o preço:
-- o PostgREST exige que o `onConflict` liste EXATAMENTE as colunas da
-- constraint, e declarar quatro das cinco devolvia "there is no unique or
-- exclusion constraint matching the ON CONFLICT specification" — *nenhuma nota
-- conseguia ser gravada*.
--
-- Daí a ordem, que é a regra do banco compartilhado do CLAUDE.md:
--
--   1. **agora:** cria o índice de 6 colunas. Os dois coexistem; o antigo é
--      mais estrito, então nada muda de comportamento.
--   2. **deploy:** o código passa a declarar as 6 colunas no `onConflict`, que
--      agora casa com o índice novo.
--   3. **depois do deploy confirmado:** o `DROP` do antigo, em migração própria.
--
-- Entre 1 e 3 o ganho já é real: o `onConflict` de 6 colunas não acha a linha da
-- outra empresa, tenta `INSERT`, e **bate no índice antigo com erro**. Erro alto
-- em vez de perda silenciosa — que é a troca que importa.

-- `NULLS NOT DISTINCT` porque a alternativa é pior: com a regra padrão, duas
-- linhas de `empresa_id` nulo nunca colidem entre si, e a coluna que existe para
-- separar empresas passaria a criar duplicata quando estivesse vazia.
create unique index if not exists uq_documentos_fiscais_por_empresa
  on public.documentos_fiscais
  (competencia, fornecedor, tipo, subtipo, referencia_externa, empresa_id)
  nulls not distinct;

comment on index public.uq_documentos_fiscais_por_empresa is
  'A chave do documento fiscal COM a empresa. Substitui uq_documentos_fiscais, '
  'que colapsava as notas de dois CNPJs na mesma linha. O antigo sai em '
  'migração própria, depois de o código das 6 colunas estar em produção.';

-- E a empresa deixa de poder faltar. Os três escritores (tela do Financeiro,
-- aba do editor, `cs-comprovantes`) já carimbam; os 212 documentos já têm. Sem
-- isto a coluna fica na chave podendo ser nula, que é a mesma porta por outro
-- lado — e "documento fiscal sem dono" foi o que colocou 38 notas em lugar
-- nenhum até 07/10/2026.
do $$
declare v_sem int;
begin
  select count(*) into v_sem from public.documentos_fiscais where empresa_id is null;
  if v_sem > 0 then
    raise exception 'Há % documento(s) sem empresa; carimbe antes de exigir a coluna.', v_sem;
  end if;
end $$;

alter table public.documentos_fiscais alter column empresa_id set not null;

-- ── A prova ────────────────────────────────────────────────────────────────
-- Não "o índice existe", que é ler o que acabei de escrever: que a colisão
-- entre empresas, que era um UPDATE silencioso, agora é recusada.
do $$
declare
  v_alaskan uuid;
  v_aeliss  uuid;
  v_erro    text := null;
begin
  select id into v_alaskan from public.empresas where slug = 'alaskan';
  select id into v_aeliss  from public.empresas where slug = 'aeliss';
  if v_alaskan is null or v_aeliss is null then
    raise notice 'Sem as duas empresas para testar; índice criado.';
    return;
  end if;

  insert into public.documentos_fiscais
    (competencia, fornecedor, tipo, subtipo, referencia_externa, empresa_id, storage_path, nome_arquivo)
  values ('2099-01-01', 'TESTE DA CHAVE', 'servico', 'pagamento', '', v_alaskan, 'x/2099-01/servicos/a.pdf', 'a.pdf');

  -- A MESMA chave de 5 colunas, outra empresa. Antes virava UPDATE na linha da
  -- Alaskan. Agora tem de bater no indice antigo, que ainda existe.
  begin
    insert into public.documentos_fiscais
      (competencia, fornecedor, tipo, subtipo, referencia_externa, empresa_id, storage_path, nome_arquivo)
    values ('2099-01-01', 'TESTE DA CHAVE', 'servico', 'pagamento', '', v_aeliss, 'y/2099-01/servicos/b.pdf', 'b.pdf');
  exception when unique_violation then
    v_erro := 'recusada';
  end;

  delete from public.documentos_fiscais where fornecedor = 'TESTE DA CHAVE';

  if v_erro is null then
    raise exception 'PROVA FALHOU: a segunda empresa entrou sem erro — a colisão continua possível.';
  end if;

  raise notice 'PROVA OK: nota da segunda empresa na mesma chave foi recusada (%). Depois do DROP do índice antigo ela passará a ser aceita como linha PRÓPRIA.', v_erro;
end $$;
