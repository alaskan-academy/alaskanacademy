# A avaliação de criativo passa a vir preenchida — só para os novos

Plano. Nada implementado. Medições de 09/10/2026 contra produção, cada uma
conferida por um segundo agente adversarial.

## Contexto

A avaliação de criativo é digitada em dois campos de
`src/features/criativos/components/AvaliacaoView.tsx` — **Marcação**
(`producoes.status_veiculacao`) e **Avaliação** (`producoes.avaliacao`). O pedido:
que venham preenchidos e que ela só confirme ou altere.

A régua para decidir já existia e já estava medida — o `CRIVO` em
`AvaliacaoView.tsx:141`, apurado sobre 782 anúncios e R$ 242.143. Ela nunca foi
aplicada: era um número na tela que a pessoa lia e reproduzia à mão. Em 09/10/2026
a régua foi **redefinida por ela** (ver abaixo) e o escopo foi reduzido a **cards
novos**.

## Escopo: só os novos

> **A régua vale para cards que entram em `fase = 'postado'` a partir da data de
> estreia.** Nada do que já existe é tocado — nem os 393 cards avaliados de
> verdade, nem os ~2.290 que carregam valor vindo da carga de importação.

Isto foi decidido em 09/10/2026 e **elimina o maior risco que o plano tinha**: a
reclassificação em massa de ~2.100 cards, a queda da esteira do Copy de 198 para
39, a mudança nos números de desempenho dos editores e a queda de "descartado" em
`vw_criativo_por_angulo` de 2.444 para 254. Nenhuma dessas coisas acontece mais.

**O fluxo que a automação vai atender**, medido por `criativo_historico`
(`campo_alterado='fase'`, `valor_novo='postado'`):

| mês | criativos postados | passaram de R$ 80 | com 5+ vendas |
|---|---|---|---|
| jul/2026 | 36 | 23 | 11 |
| ago/2026 | 185 | 99 | 39 |
| set/2026 | 112 | 56 | 16 |
| out/2026 (9 dias) | 58 | 13 | 1 |

De 100 a 185 criativos por mês; ~50 a 100 passam do piso de verba e ~15 a 40
chegam a 5 vendas. Os números de outubro são baixos porque os cards são recentes:
**um card postado hoje só fica julgável em ~2 semanas**, e é por isso que a régua
reavalia de hora em hora em vez de decidir uma vez.

**Consequência a aceitar:** sem backfill, a régua não tem como se provar agora. A
distribuição medida abaixo é **previsão**, não resultado, e só dá para dizer se a
régua é boa depois de uns dois meses de cards novos. Isso é a segunda armadilha
olhando para a própria automação, e o conserto está em §7 (medir a régua).

## A régua, decidida em 09/10/2026

**Entradas**, de `fn_criativos_metricas(null, null)` — vida inteira do anúncio, não
o mês: julgar pelo mês corrente reprovaria todo AD que estreou ontem.
`investimento`; `vendas` e `roas` (Payt); `vendas_meta` e `roas_meta` (Meta).

**Quem entra:** `fase = 'postado'` **e** `tipo = 'criativo'` **e** postado a partir
da estreia. VSL e aula ficam fora — a régua é de mídia, e as 68 VSLs e 1 aula em
'postado' não gastam verba.

| ordem | vira | condição | margem s/ receita |
|---|---|---|---|
| 1 | **Sem dados** | `investimento` nulo **ou** `<= 80` — um ticket | — |
| 2 | **Escalado** | `vendas >= 15` **e** `roas > 1,8` | 9,7% |
| 3 | **Validado** | `(vendas >= 10 e roas >= 1,65)` | 4,0% |
| | | **ou** `(vendas >= 5 e roas > 2)` | 16,1% |
| 4 | **Não validado** | verba acima de R$ 80 e não passa na linha 3 | — |
| 5 | *não grava* | as fontes discordam | — |

A linha 3 é a definição dela, em duas cláusulas: *"ou se paga com margem boa com
poucas vendas, ou se paga com margem pequena mas com um volume maior de vendas —
mas sempre com margem."* O `> 2` é a margem boa, o `>= 1,65` é a pequena, e
**nenhuma das duas é zero**, que é o que o empate de 1,56 seria.

A margem sai de `L(R) = 0,7308 − 1,14/R`, derivada do empate. Por isso a tabela do
crivo guarda o **empate**, não as margens: elas se recalculam quando a alíquota
mudar.

Operadores exatamente como ela os disse: `>= 15`, `>= 10`, `>= 5` e `>= 1,65`
inclusivos; `> 1,8`, `> 2` e `> 80` estritos.

