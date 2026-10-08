# Estrutura de pastas dos documentos fiscais

Decisão de 08/10/2026, **implementada no mesmo dia**. Os 212 documentos estão na
estrutura nova nos dois sistemas.

## A estrutura

```
{empresa}/{competência}/{tipo}/{arquivo}

alaskan/2026-09/comprovantes/2026-09-04_FORNECEDOR_1234.pdf
alaskan/2026-09/servicos/2026-09_Jaqueline-Coelho_pagamento.pdf
aeliss/2026-09/comprovantes/2026-09-04_J-A-BATISTA-JUNIOR_....pdf
```

A mesma no Supabase Storage e no Google Drive. Uma estrutura só para lembrar.

### Por que a empresa vem primeiro

É o recorte que **nunca** se mistura. Duas empresas são dois CNPJs, duas
apurações, duas contabilidades — uma NF da Aeliss dentro do pacote da Alaskan
é erro fiscal, não desorganização. Tudo o mais (tipo, mês) pode ser olhado
junto; empresa não.

### Por que a competência vem antes do tipo

Porque o produto desta área é o **pacote mensal para a contabilidade**, e o
pacote é de uma empresa num mês. Com `empresa/competência/tipo`, o pacote é
UMA pasta: `aeliss/2026-09/` compacta e vai. Com a estrutura anterior
(`tipo/competência`) ele estava espalhado por três, e com
`empresa/tipo/competência` continuaria espalhado por três.

O preço é que "todas as notas de ferramenta" deixa de ser uma pasta. É a
pergunta menos frequente, e a tela de Notas Fiscais já responde ela melhor que
o explorador de arquivos.

### Por que `slug` e não o nome

`alaskan` e `aeliss`, de `empresas.slug`. Sem espaço, sem acento, estável se o
nome fantasia mudar. O mesmo nome nos dois sistemas.

### O nível da empresa é DERIVADO, nunca digitado

Sai de `empresa_id` → `empresas.slug`. Se alguém puder digitar, vira um segundo
campo dizendo o que o primeiro já diz — exatamente os 368 `centro_custo` que
divergiram de `categorias_centro`, e a primeira armadilha do CLAUDE.md.

## São DUAS estruturas, não uma

Esta é a descoberta que muda o tamanho da tarefa, e custou uma afirmação errada
minha antes de eu ir ler o código:

- **Supabase Storage** usa `documentos_fiscais.storage_path`.
- **Google Drive** NÃO segue esse caminho. A edge function `drive-espelho`
  monta o dela do zero, a partir de `doc.tipo` e `doc.competencia`.

Mudar `storage_path` **não mexe no Drive**. Os dois precisam ser alterados, e é
por isso que o movimento mora num lugar que alcança os dois.

## Onde cada peça vive

### 1. O caminho, montado num lugar só

`caminhoDoDocumento(slug, competencia, tipo, nome)` em
[src/lib/documentos.ts](../src/lib/documentos.ts). Antes havia duas montagens à
mão — `FinanceiroNotasFiscaisPage` e `editores/NotasFiscaisTab` —, e foi assim
que elas divergiram: uma carimbava a empresa, a outra nunca carimbou, e 38
documentos ficaram sem dono até 07/10/2026.

O helper **recusa** sem slug, com tipo desconhecido ou competência inválida, em
vez de improvisar: um arquivo numa pasta que ninguém procura só aparece quando a
contabilidade reclama da nota que falta.

### 2. A cadeia de pastas no Drive

`pastaDoDocumento()` em
[supabase/functions/drive-espelho/index.ts](../supabase/functions/drive-espelho/index.ts),
um `garantirPasta` por nível: `{slug}` → `{slug}/{mes}` → `{slug}/{mes}/{tipo}`.
`garantirPasta` já era segura contra corrida (`fn_reservar_pasta`, migração
`20260825u`) e `drive_pastas.caminho` aceitou o nível a mais sem mudança.

### 3. A migração dos 212

`acao: 'mover'` na mesma edge function, em lotes, com fila em
`vw_documentos_a_mover` e registro em `documentos_movidos` (migração
`20261008a`).

## Duas coisas que a implementação descobriu

### Mover no Storage NÃO dá para fazer em SQL

A primeira versão da migração fazia
`update storage.objects set name = <caminho novo>` — o que a API `.move()` faz
na parte do banco, numa transação só, sem 212 chamadas HTTP. **Estava errado.**

`storage.objects` tem uma coluna `version`, e na storage-api a chave do objeto
no armazenamento é `{bucket}/{name}/{version}`: o `name` **é** parte da chave.
Renomear a linha sem copiar o objeto deixaria o banco apontando para um caminho
que não tem arquivo — a tela mostraria a nota e o download daria 404, sem nada
denunciando até alguém clicar.

Por isso o movimento inteiro mora na edge function, que tem a service role e
pode chamar `.move()`. Era a quarta armadilha chegando pela porta do SQL:
espelho (o `name`) tratado como se fosse a coisa (o objeto).

