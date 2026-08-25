-- Comprovante e por TRANSACAO, nao por fornecedor/mes.
--
-- A nota fiscal e uma por fornecedor por competencia -- e assim que a
-- contabilidade trabalha. O comprovante nao: cada PIX tem o seu, e ha varios
-- para o mesmo fornecedor no mesmo mes (a Jaqueline recebe duas vezes, a
-- ALASKAN ACADEMY varias).
--
-- Com a chave unica sem a transacao, cada novo comprovante sobrescrevia o
-- anterior: 25 arquivos baixados viraram 10 linhas. Os PDFs ficaram no Storage,
-- orfaos, e o espelho no Drive nunca soube deles.
alter table public.documentos_fiscais
  add column if not exists referencia_externa text not null default '';

comment on column public.documentos_fiscais.referencia_externa is
  'Id da transacao na Conta Simples. Vazio em NF, que e por fornecedor/mes; preenchido em comprovante, que e por transacao.';

-- Coluna nua e nao `coalesce(...)`: indice de expressao nao e alcancavel pelo
-- `on_conflict` do PostgREST, e foi por isso que todo anexo falhava com 400
-- antes de eu descobrir clicando.
alter table public.documentos_fiscais drop constraint if exists uq_documentos_fiscais;
alter table public.documentos_fiscais add constraint uq_documentos_fiscais
  unique (competencia, fornecedor, tipo, subtipo, referencia_externa);
