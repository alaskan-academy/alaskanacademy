# Estrutura de pastas dos documentos fiscais

Desenho, 08/10/2026. Ainda **não implementado** — este arquivo é a decisão
escrita, para a implementação não precisar redescobrir o terreno.

## O que existe hoje

São **212 documentos**, e desde 07/10/2026 todos têm `empresa_id`. A estrutura
atual é `tipo/competência/arquivo`, e a empresa não aparece nela.

```
comprovantes/2026-09/2026-09-04_J-A-BATISTA-JUNIOR_aeliss_83....pdf
ferramentas/2026-08/2026-08_CapCut_NF_invoice.pdf
servicos/2026-08/2026-08_Jaqueline-Coelho_comissao.pdf
```

| empresa | documentos |
|---|---|
| alaskan | 210 |
| aeliss | 2 |

### São DUAS estruturas, não uma

Esta é a descoberta que muda o tamanho da tarefa, e custou uma afirmação
errada minha antes de eu ir ler o código:

- **Supabase Storage** usa `documentos_fiscais.storage_path`, montado no
  cliente (`FinanceiroNotasFiscaisPage.tsx` e `editores/NotasFiscaisTab.tsx`).
- **Google Drive** NÃO segue esse caminho. A edge function `drive-espelho`
  monta o dela do zero, a partir de `doc.tipo` e `doc.competencia`:

  ```ts
  const pasta = doc.tipo === 'servico' ? 'servicos'
              : doc.tipo === 'comprovante' ? 'comprovantes'
              : 'ferramentas';
  const mes = String(doc.competencia).slice(0, 7);
  const idTipo = await garantirPasta(token, pasta, DRIVE_PASTA_RAIZ);
  const idMes  = await garantirPasta(token, `${pasta}/${mes}`, idTipo);
  ```

Mudar `storage_path` **não mexe no Drive**. Os dois precisam ser alterados.

## A estrutura nova

```
{empresa}/{competência}/{tipo}/{arquivo}

alaskan/2026-09/comprovantes/2026-09-04_FORNECEDOR_1234.pdf
alaskan/2026-09/servicos/2026-09_Jaqueline-Coelho_pagamento.pdf
aeliss/2026-09/comprovantes/2026-09-04_J-A-BATISTA-JUNIOR_....pdf
```

A mesma em Storage e em Drive. Uma estrutura só para lembrar.

### Por que a empresa vem primeiro

É o recorte que **nunca** se mistura. Duas empresas são dois CNPJs, duas
apurações, duas contabilidades — uma NF da Aeliss dentro do pacote da Alaskan
é erro fiscal, não desorganização. Tudo o mais (tipo, mês) pode ser olhado
junto; empresa não.

### Por que a competência vem antes do tipo

Porque o produto desta área é o **pacote mensal para a contabilidade**, e o
pacote é de uma empresa num mês. Com `empresa/competência/tipo`, o pacote é
UMA pasta: `aeliss/2026-09/` compacta e vai. Com a estrutura de hoje
(`tipo/competência`) ele está espalhado por três pastas, e com
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
divergiram de `categorias_centro` e a primeira armadilha do CLAUDE.md.

## O que precisa mudar

### 1. Cliente — o `storage_path`

Os dois lugares que montam o caminho hoje:

- `FinanceiroNotasFiscaisPage.tsx`: `${pasta}/${competencia}/${nome}`
- `editores/NotasFiscaisTab.tsx`: `servicos/${competencia}/${nome}`

Viram um helper só em `src/lib/documentos.ts`, que recebe o slug e não aceita
vazio. Duas montagens à mão é como as duas telas divergiram em primeiro lugar.

### 2. `drive-espelho` — a cadeia de pastas

Ganha um nível antes do tipo:

```ts
const idEmpresa = await garantirPasta(token, slug, DRIVE_PASTA_RAIZ);
const idMes     = await garantirPasta(token, `${slug}/${mes}`, idEmpresa);
const idTipo    = await garantirPasta(token, `${slug}/${mes}/${pasta}`, idMes);
```

`garantirPasta` já é seguro contra corrida (`fn_reservar_pasta`, migração
`20260825u`), e `drive_pastas.caminho` aceita o nível a mais sem mudança.

A função precisa passar a ler `empresa_id` no `select` — hoje ela busca
`id, tipo, competencia, nome_arquivo, storage_path, drive_url`.

### 3. A migração dos 212 — a parte difícil

**Mover no Storage é fácil**: `supabase.storage.from('documentos').move(de, para)`.

**Mover no Drive não tem código.** E tem uma armadilha: o gatilho
`trg_espelho_drive` dispara em `AFTER INSERT OR UPDATE OF storage_path`, mas
`espelhar()` começa com

```ts
// Ja espelhado: reenviar criaria uma segunda copia, e a contabilidade veria a
// mesma nota duas vezes.
if (doc.drive_url) return null;
```

Ou seja: atualizar `storage_path` dispara o gatilho e **não faz nada**. Os 212
ficariam no lugar novo no Storage e no lugar velho no Drive — pior que antes.

Essa guarda está certa e não deve ser removida. O caminho é uma ação NOVA na
mesma função:

```
POST /drive-espelho  { acao: 'mover', documento_id }
  → calcula a pasta nova (garantirPasta)
  → PATCH /files/{drive_id}?addParents={nova}&removeParents={velha}
  → não baixa, não sobe, não duplica
```

`removeParents` exige saber o pai atual: vem de `drive_pastas` pelo caminho
antigo, ou de um `GET /files/{id}?fields=parents`.

### Ordem da migração, por documento

1. `move` no Storage. Falhou, nada mudou — pode repetir.
2. `acao: 'mover'` no Drive. Falhou, o Storage já mudou mas o `storage_path`
   ainda não: o par continua coerente.
3. `update storage_path`. O gatilho dispara e vira no-op (`drive_url` setado),
   que aqui é o comportamento desejado.

### Desfazer

Antes de mover, gravar em `documentos_movidos` o `documento_id`, o
`storage_path` antigo e o id do pai antigo no Drive — o mesmo padrão de
`views_apagadas` (20261006j), que provou valer a pena. Sem isso, um erro no
meio de 212 arquivos é arqueologia.

### O que fica para trás

As pastas antigas vazias no Drive (`comprovantes/`, `ferramentas/`,
`servicos/`) e suas linhas em `drive_pastas`. Apagar é opcional e deve ser o
último passo, depois de conferir que todas as 212 chegaram.

## A prova de que terminou

Derivada, não lista:

```sql
-- nenhum documento fora da estrutura nova
select count(*) from documentos_fiscais d
join empresas e on e.id = d.empresa_id
where d.storage_path !~ ('^' || e.slug || '/\d{4}-\d{2}/(comprovantes|ferramentas|servicos)/');
-- tem de dar 0
```

E, no Drive, que a contagem de arquivos por pasta nova bata com a contagem por
`(empresa, competência, tipo)` da tabela — 17 combinações hoje.
