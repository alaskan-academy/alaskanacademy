# Recuperação de vendas — linha de base de 09/09/2026

Medição completa do canal de recuperação (carrinho abandonado, pix expirado e
cartão recusado) antes de qualquer alteração. **O objetivo deste documento é
permitir que a mesma medição seja refeita em 09/10/2026 com a mesma lógica**,
para que a comparação seja justa.

Se você só tem cinco minutos: pule para [O que mudar](#o-que-mudar) e para
[Como repetir a medição](#como-repetir-a-medição-em-09102026).

Medido em **09/09/2026**. Exportação de contatos do Voxuy feita em
**10/09/2026 02:23** (`contatos_2026-09-10 022333.xlsx`, 11.182 linhas).

---

## Por que este documento existe

A segunda armadilha do `CLAUDE.md` diz: *criar sem medir*. A recuperação de
vendas tinha três fluxos publicados, 2.840 pessoas dentro deles e nenhuma tela
dizendo o que aquilo virava. Este documento é a coluna de resultado que
faltava, congelada num instante.

Ele não é um relatório de desempenho: é o **instrumento de medição**. O valor
está menos nos números de hoje e mais em conseguir produzir os mesmos números
daqui a um mês, do mesmo jeito.

---

## Como os números foram obtidos

### Fonte 1 — banco (Supabase, projeto `prtkfwwqpcziexgipoqk`)

Toda venda de recuperação é identificada **pela UTM**, não pelo checkout. O
motivo: o checkout "Oferta Relâmpago" não cobre o canal humano, e a UTM cobre
os dois.

| canal | regra | quem dispara |
|---|---|---|
| **automação** | `utm_medium = 'recuperacao'` | link mandado pelo fluxo do Voxuy |
| **humano** | `utm_medium in ('suporte','suportelina')` | atendente mandando link manualmente |

Todas as consultas excluem pedidos de teste com
`pedido_id not like 'TEST%' and pedido_id not like 'LC-%'`, que é o padrão do
projeto.

> **Dívida conhecida:** `suporte` e `suportelina` são a mesma coisa escrita de
> dois jeitos. Enquanto não forem padronizados, **as duas precisam estar em
> toda consulta**, senão a Lina some da conta.

### Fonte 2 — contadores dos nós do Voxuy

Cada nó do fluxo mostra `Executados / Aguardando resposta / Agendados`. Três
coisas importam para ler isso certo:

1. **São cumulativos desde a criação do fluxo**, não do mês. Para o mês, é
   preciso subtrair o snapshot anterior. Por isso a seção
   [Snapshot bruto dos contadores](#5-snapshot-bruto-dos-contadores) existe:
   ela é a subtração do mês que vem.
2. **No DOM, o contador aparece imediatamente ANTES do nó a que pertence.**
   Ler na ordem visual dá um resultado deslocado em um nó. A conferência que
   provou isso: a condição de produto marca 71% Saponaria, e o nó que recebe
   2.262 é o de tag da Saponaria — não o anterior.
3. As percentagens nas condições são arredondadas para inteiro pelo Voxuy.
   `0%` na condição "Compra Aprovada" quer dizer *menos de 0,5%*, não zero
   absoluto.

Como extrair sem ler tudo à mão, com o fluxo aberto no navegador:

```js
// devolve, em ordem, "contador -> primeiras palavras do nó a que pertence"
const t = document.body.innerText.split('\n').map(s => s.trim()).filter(Boolean);
const out = [];
for (let i = 0; i < t.length; i++) {
  if (t[i] === 'Executados') out.push(t[i-1] + ' -> ' + t.slice(i+4, i+12).join(' | ').slice(0, 90));
}
out.join('\n');
```

E, para conferir quem liga em quem (o grafo, que é o que revela buracos de
estratégia):

```js
const ns = [...document.querySelectorAll('.react-flow__node')].map(n => ({
  id: n.getAttribute('data-id'),
  t: n.innerText.replace(/\s+/g, ' ').trim().slice(0, 70),
}));
const es = [...document.querySelectorAll('.react-flow__edge')].map(e => e.getAttribute('data-testid') || e.id);
JSON.stringify({ ns, es });
```

### Fonte 3 — exportação de contatos do Voxuy

`Contatos → exportar` gera um `.xlsx` de 19 colunas. Duas armadilhas técnicas
já resolvidas:

- O arquivo usa **prefixo de namespace** (`<x:row>`, `<x:c>`). Um leitor que
  case `<row` devolve **zero linhas em silêncio**. O leitor correto está em
  `scratchpad/ler-contatos.mjs` e usa `(?:\w+:)?` em toda expressão.
- A coluna **Tags** vem como uma string separada por vírgula, e existe um erro
  de digitação **na origem**: `Reuperação - Fábrica de Lembrancinha` (sem o
  `c`). Qualquer filtro precisa de `Re[cu]?upera[çc][ãa]o` ou a Fábrica some.

**As tags são as etapas do funil.** Cada fase adiciona a sua tag e **remove a
anterior**, então a tag que sobrou diz onde a pessoa parou. Mesmo assim, os
contadores do Voxuy são a fonte preferida, porque contam execuções e a
planilha conta o retrato de hoje.

### Regra de atribuição de custo

**Custo do canal = Voxuy (integral) + WhatsApp/Meta (integral) + OpenAI
(integral).**

Isso é deliberadamente conservador: o Voxuy também roda onboarding e crossell,
e o OpenAI serve o negócio inteiro. Atribuir tudo à recuperação produz uma
margem que é **piso**, não estimativa. A alternativa — ratear por execuções —
depende de um denominador que muda de mês para mês e destruiria a comparação.

> **Correção em relação à análise anterior:** numa conversa anterior usei
> R$ 138,33 de OpenAI em agosto, que era um rateio. Aqui uso o valor cheio de
> **R$ 293,63**. A regra do valor cheio é a que vale daqui para a frente.

| ferramenta | como sai do banco |
|---|---|
| Voxuy | `transacoes` com `descricao ilike '%voxuy%'` |
| OpenAI | `transacoes` com `descricao ilike '%openai%' or '%chatgpt%'` |
| WhatsApp/Meta | **não está no banco** — ver abaixo |

**O custo de conversa do WhatsApp não existe em `transacoes`.** Procurei por
`%whats%`, `%meta%`, `%cloud api%`, `%twilio%`, `%360dialog%`, `%gupshup%`: zero
linhas. O valor de agosto (**R$ 513,88**) veio do faturamento do Meta e é
**entrada manual**. Enquanto ele não tiver uma linha própria no financeiro,
todo mês essa medição precisa desse número digitado à mão — e ele precisa ser
anotado aqui embaixo.

---

## A linha de base

### 1. O bolso parado

Pedidos que não foram pagos, **excluindo os próprios pedidos de recuperação**
(senão a segunda tentativa entra na conta da primeira).

```sql
select to_char(data_venda,'YYYY-MM') as mes,
  count(*) filter (where status='expirada')  as pix_expirado,
  count(*) filter (where status='cancelada') as cartao_cancelado,
  count(*) filter (where status in ('expirada','cancelada')) as bolso_parado,
  round(sum(valor_total) filter (where status in ('expirada','cancelada'))::numeric,2) as valor_parado,
  count(distinct cliente_id) filter (where status in ('expirada','cancelada')) as pessoas
from vendas
where pedido_id not like 'TEST%' and pedido_id not like 'LC-%'
  and coalesce(utm_medium,'') not in ('recuperacao','suporte','suportelina')
  and data_venda >= '2026-05-01'
group by 1 order by 1;
```

| mês | pix expirado | cartão recusado | total | valor parado | pessoas |
|---|---:|---:|---:|---:|---:|
| 2026-05 | 537 | 116 | 653 | R$ 55.737,16 | 562 |
| 2026-06 | 194 | 33 | 227 | R$ 20.852,09 | 206 |
| 2026-07 | 316 | 137 | 453 | R$ 45.090,91 | 373 |
| 2026-08 | 507 | 142 | 649 | R$ 72.359,89 | 554 |
| 2026-09 (até dia 9) | 147 | 67 | 214 | R$ 26.204,09 | 178 |

### 2. O funil da automação

Desde **17/06/2026**, quando os fluxos por produto foram criados. Cada célula
é o contador `Executados` do nó correspondente.

| etapa | Saponaria | Buquê | Fábrica | total | % de quem entrou |
|---|---:|---:|---:|---:|---:|
| entrou no fluxo do produto | 2.241 | 280 | 319 | **2.840** | 100% |
| **msg 1** — "houve uma interrupção" | 2.241 | 280 | 319 | 2.840 | 100% |
| **msg 2** — "dúvidas comuns" | 1.862 | 216 | 246 | 2.324 | 82% |
| **msg 3** — oferta relâmpago | 1.570 | 173 | 202 | 1.945 | 68% |
| **clicou "Link Atualizado"** | 234 | 37 | 51 | **322** | 11,3% |
| abriu um pedido (banco) | 78 | 11 | 14 | 103 | 3,6% |
| **pagou** (banco) | 56 | 11 | 10 | **77** | **2,7%** |
| virou "Lead Perdido" | 1.274 | 131 | 147 | 1.552 | 55% |

As quatro dobradiças, que são o que interessa acompanhar:

| dobradiça | Saponaria | Buquê | Fábrica | **total** |
|---|---:|---:|---:|---:|
| entrou → viu a msg 3 | 70,1% | 61,8% | 63,3% | **68,5%** |
| viu a msg 3 → pediu o desconto | 14,9% | 21,4% | 25,2% | **16,6%** |
| **pediu o desconto → abriu pedido** | 33,3% | 29,7% | 27,5% | **32,0%** |
| abriu pedido → pagou | 71,8% | 100% | 71,4% | **74,8%** |

O **Fluxo Geral** (o roteador, criado 15/05) marca 5.918 execuções no atraso de
7 minutos e 3.150 na condição de produto. A diferença de 2.768 é do período
anterior a 17/06, quando a estrutura era outra — por isso a base é 2.840 e não
5.918. Isso não é perda: é histórico de outra configuração.

### 3. Receita e margem

```sql
select to_char(data_venda,'YYYY-MM') as mes,
  case when utm_medium='recuperacao' then 'automacao' else 'humano' end as canal,
  count(*) as pedidos,
  round(sum(valor_total)::numeric,2) as bruto,
  round(sum(taxa_plataforma_valor)::numeric,2) as taxa_payt
from vendas
where pedido_id not like 'TEST%' and pedido_id not like 'LC-%'
  and utm_medium in ('recuperacao','suporte','suportelina')
  and status='aprovada'
group by 1,2 order by 1,2;
```

**Líquido = bruto − taxa da Payt − 9% de Simples sobre o bruto.** Os 9% saem de
`configuracoes.imposto_simples_nacional_pct` (conferido em 09/09: 9,0000 para
as duas empresas e para a linha geral). A taxa da Payt é o valor real de cada
venda, não uma alíquota média — ela varia de 6,3% a 7,3% conforme o meio de
pagamento.

| mês | canal | pedidos | bruto | taxa Payt | **líquido** |
|---|---|---:|---:|---:|---:|
| 2026-05 | automação | 1 | 45,14 | 3,25 | **37,83** |
| 2026-05 | humano | 11 | 529,76 | 37,37 | **444,71** |
| 2026-06 | automação | 4 | 193,66 | 13,30 | **162,93** |
| 2026-06 | humano | 25 | 1.526,54 | 100,25 | **1.288,90** |
| 2026-07 | automação | 26 | 1.800,47 | 113,82 | **1.524,61** |
| 2026-07 | humano | 27 | 2.316,85 | 139,58 | **1.968,75** |
| 2026-08 | automação | 32 | 2.770,72 | 166,60 | **2.354,76** |
| 2026-08 | humano | 56 | 4.912,85 | 295,02 | **4.175,67** |
| 2026-09 (até 9) | automação | 16 | 1.531,66 | 90,46 | **1.303,35** |
| 2026-09 (até 9) | humano | 14 | 1.142,89 | 69,01 | **971,02** |

Custos:

| mês | Voxuy | OpenAI | WhatsApp/Meta | total |
|---|---:|---:|---:|---:|
| 2026-05 | 644,47 | 256,82 | *não anotado* | 901,29 |
| 2026-06 | 324,88 | 261,18 | *não anotado* | 586,06 |
| 2026-07 | 321,72 | 289,76 | *não anotado* | 611,48 |
| **2026-08** | **326,46** | **293,63** | **513,88** | **1.133,97** |
| 2026-09 (parcial) | 309,39 | 43,17 | *a anotar* | 352,56 |

**Agosto, o único mês fechado com custo completo:**

| | valor |
|---|---:|
| líquido da automação | R$ 2.354,76 |
| líquido do humano | R$ 4.175,67 |
| **líquido total do canal** | **R$ 6.530,43** |
| custo das ferramentas | R$ 1.133,97 |
| **margem do canal** | **R$ 5.396,46** |
| **margem só da automação** | **R$ 1.220,79** (ROI 2,1×) |

O canal humano não tem o custo da pessoa nesta conta. A margem de R$ 5.396,46
é do canal com as ferramentas pagas, não com a folha.

### 4. Entrega e leitura

Dos 2.857 contatos com tag de recuperação na exportação de 10/09:

| status da última mensagem | contatos | % |
|---|---:|---:|
| Lido | 1.594 | 55,8% |
| Entregue (não lido) | 749 | 26,2% |
| **Erro — Message Undeliverable** | 234 | 8,2% |
| Enviado | 129 | 4,5% |
| **Erro — healthy ecosystem engagement** | 112 | 3,9% |
| Erro — número não está no WhatsApp | 28 | 1,0% |
| outros erros | 3 | 0,1% |
| vazio | 8 | 0,3% |

**377 contatos (13,2%) nunca receberam a mensagem.** Os 112 do
*"healthy ecosystem engagement"* são o freio de qualidade do Meta.

Os três templates estão com **Qualidade pendente**. A msg 3 — a única com
oferta — é a única categorizada como **Marketing**; as outras duas são
**Utilidade**.

Status da automação, entre os mesmos 2.857:

| status | contatos |
|---|---:|
| Concluído | 1.949 |
| **Cancelado** | 519 |
| Agendado | 232 |
| Aguardando resposta | 150 |
| Erro | 7 |

### 5. Snapshot bruto dos contadores

**Ler em 09/10/2026 e subtrair destes valores.** Os `id` são os do
`data-id` de cada nó no react-flow e são estáveis entre visitas.

#### Fluxo Geral - Recuperação (criado 15/05)

| nó | executados |
|---|---:|
| Atraso 7 minutos | 5.918 |
| Condição de produto (71% Sap · 0% Velas · 9% Buquê · 10% Fábrica · 8% nenhum) | 3.150 |
| Condição "já comprou?" — Saponaria | 2.278 |
| Condição "já comprou?" — Velas Perfeitas | 0 |
| Condição "já comprou?" — Workshop Buquê | 291 |
| Condição "já comprou?" — Fábrica | 329 |
| Adicionar tag + trocar de fluxo — Saponaria | 2.262 |
| Adicionar tag + trocar de fluxo — Velas Perfeitas | 0 |
| Adicionar tag + trocar de fluxo — Workshop Buquê | 282 |
| Adicionar tag + trocar de fluxo — Fábrica | 321 |

#### Saponaria - Recuperação (criado 17/06)

| id | nó | executados | outros |
|---|---|---:|---|
| 140351 | msg 1 (`verificacao_instabilidade_acesso`) | 2.241 | |
| 140333 | Fase 1 (tag Recuperação 1 + fecha conversa + CRM) | 2.241 | |
| 140348 | Atraso 1 dia (seg–sex, 09:00–16:00) | 2.241 | |
| 140345 | Condição compra/recusa | 1.914 | 68 agendados · 0% / 2% / 98% |
| 140335 | CRM Lead Ganho | 5 | |
| 140336 | CRM Oferta Recusada | 40 | |
| 140352 | msg 2 (`suporte_ajuda_etapa2`) | 1.862 | 7 agendados |
| 140334 | Fase 2 | 1.861 | 2 agendados |
| 140349 | Atraso 2 dias (seg–sex, 09:00–16:00) | 1.860 | |
| 140346 | Condição compra/recusa | 1.733 | 85 agendados · 0% / 1% / 99% |
| 140337 | CRM Lead Ganho | 0 | |
| 140338 | CRM Oferta Recusada | 25 | |
| 140340 | Fase 3 | 1.707 | 2 agendados |
| 140353 | **msg 3** (Template 13, Marketing) | **1.570** | 121 aguardando · botão **15%** · sem resposta 81% · outra coisa 4% |
| 140344 | CRM Lead Perdido (timeout de 3 dias) | 1.274 | |
| 140350 | **Mensagem "Link 20% OFF"** | **234** | |
| 140339 | Fase 4 (tag Desconto Aceito + **fecha conversa** + CRM Aceitou Oferta Final) | 234 | |
| 140347 | Condição compra/recusa | 234 | **0% / 0% / 100%** |
| 140341 | CRM Lead Ganho | 0 | |
| 140342 | CRM Oferta Recusada | 0 | |
| 140343 | **CRM Lead Perdido** | **234** | |

#### Workshop Buquê - Recuperação

| nó | executados |
|---|---:|
| msg 1 / Fase 1 / Atraso 1 dia | 280 |
| Condição 1 | 223 (7 agendados) · Lead Ganho 1 · Recusada 3 |
| msg 2 / Fase 2 / Atraso 2 dias | 216 |
| Condição 2 | 197 · Lead Ganho 0 · Recusada 0 |
| Fase 3 | 197 |
| **msg 3** | **173** (20 aguardando) |
| Lead Perdido (timeout) | 131 |
| **Link 20% OFF / Fase 4 / Condição 3 / Lead Perdido** | **37** |

#### Fábrica de Lembrancinhas - Recuperação

| nó | executados |
|---|---:|
| msg 1 / Fase 1 / Atraso 1 dia | 319 |
| Condição 1 | 249 · Lead Ganho 1 · Recusada 2 |
| msg 2 / Fase 2 / Atraso 2 dias | 246 |
| Condição 2 | 221 |
| Fase 3 | 221 |
| **msg 3** | **202** |
| Lead Perdido (timeout) | 147 |
| **Link 20% OFF / Fase 4 / Condição 3 / Lead Perdido** | **51** |

O fluxo **Velas Perfeitas - Recuperação** está publicado e zerado: o roteador
manda 0% para ele. As 2 vendas com `utm_campaign=velas` (R$ 127,14) são de
maio, anteriores à divisão por produto.

---

## Diagnóstico

### O maior buraco: depois de mandar o link, o fluxo acaba

Conferido no grafo do react-flow, aresta por aresta. Depois que a pessoa clica
em "Link Atualizado":

```
[botão] → Mensagem "Link 20% OFF" (234)
        → Fase 4: tag Desconto Aceito + fecha conversa + CRM "Aceitou Oferta Final" (234)
        → Condição "comprou?" (234) → 0% comprou · 0% recusou · 100% nenhum
        → CRM Lead Perdido (234)
```

**Não há mais nada depois disso.** Nenhum lembrete, nenhum "conseguiu abrir?",
nenhum aviso de vencimento. A pessoa mais quente da base inteira recebe um link
cru e é deixada sozinha.

> **O "Fechar conversa" não é o problema** — quando a contato responde, o
> chamado reabre sozinho. Ele só serve para não poluir a central de
> atendimento. Vale para a Fase 1, a 2, a 3 e a 4 igualmente.

O que **é** problema nesse trecho, e são duas coisas diferentes que não devem
ser confundidas:

**a) Dinheiro — não existe follow-up.** É isto que custa as vendas. O último
contato do fluxo é a mensagem do link, e ela é a pior escrita de todas
(ver [A mensagem do link](#a-mensagem-do-link-depois-do-botão)).

**b) Enxergar — o CRM mente sobre essas pessoas.** Não existe nó de atraso
entre a Fase 4 e a condição, então ela é avaliada milissegundos depois de o
link sair; ninguém comprou ainda, 100% cai no "nenhum" e vai para Lead Perdido.
Os contadores provam sozinhos que a leitura está errada: **"Lead Ganho" marca
0 e "Lead Perdido" marca 234 — sendo que 56 dessas pessoas pagaram.** Quem
abrir o quadro do CRM não vê ninguém em "Aceitou Oferta Final" e vê 234
perdidos que não estão perdidos. Isso não faz a cliente deixar de comprar; faz
o time deixar de ver.

O efeito no número:

- **322 pessoas pediram o desconto. 219 nunca abriram um pedido.**
- Quem abre, paga: 74,8%. O preço e a oferta não são o problema.
- São ~107 mãos levantadas por mês, ~3 a 4 por dia — perfeitamente atendível
  por uma pessoa, e o canal humano converte melhor que a automação
  (122 pedidos contra 78 desde junho).

Se a dobradiça "pediu → abriu pedido" fosse de 32% para 60%, seriam ~145 pagos
no lugar de 77 — 68 vendas a mais em 2,8 meses de operação (17/06 a 09/09). A
**R$ 80,27 de ticket médio** (6.341,65 ÷ 79) e 85% de líquido, isso é
**~R$ 1.657/mês líquido a mais** — sobre uma margem de automação que hoje é de
R$ 1.220,79/mês. Só esse ajuste mais que dobra a margem do canal automatizado.

### As copies

#### msg 1 — `verificacao_instabilidade_acesso` · Utilidade · +7 minutos

> Olá, Primeiro nome! Tudo bem? / Vi aqui no sistema que houve uma interrupção
> quando você tentou concluir a matrícula na Handify, para o Produto. /
> Passando só para saber se o link deu algum erro ou se você precisa de uma
> ajuda para conseguir entrar na turma. / Se tiver qualquer dúvida, me dá um
> toque por aqui que a gente resolve, tá?

**O que funciona:** chega a 100%, o pretexto é de suporte e não de venda (por
isso cabe em Utilidade, que é mais barata e sofre menos bloqueio), o tom é de
gente, e 7 minutos é a hora certa — o pix ainda nem expirou.

**O que quebra:**

- **A automação não reage a quem responde.** Quem responde reabre o chamado
  sozinho e cai no atendimento humano — isso funciona. Mas o fluxo em si não
  tem ramo de resposta aqui: segue para o atraso de 1 dia igual, e a pessoa que
  respondeu recebe a msg 2 no dia seguinte como se não tivesse dito nada. (A
  msg 3 tem esse ramo; a 1 e a 2 não.)
- "matrícula na **Handify**" — a pessoa comprou "Saponaria Brasil". Pode não
  reconhecer o nome da plataforma.
- Não diz o valor nem mostra o produto. É a mensagem de maior alcance do fluxo
  e é a que menos informa.

#### msg 2 — `suporte_ajuda_etapa2` · Utilidade · +1 dia útil

> Dando continuidade ao seu contato sobre o Produto , reunimos aqui as
> principais informações solicitadas por novos alunos sobre o funcionamento da
> plataforma: / Formato das Aulas: … / Disponibilidade do Acesso: Liberação
> imediata via e-mail pós-confirmação, com vigência por tempo indeterminado
> (acesso vitalício). / … nossa equipe está à disposição.

**O que quebra:**

- **Responde uma pergunta que ninguém fez.** Quem abandonou um pix não parou
  por não saber o formato das aulas. Parou por preço, medo ou distração.
- **Troca de pessoa no meio da conversa.** A msg 1 é "Vi aqui no sistema", "me
  dá um toque". A msg 2 é "reunimos", "nossa equipe está à disposição". Quem
  estava falando sumiu.
- **Não é linguagem de WhatsApp.** "Disponibilidade do Acesso: Liberação
  imediata via e-mail pós-confirmação, com vigência por tempo indeterminado" é
  texto de manual.
- **Não tem pergunta nem botão.** Termina em "à disposição" — nada para
  responder, nada para clicar.
- Erro visível que sai no WhatsApp: `sobre o Produto ,` — espaço antes da
  vírgula.

É a mensagem mais cara do fluxo em atenção gasta e a que menos produz.

#### msg 3 — `Template 13` "Oferta relâmpago com Desconto" · **Marketing** · +3 dias úteis

> Este é o meu ultimo contato, é apenas para um Lembrete. / Estamos com uma
> ação especial acontecendo por aqui e, como vi que você já tinha interesse no
> Produto, consegui liberar um benefício para que você não fique de fora desta
> vez. / Esta condição é exclusiva e aparece apenas neste link de atualização
> … clique em "Link Atualizado". / Espero que essa notícia alegre o seu dia!
>
> **[ Link Atualizado ]** → 15% clicam · 81% não respondem · 4% respondem outra coisa

**É a única mensagem do fluxo que funciona.** Tem botão (fricção zero),
benefício e exclusividade. 15% a 25% clicam.

**O que quebra:**

- **Não diz qual é o benefício.** "consegui liberar um benefício" — quanto? A
  pessoa clica no escuro. Isso *ajuda* o clique e *atrapalha* o que vem
  depois: parte dos 219 que sumiram pode ter clicado, visto "20%" e achado
  pouco. O clique alto com conversão baixa é a assinatura desse padrão.
- "Este é o meu **ultimo** contato" — sem acento, e é uma despedida colocada
  logo antes de pedir uma ação. "é apenas para um **L**embrete" tem maiúscula
  no meio da frase e diminui o que vem em seguida.
- "Espero que essa notícia alegre o seu dia!" não combina com o resto.
- **É a única categorizada como Marketing.** É a mais cara, a que entra na
  cota de qualidade do Meta e a mais provável de gerar o erro
  *healthy ecosystem engagement* — que já atingiu 112 contatos.

#### A mensagem do link (depois do botão)

> https://payt.site/wGCBMxg?utm_source=whatsapp&utm_medium=recuperacao&utm_campaign=saponaria
> / Com o link acima você consegue garantir 20% de desconto 😊 / Não se esqueça
> que é por tempo limitado.

**É a mensagem mais importante do fluxo e a pior escrita.** É o que 322
pessoas que disseram "sim" recebem — e é a última coisa que recebem.

- **Link cru na primeira linha, motivo na segunda.** Invertido. Um
  `payt.site/wGCBMxg` sozinho, vindo de um número comercial, parece golpe.
- **Sem produto, sem valor antigo, sem valor novo.** "20% de desconto" é
  abstrato; "de R$ 79,90 por R$ 63,92" é concreto.
- **"por tempo limitado" sem prazo não é escassez, é ruído.** Sem data e hora,
  não cria urgência nenhuma.
- **Nada depois.** Sem lembrete, sem "conseguiu abrir?", sem aviso de
  vencimento. O fluxo termina aqui, e quem não voltou sozinho não é procurado
  mais.

### O tempo

| mensagem | quando | janela |
|---|---|---|
| msg 1 | +7 minutos | qualquer hora |
| msg 2 | +1 dia útil | seg–sex, 09:00–16:00 |
| msg 3 (a oferta) | +3 dias úteis | seg–sex, 09:00–16:00 |
| corte | +3 dias de espera de resposta | — |

Duas consequências:

1. **A oferta chega no terceiro dia útil.** Quem abandona na sexta às 20h
   recebe a msg 2 na segunda e a msg 3 na quarta — cinco dias depois. A
   intenção de compra já morreu.
2. **A janela 09:00–16:00 de segunda a sexta exclui exatamente quando as
   pessoas compram**: noite e fim de semana. O carrinho é abandonado às 21h de
   um sábado e a conversa só continua na segunda de manhã.

Na leitura de comportamento feita antes, o canal tem dois picos: **1 a 6 horas**
e **3 a 7 dias**. Hoje **não existe nenhuma mensagem na janela de 1 a 6 horas**.

### As objeções reais, lidas nas conversas de agosto

**Base: agosto inteiro.** Todas as conversas arquivadas de 01/08 a 31/08/2026 —
**4.364**, das quais **1.389 têm tag de recuperação**. Dessas, **436 têm ao
menos uma mensagem escrita pela cliente** (875 mensagens no total), e **386
sobram** depois de tirar resposta automática de bot de outra empresa e
saudação pura ("oi", "obrigada", "bom dia").

> **Esta seção substitui uma leitura anterior de 33 conversas recentes, e
> corrige duas conclusões dela.** Ver [Correções](#correções-feitas-depois-da-primeira-versão).

Classificação por palavra-chave, **multirrótulo** (uma conversa pode carregar
mais de uma objeção, então os números somam mais de 100%). São **pisos**: 130
das 386 não casaram com nenhuma regra e parte delas tem objeção que a regra não
pegou. As falas estão sem nome, telefone e e-mail.

| objeção | conversas | % de 386 |
|---|---:|---:|
| **O ato de pagar** (união das três abaixo) | **121** | **31,3%** |
| ├ falha técnica no pagamento | 78 | 20,2% |
| ├ quer o link/pix pelo WhatsApp | 30 | 7,8% |
| └ preço do checkout ≠ preço anunciado | 25 | 6,5% |
| **Dúvida sobre o produto** | 77 | 19,9% |
| └ *dessas, sobre o que a msg 2 responde* | *12* | *3,1%* |
| **Dinheiro e prazo** | 69 | 17,9% |
| Pós-compra (acesso, estorno) | 35 | 9,1% |
| Sem interesse / já tem / comprou em outro lugar | 26 | 6,7% |
| Medo de golpe | 15 | 3,9% |

#### O achado principal: o preço muda no caminho até o pagamento

Não estava na amostra pequena e é o defeito mais **específico e repetido** de
todos. A pessoa vê um valor no anúncio, chega no checkout e o total é outro:

> *"O valor inicial foi 37, quando cliquei para pagar virou 256."*
> *"Oferecem o curso por 67,00 e qdo vai finalizar está por 180,00."*
> *"No anúncio o valor era 97 reais e no PIX aparece 124 reais."*
> *"No anúncio estava de 63 reais e quando fui pagar de 85."*
> *"O valor dobrou ao fazer o Pix, não interesso mais, obrigada!"*
> *"Já tentei fazer 3× o pagamento, mas o valor q aparece nao condiz…"*
> *"Foi porque escolhi um valor e foi o dobro."*
> *"Gerei o pagamento e não vi o desconto."*

A causa são os **order bumps** — mas não porque venham marcados: **eles não
vêm** (conferido com a Jessica em 10/09). O que acontece é que a pessoa marca,
e o total só se materializa na hora do pix. Medido em junho–agosto, quem leva
bump sai de R$ 67 para **R$ 122 de ticket**.

> *"No caso esses outros cursos são opcionais? Não entendi…"*
> *"Tudo aquilo que cliquei, tenho certeza que vou precisar."*
> *"Pensei q eles sairiam todos por aquele preço abaixo."*
> *"Hummmm, e muita coisa pra comprar."*

E o efeito não para no preço — **é o que cria a suspeita de golpe**:

> *"Realmente, o valor mudou ao digitar para o pagamento. **Já não mim passou
> segurança.**"*

Isso liga as duas pontas: a linha de "medo de golpe" (3,9%) não é desconfiança
solta, é consequência do preço mudar. E o banco entra junto:

> *"O cartão bloqueou dizendo que era fraude."*
> *"Não irei fazer o pix, meu banco avisou que era conta falsa."*

**Nenhuma mensagem do fluxo de recuperação toca nesse assunto.** A pessoa
abandona por causa do valor e recebe, um dia depois, um texto sobre o formato
das aulas.

#### Falha técnica (20,2%) — três causas concretas

**Pix** é a mais citada: *"Não visualizo a Chave PIX"* · *"Não consigo copiar e
colar pra fazer o pix"* · *"Deu erro quando foi copiar o código de barra via
pix"* · *"Cliquei em pix e não aparece nada"* · *"Não gerou o Pix e saiu fora a
página"* · *"O código de pagamento não passou"*.

**Captcha** — duas falas descrevem exatamente a mesma tela, e é um bloqueio
invisível num público de mais idade:

> *"Quando vou entrar para pagar aparece os quadrinhos pra gente marcar os que
> tem carros."*
> *"Não consegui, apareceu uma tela falando pra clicar onde tinha ônibus 🤷🏽‍♀️"*

**CPF** — resistência a informar, que trava o checkout:

> *"Não vou colocar meu cpf. Pago o pix. Porque CPF????"*
> *"Não gostaria de informar meu cpf."*

#### Dúvida de produto (19,9%) — família certa, respostas erradas

Aqui está a correção mais importante em relação à leitura anterior: **dúvida de
produto é o maior rótulo isolado**, não o sexto. Eu estava errado sobre isso.

Mas o que a msg 2 responde — formato das aulas, acesso vitalício, canal de
suporte — cobre **12 das 386 conversas (3,1%)**. As outras são práticas, e o
fluxo não diz uma palavra sobre elas:

> *"É incluso somente o curso? E materiais?"*
> *"Nesse curso vou receber o material ou só aulas com o passo a passo?"*
> *"Onde consigo comprar os materiais pra iniciar?"*
> *"Então os modelos de embalagem não estão incluídos?"*
> *"O curso ensina a calcular preço das peças?"*
> *"Gostaria de saber o endereço dos fornecedores."*

São 26 conversas — mais que o dobro das 12 — sobre **material, fornecedor e o
que está incluído**. É a dúvida de quem vai *fazer e vender*, não de quem vai
*assistir*.

#### Dinheiro e prazo (17,9%)

Continua grande e continua sem ramo nenhum no fluxo:

> *"Só poderei comprar no pagamento dia 05/09."* · *"Estou no aguardo receber
> minha aposentadoria."* · *"Meu cartão foi bloqueado e estou esperando outro."*
> *"Vou esperar virar a fatura do meu cartão e volto a entrar em contato."*
> *"Farei minha inscrição em setembro na segunda semana, pode ser?"*
> *"Não fiz, porque só vou conseguir efetuar a matrícula dia 01/09."*

Repare que várias **marcam uma data sozinhas**. O fluxo ignora e manda a oferta
relâmpago no terceiro dia.

#### Querem pagar pelo WhatsApp (7,8%)

> *"Posso fazer a matrícula por aqui mesmo???"* · *"Manda a chave pix"* ·
> *"Me envie o pix de vcs para efetuar o pagamento"* · *"Não consegui abrir o
> link. Tem como me enviar de outra forma?"*

#### Duas coisas menores que valem registro

**Hotmart.** Os mesmos cursos aparecem lá, e isso gera confusão e compra
duplicada: *"Essas aulas eu vejo é pela hotmart?"* · *"Eu já tenho esse curso
pela hotmart"* · *"Então paguei duas vezes pelo mesmo conteúdo."*

**Boleto.** Duas pedem: *"Vcs tem forma de pago em boleto?"* · *"O pagamento
pode ser por boleto?"*

### A estratégia

- **Três mensagens, duas de suporte e uma de oferta**, com a oferta por último.
  A que converte é a terceira, e é a que menos gente vê (68%).
- **Sem segmentação por valor.** Um carrinho de R$ 50 e um de R$ 500 recebem a
  mesma sequência e os mesmos 20%. A faixa R$ 50–100 é a maior (445 pessoas) e
  a que pior converte (4,5%).
- **Sem distinção entre pix expirado e cartão recusado.** São pessoas
  diferentes: quem teve o cartão recusado *quis* e não conseguiu, e converte
  bem melhor (11,7% contra 4,6%). Para essa pessoa a solução não é desconto —
  é "tenta outro cartão" ou "te mando um pix". Hoje recebe o mesmo texto.
- **Reentrada mata a sequência (hipótese a testar).** Os três fluxos estão em
  "Cancelar outros + controle de reenvio". Há **519 automações canceladas**
  entre os contatos de recuperação, e a queda de 2.840 para 1.945 entre a
  msg 1 e a msg 3 é de 895. Se cancelar de fato reinicia a sequência a cada
  novo abandono, **quem abandona mais de uma vez — a pessoa mais interessada —
  recebe a msg 1 repetidamente e nunca chega à oferta.** Isso ainda não foi
  provado; a forma de provar está em [Como repetir](#como-repetir-a-medição-em-09102026).

---

## O que mudar

Em ordem de dinheiro por esforço. O item 0 nasce do preço, que é a maior causa
isolada de abandono em agosto — mas a ação fica **na mensagem**, porque o
checkout é da plataforma. Os itens 1 a 3 não custam nada além de editar o
fluxo.

### 0. Oferecer o carrinho **sem os bumps** na recuperação

> **Este item foi reescrito em 10/09.** A primeira versão mandava mexer no
> checkout — tirar bump pré-marcado, mostrar o total, afrouxar o captcha. Duas
> coisas derrubaram isso: **nenhum bump vem pré-marcado** (já era assim), e o
> **checkout é da plataforma**, sem espaço para essas mudanças. E, quando fui
> medir, a recomendação estava errada também no mérito.

**Os order bumps não são o vilão. Medido, junho a agosto, 5.581 pedidos:**

| cesta | pedidos | pagos | ticket | **valor esperado por pedido** |
|---|---:|---:|---:|---:|
| com bump | 2.372 | 69,4% | R$ 121,95 | **R$ 84,63** |
| sem bump | 3.209 | 79,3% | R$ 67,24 | **R$ 53,33** |

O bump derruba a conversão em **10 pontos** e mesmo assim vale **+59% por
pedido**. Tirar bump seria jogar fora R$ 31 por pedido. **Não tire.**

Só que o outro lado da conta é o que alimenta a recuperação: **726 carrinhos
com bump foram abandonados**, e o curso sozinho dentro deles soma
**R$ 45.545,05**. Essas pessoas quiseram o curso e travaram no total do
pacote — é literalmente o que elas escrevem:

> *"O valor inicial foi 37, quando cliquei para pagar virou 256."*
> *"É porque não vou querer os debaixo."*
> *"Tudo aquilo que cliquei, tenho certeza que vou precisar se quiser…"*
> *"No caso esses outros cursos são opcionais? Não entendi…"*

**A ação, que não depende da plataforma:** criar um link de checkout **só com o
curso, sem bumps**, e usá-lo na recuperação de quem abandonou carrinho com
bump. Em vez de 20% sobre R$ 127, oferecer **o curso limpo por R$ 67** — o
preço pelo qual a pessoa entrou.

> Vi que o seu carrinho ficou em R$ 127 com os extras. Se preferir, dá pra
> levar **só o curso por R$ 67** e pegar os extras depois. Link aqui.

*Vale:* atinge um bolso de R$ 45.545 em 3 meses que hoje recebe uma oferta com
o preço que causou o abandono. E não custa conversão de quem estava disposto ao
pacote, porque só muda a mensagem de quem já desistiu dele.

### 0b. O que depende da Payt — pedir, não implementar

Não dá para mudar sozinha; vale abrir chamado com a plataforma, porque cada um
apareceu nas conversas de agosto:

- **O captcha na hora de pagar.** Duas clientes descrevem a mesma tela:
  *"aparece os quadrinhos pra gente marcar os que tem carros"*, *"uma tela
  falando pra clicar onde tinha ônibus"*. Num público de mais idade, encerra a
  compra.
- **O pix que não copia.** *"Não visualizo a Chave PIX"* · *"Não consigo copiar
  e colar pra fazer o pix"* · *"Deu erro quando foi copiar o código de barra
  via pix"* · *"Cliquei em pix e não aparece nada"*.
- **O total só aparecer no fim.** Se algum dia der para mostrar o total ao lado
  de cada bump, é a correção de raiz do item 0.

Enquanto não vier, **a mensagem de recuperação é o remendo** — e ela está sob
seu controle.

### 1. Dar sequência depois do link — **é aqui que está o dinheiro**

Hoje não existe nada. Colocar:

- **+2 horas:** "Conseguiu abrir o link? Se der qualquer erro me chama que eu
  resolvo por aqui."
- **+20 horas:** "Seu desconto vale até hoje às 23h59 — depois disso o valor
  volta ao normal."
- Só então, e só aí, a condição de compra e o Lead Perdido.

*Vale:* é o que transforma um clique numa compra. Junto com o item 2, é a
origem dos 219.

### 2. Reescrever a mensagem do link

Ordem certa e informação concreta:

1. o que é e por quanto — "Consegui liberar o **Saponaria Brasil** por
   **R$ 63,92** no lugar de R$ 79,90"
2. até quando — data e hora de verdade
3. só então o link
4. e uma linha de segurança: "é o mesmo checkout da Payt de antes"

*Vale:* é a mensagem que 100% dos 322 leem e a única que hoje não vende nada.

### 3. Tirar do "Lead Perdido" quem aceitou o desconto — é enxergar, não vender

Colocar o atraso e a sequência do item 1 **antes** da condição de compra. Assim
ela é avaliada quando já dá para ter comprado, e quem comprou cai em "Lead
Ganho" em vez de "Lead Perdido".

Isso **não traz venda nenhuma sozinho** — a cliente nem fica sabendo. O que ele
resolve é o quadro do CRM dizer a verdade: hoje 234 pessoas estão em "Lead
Perdido" e 56 delas pagaram, enquanto "Lead Ganho" marca zero. Sem isso, no mês
que vem não há como olhar o quadro e saber se os itens 1 e 2 funcionaram.

O "Fechar conversa" pode ficar como está em todas as fases: a resposta da
cliente reabre o chamado sozinha, e ele só serve para não poluir a central.

*Vale:* é o que torna o resto mensurável.

### 4. Antecipar a oferta e abrir a janela

- msg 2 para **+3 horas** em vez de +1 dia útil (é a janela que hoje está vazia
  e onde o canal pica).
- msg 3 para **+1 dia** em vez de +3 dias úteis.
- Estender a janela para **seg–sáb, 09:00–20:00**.

*Vale:* 32% das pessoas nunca chegam à msg 3. Encurtar o caminho até ela é o
segundo maior lever depois do desconto.

### 5. Trocar o conteúdo da msg 2 — que a pessoa escolha a objeção

A msg 2 explica plataforma, acesso vitalício e canal de suporte. Isso responde
**12 das 386 conversas de agosto (3,1%)**. O ato de pagar sozinho é **31,3%**,
e dinheiro e prazo é **17,9%** — nenhum dos dois tem resposta no fluxo.

Nenhum texto único cobre três objeções diferentes. O que cobre é **perguntar**,
com botões, e ramificar. Continua em **Utilidade**, porque continua sendo
suporte:

> Oi, {{nome}}! Sou eu de novo.
> Só pra eu te ajudar do jeito certo — o que rolou com o seu pedido do
> {{produto}}?
>
> **[ Deu problema no pagamento ]  [ Quero pagar depois ]  [ Fiquei com dúvida ]**

**Ramo "Deu problema no pagamento"** — 31,3% da base

> Consigo resolver por aqui mesmo. Foi no **cartão** ou no **pix**?

Cartão → oferecer pix. Pix → **gerar um novo na hora, dentro da conversa** —
7,8% pedem exatamente isso (*"Posso fazer a matrícula por aqui mesmo???"*,
*"Manda a chave pix"*). E **passar para o atendimento humano**: é uma venda
fechada travada por software.

**Ramo "Quero pagar depois"** — 17,9%, e hoje inexistente

> Sem problema nenhum. Que dia fica melhor pra você?
> **[ Essa semana ]  [ Semana que vem ]  [ Depois do dia 15 ]**

E **reagendar o disparo para a data que a pessoa escolheu**. Várias já dão a
data sozinhas — *"Só poderei comprar no pagamento dia 05/09"*, *"vou esperar
virar a fatura do meu cartão"* — e recebem a oferta relâmpago no terceiro dia.

**Ramo "Fiquei com dúvida"** — 19,9%, mas não as dúvidas que o fluxo responde

As perguntas reais são **práticas**: material, fornecedor, o que está incluído.
*"É incluso somente o curso? E materiais?"* · *"Onde consigo comprar os
materiais pra iniciar?"* · *"Então os modelos de embalagem não estão
incluídos?"* São 26 conversas contra 12 sobre plataforma e acesso.

Três linhas sobre **o que vem junto e onde comprar o material**, e a linha de
confiança que hoje não existe em lugar nenhum:

> Na fatura aparece **PAYT\*HANDIFY** — somos a Handify, e o pagamento é o
> mesmo checkout da Payt que você já tinha aberto.

Uma das falas trava exatamente em não reconhecer o nome na fatura (*"qual nome
que aparece para a financeira?"*), e duas relatam o **banco** bloqueando por
suspeita de fraude. É uma linha de texto.

### 6. Separar cartão recusado de pix expirado

Ramo próprio no Fluxo Geral, logo depois do atraso de 7 minutos. Para cartão
recusado, a primeira mensagem não é desconto: é "seu cartão não passou — quer
tentar outro ou prefere pix?". São 495 pessoas desde maio e a faixa que melhor
converte.

### 7. Resolver a qualidade dos templates — passo a passo

13,2% das mensagens não chegam, e 112 contatos bateram exatamente no erro
*"to maintain a healthy ecosystem engagement"*, que é o **limite de mensagens
de marketing por pessoa** que o Meta impõe.

**Onde isso mora.** Não é no Voxuy: é no **WhatsApp Manager** do Meta
(`business.facebook.com` → a conta do WhatsApp Business → **Ferramentas da
conta → Modelos de mensagem**). O Voxuy só usa os templates que estão lá. A
Payt não tem nada a ver com isso.

**O que "Qualidade pendente" quer dizer.** Não é problema: é *ainda não tenho
dados*. O Meta classifica cada template em Alta / Média / Baixa a partir de
quem **bloqueia** e quem **denuncia** depois de receber. "Pendente" vira uma
nota assim que houver volume. **Só vira problema se descer para Baixa** — aí o
template é pausado e para de enviar.

**As três coisas que dá para fazer, em ordem:**

1. **Trocar a categoria da msg 3 de Marketing para Utilidade.** É a única das
   três em Marketing, e é a categoria que tem limite por pessoa — a origem dos
   112 bloqueios. Para caber em Utilidade, a mensagem tem que tratar de um
   pedido existente, não de uma promoção: *"seu pedido do Saponaria Brasil
   ficou pendente e eu consegui reativar o link com a condição de antes"*
   passa; *"estamos com uma ação especial acontecendo"* não passa. **A
   categoria é escolhida na criação do template**, e a mudança exige criar um
   novo e submeter à aprovação (costuma sair em minutos ou horas).
2. **Conferir a nota de qualidade do número**, na mesma tela, ao lado do
   telefone. Ela define o **limite diário de mensagens** (250 → 1.000 → 10.000).
   Se estiver Média ou Baixa, o limite pode estar cortando envios antes de o
   template ter culpa.
3. **Parar de mandar para quem nunca respondeu nada.** O que derruba a nota é
   bloqueio e denúncia, e quem já ignorou três mensagens é quem mais bloqueia.
   Vale cortar o disparo depois de dois silêncios seguidos — perde-se pouca
   venda e protege-se o número inteiro.

**Como saber se funcionou:** a mesma tela mostra o status e a nota de cada
template. Na remedição de 09/10, anotar as três notas e refazer a conta de erro
de entrega (seção [4. Entrega e leitura](#4-entrega-e-leitura)); a meta é sair
de 13,2% para menos de 5%.

> Se em 09/10 as notas ainda estiverem "Pendente" e o erro de ecosystem
> continuar, o caminho é o item 3 acima, não reescrever texto: o bloqueio é de
> **frequência**, não de conteúdo.

### 8. Dar valor ao desconto conforme o carrinho

20% num carrinho de R$ 50 são R$ 10 — não move ninguém. Testar faixas: até
R$ 100 oferecer frete/bônus em vez de percentual; acima de R$ 200, percentual
maior.

### 9. Dívidas que atrapalham a medição

- Padronizar `suportelina` → `suporte` (ou o contrário) em `utm_medium`.
- Criar uma linha própria para o custo de conversa do WhatsApp em `transacoes`.
- Corrigir a tag `Reuperação - Fábrica de Lembrancinha` na origem.
- Trazer para o painel a lista de quem tem "Desconto Aceito" e não abriu
  pedido. Hoje esse vazamento só é visível entre uma exportação manual e outra
  — que é exatamente a segunda armadilha do `CLAUDE.md`.

### Quanto isso vale, junto

| item | vendas a mais | ganho estimado |
|---|---:|---:|
| dobradiça do desconto 32% → 60% (itens 1, 2, 3) | +68 | **~R$ 1.657/mês líquido** |
| dobradiça da msg 3 16,6% → 25% (itens 4, 5) | +39 | ~R$ 951/mês líquido |
| recuperar os 13,2% de erro de entrega (item 7) | +6 | ~R$ 153/mês líquido |

Contra uma margem de automação de **R$ 1.220,79/mês** hoje.

Como as estimativas foram feitas, para poderem ser refeitas do mesmo jeito:
vendas a mais = (dobradiça nova − dobradiça atual) × base, mantendo as
dobradiças seguintes onde estão; receita = vendas × **R$ 80,27** de ticket
médio; líquido = **85%** da receita (6,5% de Payt + 9% de Simples); e o total
acumulado dividido por **2,8 meses**, que é o período de 17/06 a 09/09 em que
a estrutura atual rodou. Os três itens são somáveis porque atacam dobradiças
diferentes, mas o segundo supõe a dobradiça do desconto ainda em 32% — se o
item 1 funcionar primeiro, o ganho do item 2 é maior que o da tabela.

---

## Como repetir a medição em 09/10/2026

Fazer nesta ordem. **Só é comparação justa se a lógica for a mesma.**

1. **Anotar a data e hora exatas** da leitura dos contadores. Eles são
   cumulativos: o valor do mês é a diferença para o snapshot de 09/09.
2. **Rodar as três consultas** deste documento sem alterar nenhum filtro:
   bolso parado, receita por canal, custos. Se `suporte`/`suportelina` tiverem
   sido padronizados até lá, **manter os dois na cláusula `in`** — a lista mais
   larga continua correta e a comparação não quebra.
3. **Exportar os contatos do Voxuy** e ler com `scratchpad/ler-contatos.mjs`
   (namespace `x:` e a tag com erro de digitação já tratados).
4. **Abrir os três fluxos** e extrair os contadores com os dois trechos de JS
   da seção [Fonte 2](#fonte-2--contadores-dos-nós-do-voxuy). Lembrar que **o
   contador vem antes do nó a que pertence**.
5. **Anotar o custo de conversa do WhatsApp** vindo do faturamento do Meta.
   Sem ele não há margem, só receita.
6. **Reclassificar as objeções.** Clicar conversa a conversa não chega em
   agosto — a lista carrega 20 por vez e dois dias já ocupam 79. Use a própria
   API do Voxuy, na aba do app já logada. **O token fica só na página; nunca
   copie para lugar nenhum.**

   **a) Capturar o cabeçalho de autenticação** (o app o guarda em memória, não
   em `localStorage`):

   ```js
   if (!window.__hook) {
     window.__hook = 1; window.__hdrs = null;
     const oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.setRequestHeader,
           on = XMLHttpRequest.prototype.send;
     XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; this.__h = {}; return oo.apply(this, arguments); };
     XMLHttpRequest.prototype.setRequestHeader = function (k, v) { if (this.__h) this.__h[k] = v; return os.apply(this, arguments); };
     XMLHttpRequest.prototype.send = function () {
       if (this.__u && /\/api\//.test(this.__u) && this.__h && Object.keys(this.__h).length) window.__hdrs = this.__h;
       return on.apply(this, arguments);
     };
   }
   ```

   Depois role a lista de conversas uma vez para disparar uma chamada e
   `window.__hdrs` se preenche. **O token expira em poucos minutos** — quando
   um `fetch` devolver 401, role a lista de novo e continue de onde parou.

   **b) Listar as conversas do mês.** O cursor é a data da última conversa da
   página; `pageSize` maior que 20 devolve vazio:

   ```js
   window.__L = window.__L || { cur: '2026-10-01T00:00:00-03:00', its: [], fim: false };
   const REC = /Recupera|Reupera|Desconto Aceito|Recusou Oferta/i;
   const S = window.__L;
   let p = 0;
   while (!S.fim && p < 40) {                 // 40 páginas por chamada: acima disso o tool expira
     const u = `/api/inbox/conversations?cursor=${encodeURIComponent(S.cur)}&pageSize=20&archived=true&dateOrder=1&tags.operator=OR`;
     const res = await fetch(u, { headers: window.__hdrs });
     if (res.status !== 200) break;           // 401 = recapturar o token e repetir
     const d = (await res.json()).data || [];
     if (!d.length) { S.fim = true; break; }
     for (const c of d) {
       const t = (c.contact && c.contact.tags || []).map(x => x.name);
       S.its.push({ id: c.id, dt: (c.lastInteractionAt || '').slice(0, 10), tags: t });
     }
     S.cur = d[d.length - 1].lastInteractionAt;
     if (S.cur < '2026-09-01') S.fim = true;  // limite inferior do mês medido
     p++;
   }
   JSON.stringify({ total: S.its.length, ate: S.cur.slice(0, 10), fim: S.fim });
   ```

   **Guarde `tags` inteiro, não só as de recuperação** — sem a tag
   `Compra Aprovada` não dá para separar quem comprou depois de quem não
   comprou. (Foi o erro desta rodada.)

   **c) Puxar as mensagens.** O texto vem em `text.body`, e não em `text`
   — ler `m.text` devolve `[object Object]` e zero resultados:

   ```js
   const M = window.__M = window.__M || { i: 0, alvo: S.its.filter(x => x.tags.some(t => REC.test(t))), falas: [] };
   const TPL = /ultimo contato|reunimos aqui as principais|houve uma interrup|Central de Ajuda|Horário de atendimento|equipe de atendimento da Handify|link acima você consegue|foi liberado com sucesso/i;
   const t0 = Date.now();
   while (M.i < M.alvo.length && Date.now() - t0 < 31000) {
     const lote = M.alvo.slice(M.i, M.i + 6);
     const rs = await Promise.all(lote.map(c =>
       fetch(`/api/inbox/conversations/${c.id}/messages`, { headers: window.__hdrs })
         .then(r => r.status === 200 ? r.json() : null).catch(() => null)));
     rs.forEach((j, k) => {
       if (!j) return;
       const t = (j.data || [])
         .filter(m => m && m.fromMe === false && m.text && typeof m.text.body === 'string' && m.text.body.trim().length > 2)
         .map(m => m.text.body.replace(/\s+/g, ' ').trim()).filter(s => !TPL.test(s));
       if (t.length) M.falas.push({ dt: lote[k].dt, tags: lote[k].tags, t });
     });
     M.i += 6;
   }
   JSON.stringify({ lidas: M.i, total: M.alvo.length, comFala: M.falas.length });
   ```

   **d) Limpar antes de contar.** Sem isto o resultado é lixo: **respostas
   automáticas de bots de outras empresas** (o número da cliente é comercial e
   o bot dela responde) e **saudações puras**. Redija também e-mails e números:

   ```js
   const BOT = /agradece(mos)? (o )?seu contato|seja bem[- ]vind|em breve (retorn|responder)|como podemos (te )?ajudar|assim que possível (estarei |)responder|não estamos disponíve|horário de atendimento|retornarei o contato|neste momento não consigo/i;
   const OI = /^(oi+|olá|bom dia|boa tarde|boa noite|sim|não|ok|obrigad[ao]|blz|beleza|tudo bem\??|certo|entendi|tá bom|tudo bom|amém)[\s\p{Emoji}!.?,]*$/iu;
   const red = s => s.replace(/[\w.+-]+@[\w.-]+/g, '@').replace(/\d{4,}/g, '#');
   window.__F = M.falas
     .map(f => ({ tg: f.tags.join('/'), t: red(f.t.filter(s => !BOT.test(s) && !OI.test(s.trim()) && s.trim().length > 8).join(' ~ ')) }))
     .filter(f => f.t.length > 8);
   ```

   **e) Classificar.** Nas mesmas categorias da seção
   [As objeções reais](#as-objeções-reais-lidas-nas-conversas-de-agosto), em
   **multirrótulo** — uma conversa pode ter mais de uma, e os números somam
   mais de 100%. Regra por palavra-chave dá um **piso**: em agosto, 130 das 386
   não casaram com nenhuma regra e parte delas tinha objeção. Se der para ler
   as 386 à mão, leia — foi assim que o preço divergente apareceu.

   **Não copiar nome, telefone nem e-mail para lugar nenhum.**
6. **Calcular as quatro dobradiças** — são elas que dizem se a mudança
   funcionou, não a receita total. A receita se move com o volume de vendas do
   mês; as dobradiças, não.

### O que comparar, e contra o quê

| dobradiça | linha de base 09/09 | meta |
|---|---:|---:|
| entrou → viu a msg 3 | 68,5% | 85% |
| viu a msg 3 → pediu o desconto | 16,6% | 25% |
| **pediu o desconto → abriu pedido** | **32,0%** | **60%** |
| abriu pedido → pagou | 74,8% | manter |
| entrou → pagou | **2,7%** | **6%** |
| erro de entrega | 13,2% | < 5% |
| objeções do ato de pagar sem resposta no fluxo | 31,3% | 0% |
| conversas citando preço diferente do anunciado | 6,5% | < 3% |
| carrinhos com bump abandonados (jun–ago: 726) | 30,6% | 25% |

### Duas armadilhas na hora de comparar

- **Não usar a tag "Compra Aprovada" como conversão da recuperação.** 587 dos
  2.857 contatos (20,5%) a carregam, e isso *parece* uma conversão de 20%. Não
  é: a tag é posta por outros fluxos, em qualquer compra e a qualquer momento.
  A prova está no próprio fluxo — a condição interna "Compra Aprovada" marca
  **0% a 1%**. A conversão real é 2,7%.
- **Não comparar setembro fechado com setembro parcial.** Os números de
  2026-09 neste documento vão até o dia 9.

### Como testar a hipótese do "Cancelar outros"

Ainda não provada. Para provar: pegar os contatos com `Status da automação =
Cancelado` na exportação e cruzar com `vendas` por telefone/e-mail, contando
quantos têm **mais de um** pedido não pago. Se a maioria dos cancelados tiver
dois ou mais abandonos, a hipótese está certa e a correção é trocar o modo do
fluxo para não reiniciar a sequência de quem já está nela.

---

## Procedência

- Banco: Supabase `prtkfwwqpcziexgipoqk`, consultado em 09/09/2026.
- Voxuy: `app.voxuy.com`, fluxos *Fluxo Geral*, *Saponaria*, *Workshop Buquê*
  e *Fábrica de Lembrancinhas - Recuperação*, lidos em 09/09/2026.
- Exportação de contatos: `contatos_2026-09-10 022333.xlsx`, 11.182 linhas,
  19 colunas.
- Conversas: central de atendimento do Voxuy, filtros **Abertas** e
  **Fechadas**, lidas em 10/09/2026. 44 conversas com tag de recuperação, 33
  com objeção identificável. Nenhum nome, telefone ou e-mail foi copiado para
  este documento.
- Links de recuperação: quatro do fluxo (`wGCBMxg` Saponaria · `LmCa9dy` Buquê
  · `kNCnkLg` Fábrica · `LmCaG1b` Velas). **6 dos 105 pedidos com
  `utm_medium=recuperacao` vieram de links mandados à mão** que pegaram carona
  na UTM (`ODCdqxv`, `bbC2mzn`, `8oClXQy`, 2 de Assinatura, 1 sem link). É 5,7%
  e não move as dobradiças, mas se crescer, separar por `link_url`.
- Alíquota do Simples: `configuracoes.imposto_simples_nacional_pct` = 9,0000.
- Taxa da Payt: `vendas.taxa_plataforma_valor`, venda a venda.
- Custo do WhatsApp de agosto (R$ 513,88): **entrada manual**, vinda do
  faturamento do Meta. Não existe em `transacoes`.

### Correções feitas depois da primeira versão

- **"Fechar conversa" não prejudica nada** (10/09, corrigido pela Jessica). A
  primeira versão tratava isso como defeito da msg 1 e como parte da causa dos
  219. Está errado: a resposta da contato reabre o chamado sozinha, e o nó só
  serve para não poluir a central de atendimento. A causa dos 219 é a ausência
  de follow-up depois do link — o Lead Perdido é um problema de leitura do CRM,
  não de receita. As duas coisas estão separadas no diagnóstico e na lista do
  que mudar.
- **A leitura de objeções foi refeita com agosto inteiro** (10/09). A primeira
  versão classificou **33 conversas recentes** e tirou duas conclusões que
  agosto desmente:
  - *"Dinheiro e prazo é a maior objeção, com 27%."* Continua grande (17,9%),
    mas o maior bloco é **o ato de pagar** — falha técnica, querer pagar pelo
    WhatsApp e preço divergente — com **31,3%**.
  - *"A msg 2 responde a sexta objeção mais comum."* Errado ao contrário:
    dúvida de produto é o **maior** rótulo isolado (19,9%). O que muda é que a
    msg 2 responde **plataforma e acesso**, que são 12 das 386 conversas
    (3,1%), enquanto as dúvidas de **material, fornecedor e o que está
    incluído** são 26 e não têm resposta nenhuma. Família certa, respostas
    erradas.
  - E apareceu um achado que a amostra pequena não tinha: **o preço do checkout
    diferente do anunciado**, por causa dos order bumps, que é também a origem
    da suspeita de golpe.
- **O item 0 foi reescrito depois da revisão da Jessica** (10/09). A primeira
  versão mandava mexer no checkout: tirar bump pré-marcado, mostrar o total,
  afrouxar o captcha, melhorar o botão do pix. Três erros de uma vez —
  **nenhum bump vem pré-marcado**, o **checkout é da plataforma** e não aceita
  essas mudanças, e a medição mostrou que **os bumps valem +59% por pedido**
  mesmo derrubando a conversão em 10 pontos. Tirar bump destruiria valor. A
  ação certa é oferecer **o curso sem os bumps na recuperação**, que é
  mensagem e não checkout. O que só a Payt pode fazer virou o item 0b, como
  pedido.
