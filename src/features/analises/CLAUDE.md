# CLAUDE.md — Módulo Análises

Registro de alterações nos funis e a análise que mede se elas funcionaram.

Substitui dois lugares onde isso vive hoje: o **Google Chat** (registro das
alterações) e uma **planilha por funil** (as métricas). O Obsidian recebe a
narrativa da rodada.

---

## O problema que este módulo resolve

A cada duas semanas a análise de todos os funis leva **~3 horas**. O trabalho é
quase todo transcrição: abrir a planilha do funil, digitar investimento,
faturamento, vendas, conversões, número de cada orderbump, e só então olhar.

E o registro da alteração vive no Google Chat, que **não fecha o ciclo**: dá
para ver que alguém mudou o preço em 28/07, mas não dá para ver o que aconteceu
depois. Quem quer saber precisa cruzar a data da mensagem com a planilha à mão.

O ciclo real é este, e hoje ele está partido em três ferramentas:

```
alteração  →  espera  →  medição  →  veredito  →  próxima alteração
(Chat)                  (planilha)   (PDF/Obsidian)   (Chat de novo)
```

---

## A tese central: o dado já está no banco

**Quase toda métrica da planilha é calculável com o que já existe.** Isto é o
que define o desenho: a tela não pede que ela digite números — ela calcula, e
pede só o julgamento.

| Linha da planilha | De onde sai |
|---|---|
| Investimento | `metricas_meta.investimento` |
| Faturamento, Vendas | `vendas` |
| ROAS, Resultado | derivado |
| Oferta principal, Orderbumps 1–5, Upsells | `venda_itens` + `ofertas` |
| Cliques, Visualização da Página, IC | `metricas_meta` |
| Conversão do Funil / Checkout / Connect Rate | derivado |
| CPV, CPA, EPC, AOV, EPC−CPV | derivado |
| Imposto, Taxa, Lucro líquido | `configuracoes` + `vendas` |
| **Play Rate, 1 min, Fim da Lead, Pitch, Final VSL** | **não existe** — vem do player (Panda/VTurb) |

Volume disponível: `metricas_meta` 10.268 linhas (mai–ago/26), `vendas` 13.545
(jan–ago/26), `venda_itens` 3.749, `ofertas` 54 cadastradas.

**A retenção de VSL é a única lacuna real.** Enquanto não houver integração com
o player, esses cinco campos são digitados à mão — e a tela deve deixar claro
que são os únicos, para não parecer que o resto também precisa.

---

## Modelo de dados

Três tabelas, e a relação entre elas é o produto inteiro.

> O plano original previa uma tabela `alteracoes` separada, com `variante`,
> `status` e `veredito`. Ela **não existe**: virou `analise_acoes`, que faz o
> mesmo trabalho com metade dos campos. Registrar a alteração e registrar o que
> se decide fazer eram a mesma coisa escrita duas vezes — e dois lugares para o
> mesmo fato divergem, como já aconteceu cinco vezes neste projeto.

### `analises`
Uma rodada, de uma data, cobrindo vários REVs.

- `data`, `autor_id`, `observacoes`
- `fechada_em` — o marco que separa "estou analisando" de "analisei". Enquanto
  for null, abrir a tela **retoma** esta rodada em vez de criar outra

### `analise_itens`
Um por REV dentro da rodada. `unique (analise_id, funil_id)`.

- `metricas` (jsonb) — o RETRATO calculado
- `retencao` (jsonb) — o retrato da VSL, quando existe
- `leitura` — o que ela escreveu

**Por que gravar `metricas` como retrato e não recalcular sempre:** a análise é
um documento histórico. Se o dado de origem mudar depois — uma venda
recategorizada, um estorno — a leitura que ela escreveu deixaria de fazer
sentido ao lado de números diferentes. O retrato preserva o contexto da decisão.