**Como as duas fontes se combinam.** A escada roda separadamente nas colunas da
Payt e nas do Meta, e:

- vereditos **iguais** → grava;
- as duas **aprovam** em níveis diferentes (uma diz Validado, a outra Escalado) →
  grava o **menor**. As duas concordam que o card é bom; divergir no nível não é
  motivo para não gravar nada, e o lado conservador é o que não autoriza verba por
  engano. São 4 cards na amostra histórica, e é o que levaria o Validado de 7 a 11;
- qualquer outra divergência → **não grava**, mostra os dois números e espera.

Por cima de tudo: **se `avaliacao_origem = 'humano'`, nada é escrito** — a régua só
anota que discorda. Com o escopo em "só os novos" isso passa a ser uma segunda
cerca, não a principal.

> **A faixa de 2 cards entre 1,60 e 1,65.** A linha de corte dela é 1,60
> (*"abaixo de 1,6 cortamos"*) e a de validação ficou em 1,65, então um card com
> 10+ vendas e ROAS nessa faixa não é cortado nem validado. Cai em "Não validado"
> pelo ramo final, o que é correto — não alcançou a barra —, mas a tela deve dizer
> **"acima do corte, abaixo da régua"** em vez de um "Não validado" seco. São os
> únicos cards em que o rótulo não conta a história inteira.

### Previsão, aplicando a régua à base histórica

Não vai ser executado assim — serve para dizer o que esperar de cada 3.000 cards
que passarem pela régua:

| desfecho | cards | verba |
|---|---|---|
| Sem dados | 2.669 | R$ 8.034 |
| Não validado | 254 | R$ 100.078 |
| **não grava — as fontes discordam** | **65** | **R$ 264.049** |
| Validado | 11 | R$ 23.010 |
| Escalado | 5 | R$ 13.119 |

Soma 3.004. **Os cards que a régua se recusa a decidir carregam 64% da verba**, e é
para eles que a fila "a revisar" deve estar ordenada por investimento.

## O que a medição ensinou sobre esta régua

**O piso de 1,8 no Escalado evitou um prejuízo grande.** O pedido literal (15
vendas, sem ROAS) daria 60 cards "Escalado" com **−R$ 67.441** de lucro, 26 no
vermelho — e 55 dos 60 reprovariam no teste do próprio Validado, quebrando a
monotonicidade da escada. Com o piso em 1,8: 5 cards, +R$ 7.364, nenhum no
vermelho. E 2,5 seria letra morta: o teto de ROAS medido na Payt é 2,18.

**O argumento do 2,5 que está na tela está vencido.** A frase *"quem passou em 2,5
rendeu 1,64 depois"* **não reproduz** por nenhum dos dois caminhos de medição (dá
1,21 e 0,91). E exigir 2,5 é pior que 1,8, não melhor: sobrevivência 16,7% contra
21,6%. A prosa precisa dizer isso, não ser apagada.

**5 vendas não custa confiança.** Dispersão do ROAS 0,61 contra 0,61 das 6 vendas;
acerto fora de amostra 27,4% contra 29,7% — ruído. A primeira queda real de
dispersão é de **6 para 8** (0,61 → 0,45). O *"com 4 acerta 71%, com 6 acerta 86%"*
da tela também não reproduz.

**O empate verdadeiro é 1,56, não 1,6** — recalculado com o Simples em 6,9359%
(`vw_aliquota_simples_mes`) contra os 9% do cálculo original.

**O piso de R$ 80 é um ticket, e está certo.** Ticket mediano **R$ 83,60**, médio
R$ 89,84, p10–p90 de R$ 47 a R$ 136 sobre 5.949 vendas desde 01/07. A lógica dela é
*"julgamos a partir do momento que gastou 1 ticket; se zero vendas ou abaixo de
1,6, cortamos"* — que responde **quando cortar**, não quando validar, e para cortar
um ticket gasto sem venda é evidência suficiente. Medido com faixas exclusivas
(totais fecham em 3.004):

| faixa | zero vendas → corta | vendeu no vermelho → corta | 1–4 vendas no azul → **ambíguo** | 5+ no azul |
|---|---|---|---|---|
| até R$ 80 | 2.631 | 17 | **21** | 0 |
| R$ 80–348 | 83 | 97 | **13** | 6 |
| acima de R$ 348 | 14 | 97 | **1** | 24 |

