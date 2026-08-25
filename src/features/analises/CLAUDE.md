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

Duas entidades, e a relação entre elas é o produto inteiro.

### `alteracoes`
O que mudou, quando, e por quê. Herda a estrutura que o Google Chat já usa
(FUNIL / ALTERAÇÃO / MOTIVO / RESPONSÁVEL) porque as pessoas já escrevem assim.

- `funil_id` / `projeto_id` — onde mudou. Os dois existem: `funis` e
  `ofertas_editores` (que a tela chama de projetos)
- `variante` — "REV1", "REV5", "VSL h06 v01". É o nome que eles já usam
- `data` — **a data importa mais que tudo**: é o eixo do antes/depois
- `descricao`, `motivo`, `responsavel_id`
- `status` — `rodando` · `vencedora` · `descartada` · `revertida`
- `veredito` — o texto que hoje vira `==` no Obsidian
- `decidida_em`

### `analises`
Uma rodada de análise, de uma data, cobrindo vários funis.

- `data`, `autor_id`, `observacoes`
- `analise_itens` — um por funil/projeto: `metricas` (jsonb, o retrato
  calculado), `leitura` (o que ela escreveu), `proximas_acoes` (texto)

**Por que gravar `metricas` como retrato e não recalcular sempre:** a análise é
um documento histórico. Se o dado de origem mudar depois — uma venda
recategorizada, um estorno — a leitura que ela escreveu deixaria de fazer
sentido ao lado de números diferentes. O retrato preserva o contexto da decisão.

---

## Telas

Uma entrada só na sidebar — **Análises** —, com nav interna igual ao Financeiro
(`FinanceiroNav.tsx` é o modelo).

| Rota | Tela | O que faz |
|---|---|---|
| `/analises` | Linha do tempo | Alterações de todos os funis em ordem, com o resultado de cada uma ao lado |
| `/analises/rodada` | Rodada de análise | O trabalho de 3h. Um funil por vez, métricas já calculadas, ela escreve a leitura |
| `/analises/alteracoes` | Registro | Formulário curto para registrar o que mudou |
| `/analises/acoes` | Próximos passos | O que saiu das análises e ainda não foi feito |

### A tela que importa: `/analises/rodada`

Cada funil aparece como um cartão com:
1. **As métricas do período**, já calculadas, comparadas com o período anterior
   — seta e delta, não só o número
2. **As alterações que entraram no período**, com quantos dias de dados cada uma
   tem
3. **Um campo de leitura** e **um de próximas ações**
4. Os cinco campos de VSL para digitar, marcados como os únicos manuais

O botão "Próximo funil" avança. No fim, um botão fecha a rodada e dispara as
exportações.

---

## Acesso

**Sócios e admins apenas.** É onde se discute preço, margem e o que não
funcionou — não é informação de time.

Segue o padrão de `ProtectedRoute` com `pageKey`, e a RLS nas tabelas restringe
por `perfis.is_admin` ou cargo de sócio. **A restrição vive no banco**, não em
esconder o item da sidebar.

---

## Exportações

Disparadas ao fechar a rodada, nunca a cada digitação.

- **Google Sheets** — uma aba por rodada, no formato da planilha atual. Já
  existem duas edge functions com Sheets (`radar-sheets-sync`,
  `referencias-sheets-sync`) e a conta de serviço do Google já está configurada
  para o Drive; é o mesmo caminho.
- **Obsidian** — markdown no formato do PDF (funil → alteração → `==` resultado
  → próximas alterações). `RadarPage` já fala com o Obsidian local em
  `127.0.0.1:27123`; reaproveitar.

**As duas são acessórias e falham em silêncio de propósito** — o Obsidian roda
na máquina de quem está usando e pode não estar aberto. A análise não pode
depender delas.

---

## Regras importantes

- **Nunca pedir número que o banco tem.** Se um campo pode ser calculado e mesmo
  assim é digitado, o módulo falhou — voltou a ser a planilha.
- **A data da alteração é sagrada.** É por ela que o antes/depois é medido. Um
  registro sem data não serve para nada.
- **Comparar sempre com o período anterior de mesmo tamanho.** "ROAS 1,9" não
  diz nada; "1,7 → 1,9" diz.
- **Dias de dados junto do resultado.** A análise de 24/08 diz "não saberemos
  muito bem o impacto, poucos dias" — a tela deve dizer isso sozinha, não
  depender de alguém lembrar.
- **Alteração sem veredito é dívida.** Depois de N dias rodando, ela precisa
  aparecer cobrando decisão.
- **Retrato, não link.** A análise guarda os números do dia; não recalcula ao
  abrir.

---

## O que este módulo NÃO é

- **Não é gestão de tarefas.** "Próximas ações" é uma lista de texto que sai da
  análise. Produção já tem kanban, prazo e responsável — se virar isso aqui,
  são dois lugares para a mesma coisa.
- **Não substitui a página de Funis.** Lá é o funil hoje; aqui é o histórico de
  decisões sobre ele.
- **Não é onde se mede criativo.** Isso é Criativos e Meta Ads.
