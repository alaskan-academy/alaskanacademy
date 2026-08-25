-- O `upsert` da tela nao alcancava o indice unico e todo anexo falhava com 400.
--
-- O indice era sobre (competencia, fornecedor, tipo, coalesce(subtipo,'')), e o
-- `coalesce` faz dele um indice de EXPRESSAO. O `on_conflict` do PostgREST so
-- casa com constraint sobre colunas nuas, entao a chamada devolvia "there is no
-- unique or exclusion constraint matching the ON CONFLICT specification".
-- Nenhuma nota fiscal conseguia ser gravada -- o recurso inteiro estava morto e
-- so apareceu porque fui testar de ponta a ponta.
--
-- A solucao e tirar o `coalesce` do indice e o nulo do campo. `subtipo` passa a
-- ter default '' e NOT NULL: ferramenta e comprovante ficam com string vazia,
-- editores com 'pagamento' ou 'comissao'. Assim as quatro colunas sao nuas, o
-- upsert as alcanca, e continua valendo a regra de um documento por
-- fornecedor/competencia/tipo/subtipo.
drop index if exists public.uq_documentos_fiscais;

update public.documentos_fiscais set subtipo = '' where subtipo is null;

alter table public.documentos_fiscais
  alter column subtipo set default '',
  alter column subtipo set not null;

alter table public.documentos_fiscais drop constraint if exists documentos_fiscais_subtipo_check;
alter table public.documentos_fiscais add constraint documentos_fiscais_subtipo_check
  check (subtipo in ('', 'pagamento', 'comissao'));

alter table public.documentos_fiscais drop constraint if exists uq_documentos_fiscais;
alter table public.documentos_fiscais add constraint uq_documentos_fiscais
  unique (competencia, fornecedor, tipo, subtipo);
