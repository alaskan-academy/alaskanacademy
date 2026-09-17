# Calibração do alerta "AD morrendo" — 17/09/2026

**Veredito: não construir o alerta.** Construir uma coluna.

Este documento é a medição que o desenho
[`docs/producao/2026-09-16-desenho-sete-pedidos.md`](../producao/2026-09-16-desenho-sete-pedidos.md)
pediu antes de escrever a regra. Ele responde uma pergunta só: **se o alerta
existisse nos últimos 90 dias, ele teria acertado?**

Janela: 19/06/2026 a 16/09/2026 (o dia corrente fica de fora: o sync roda de
hora em hora e o dia de hoje está sempre parcial, e parcial sempre parece
queda). Fonte: `metricas_meta`, `nivel = 'ad'`.

---

## O terreno, antes de qualquer regra

| | |
|---|---:|
| dias-anúncio | 6.283 |
| anúncios distintos | 788 |
| anúncios por dia (média) | 69,8 |
| com gasto por dia | 59,9 |
| gasto por dia | R$ 3.012,97 |
| gasto por anúncio por dia | ~R$ 50 |
| gasto total em 90 dias | R$ 271.167,30 |

**Quanto tempo um anúncio vive, e onde está o dinheiro**

| dias com gasto | anúncios | % do gasto |
|---|---:|---:|
| 1 dia | 55 | — |
| 2 a 3 dias | 277 | **6,4% (com os de 1 dia)** |
| 4 a 7 dias | 230 | 9,5% |
| mais de 7 dias | 226 | **84,1%** |

Isto muda a pergunta. 42% dos anúncios vivem três dias ou menos e carregam 6%
do dinheiro: são testes, e teste que morre não é problema, é o produto do
teste. O dinheiro está nos 226 que vivem mais de uma semana.

**Só 46% dos dias-anúncio podem ser avaliados.** Uma regra de "caiu 3 dias
seguidos" precisa de 4 dias seguidos de dado: 2.881 dos 6.283 dias-anúncio têm
isso. Nos outros o anúncio não rodou quatro dias em fila.

---

## Teste 1 — a regra como foi pedida, nas cinco métricas

"Quando ele estiver declinando por +3 dias seguidos", aplicado literalmente:
`x[d] < x[d−1] < x[d−2] < x[d−3]`, com os quatro dias consecutivos de verdade.

O desfecho medido é **"o anúncio morreu"**: ele não teve nenhum dia com gasto
depois de `d + 7`. Só dias com 21 dias de futuro observável entram, senão os
anúncios do fim da janela pareceriam mortos por falta de dado.

| regra | acusados/dia | morreram depois | |
|---|---:|---:|---|
| **nenhuma — a taxa-base** | 29,8 | **56,1%** | |
| Hookrate cai 3 dias | 1,16 | 48,8% | ↓ |
| CTR cai 3 dias | 1,46 | 47,5% | ↓ |
| CPM sobe 3 dias | 1,46 | 43,6% | ↓ |
| CPA sobe 3 dias | 0,26 | 38,9% | ↓ |
| ROAS cai 3 dias | 0,26 | 33,3% | ↓ |
| qualquer uma das cinco | 4,01 | 46,2% | ↓ |

**As cinco regras são pior que não ter regra nenhuma.** Um anúncio acusado por
elas tem MENOS chance de morrer que um anúncio sorteado entre os que estão
rodando.

O mecanismo não é acaso, e é importante: para a regra poder disparar, o anúncio
precisa ter sobrevivido quatro dias entregando. **Exigir quatro dias já é um
filtro de sobrevivência** — ele seleciona exatamente os anúncios mais saudáveis
que a média. A regra sobe numa escada rolante que desce.

O volume, aliás, estava dentro do alvo (4/dia, a meta era ≤5). Volume bom não
salva sinal invertido. Se o alerta fosse medido só por "quantos ele nomeia por
dia", ele passaria — e estaria errado.

**ROAS e CPA diários seguem impossíveis**, agora com número melhor: dos 2.881
dias-anúncio avaliáveis, só **555 (19%)** têm ROAS definido nos quatro dias, e
**574 (20%)** têm CPA. Em 4 de cada 5 janelas não há o que comparar.

---

## Teste 2 — a regra BOA, a que o desenho de 16/09 escreveu

A regra acima é a ingênua. O desenho já tinha proposto outra, muito melhor:
hookrate **normalizado pela conta naquele dia** (senão, no dia em que o leilão
inteiro sobe, todos os anúncios alertam juntos e nenhum piorou), com mínimo de
1.000 impressões por dia, e comparado contra a **melhor janela de 3 dias do
próprio anúncio** em vez de contra o dia anterior.

É justo medir essa, e não a ingênua. Medida:

| | acusados/dia | morreram depois |
|---|---:|---:|
| **elegíveis — a taxa-base deles** | 7,96 | **38,3%** |
| hook_rel caiu 25% da melhor janela | **0,51** | 48,6% |
| hook_rel caiu 40% da melhor janela | 0,20 | 7,1% |

Agora o sinal aponta para o lado certo: 48,6% contra 38,3% é 1,27× a taxa-base.
A normalização pela conta era mesmo a peça que faltava.

**Mas são 35 disparos em três meses.** Dos 35, 17 morreram; o acaso entregaria
13,4. A diferença é de 1,2 desvio-padrão — dentro do ruído. Com 0,5 disparo por
dia, seria preciso mais de um ano para saber se esse 1,27× é real.