Só **35 cards em 3.004** ficam genuinamente sem resposta. E onde está o dinheiro é
noutra faixa: **97 cards acima de R$ 348 que venderam e estão no vermelho, com
R$ 300.480 de verba** — a regra dela corta todos, e é o maior acerto dela.

**A régua reprova card lucrativo:** 17 cards acima do empate e lucrativos
(+R$ 1.645) recebem "Não validado". Fronteiras reais: `AD 001 H01 V01` (7 vendas,
ROAS 3,00, +R$ 398) valida, enquanto `AD 009 H05 V01` (13 vendas, ROAS 1,70,
+R$ 144) reprova. É consequência aceita da estrutura de duas cláusulas, não defeito.

### A pergunta que a medição NÃO resolveu

**Payt ou Meta é a verdade.** Os **mesmos 60 cards** dão **−R$ 67.441 pela Payt** e
**+R$ 126.762 pelo Meta**. E quem marcou os 19 "Escalado" à mão estava lendo o
Meta — 18 dos 19 com `roas_meta >= 1,7`, só 2 com ROAS Payt >= 2,0. Nenhuma das
duas medições independentes resolveu. A régua decide pela Payt e só grava com
concordância, o que contorna a pergunta sem respondê-la: os cards onde ela importa
são exatamente os 65 que vão para a fila.

## Desenho

### Onde a derivação mora

**A regra numa view, a aplicação numa função, o disparo no cron horário que já
existe, mais um gatilho em `producoes`.**

| objeto | papel |
|---|---|
| `vw_criativo_avaliacao_sugerida` | a regra, um lugar só, calculada na hora |
| `fn_avaliar_criativos(p_card uuid default null)` | aplica, respeitando escopo e procedência |
| cron `atribuicao-horaria` (`'10 * * * *'`) | chama a função **depois** de `fn_fixar_vinculo_ads()` |
| `trg_avaliar_card_novo` em `producoes` | card que entra em `postado` → `Sem dados` na hora |

Por que o cron: **a avaliação não pode ser mais fresca que as entradas dela.**
`metricas_meta` chega por sync horário (`'0 * * * *'`) e `producao_ads` só ganha
linha às `:10`. Reavaliar às `:10` garante que a avaliação nunca está mais velha que
o dado que a produz — e é o mesmo mecanismo que mantém o vínculo desde 24/08, então
não é carga inicial (quarta armadilha).

Por que **não** view pura: a decisão de gravar exige o valor no banco.
`producoes.avaliacao` é filtrado no servidor (`AvaliacaoView.tsx:420`) e é lido por
8 migrações e 3 telas; e uma view não tem onde gravar "eu concordo".

Por que **não** gatilho em `metricas_meta`/`vendas`: o sync entra em lote de
milhares de linhas, o agregado rodaria dentro da transação do sync, e um erro na
avaliação passaria a derrubar a entrada do dado de mídia. Não compraria frescor — o
vínculo de que a regra depende só muda de hora em hora.

O gatilho em `producoes` é barato **porque um card recém-postado não tem vínculo
por construção** (`fn_fixar_vinculo_ads` roda depois): a resposta é determinística,
`Sem dados`, sem ler `metricas_meta` nenhuma vez. Isso precisa estar escrito no
corpo do gatilho, senão alguém "melhora" chamando a view pesada e põe segundos no
UPDATE dela.

**Vigia:** `fn_alerta_avaliacao_parada()` em `vw_alertas` — "N cards postados há
mais de 2h sem sugestão". Sem ele, o dia em que o cron parar a tela mostra valor
velho com cara de atual (já aconteceu: 52 execuções de `cs-sync-daily` falhando em
silêncio de 30/06 a 20/08).

### Escopo e procedência, no banco

```sql
producoes.avaliacao_origem text
  check in ('humano','automatico','fora_do_escopo')
avaliacao_sugerida(producao_id pk, sugestao, motivo, crivo_versao_id, decidido_em)
avaliacao_automatica_log(id, producao_id, de, para, motivo, versao_id, em)
```

Não é a primeira armadilha: `avaliacao` e `avaliacao_origem` respondem perguntas
diferentes — "qual é o valor" e "quem o pôs". É o mesmo par de
`producao_ads.origem` e de `transacoes.categoria` + `categoria_origem` +
`status_revisao`, já em produção. `avaliacao_sugerida.sugestao` **pode e deve**
divergir de `producoes.avaliacao` — é como a tela avisa sem mexer. A proteção não é
ter um campo só, é ter **um escritor só por campo**, e isso dá teste.