### `analise_acoes`
O que ficou decidido. **Pertence ao REV, não à rodada**: escrita numa quinzena,
continua aparecendo até alguém marcar como feita. É isso que faz a análise
virar ciclo em vez de diário.

- `funil_id` (dono) · `analise_id` (rodada em que nasceu, para o "desde 12/08")
- `texto` · `expectativa` (opcional — o que se espera, escrito ANTES)
- `feita` · `feita_em` · `feita_por` — carimbo, não opinião: é o gatilho
  `fn_analise_acao_carimbo` que preenche, e desmarcar o refaz

---

## Telas

Uma entrada só na sidebar — **Análises** —, com nav interna igual ao Financeiro
(`FinanceiroNav.tsx` é o modelo).

| Rota | Tela | O que faz |
|---|---|---|
| `/analises` | Rodada | O trabalho de 3h. Um REV por vez, métricas já calculadas, ela escreve a leitura |
| `/analises/comparar` | Comparar | Todos os REVs de uma vez, ou dois lado a lado. Responde "qual funil eu corto" |
| `/analises/historico` | Histórico | As rodadas passadas, com o retrato dos números junto do texto |

### A tela que importa: `/analises`

Na ordem da planilha que ela já usa — mudar a sequência de leitura custa mais
que qualquer número a mais que se ganhe:

1. **Resultado** — investimento, faturamento, ROAS, imposto, taxa, lucro
2. **Com upsell** — ao lado e nunca dentro (ver abaixo)
3. **Ofertas** — oferta principal e cada bump, com a adesão em evidência
4. **Funil** — cliques → checkouts → vendas, com o custo em evidência
5. **Retenção da VSL** (ou rolagem, no TSL) — fica no meio do funil porque é
   onde ela acontece
6. **Por visitante** — CPV, EPC, EPC−CPV, AOV
7. **O que já foi feito** — as ações marcadas, com dias de dados desde a execução
8. **A leitura** e as **próximas ações**

No último REV o botão vira "fechar rodada".

---

## O upsell: ao lado, nunca dentro

Somar o upsell esconde front doente; tirar mata funil lucrativo. Não é escolher
o melhor dos dois — **a pergunta é outra em cada caso**:

- *"A página precisa de ajuste?"* → só o front responde, é onde se mexe
- *"Esse funil dá dinheiro?"* → só o total responde, é o que entra no caixa

Toda métrica de otimização (ROAS, CPA, EPC, lucro) é de **front + order bumps**.
O upsell entra num bloco próprio, com `front_se_paga` decidindo a frase que a
tela diz sozinha. É a única leitura automática do módulo inteiro.

**O upsell é assinatura anual** — caixa que entrou, não receita recorrente do
período. A renovação reaparece em 12 meses como venda nova.

---

## Acesso

**Sócios e admins apenas.** É onde se discute preço, margem e o que não
funcionou — não é informação de time.

Segue o padrão de `ProtectedRoute` com `pageKey`, e a RLS nas tabelas restringe
por `perfis.is_admin` ou cargo de sócio. **A restrição vive no banco**, não em
esconder o item da sidebar.

---

## Exportações

**Disparadas a cada salvar**, e não só ao fechar a rodada — foi o que ela
pediu. Só é seguro porque as duas pontas SOBRESCREVEM: salvar vinte vezes
deixa o mesmo resultado de salvar uma. Se qualquer das duas passasse a
acrescentar, viraria vinte cópias da mesma análise.