O corte de 40% tem 14 disparos e 7,1% de acerto — abaixo da taxa-base. Não
significa que apertar piora; significa que com 14 eventos não dá para dizer nada.

---

## Teste 3 — e se a pergunta fosse outra: o anúncio ZUMBI

Se o dinheiro está nos 226 anúncios de vida longa, talvez a pergunta certa não
seja "está morrendo" e sim "está vivo, gastando, e não se paga". Medido com o
ROAS de equilíbrio de **1,34** (1,14 ÷ 0,85):

| | |
|---|---:|
| anúncios com mais de 7 dias de gasto | 226 |
| deles, abaixo do equilíbrio | **31** |
| gasto desses 31 | R$ 6.741,28 (2,5% do total) |
| faturamento atribuído a eles | R$ 7.357,96 |
| ainda rodando em 17/09 | 9 |

**Não há pilha de dinheiro atrás deste alerta.** Os 31 zumbis gastaram R$ 6.741
e trouxeram R$ 7.358 atribuídos — estão entre 1,0 e 1,34 de ROAS, marginalmente
ruins depois de imposto e taxa, não sangrando. Em janela móvel de 7 dias a
regra nomearia 3,5 dias-anúncio por dia cobrindo 3,5% do gasto.

---

## O furo que derruba os andares de dinheiro

Tudo que usa `faturamento_atribuido` está apoiado num número que não fecha:

| | 90 dias |
|---|---:|
| faturamento que o Meta atribui (nível ad) | **R$ 477.576,55** |
| o mesmo, nível campanha (bate) | R$ 477.576,55 |
| gasto no período | R$ 271.712,33 |
| **receita real de TODA a empresa** | **R$ 445.492,63** |

**O Meta reivindica 107% de tudo que a empresa faturou** — e a receita real
inclui back-end, orgânico, recuperação e tudo que nunca viu um anúncio. É o
mesmo fenômeno que a tabela de confiança por conta já tinha mostrado
(Lembrancinha-TSL 99%, Saponaria 24%, Saponaria-VSL 0%), agora medido no
agregado.

Consequência direta: **qualquer ROAS ou CPA por anúncio vindo daqui é
otimista**, e é por isso que só 31 de 226 anúncios longos parecem não se pagar.
O andar 2 do desenho — "dinheiro contextualiza" — contextualiza com um número
inflado. Enquanto a atribuição não for reconciliada com a venda real, o
dinheiro não pode nem contextualizar.

---

## O que fazer em vez do alerta

**Uma coluna, não um alerta.** O hookrate relativo à conta e a tendência dele
em 3 dias, mostrados na tabela onde o trabalho já acontece
(`CriativosMetaTab`), ao lado do `MIN_IMPRESSOES = 1000` que já existe ali.

Por que isto e não o alerta:

- **O custo do erro é zero.** Coluna errada é coluna que se ignora; alerta
  errado interrompe, e alerta que interrompe errado 5 vezes em 10 ensina a
  ignorar os outros 5. O painel já tem a lição escrita na catraca do lint:
  "verificação sempre vermelha é pior do que não ter".
- **Ela alcança quem o alerta não alcançaria.** O alerta exige 4 dias de
  corrida e 1.000 impressões/dia — 8 dias-anúncio por dia, de ~60 com gasto. A
  coluna mostra o número para todos, e diz "sem vídeo" ou "poucas impressões"
  onde não dá para calcular.
- **Ela é a medição que o alerta precisaria de qualquer jeito.** Se em três
  meses a coluna mostrar que a queda de hook_rel antecede a morte com folga, o
  alerta nasce depois — com o limiar calibrado em dado de verdade em vez de
  chutado. É a ordem certa: medir, depois avisar.

**O que NÃO fazer:** construir o alerta com o limiar de 25% "porque foi o
melhor dos dois testados". Dos dois, um deu 1,27× com n=35 e o outro deu 0,19×
com n=14. Escolher o melhor de dois resultados ruidosos é escolher ruído, e
depois ele fica no código parecendo uma decisão.

---

## Como refazer esta medição

As cinco consultas estão neste documento em forma de resultado; a forma
executável está no commit que o introduziu. Para repetir daqui a três meses,
o que precisa ser igual:

1. **Janela de 90 dias terminando ONTEM**, nunca incluindo o dia corrente.
2. **`nivel = 'ad'`**, e `impressoes > 0` no teste 2.
3. **Desfecho "morreu"** = `max(data) filter (where investimento > 0) <= d + 7`,
   e só dias com `d <= current_date - 21` entram, para todo acusado ter futuro
   observável.
4. **A taxa-base é obrigatória.** Ela é a única coisa que transforma "48,6% dos
   acusados morreram" em informação. Sem ela o número parece bom.
5. **ROAS de equilíbrio 1,34** = 1,14 ÷ 0,85 (14% de imposto sobre o gasto do
   Meta; a receita sobra 85% depois de Payt ~6,5% e Simples 9%). Se a alíquota
   do Simples mudar, este número muda — e desde 17/09/2026 o Simples incide
   sobre o bruto com juros, o que o empurra para cima (ver a migração
   `20260917a`).

O número que decide se vale reabrir o assunto: **a taxa-base de morte em 7
dias**. Hoje ela é 56,1% no geral e 38,3% entre os elegíveis. Se ela cair muito
— porque os anúncios passaram a viver mais —, "vai morrer" volta a ser uma
pergunta com resposta informativa, e esta calibração precisa ser refeita.