### O gatilho não reposiciona nada

`trg_espelho_drive` dispara em `AFTER INSERT OR UPDATE OF storage_path`, mas
`espelhar()` começa com

```ts
// Ja espelhado: reenviar criaria uma segunda copia, e a contabilidade veria a
// mesma nota duas vezes.
if (doc.drive_url) return null;
```

Essa guarda está certa e não deve ser removida. Consequência: atualizar
`storage_path` dispara o gatilho e **não faz nada** — os 212 ficariam no lugar
novo no Storage e no lugar velho no Drive, pior que antes, porque as duas
estruturas passariam a discordar. Daí a ação própria.

## A ordem dos passos, por documento

1. **Storage**, via `.move()`. Falhou, nada mudou — pode repetir.
2. **`storage_path`**. Agora Storage e banco voltam a concordar. Se este passo
   falhar, o movimento do Storage é desfeito na hora, em vez de deixar a linha
   apontando para um caminho vazio.
3. **Drive**, via `PATCH ?addParents&removeParents`. Não baixa nem sobe: o
   `drive_id` continua o mesmo, então `drive_url` segue valendo e nenhum link
   guardado quebra. Falhou, 1 e 2 ficaram certos e a cópia está na pasta velha —
   incômodo, não estrago, e a chamada seguinte conserta.

Os pais atuais no Drive vêm de `GET /files/{id}?fields=parents`, e não de
`drive_pastas` pelo caminho antigo: se alguém moveu o arquivo à mão, o banco não
sabe e o `removeParents` erraria o alvo, deixando o arquivo em duas pastas.

## A fila e o desfazer

`documentos_movidos` grava cada passo **antes** de executá-lo, com `ok = false`,
e marca `ok = true` quando ele volta. Linha com `ok = false` é passo tentado e
falhado — o que se quer ver, e não um registro que desaparece deixando a dúvida
entre "não tentei" e "tentei e quebrou". O desfazer de verdade é
`where ok and de <> para`.

`vw_documentos_a_mover` é a fila: documento a que falta o passo do Storage, o do
Drive, ou os dois. **"Falta" é a ausência de linha com `ok`, nunca posição na
lista.** A primeira versão do lote pegava "os 60 primeiros por `criado_em`" e
olharia os mesmos 60 em toda chamada, sem nunca alcançar o 61. É também por isso
que o passo que não precisou mexer grava sentinela (`de = para`): sem ela o
documento já certo travaria a fila atrás de si.

## A prova de que terminou

Derivada, não listada. Rodada em 08/10/2026, todas as contas em zero:

```sql
-- nenhum documento fora da estrutura nova
select count(*) from documentos_fiscais d
join empresas e on e.id = d.empresa_id
where d.storage_path !~ ('^' || e.slug || '/\d{4}-\d{2}/(comprovantes|ferramentas|servicos)/');

-- todo storage_path tem arquivo de verdade no bucket
select count(*) from documentos_fiscais d
where not exists (select 1 from storage.objects o
                   where o.bucket_id = 'documentos' and o.name = d.storage_path);

-- nada sobrou na estrutura velha
select count(*) from storage.objects
where bucket_id = 'documentos' and name ~ '^(comprovantes|ferramentas|servicos)/';

-- e as três partes do caminho batem com os campos de que saíram
select count(*) from documentos_fiscais d join empresas e on e.id = d.empresa_id
where split_part(d.storage_path, '/', 1) <> e.slug;          -- a empresa
-- idem split_part(..., '/', 2) contra left(competencia::text, 7)
-- e   split_part(..., '/', 3) contra o plural do tipo
```

No Drive, o cruzamento é por `drive_pastas.caminho`, que espelha a estrutura:
os 212 documentos foram para a pasta correspondente ao próprio caminho, e as 17
combinações de `(empresa, competência, tipo)` da tabela deram exatamente 17
pastas folha.

A catraca que impede a volta é
[src/test/caminho-do-documento-e-um-so.test.ts](../src/test/caminho-do-documento-e-um-so.test.ts).
Ela existe porque a regra passou a viver em **três** lugares que não se
enxergam — o helper do cliente, a edge function em Deno e o SQL —, e três
cópias da mesma regra é a primeira armadilha em estado puro. O teste amarra as
três: os tipos que o helper traduz saem do `check` da migração que criou a
tabela, as pastas do Drive têm de ser as mesmas do Storage, e nenhuma das duas
telas pode voltar a montar o caminho à mão.

## O que ficou para trás, de propósito

As pastas antigas no Drive (`comprovantes/`, `ferramentas/`, `servicos/`) e suas
19 linhas em `drive_pastas`. Estão sem nenhum documento — está provado, porque
os 212 têm pai novo —, mas apagar uma pasta do Drive compartilhado não se
desfaz, e não há como verificar daqui se alguém largou um arquivo lá à mão.
Fica como decisão dela.
