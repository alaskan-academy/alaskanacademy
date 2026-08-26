# Revisão da área de Funis — diagnóstico

Levantamento de 26/08/2026, antes de mexer em qualquer coisa. Ela pediu a
revisão porque quer "mudar quase tudo", e porque a área bloqueia o módulo de
[Análises](../analises/plan.md).

---

## O defeito de raiz: "funil" na tabela é a VARIANTE

Os 23 registros de `funis` se chamam REV1, REV2, REV5, REV6 — e os nomes se
repetem entre produtos:

| Nome | Quantas vezes |
|---|---|
| REV1 - Original | 4 |
| REV2 | 3 |
| REV3 | 3 |

Isso não é bagunça de cadastro. É o modelo dizendo que **o funil de verdade é o
produto**, e o que está gravado como funil é a revisão dele. "Saponária REV5" e
"Saponária REV6" são o mesmo funil em duas versões — não dois funis.

Tudo o que está torto abaixo é consequência disso.

**O modelo que a operação já usa, sem estar escrito em lugar nenhum:**

```
produto  →  funil  →  variante (REV)  →  checkout
                                     →  VSL
                                     →  página
                                     →  preço
```

A alteração acontece na variante. A campanha aponta para a variante. A métrica
é da variante. O funil é o guarda-chuva.

---

## O que está quebrado hoje

### Dois campos dizendo a mesma coisa, e discordando

`ativo` (boolean) e `status` (texto) coexistem. Quatro funis têm
`status = 'ativo'` e `ativo = false` ao mesmo tempo.

Foi o que me fez contar **1 funil ativo** quando ela via vários na tela — a
consulta usou o booleano, a tela usa o status. Se dois campos podem discordar,
um dia discordam, e ninguém sabe qual é o certo.

**Um só sobrevive.** `status` é mais rico e é o que a tela já usa.

### `payt_key` não identifica nada

O mesmo valor — `8e820d583a121bdb552c6202638d8066` — em **9 funis diferentes**.
É a chave da conta na Payt, não do funil. Como identificador de funil, é
inútil, e foi provavelmente copiada de um para outro no cadastro.

### `produto` é texto livre e nulo na maioria

Nulo em **14 de 23**. Onde existe, é digitado à mão: "Saponária" com acento,
enquanto o enum `produto_tipo` usa `saponaria`. Duas taxonomias para a mesma
coisa, nenhuma conversando com a outra.

### `metodo` contradiz o nome

`REV5 - VSL` tem `metodo = 'TSL'`. `REV5 - VSL 03` também. O nome diz uma coisa,
o campo diz outra, e ninguém sabe qual vale.

### `link_checkout` em 8 de 23

Metade dos funis não tem checkout registrado — e é justamente por ele que a
venda seria ligada ao funil.

### Não existe VSL

Ela pediu para incluir. Hoje a informação de qual VSL está rodando vive só no
nome ("REV5 - VSL 03") e nas mensagens do Google Chat.

---

## O que já existe e é bom: `testes_funis`

**Isto muda o plano do módulo de Análises.** A tabela já tem exatamente a forma
do que eu ia criar como `alteracoes`:

`variante_a`, `variante_b`, `metrica`, `resultado_a`, `resultado_b`, `vencedor`,
`data_inicio`, `data_fim`, `pipeline_status`, `impacto`, `dificuldade`, `kpi`.

E está em uso: **38 testes ativos**, todos ligados a funil, criados em agosto.

| Status | Testes | Com vencedor |
|---|---|---|
| planejado | 20 | 0 |
| concluído | 13 | **3** |
| rodando | 4 | 0 |
| produzindo | 1 | 0 |

**Só 3 de 13 concluídos têm vencedor.** O ciclo não fecha aqui pelo mesmo motivo
que não fecha no Google Chat: registrar é manual, medir é manual, e ninguém
volta para preencher o resultado depois.

**Consequência para o plano:** não criar `alteracoes` do zero. O módulo de
Análises deve alimentar `testes_funis` — o que falta ali é o resultado ser
calculado sozinho a partir das datas, não um lugar novo para digitar.

