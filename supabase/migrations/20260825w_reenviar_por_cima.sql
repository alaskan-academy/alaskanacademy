-- Reenviar uma nota por cima da anterior.
--
-- O bucket tinha política de leitura, gravação e remoção — faltava a de
-- ATUALIZAÇÃO. E o upload manda `upsert: true`, que para um caminho que já
-- existe é um UPDATE, não um INSERT. Sem a política, o Storage devolvia 400 e a
-- tela dizia só "não foi possível enviar".
--
-- O caso não aparecia no teste normal: subir uma nota nova funciona. Só quebra
-- quando o editor manda a NF corrigida por cima da errada — que é exatamente
-- quando ele mais precisa que funcione.
drop policy if exists documentos_atualizacao on storage.objects;
create policy documentos_atualizacao on storage.objects
  for update to authenticated
  using (
    bucket_id = 'documentos'
    and ( owner = auth.uid()
       or exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_admin) )
  )
  with check (bucket_id = 'documentos');

comment on policy documentos_atualizacao on storage.objects is
  'Permite reenviar um documento por cima do anterior. Sem ela, upsert:true dá 400.';
