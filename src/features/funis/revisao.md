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