---

## O tamanho da área hoje

4.361 linhas em seis abas:

| Aba | Linhas | O que faz |
|---|---|---|
| Funis | 475 | lista e cadastro |
| Testes | 247 | testes A/B |
| Esteira | 402 | pipeline dos testes |
| Concluídos | 345 | testes encerrados |
| Domínios | 233 | domínios e vencimento |
| Gerador UTM | 681 | monta link com UTM |
| FunilModal | 551 | cadastro de funil |
| TesteModal | 807 | cadastro de teste |

**Testes, Esteira e Concluídos são três telas do mesmo objeto** em fases
diferentes — 994 linhas para o que provavelmente é uma tela com filtro.

---

## Correções ao diagnóstico, depois das respostas dela

### O Gerador de UTM não é ferramenta de funil — eu errei

Escrevi que ele deveria virar um botão dentro do REV, porque o link seria
derivável. Ela corrigiu: a maioria do uso é FORA dos funis — contato de
suporte, área de membros, bio do Instagram. Os dados confirmam:

| Canal | Links | Vendas (desde 01/05) | Faturamento |
|---|---|---|---|
| area-membros-handify | 33 | 72 | R$ 2.700 |
| whatsapp / recuperação | 6 | 53 | R$ 3.748 |
| instagram / bio | 8 | 52 | R$ 3.992 |
| whatsapp / suporte | 13 | 50 | R$ 3.197 |
| site-handify | 39 | 16 | R$ 1.763 |

**Só 1 dos 134 links é de funil.** É rastreio de tráfego próprio, e está em
Funis por acidente de história.

**E é o mesmo defeito de sempre: cria e não mede.** 134 links gerados, nenhuma
tela diz qual vendeu. Repare que 39 links do site geraram 16 vendas enquanto 6
de recuperação geraram 53 — o canal mais eficiente por link, e ninguém sabe.

**Vai para `/utm`**, que já existe e é a página de atribuição. Criar o link e
medir o link são a mesma conversa; hoje estão em duas áreas do dash, e é por
isso que o ciclo não fecha. O vínculo já funciona: `utm_links` casa com `vendas`
por `source` + `medium` + `campaign` + `content`.

Alerta que cai de bandeja: link com 30 dias e zero vendas — ou não é usado, ou
está quebrado. E `whatsapp / suportelina` tem 21 vendas com ZERO links
cadastrados: alguém montou UTM à mão fora da ferramenta.

### O "produto" do funil é o PROJETO que Produção já usa

`funis.produto` é texto livre e bate com `ofertas_editores.nome` com grafia
diferente:

| No funil | O projeto |
|---|---|
| Saponária | Saponaria Brasil |
| Handify Completo | Handify |
| Workshop Buquê de Velas | Workshop Buquê de Velas |

Meu próprio casamento por prefixo errou "Velas de Lembrancinha" → "Workshop
Buquê de Velas", o que prova que texto livre não casa sozinho e precisa virar
chave estrangeira.

**O modelo fica:**

```
projeto (ofertas_editores)  →  funil/REV  →  checkout · VSL · página · preço
                                          →  testes
```

Um vocabulário só no dash inteiro: Produção, Criativos e Funis passam a falar do
mesmo "projeto".

### Cada REV é um funil, com vários testes dentro

Ela confirmou. Então `funis` continua sendo a granularidade certa — o que muda é
que ele ganha um pai (`projeto_id`) e o nome deixa de precisar carregar o
produto.

E `link_checkout` é único por REV — confirmado por ela. É a chave-mestra.

---

## Perguntas que precisam de resposta antes de mexer

1. **Um funil tem várias variantes (REV) ou cada REV é um funil?** Todo o resto
   depende disto. Os dados dizem "variantes"; confirmar com ela.
2. **O que identifica a venda como sendo de uma variante?** O `link_checkout` é
   único por REV? Se for, é ele que liga tudo.
3. **Domínios e Gerador de UTM continuam aqui?** São ferramentas úteis mas de
   outra natureza — não são o funil, são infraestrutura em volta dele.
