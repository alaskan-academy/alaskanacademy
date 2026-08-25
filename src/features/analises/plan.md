# Plano — Módulo Análises

Plano de implementação. O contexto e as decisões de desenho estão em
`CLAUDE.md`, ao lado deste arquivo.

---

## Minha leitura, antes do plano

Você pediu opinião de especialista, então começo pelo que eu mudaria no
enunciado.

**O pedido foi "documentar alterações e análises". O problema real é outro:** o
ciclo de otimização está partido em três ferramentas e nunca fecha. O Google
Chat guarda a alteração, a planilha guarda o número, o Obsidian guarda a
conclusão — e nada liga os três. Por isso "ver quando mudamos algo para analisar
o resultado" é difícil: a informação existe, só não está junta.

Documentar melhor em três lugares separados não resolve. Juntar resolve.

**As 3 horas não são de análise, são de digitação.** Olhei os dados: quase toda
linha da sua planilha já está no banco. Investimento, faturamento, vendas,
cliques, IC, conversões, cada orderbump, AOV, CPA, EPC — tudo calculável. O que
falta é só a retenção da VSL (Play Rate, 1 min, Fim da Lead, Pitch, Final VSL),
que vem do player.

Então a meta não é "uma tela mais rápida para preencher". É **não preencher**.
Se depois de pronto ainda houver campo numérico para digitar além dos cinco da
VSL, o módulo falhou.

**Um alerta de escopo.** A tentação aqui é construir tudo: kanban de ações,
notificações, aprovações. Não faça. Produção já é o lugar de tarefa com prazo e
responsável — duplicar aqui cria dois lugares para a mesma coisa, e em três
meses ninguém sabe qual vale. Este módulo é registro e leitura; a execução vive
em Produção.

---

## O que já existe e vai ser reaproveitado

Vale listar porque muda o tamanho do trabalho:

| Peça | Onde | Para quê |
|---|---|---|
| `metricas_meta` (10.268 linhas) | banco | investimento, cliques, IC, vídeo |
| `vendas` (13.545) + `venda_itens` (3.749) | banco | faturamento, OBs, upsells |
| `ofertas` (54) | banco | nome e tipo de cada OB/upsell |
| `funis` / `ofertas_editores` | banco | os dois eixos que vocês usam |
| Sheets via conta de serviço | `radar-sheets-sync` | exportar a rodada |
| Obsidian em `127.0.0.1:27123` | `RadarPage` | exportar a narrativa |
| `FinanceiroNav` | financeiro | padrão de nav interna |
| `useConfirm` | hooks | confirmação de ação destrutiva |

Nada disso precisa ser criado.

---

## Etapas

Cada uma entrega valor sozinha. Se parar depois da 2, já vale.

### 1. Registrar alterações — substitui o Google Chat

**Banco:** `alteracoes` com RLS de sócio/admin.

**Tela:** `/analises/alteracoes` — formulário curto, os mesmos campos que vocês
já escrevem no Chat: funil, variante, o que mudou, motivo, responsável, data.

**Detalhe que decide se vai ser usado:** o formulário precisa ser mais rápido
que digitar a mensagem no Chat. Funil e responsável pré-selecionados pelo último
uso; data com padrão hoje; campo de texto livre, sem estrutura obrigatória.

**Entrega:** a alteração deixa de se perder no scroll.

### 2. Rodada de análise — substitui a planilha

**Banco:** `analises` + `analise_itens`. Uma função
`fn_metricas_do_funil(funil_id, inicio, fim)` que devolve o retrato completo,
mais o mesmo retrato do período anterior para comparação.

**Tela:** `/analises/rodada` — um funil por vez, métricas prontas, comparação
com o período anterior, as alterações do período listadas com quantos dias de
dados cada uma tem, e dois campos de texto: leitura e próximas ações.

**Onde mora o ganho das 3h.** Tudo calculado; ela lê e escreve.

**Entrega:** a análise vira leitura, não transcrição.

### 3. Linha do tempo — o que o Chat nunca deu

