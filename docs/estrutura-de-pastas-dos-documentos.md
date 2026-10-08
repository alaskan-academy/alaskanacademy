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

## Havia um TERCEIRO escritor de `storage_path`

`cs-comprovantes`, a edge function que baixa o comprovante dos PIX da Conta
Simples, montava `comprovantes/${mes}/${nome}` na linha 174 — e um cron a chama
às **10:30 e 22:30 todo dia**. A unificação deste arquivo dizia "os dois lugares
que montam o caminho hoje", e estava errada: eram três.

O preço, se tivesse passado: no mesmo dia da migração, o Storage voltaria a
receber `comprovantes/2026-10/` enquanto a cópia do *mesmo* documento ia para
`alaskan/2026-10/comprovantes/` no Drive. Os dois sistemas divergindo em cada
comprovante novo, a migração dos 212 desfazendo-se pela beirada, e nada na tela
denunciando.

Quem achou foi uma **revisão adversarial**, não a busca que precedeu a
implementação — ela procurou em `src/` e parou ali. A lição está num teste:
`caminho-do-documento-e-um-so` varre `src/` **e** `supabase/functions/`, deriva
a lista de arquivos do repositório em vez de enumerá-la, e reprova qualquer
arquivo que escreva `storage_path` montando o caminho pela pasta. Foi conferido
que ele pega a versão anterior do `cs-comprovantes`.

O conserto usa `conta.slug`, que já é o slug da empresa dona do PIX: o mapa
`contaPorEmpresa` casa `conta.slug` com `empresas.slug`, então buscar o slug de
novo por `p.empresa_id` seria o segundo campo da primeira armadilha.

A prova foi funcional, não lida: um comprovante devolvido à fila, uma rodada com
`limite: 1`, e o arquivo caiu em `alaskan/2026-10/comprovantes/` com **zero**
objetos na estrutura velha — com o código antigo haveria um.

## E um quarto espelho, sem leitor

`comprovantes_buscados.storage_path` é uma segunda cópia do mesmo caminho,
chaveada por `referencia_externa`. A migração dos 212 atualizou
`documentos_fiscais` e deixou essa coluna com o caminho velho em **168 de 168**
linhas — cem por cento de divergência, invisível, porque ninguém lê a coluna: o
que a tabela precisa responder é "este PIX já foi baixado?", e isso é a chave
primária.

A coluna é `not null` desde `20260825s`, então parar de escrevê-la é um DROP, e
DROP espera a ordem do deploy. A migração `20261008b` faz o que o CLAUDE.md
prescreve para os dois que têm de coexistir: carga para o passado, **gatilho**
para o presente (`trg_caminho_do_comprovante`). O gatilho foi provado mexendo —
a migração altera um `storage_path`, confere que propagou, e desfaz —, porque a
carga sozinha passaria na conta mesmo sem gatilho nenhum, que é o engano da
quarta armadilha.

## As pastas antigas: arquivadas, não apagadas

`comprovantes/`, `ferramentas/` e `servicos/` ficaram sem nenhum documento, mas
vazias na raiz da contabilidade não eram inofensivas: alguém abre
`comprovantes/2026-09/`, não encontra nada e conclui que as notas sumiram.

A primeira ideia foi **apagar** depois de conferir que estavam vazias. A revisão
adversarial derrubou, e estava certa nos três pontos:

- A lixeira é da **conta de serviço**, não dela. A árvore é My Drive da conta de
  serviço, que não tem navegador e onde ninguém clica em nada. "Restaura num
  clique" era falso.
- 30 dias é um relógio, não uma rede.
- A conferência de "está vazia" tinha duas cegueiras que falhavam as duas na
  direção de destruir: `trashed = false` esconde filho que está na lixeira, e
  "zero arquivos" é indistinguível de "não consegui ver", porque o `fields`
  suprime o `incompleteSearch` que denunciaria.

**Mover dissolve os três.** Nada é destruído, então a pergunta "alguém largou um
arquivo aqui?" para de importar — se largou, o arquivo vai junto e continua onde
sempre esteve, um nível mais fundo. O desfazer é arrastar de volta, sem prazo.

As três pastas de topo foram para `_antigo-ate-2026-10-08/` (a data no nome para
ninguém abrir procurando nota recente), levando os meses de carona, e as 19
linhas de `drive_pastas` foram reescritas com o prefixo. Reescritas e não
apagadas: assim o cache diz onde a pasta está **de verdade**, e quem pedir
`comprovantes/2026-09` não acha linha e cria pasta nova — que é o certo se
alguém algum dia reverter o commit desta mudança.

Depois: 52 linhas em `drive_pastas` (32 da estrutura nova + 19 arquivadas + o
abrigo), zero fora, e os 212 documentos conferidos ainda na pasta certa.

## O cache de pastas é CONFERIDO, não obedecido