4. **Testes/Esteira/Concluídos viram uma tela só?**
5. **O que fazer com os 23 registros atuais** — migrar para o modelo novo, ou
   recomeçar o cadastro com o histórico preservado?

---

## O que dá para aproveitar do que já existe — muito mais do que eu supunha

Ela perguntou se não dava para aproveitar o cadastro atual em vez de digitar
tudo de novo. Dá, e a resposta tem duas partes — a segunda eu não esperava.

### 1. O vínculo com o projeto JÁ EXISTE, com o nome errado

`funis.oferta_id` não aponta para `ofertas`. Aponta para `ofertas_editores` —
os projetos — em **22 de 23** registros.

O modelo `projeto → REV` que propus não precisa ser criado. Ele está lá,
chamado de `oferta_id`, e por isso ninguém sabia:

| Projeto | REVs | Com checkout |
|---|---|---|
| Saponaria Brasil | 6 | 3 |
| Workshop Buquê de Velas | 5 | 1 |
| Velas Lembrancinhas | 5 | 2 |
| Handify | 2 | 0 |
| +4 projetos com 1 REV | 4 | 1 |

**Consequência:** `funis.produto` (texto livre, nulo em 14 de 23) é redundante e
some. O nome do projeto vem da chave estrangeira.

### 2. Os checkouts estão dentro das vendas

O webhook da Payt guarda o checkout inteiro em `payload_webhook.link`:

```json
{ "url": "https://payt.site/A1C7m7x",
  "title": "Workshop Buquê de Velas Rev1",
  "sources": { "utm_source": "whatsapp", "utm_medium": "suporte" } }
```

**61 checkouts distintos** já registrados em vendas reais, com URL, nome e UTMs.
E **12 deles dizem a REV no próprio título** — "Rev1", "Rev5" — cobrindo 1.185
vendas.

Isto inverte o trabalho dela: em vez de digitar 16 checkouts que faltam, a tela
mostra os 61 que existem e ela confirma a qual REV cada um pertence. Os que
trazem "Rev" no título já vêm sugeridos.