**Tela:** `/analises` — todas as alterações em ordem, cada uma com o resultado
medido ao lado, e destaque para as que estão rodando há muito tempo sem
veredito.

**Entrega:** responde "mudamos o quê e deu no quê" numa tela só.

### 4. Exportações

Ao fechar a rodada: Sheets no formato atual e Obsidian no formato do PDF. As
duas acessórias, falhando em silêncio.

**Entrega:** o histórico continua onde a contabilidade e você já olham.

### 5. Retenção de VSL — a única lacuna

Investigar API do Panda Video e do VTurb. Se houver, os cinco campos manuais
somem. Se não houver, ficam — mas isolados e explicados.

**Deixar por último de propósito:** é o único item cuja viabilidade não é
conhecida, e não pode bloquear o resto.

---

## Decisões que eu tomaria, e por quê

**Uma entrada só na sidebar.** "Análises", com nav interna. É a regra do projeto
e evita o inchaço que já aconteceu no Financeiro.

**Retrato, não recálculo.** A análise guarda os números do dia em `jsonb`. Se um
lançamento for recategorizado depois, a leitura que ela escreveu continua ao
lado dos números que a motivaram. Análise é documento histórico.

**Comparação obrigatória.** Nenhuma métrica aparece sozinha. "ROAS 1,9" não diz
nada; "1,7 → 1,9 ↑" diz. Você já faz isso à mão nos PDFs.

**Dias de dados na cara.** Sua análise de 24/08 diz "não saberemos muito bem o
impacto, poucos dias". A tela deve dizer isso sozinha — uma alteração com 3 dias
de dados não merece a mesma confiança que uma com 30.

**Alteração sem veredito vira cobrança.** É o defeito do Chat: registra e
esquece. Depois de N dias rodando, a alteração aparece pedindo decisão.

**Texto livre, não formulário rígido.** Suas anotações no Obsidian são boas
porque são narrativas — "todos os OBs caíram a conversão, mas faturamos mais com
o combo: 33 vendas = 1.400 para 33 vendas = 1.800". Um formulário com campos
fixos perderia isso. Estrutura no que é dado; liberdade no que é raciocínio.

---

## O que eu NÃO faria

- **Kanban de próximas ações.** Produção já é isso. Aqui é lista de texto.
- **Notificações.** Deixa para depois de o módulo provar que é usado.
- **Editor rico.** Markdown simples basta e exporta limpo para o Obsidian.
- **Importar o histórico do Chat.** Trabalhoso e de valor duvidoso — o histórico
  antigo já está nos PDFs. Começar do zero é mais barato.
- **Aprovação/workflow.** São dois sócios. Cerimônia aqui é atrito puro.

---

## Riscos

**O maior: a alteração não ser registrada.** Se o formulário for mais lento que
o Chat, ninguém usa e o módulo vira uma tela vazia bonita. Por isso a etapa 1
vem antes de tudo e precisa ser brutalmente curta.

**Atribuir resultado à alteração errada.** Duas alterações no mesmo funil na
mesma semana tornam o antes/depois ambíguo. A tela deve mostrar as duas e não
fingir que sabe qual causou o quê — dizer o que aconteceu, não inventar
causalidade.

**Períodos curtos demais.** Já contemplado: mostrar dias de dados junto do
resultado.

---

## Ordem sugerida

1 → 2 → 3 → 4 → 5.

A 1 e a 2 juntas já eliminam o Chat e a planilha, que é a dor. A 3 é o que você
não tem hoje em lugar nenhum. A 4 mantém a ponte com o que já existe. A 5
depende de investigação externa.

**Antes de começar, uma pergunta que muda o modelo:** a alteração é sempre de
funil, ou existe alteração de projeto que não passa por funil? A lista tem 35
projetos e só 1 funil ativo cadastrado — o que sugere que o eixo real de vocês é
o projeto, e o funil é um detalhe dentro dele. Se for isso, `projeto_id` é o
campo principal e `funil_id` o opcional, e não o contrário.