**`'fora_do_escopo'` é o nome honesto da base atual.** Com a régua valendo só para
os novos, tudo que existe hoje recebe esse selo numa única instrução, e a função
tem a guarda `avaliacao_origem <> 'fora_do_escopo'`. Duas vantagens sobre guardar
uma data de corte: a fila "a revisar" não enche com 2.600 cards antigos, e a tela
pode dizer *por que* um card antigo não tem sugestão em vez de parecer um buraco.

Dentro de "fora do escopo" vale distinguir quem foi julgado de verdade, porque é
informação que a tela deve mostrar:

```sql
-- 393 cards: julgamento real, dela ou da equipe
update producoes p set avaliacao_origem = 'humano'
 where exists (select 1 from criativo_historico h
                where h.criativo_id = p.id and h.campo_alterado = 'avaliacao');
-- todo o resto que já existe: a régua não opina
update producoes set avaliacao_origem = 'fora_do_escopo'
 where avaliacao_origem is null;
```

A prova trava a faixa (`count(humano)` entre 300 e 500): se vier 2.700, o
`campo_alterado` mudou de nome. Atenção — `criativo_historico` tem 583 alterações
de `avaliacao` em 393 cards (a coluna é `criativo_id`, não `producao_id`) **e 60
linhas com `campo_alterado` NULL**; o `exists` tem de dizer explicitamente o que
faz com essas 60.

**A automação não escreve em `criativo_historico`.** Aquela tabela é a única prova
de toque humano e é lida por `fn_desempenho_editores`; enchê-la de linhas de máquina
destrói a prova que o backfill acima usa. Para isso existe
`avaliacao_automatica_log`.

| ação | `avaliacao` | `origem` | `criativo_historico` | log |
|---|---|---|---|---|
| ela troca o valor | sim | `humano` | 1 linha | — |
| ela clica confirmar | não muda | `humano` | 1 linha (`campo_alterado='avaliacao_origem'`) | — |
| `fn_avaliar_criativos` | só se origem = `automatico` ou nula | `automatico` | **nunca** | 1 linha |
| gatilho card novo | idem | `automatico` | nunca | sim |

**Fila "só a revisar"** = `avaliacao_origem = 'automatico'`, filtrável no servidor,
**ordenada por investimento desc** — os cards que carregam 64% da verba sobem ao
topo.

**`isPendente` precisa morrer** (`AvaliacaoView.tsx:90-96`, `:543`, `:725-727`).
Hoje pendente = `!avaliacao || avaliacao === 'Sem dados'`, **e** exige
`status_veiculacao` 'Rodando' ou vazio. Com a régua gravando "Sem dados" nos cards
novos sem verba, a pílula passa a contar o que não devia. Reescrever como "a
revisar" sobre `avaliacao_origem`, e os dois botões viram um: deixa de ser
adivinhação e passa a ser procedência.

### A ação de um clique da Marcação

A Marcação continua 100% intenção dela — `status-veiculacao-e-intencao.test.ts`
proíbe derivá-la, e com razão: a contradição com o Meta achou 24 cards marcados
"Encerrado" gastando R$ 5.691,62 em 7 dias. O que entra é só o atalho.

Dentro do bloco que já existe, `AvaliacaoView.tsx:846-871` — a linha âmbar do fato,
embaixo do `select`. Ganha um botão-texto de 10px `[marcar Encerrado]`, chamando
`handleChange(c, 'status_veiculacao', sugerida)`, que já faz UPDATE + histórico +
rollback otimista. Zero escrita nova. Toast com "Desfazer". **Vale para todos os
cards, novos e antigos** — é ação dela, não régua.

Mapa novo em `src/features/ads/situacao.ts`:

```ts
/** A marcação que o fato do Meta SUGERE. Só isso: aplicar é clique dela. */
export function marcacaoQueOMetaSugere(estado: string | null): string | null
```

O vocabulário vem do banco: a tela só desenha o botão se `opStatus` (de
`criativo_campos_opcoes`) contiver o valor. Renomear "Encerrado" na tabela faz o
botão **desaparecer** em vez de gravar valor que não é opção.

**Como não quebrar o teste:** ele varre janelas de 3 linhas que contenham
`status_veiculacao` e reprova literal do vocabulário do Meta na janela, isentando
`/contradiz/`. `marcacaoQueOMetaSugere` recebe **só `estado`** e vive em
`situacao.ts`, arquivo que não contém `status_veiculacao` em lugar nenhum. No ponto
de uso, calcular antes e aplicar depois, para a linha com `status_veiculacao` ter
janela limpa.

### O aviso de "virou contra o que você confirmou"