- **Google Sheets** — edge function `analises-sheets-sync`. UMA planilha para
  todas as análises, e dentro dela UMA ABA POR REV, com uma linha por rodada:
  descer a aba é ver a história daquele REV no tempo, leitura que a rodada não
  dá porque ela só mostra dois períodos. Mais uma aba "Ações" com todas.
  Reescritas por inteiro a cada chamada. Aba de REV que sumiu do cadastro NÃO é
  apagada — perder histórico é pior que uma aba parada. Usa a mesma
  conta de serviço do `radar-sheets-sync` (secret `GOOGLE_SERVICE_ACCOUNT`), e
  o id da planilha vive em `configuracoes_texto.analises_spreadsheet_id` — não
  no código, para trocar de planilha sem deploy. Vazio, ela pula e diz que
  pulou; a tela mostra um convite para ligar uma.
  Os números saem do RETRATO gravado, não de recálculo: a planilha é o
  histórico da decisão, e recalcular faria uma linha de agosto mudar sozinha
  quando uma venda fosse recategorizada em setembro.
- **Obsidian** — `PUT` em `127.0.0.1:27123/vault/Análises Alaskan/{data}/{rev}.md`,
  com a chave em `configuracoes_texto.obsidian_api_key`. Frontmatter com os
  números que valem filtro e gráfico, corpo com as tabelas, a leitura em
  `==destaque==` e as ações como checkbox de markdown — que o Obsidian marca
  nativamente, então a nota continua útil lida fora do dashboard.
  O caminho vem da data e do REV, nunca de um id: nome legível no vault, e a
  mesma nota entre salvamentos.

**As duas são acessórias e falham em silêncio de propósito** — o Obsidian roda
na máquina de quem está usando e pode não estar aberto. A análise não pode
depender delas.

---

## Regras importantes

- **Salvar grava o retrato mesmo sem leitura escrita.** A leitura é opinião
  sobre o registro; opinião opcional não pode ser condição para o registro
  existir. Antes disso, um REV que ela olhou e não teve o que comentar sumia do
  histórico e da planilha com todos os números dele.
- **Nunca pedir número que o banco tem.** Se um campo pode ser calculado e mesmo
  assim é digitado, o módulo falhou — voltou a ser a planilha.
- **A data da alteração é sagrada.** É por ela que o antes/depois é medido. Um
  registro sem data não serve para nada.
- **Comparar sempre com o período anterior de mesmo tamanho.** "ROAS 1,9" não
  diz nada; "1,7 → 1,9" diz.
- **Dias de dados junto do resultado.** A análise de 24/08 diz "não saberemos
  muito bem o impacto, poucos dias" — a tela deve dizer isso sozinha, não
  depender de alguém lembrar.
- **Alteração sem veredito é dívida.** Ação aberta continua aparecendo em toda
  rodada seguinte, com "desde 12/08" ao lado, até alguém marcar.
- **Retrato, não link.** A análise guarda os números do dia; não recalcula ao
  abrir.
- **Investimento é pelo CONJUNTO, nunca pela campanha.** A mesma campanha roda
  REVs diferentes, inclusive os de teste. Medir o REV6 pela campanha inflava o
  gasto de R$ 1.898 para R$ 12.936 — quase 7×.
- **Duas fontes nunca se cruzam num mesmo número.** Nossas vendas com o
  denominador do pixel do Meta já produziu "conversão de checkout: 202,9%".
- **Número estranho é conferido contra segunda fonte antes de ser explicado.**
  Foi assim que caíram o CPA de R$ 198, o ROAS por campanha e a seta verde num
  prejuízo que triplicou.

### O que está preso por teste

`src/test/analises.test.ts` — as decisões que já falharam uma vez ficam
travadas: variação com base negativa, janela que termina ontem, vencedor sem
direção, alerta de atribuição quebrada. Se alguém reescrever uma delas de um
jeito plausível e voltar a mostrar o número errado, o teste quebra.

---

## O que este módulo NÃO é

- **Não é gestão de tarefas.** As ações têm caixinha e carimbo de execução, e
  param aí: sem prazo, sem responsável, sem kanban. Produção já é o lugar disso
  — se virar isso aqui, são dois lugares para a mesma coisa.
- **Não substitui a página de Funis.** Lá é o funil hoje; aqui é o histórico de
  decisões sobre ele.
- **Não é onde se mede criativo.** Isso é Criativos e Meta Ads.