Reescrever os 19 caminhos era remendo. O defeito estava um nível abaixo:
`garantirPasta` devolvia `drive_pastas.drive_id` direto, e a linha nunca
expirava. Uma pasta apagada, movida para a lixeira ou tirada do
compartilhamento deixava o cache apontando para o nada, e o upload seguinte ia
para uma pasta que ninguém abre — com `drive_url` funcionando, porque o arquivo
existe; só o lugar é que não existe mais. Sem ninguém reclamar, porque a tela
não olha o Drive.

Agora o cache passa por um `GET /files/{id}?fields=id,trashed`. Duas decisões
dentro disso:

- **Erro de rede LANÇA, não devolve `false`.** Só 404 e `trashed` significam
  "não existe". Tratar indisponibilidade como ausência faria o cache ser
  descartado e uma pasta nova criada ao lado da boa — as três pastas
  `comprovantes` de novo, por outro caminho.
- **Um `Set` por isolate.** `pastaDoDocumento` faz três `garantirPasta` por
  documento, e um lote de 60 do mesmo mês pede as mesmas três pastas 60 vezes:
  3 chamadas ao Drive em vez de 180. Não envelhece porque o que a memória guarda
  é "este id existia agora", não "este caminho tem este id".

Provado em produção pelo caminho feliz (um `mover` com as três pastas em cache:
zero erro, zero pasta criada à toa) e pela premissa (o Drive devolve 404 para id
inexistente, sondado pela ação `apagar`). O ramo do cache podre não foi testado
ao vivo: arranjá-lo significaria apontar deliberadamente a linha de uma pasta
real para o nada, e a recuperação envolveria criar e descartar pastas no Drive
da contabilidade.

## A empresa entra na chave, e a nota do editor para de vir do cabeçalho

Duas coisas que a pergunta "como garantir que a NF do editor vai na pasta certa?"
destravou.

**A chave única não tinha a empresa.** `uq_documentos_fiscais` era
`(competencia, fornecedor, tipo, subtipo, referencia_externa)`, e com `upsert`
dois CNPJs com nota do mesmo fornecedor na mesma competência caíam na MESMA
linha: a segunda trocava `empresa_id` e `storage_path` da primeira, e o arquivo
da primeira ficava órfão na pasta da outra empresa. Com sucesso na tela.

Nas notas de **serviço** — as que o editor manda — `referencia_externa` é `''`
em 10 de 10, então a colisão era **garantida**. Na tela do Financeiro a
referência é o nome do arquivo, então lá dependia de os dois se chamarem igual,
o que é plausível. E a condição já existe nos dados: J. A. BATISTA JUNIOR
recebeu das duas contas no mesmo mês, em 2026-09 e 2026-10.

Migração `20261008c` cria o índice de 6 colunas **ao lado** do antigo e torna
`empresa_id` obrigatório, na ordem que o CLAUDE.md exige para banco
compartilhado: índice novo → deploy do código com as 6 colunas no `onConflict`
→ e só então o `DROP` do antigo, em migração própria. O PostgREST exige
correspondência exata, e declarar menos colunas já impediu **toda** nota de ser
gravada uma vez. `chave-do-documento-fiscal` amarra os três `onConflict` à
constraint lida da migração.

**E a empresa da nota do editor não vem mais do seletor do cabeçalho.** O
cabeçalho responde "qual operação estou olhando"; uma nota fiscal é emitida PARA
um CNPJ, que está escrito nela. Pior: o padrão do cabeçalho é "Ambas" e
sobrevive ao recarregar, então o editor anexava a nota e levava uma recusa
apontando para um seletor que ele não tem por que mexer.

A aba agora tem o seu próprio seletor, com a mesma regra que ela já aplicava ao
seletor de editor: **escolhe sozinho só quando não há escolha a fazer.** Uma
empresa ativa, usa; mais de uma, a tela espera. Ficar esperando é visível;
arquivar no CNPJ errado não é.

Dava para adivinhar pelo pagamento, que é a regra do dinheiro carimbado, e não
vale o preço: o casamento seria por NOME contra `transacoes`, que é extrato
bancário — um editor não pode ver quanto o outro recebe. Quem sabe o CNPJ é quem
emitiu a nota.

### O que fica para a próxima

- O **`DROP` de `uq_documentos_fiscais`**, depois de o deploy do cliente estar
  confirmado. Até lá, a colisão entre empresas dá erro em vez de sobrescrever —
  que é a troca que importa, mas não é o estado final.
- `fn_nfs_do_editor` não tem dimensão de empresa: ela gera UMA linha esperada
  por (competência, subtipo). Se as duas empresas passarem a pagar o mesmo
  editor, a tela vai pedir uma nota e deveria pedir duas. Hoje é teórico —
  todos os pagamentos a editor são da Alaskan.