Avisar não é atualizar, então isto **vale também para os cards antigos** — inclusive
os 393 julgados de verdade, que são justamente onde o aviso tem valor.

**O urgente — `vw_ad_morrendo`.** É a fonte certa porque a régua usa a **vida
inteira** do anúncio: um card com ROAS acumulado bom passa no crivo enquanto os
últimos 7 dias desabam. A view já compara 7 dias contra os 7 anteriores, exige
`inv_7 >= 100` e `vd_ant >= 6`, e já tem `producao_id`. Nova
`vw_criativo_virou_contra` cruza com `avaliacao_origem = 'humano'` e com os níveis
que aprovam — **lendo os níveis da tabela do crivo, não de literal**. Na tela, bloco
âmbar no molde de `AvisoAdMorrendo` (`MetaAdsPage.tsx:290`): *"Você validou AD 083
H06 V01. Nos últimos 7 dias gastou R$ 298 com ROAS 0,65 (era 3,80). Nada foi
alterado."*

**O lento — a régua discorda.** `sugestao <> avaliacao and origem = 'humano'`. Chip
"Régua discorda (N)" e um aviso discreto na linha. Inclui o sentido bom (marcou
"Não validado" e agora passa), que é informação e por isso fica fora do bloco âmbar.

### O crivo sai do código para tabela versionada

Prosa e números na mesma linha imutável não conseguem divergir. O risco de hoje é
serem duas coisas editadas separadamente — `CRIVO.empate = '1,6'` no TSX e
`roas_7 < 1.6` em `20260924b:125` — e já existe
`src/test/o-empate-e-um-so.test.ts` só para impedir que custem dinheiro.

```sql
crivo_versoes(id, vigente_de, medido_em, empate, verba_min,
              base_ads, base_investimento, base_ini, base_fim,
              nivel_sem_verba, nivel_reprovado, campo, justificativa text[])
crivo_niveis(versao_id, campo, nivel, ordem, significa,
             clausula int,                 -- 1, 2, … : o nível passa se QUALQUER uma passar
             vendas_min int, roas_min numeric, roas_inclusivo boolean,
             primary key (versao_id, nivel, clausula))
vw_crivo_vigente / vw_crivo_niveis_vigentes
```

FK composta para `criativo_campos_opcoes (campo, valor)` — a constraint
`criativo_campos_opcoes_campo_valor_key` já existe. **O banco passa a impedir que a
régua fale de um nível que o vocabulário não tem**: é a cura da raiz do bug do
"Escalado", não só do selo sem cor.

**Três colunas que só existem por causa desta régua:**

- **`clausula`** — o Validado tem duas condições alternativas,
  `(10; ≥1,65)` **ou** `(5; >2)`. Uma linha por nível não expressa isso. Com a
  cláusula, um nível é uma lista de condições em OU, o que é mais fiel ao que ela
  está dizendo: **uma curva de troca** entre volume e retorno.
- **`roas_inclusivo`** — ela misturou os operadores de propósito: `>= 1,65` no
  Validado de 10 vendas, `> 2` no de 5, `> 1,8` no Escalado.
- **`verba_min`** (os R$ 80) — piso escrito à mão é a terceira armadilha, e ele
  muda junto com o ticket.

**A semente tem DUAS linhas**, e `medido_em` é anulável de propósito: nulo
significa "decidida, não medida".

| versão | vigente_de | medido_em | níveis | justificativa |
|---|---|---|---|---|
| v1 | 2026-09-06 | 2026-09-06 | Validado (6; ≥1,6) · Escalado (10; ≥2,5) | os cinco parágrafos de `TabelaDoCrivo:185-209`, literais |
| v2 | **2026-10-09** | **nulo** | Validado (10; ≥1,65) *ou* (5; >2) · Escalado (15; >1,8) | texto novo |

Guardar a v1 serve a três coisas: a medição dos 782 ADs não se perde; a tabela nasce
com duas linhas, provando que o versionamento funciona (e não é retrato); e dá para
responder depois qual das duas acertou mais.

**A prosa tem de ser reescrita, não só os números.** Os cinco parágrafos atuais
justificam a v1, e duas das afirmações **não reproduzem** (o 1,64 pós-escala e o
71%/86% de confiança). Deixá-los é a primeira armadilha em forma de texto, na pior
variante: quem lê acredita. A v2 precisa dizer o que foi decidido, o que foi medido
e o que foi medido **e refutado** — e o nulo em `medido_em` deve aparecer na tela
como tal, não como data falsa.