E os checkouts de suporte/recuperação ("Saponaria Brasil Suporte R$67", "Oferta
Relâmpago") são a prova de que um projeto tem checkouts que NÃO são de funil —
são de atendimento. O modelo precisa comportar isso sem forçá-los a virar REV.

### 3. A VSL vira seleção, não digitação

Ela levantou: se integrar a API do VTurb, dá para só selecionar a VSL. Sim, e é
melhor por dois motivos além do óbvio:

- o identificador vem do player, então "onde está rodando a VSL h07" passa a ser
  uma busca exata e não uma comparação de texto digitado;
- o mesmo id serve depois para puxar a retenção (Play Rate, 1 min, Fim da Lead,
  Pitch, Final VSL) — os cinco campos que hoje são digitados na análise.

**Isso promove a integração do VTurb de "etapa 5, se der" para pré-requisito da
tela de Funis.** Precisa ser investigada antes, não depois.

### A VSL não espera o VTurb

A integração ainda não existe no projeto — precisa ser configurada. Então a VSL
**não pode ser desenhada em cima dela**, ou a tela de Funis fica parada
esperando.

Desenho que funciona hoje e melhora depois, sem retrabalho: uma tabela `vsls`
própria, e o REV aponta para ela.

| Campo | Hoje | Quando o VTurb entrar |
|---|---|---|
| `nome` | digitado uma vez ("h07 v01") | continua, ou vem do player |
| `player` | vturb / panda | idem |
| `player_video_id` | vazio | preenchido pela API |
| retenção | manual na análise | puxada pelo id |

**Por que uma tabela e não um campo de texto no REV:** a mesma VSL roda em mais
de um REV, e a pergunta dela é justamente "onde está rodando a h07". Com texto
solto em cada REV, a busca vira comparação de string e erra na primeira
divergência de grafia. Com tabela, é uma chave estrangeira e a resposta é exata.

São poucas VSLs; cadastrá-las uma vez é barato. E quando a API entrar, ela
preenche `player_video_id` nas existentes e passa a criar as novas sozinha.

**Um detalhe que ela levantou:** parte das VSLs pode estar no Panda Video, não
no VTurb — o Panda aparece nas ferramentas pagas (R$ 989 em agosto). Por isso o
campo `player` existe desde o começo, mesmo com um player só integrado.

---

## A API do VTurb, testada de verdade (26/08/2026)

Chave configurada por ela, função `vturb` no ar. Não é mais suposição.

**Correção:** eu disse "R$ 989 de Panda em agosto". Errado — agosto foi
**R$ 237,70**; R$ 989 é a soma de abril a agosto. E o Panda é área de membros,
não VSL. Toda VSL está no VTurb, então o campo `player` na tabela `vsls` não
precisa existir.

### Os 162 players, e como separar VSL de aula

`/players/list` devolve `id`, `name`, `duration`, `pitch_time`.

**`pitch_time > 0` é o que separa VSL de aula** — 88 dos 162. Aula e upsell curto
vêm com `pitch_time = 0` porque ninguém configurou pitch neles. Não é campo
pensado para isso, mas é o sinal mais limpo que existe.

E o padrão de nome dela está lá: `VSL 02 H07 Saponaria`, `VSL 02 H06 Saponaria`,
`NT 010 H01 V01`, `VSL 03 H01/H02/H03`. Dezenove players no padrão `H\d\d`.

### Os testes A/B já existem dentro do VTurb

Esta é a descoberta que muda o plano:

```
"Saponaria VSL 02 - VSL 02 H07 V01 vs VSL 02 H06 V01"
  player_ids: [6a7e8ac5…, 6a7e8c4e…]   started_at: 2026-08-14
```

É exatamente o teste h06 × h07 que hoje é anotado à mão no Chat e no Obsidian.
O VTurb guarda os dois players, o split de tráfego e as datas, e
`/comparison_groups/stats` dá as métricas dos dois lados.

**Consequência para `testes_funis`:** os testes de VSL não precisam de vencedor
digitado. Era isso que fazia 10 dos 13 testes concluídos ficarem sem resultado.

### Os cinco campos manuais da análise: todos vêm da API

Medido em `VSL 02 H07 Saponaria`, 01–25/08:

| Campo da planilha | Vem de | Valor |
|---|---|---|
| Play Rate | `play_rate` | 64,35% |
| 1 min | curva | 69,1% |
| Fim da Lead | curva, no segundo que ela marcar | — |
| Pitch | `over_pitch_rate` | 28,67% |
| Final VSL | curva / `total_finished` | 5,8% |

Mais conversões (594) e faturamento por moeda, de brinde.

### A armadilha do `grouped_timed` — quase entrou errado

`/times/user_engagement` devolve `grouped_timed` com `timed` e `total_users`, e
a leitura óbvia — "usuários retidos naquele segundo" — **está errada**. É um
histograma de quanto cada pessoa assistiu no total.

Lida da forma óbvia, a curva dava 6% no primeiro minuto e 47% no final. Retenção
não sobe; foi o absurdo que denunciou o erro.

A curva certa é a soma acumulada de trás para frente: retido em `t` = quem
assistiu **ao menos** `t`. Aí dá 69,1 → 42,8 → 28,7 → 5,8, e bate duas vezes
contra a própria API — o pitch calculado (28,7%) contra `over_pitch_rate`
(28,67%), e o final calculado (993 pessoas) contra `total_finished` (988).

**Quem for implementar: sempre conferir contra `over_pitch_rate`.** É o único
ponto da curva que a API também calcula sozinha, então é o único lugar onde um
erro de leitura aparece sem precisar de olho humano.

---

## Aplicado em 26/08/2026

### A migração consertou dois bugs em produção, não só o modelo

Depois de rodar `20260826t`:

| | Antes | Depois |
|---|---|---|
| Funis com `ativo = true` | 1 | **5** |
| Funis com `produto` preenchido | 9 | **23** |
| Contradições `ativo` × `status` | 4 | 0 |

Os 4 funis que voltaram estavam invisíveis em Produção — `.eq('ativo', true)`
aparece em `dataCache.ts`, `KanbanView.tsx` e `CriativoFormModal.tsx`.

**Correção ao que eu tinha dito:** quando reportei "1 funil ativo", atribuí a
diferença à minha consulta. Não era. O app mostrava 1 também.

### 88 VSLs espelhadas

`vturb sincronizar` → 162 players no VTurb, 88 com `pitch_time > 0` gravados em
`vsls`. Roda de novo sem duplicar: a chave primária é o id do player.

### Casar VSL com REV pelo nome NÃO funciona — não automatizar

Tentei sugerir o vínculo cruzando o nome do projeto com o número do REV dentro
do nome do arquivo. Saíram 4 sugestões e **uma está errada**:

```
Velas Lembrancinhas · REV1  →  "CTA 1 VSL 01 Rev1 Workshop Buque de Velas.mp4"
```

"Velas" é a primeira palavra de *Velas Lembrancinhas* e também aparece em
*Workshop Buquê de Velas*. É exatamente o mesmo erro de prefixo que já tinha me
pegado ao casar `funis.produto` com `ofertas_editores.nome`.

**25% de erro em 4 casos não vira sugestão automática.** O vínculo VSL↔REV é
seleção manual: 23 REVs, um seletor cada, e acaba. O ganho da API não está em
adivinhar o vínculo — está em (a) a lista vir pronta e correta, e (b) os cinco
campos de retenção pararem de ser digitados.

**Complicação real do seletor:** há nomes repetidos entre players diferentes —
"Cópia de VSL 02 Saponaria final.mp4" aparece 3× com ids distintos. São as
cópias que o VTurb cria para teste A/B. O seletor precisa mostrar duração e data
ao lado do nome, senão ela escolhe entre três linhas idênticas.

### Venda ↔ REV: o plano estava errado, e o motivo é interessante

O plano dizia casar por `funis.link_checkout`. Não funciona — os dois lados
falam formatos diferentes:

```
funis.link_checkout   →  checkout.payt.com.br/02cefc91261f5a16798b11ad…
webhook link.url      →  payt.site/qZCw56M
```

E o motivo de fundo importa mais que o formato: **o mesmo link curto é
reapontado quando o REV troca.**

| `payt.site/qZCw56M` | Período | Vendas |
|---|---|---|
| Saponaria Brasil Rev1 | 21/05 → 21/06 | 180 |
| Saponaria Brasil Revisão | 20/06 → 28/07 | 57 |
| Saponaria Brasil Rev5 | 28/07 → 25/08 | 307 |

A URL é a vaga; o **título** é o REV daquele momento. Um campo fixo no funil não
representa isso — por isso o vínculo passa a morar em `funil_checkouts`.

Isso cai bem para a atribuição histórica: como o título é gravado no instante da
venda, uma venda de junho continua sendo do Rev1 mesmo que o link hoje sirva o
Rev5. Não precisa de tabela de vigência.

**Normalizar tirando a query string é obrigatório:** `?cart=` é único por venda.
Com ela seriam 1.281 checkouts; sem ela, 97.

**Cobertura — 51,7% no total, mas é efeito de tempo, não buraco:**

| Mês | Vendas com link |
|---|---|
| jan–fev | 0% |
| mar | 6,4% |
| abr | 26,8% |
| mai | 45,5% |
| **jun** | **95,9%** |
| **jul** | **99,9%** |
| **ago** | **95,9%** |

**A fila de confirmação é curta onde importa:**

| Confirmando os primeiros | Cobre |
|---|---|
| 5 | 55,7% das vendas |
| 10 | 74,0% |
| 20 | 88,7% |
| 30 | 95,2% |

Só 13 dos 97 títulos trazem "Rev" — o resto ela atribui olhando nome, volume e
período, que a view já entrega prontos. E a pista de "Rev" no título entra como
sugestão, nunca como atribuição automática: hoje mesmo o casamento por nome me
traiu ao tentar ligar VSL a REV.