O `empate` continua sendo o break-even, de que `vw_ad_morrendo` depende, e passa a
**1,56**. Ele deixa de coincidir com qualquer nível de validação — o que é mais
honesto e obriga a revisar todo lugar que confundia os dois.

## Os vizinhos

Com o escopo em "só os novos", nenhum deles muda de uma vez: eles mudam **aos
poucos**, conforme cards novos ganham avaliação. Isso é desejável, mas cada um
precisa saber o que está lendo.

- **Esteira do Copy** — o objeto vivo é **`fn_esteira_defasagem`, em
  `20260827zr_defasagem_por_funil.sql:93` (CTE `val`)** e `:69`, com
  `avaliacao IN ('Validado','Escalado') AND fn_ad_numero(nome) IS NOT NULL`.
  *(Correção de uma versão anterior deste plano, que apontava `20260827zp:136,144`:
  aquela migração só cria `vw_projeto_investimento` e `vw_criativo_investimento`, e
  `vw_esteira_lotes` em `20260827zm:200` não filtra `avaliacao`.)* Card novo
  validado entra na esteira; card novo com "Sem dados" não entra.
- **`fn_desempenho_editores`** — última definição em `20260928d`, com **dois
  ramos**: `:199-200` (`novos`, que lê `producoes.avaliacao`) e `:222-223`
  (`antigos`, que lê `avaliacoes_criativos` e grava `0::bigint` em `ads_escalados`
  — imune à régua). Consumido por `DesempenhoTab.tsx:188-190`, `:358-359`,
  `:450-451`. Ganha a contagem **"N a revisar"** ao lado de validados e escalados:
  é a segunda armadilha aplicada à própria automação — ela também precisa da coluna
  de resultado ao lado, para que ninguém leia número de máquina como julgamento.
- **`vw_criativo_por_angulo`** — última definição em `20260924e:78-79`.
- `fn_criativos_meta` devolve `p.avaliacao` (`20260824b:236`).

> **`fn_criativos_metricas` não filtra `tipo` nem `fase`** — a assinatura é só
> `(p_ini, p_fim)`. A régua tem de escrever `tipo='criativo' AND fase='postado'`
> ela mesma, ou **68 VSLs e 1 aula** entram. *(E são 68 + 1, não os "66 de 66" que
> `AvaliacaoView.tsx:552` e `DesempenhoAdsView.tsx:673` ainda dizem.)*

> **Quatro pisos de verba concorrentes, e nenhum documento dizendo que respondem
> perguntas diferentes:** `> 0` (esteira), `>= 1000`, `inv_7 >= 100` em 7 dias
> (`20260924b:122`) e agora os R$ 80 de vida inteira. O piso novo tem de entrar
> sabendo dos outros três, com comentário dizendo qual pergunta cada um responde.

## Ordem de deploy

Não há DROP neste trabalho. Mas a ordem inversa morde: código que faz
`select('…,avaliacao_origem')` contra banco sem a coluna faz o PostgREST **recusar
a consulta inteira** e a lista fica em branco para todos. Logo: **migração aditiva
primeiro, código depois**, e `NOTIFY pgrst, 'reload schema';` no fim de toda
migração que adiciona coluna ou view.

1. `20261009a_o_crivo_sai_do_codigo_e_passa_a_ter_versao.sql` — tabelas, FKs, RLS,
   2 views, as duas versões da semente, provas. Ninguém lê ainda.
2. `20261009b_a_avaliacao_passa_a_dizer_de_onde_veio.sql` — `avaliacao_origem`,
   check, índice, os dois `update` de procedência, prova de faixa. **Nenhum valor de
   `avaliacao` muda.**
3. `20261009c_a_regua_decide_e_quem_discorda_espera.sql` — view da regra, as duas
   tabelas, `fn_avaliar_criativos`, `fn_desfazer_avaliacao_automatica`. A função
   **só** toca cards com origem `automatico` ou nula; a prova confirma que nenhum
   card `humano` ou `fora_do_escopo` mudou, e que a soma por desfecho fecha com o
   universo.
4. `20261009d_o_aviso_de_que_os_numeros_viraram.sql` — `vw_criativo_virou_contra`,
   `fn_alerta_avaliacao_parada`, replace de `vw_alertas` **por extenso** (lição de
   `20261006n`: a catraca lê o arquivo).
5. `20261009e_o_empate_passa_a_sair_da_tabela_do_crivo.sql` — replace de
   `vw_ad_morrendo` lendo `vw_crivo_vigente`, **mesma lista de colunas**
   (`MetaAdsPage.tsx:597` seleciona 12 pelo nome), `security_invoker` na própria
   instrução, provas reescritas. **No mesmo commit** da reescrita de
   `o-empate-e-um-so.test.ts`.
6. **Deploy do código** + `bun run test` + `bun run lint`. Tudo tolera
   `avaliacao_origem` nulo e sugestão vazia.
7. `20261010a_a_regua_passa_a_valer_a_cada_hora.sql` — `trg_avaliar_card_novo` e
   `cron.schedule` com a função **depois** de `fn_fixar_vinculo_ads` (se vier antes,
   o card de um anúncio novo espera uma hora a mais).

Desfazer, se preciso: `fn_desfazer_avaliacao_automatica(timestamp)` lê
`avaliacao_automatica_log` e devolve valor e origem anteriores.

## Testes

Estilo da casa: leem migração e código-fonte, cabeçalho longo com o preço do erro,
comentários removidos antes de casar padrão.

1. **`a-regua-so-toca-o-que-e-dela.test.ts`** — o mais importante. Todo
   `update producoes` que toque `avaliacao` carrega a guarda de origem; a função
   nunca cita `status_veiculacao`; nunca insere em `criativo_historico`. No TSX:
   `handleChange` grava `avaliacao_origem: 'humano'`. *Preço: apagar os 393
   julgamentos que são a única coisa real no campo, e a base inteira que ela pediu
   para não tocar.*
2. **`quando-payt-e-meta-discordam-ninguem-decide.test.ts`** — existe ramo que
   devolve nulo com motivo; o nível sai das colunas **Payt**, com as do Meta na
   guarda; "sem dados" é decidido por **investimento**, não por vendas; quando as
   duas aprovam em níveis diferentes grava o menor; e a view não contém literal do
   vocabulário. *Preço: carimbar os cards que carregam 64% da verba com um palpite
   de 1,49×–1,76× de viés.*
3. **`a-escada-e-monotonica.test.ts`** — o piso de ROAS do Escalado tem de ser
   maior ou igual ao do Validado. *Preço medido: sem isso, 60 cards / R$ 294.286 de
   verba e −R$ 67.441 de lucro recebem nota máxima, 26 deles no vermelho.*
4. **`o-crivo-mora-no-banco-e-tem-data.test.ts`** — nenhum número de régua literal
   no TSX; a tela lê `vw_crivo_vigente`; a semente tem as duas versões, `medido_em`
   nulo na v2, e ≥2 cláusulas no Validado. *Preço: régua sem data envelhece em
   silêncio.*
5. **`o-selo-de-avaliacao-nunca-fica-sem-cor.test.ts`** — não existe array literal
   de valores de avaliação em `src`; `AVAL_COR` tem default.
6. **`a-avaliacao-automatica-tem-gatilho-e-nao-so-carga.test.ts`** — a migração que
   agenda cita a função **depois** de `fn_fixar_vinculo_ads`; existe gatilho em
   `producoes`; o corpo do gatilho **não** referencia a view pesada; existe
   `fn_alerta_avaliacao_parada` em `vw_alertas`.
7. **`o-empate-e-um-so.test.ts`** — reescrito, obrigatório no mesmo commit. Está
   **cego nos dois sentidos**: lê só `empate:` por regex (`:42`), então trocar
   `CRIVO.linhas` passa verde; e se alguém escrever `empate: '1,8'` por engano, o
   teste passa a **exigir** trocar `roas_7 < 1.6` para 1.8 — e aí a prova `:166` da
   própria migração aborta. Precisa ler os níveis também, e distinguir empate de
   nível.
8. **`aula-e-vsl-nao-viram-anuncio.test.ts`** — mais um caso: a regra filtra
   `tipo = 'criativo'`. Hoje (`:106-152`) ele não toca `avaliacao`.
9. `view-nova-nao-fura-a-rls.test.ts` — sem mudança; já policia as views novas.

## Arquivos de código

- `src/features/criativos/components/AvaliacaoView.tsx` — o grosso: `select` ganha
  `avaliacao_origem`; join da sugestão; `isPendente` vira "a revisar"; os dois chips
  viram um, ordenado por verba; selo de procedência (molde `STATUS_LABEL` de
  `FinanceiroRevisaoPage.tsx:82` — azul Auto, verde Confirmado, cinza Fora do
  escopo); botão confirmar; `[marcar Encerrado]`; bloco `AvisoVirouContra`;
  `AVAL_COR` com "Escalado" e default; `TabelaDoCrivo` e `CRIVO` saem daqui.
- `src/features/criativos/crivo.tsx` **(novo)** — `useCrivo()` e `TabelaDoCrivo`
  lendo `vw_crivo_vigente`, com estados de vazio e carregando. Parágrafos por
  `MarkdownRenderer` (já coberto por `sanitizar.test.ts`). Régua não configurada
  mostra texto mudo — **nunca fallback numérico no código**.
- `src/features/criativos/avaliacao.ts` **(novo)** — `ORIGEM`
  (rótulo/cor/explica, com default), `aRevisar()`, tipos.
- `src/features/ads/situacao.ts` — `marcacaoQueOMetaSugere(estado)`.
- `src/features/producao/components/CriativoDrawer.tsx` — selo, confirmar,
  `avaliacao_origem` no save (`:803`).
- `src/features/producao/components/types.ts` — `avaliacao_origem` no tipo.
- `src/features/criativos/components/DesempenhoAdsView.tsx` e `PorAnguloView.tsx` —
  selo de procedência; e em `DesempenhoAdsView` o `filter(isEscalado)` de `:775` e o
  título de `:1346`.
- `src/features/editores/components/DesempenhoTab.tsx` — "N a revisar".

**As cinco listas fixas de 3 valores, todas sem `'Escalado'`** — terceira armadilha
repetida cinco vezes, e deixa de ser cosmética agora que a máquina escreve o nível:
`AvaliacaoView.tsx:298` · `CriativoFormModal.tsx:71` · `CriativoDrawer.tsx:77` ·
`CalendarioView.tsx:560` · `PorProjetoView.tsx:69`. Mais `AVALIACAO_LABEL` em
`src/features/producao/components/constants.ts:72-76` e `AVAL_COR` em
`AvaliacaoView.tsx:276-280`, que joga "Escalado" no fallback cinza de `:881`.

**Três cópias do empate em texto fixo**, e a terceira está fora de qualquer teste:
`AvaliacaoView.tsx:143` · `20260924b:125` · **`MetaAdsPage.tsx:306`**.

**`20260924b` tem o empate em QUATRO lugares e DUAS notações:** `roas_7 < 1.6`
(`:125`), comentário (`:33`), `COMMENT ON VIEW` (`:128-129`) e a prova
`roas_agora >= 1.6` (`:166`). O `COMMENT` escreve **`1,6` com vírgula** — um teste
que procure `1.6` com ponto perde essa cópia.

**`20260924b:124` (`vd_ant >= 6`) e `:31`** são o **nível de validação**, não o
empate — viram órfãos agora que Validado exige 10.

**`useMetricasDoAd(null, null)` (`AvaliacaoView.tsx:290`)** é o que faz o piso de
R$ 80 valer sobre a vida inteira. Se a régua passar a respeitar o filtro de data da
tela, o mesmo card oscila entre "Sem dados" e julgado conforme o período aberto —
decidir isso explicitamente.

## Decisões abertas

1. **Payt ou Meta é a verdade** — os mesmos 60 cards dão −R$ 67.441 pela Payt e
   +R$ 126.762 pelo Meta, e o julgamento histórico dela seguiu o Meta (18 de 19).
   A régua contorna com a guarda de concordância, mas a pergunta sobrevive nos
   cards que vão para a fila.
2. **Medir a própria régua**, numa fase seguinte: com sugestão, log e histórico dá
   para responder "quando ela discorda da máquina, quem acertou?"
   (`vw_crivo_vs_humano`). Com o escopo em "só os novos" isso deixa de ser opcional
   — é a única forma de a régua se provar, e sem ela a v2 é cadastro sem tela de
   resultado, envelhecendo como os 134 UTMs.
3. **A base antiga, algum dia.** Ficou fora por decisão de 09/10. Quando/se voltar,
   o caminho está medido: 2.669 iriam para "Sem dados" (1.979 deles dizem hoje "Não
   validado"), a esteira cairia de 198 para 39 cards, e dos 160 que sairiam **32
   passaram comprovadamente pela tela**. O selo `fora_do_escopo` é o que mantém essa
   porta aberta sem mentir na tela.
4. **Confirmar em lote: não.** `20260825j` já teve de desfazer um "confirmar 440
   automáticas" que tornou 1.206 transações intocáveis — inclusive as erradas.
5. **Limpeza separada e opcional:** 67 anúncios `sem_card` (R$ 17.339) e 88
   `outro_projeto` (R$ 16.743). Não é pré-requisito: 1.021 de 1.191 anúncios de
   2026 têm vínculo confirmado, 91% da verba.
