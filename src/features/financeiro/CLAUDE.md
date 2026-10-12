# CLAUDE.md — Módulo Financeiro

Contexto específico do módulo de automação financeira. Desde 01/09/2026 ele atende DUAS empresas — Alaskan Academy e Aeliss Ltda — com contas bancárias, NFs e conciliação separadas.
PRD completo: `C:\Users\Jessica Veiga\Downloads\PRD_Financeiro_Alaskan.md`

---

## O que este módulo faz

Automatiza o fechamento financeiro mensal, que antes levava ~4h/mês de trabalho manual. O sistema:

1. Recebe vendas em tempo real via webhook da Payt
2. Importa custos de campanha via UTMify MCP
3. Categoriza transações bancárias (Conta Simples) automaticamente por regras aprendidas do histórico do usuário
4. Gera o pacote mensal (planilha + NFs organizadas) para envio à contabilidade via Gestta

---

## Fontes de dados

| Fonte | Papel | Como entra |
|---|---|---|
| **Payt** | Vendas (fonte única de verdade) | Webhook `POST /api/webhooks/payt` |
| **UTMify** | Custos de ads, CPL, leads — nunca vendas | MCP já conectado |
| **Conta Simples** | Extrato bancário (saídas reais) | Upload CSV/OFX ou MCP se disponível |
| **Google Drive** | Armazenamento de NFs | MCP já conectado |
| **E-mail** | NFs por e-mail | **Fora do escopo — Etapa 2 (Cowork)** |

---

## Tabelas no Supabase

- `transacoes` — extrato bancário categorizado (Conta Simples). Carrega `empresa_id`, **carimbado na importação**: cada empresa tem a sua conta bancária
- `regras_categoria` — padrões de texto → categoria (geradas do histórico + aprendidas)
- `vendas_payt` — vendas recebidas via webhook
- `metricas_diarias` — gasto/CPL/leads por dia/produto (UTMify)
- `categorias_centro` — **o catálogo**: categoria → centro de custo → tipo (`custo`, `receita`, `reserva`, `socio`). É daqui que sai o que é custo operacional e o que não é
- `documentos_fiscais` — as NFs em si, com `empresa_id`: NF e conciliação são separadas por empresa para a contabilidade
- `caixa_config` — saldo inicial da Reserva, um por empresa (é de uma conta bancária)

---

## Categorias e centros de custo — saem da TABELA, nunca daqui

A fonte da verdade é **`categorias_centro`** (categoria → centro de custo →
tipo). Para ver a lista de agora:

```sql
select categoria, centro_custo, tipo from categorias_centro order by 1;
```

E o que de fato está em uso, que é outra pergunta:

```sql
select categoria, count(*), round(sum(valor),2)
  from transacoes where categoria is not null group by 1 order by 1;
```

### Por que a lista saiu deste arquivo

Ela estava escrita aqui à mão, com 33 categorias, e era um **retrato de 2026-09
da própria `categorias_centro`**. Conferido em 12/10/2026:

| | neste arquivo | na realidade |
|---|---|---|
| categorias | 33 | **45** catalogadas, 36 em uso |
| centros de custo | 8 | **12** em uso |

Treze categorias nasceram no banco e nunca entraram aqui — entre elas
`Editor de Vídeo` (41 lançamentos, **−R$ 75.639**, a segunda maior despesa da
casa depois de anúncios), `Hospedagem/Infraestrutura` (−R$ 6.781), `Mídia`
(−R$ 6.213), `Retirada do Caixa` (+R$ 102.294), `Aporte de Sócio`, `Tokens`,
`Domínios`, `Contábil`, `Automação/Marketing`, `Swipe`, `Material de Aulas`,
`Assinaturas/Verificações` e `Pagamento de Fatura`.

E o documento ainda dizia `Edição de Vídeo` onde o banco diz `Editor de
Vídeo` — o tipo de quase-acerto que faz alguém procurar pelo nome errado e
concluir que a categoria não existe.

Terceira armadilha do CLAUDE.md da raiz, em forma de documentação: **lista
fixa que envelhece em silêncio.** Por isso ela não volta.

### Onde a lista PRECISA existir no código

`CAT_SOCIOS` e `CAT_RESERVA` em `constants.ts`, porque `ehCustoOperacional` e
`ehReceita` são funções puras chamadas em laço sobre milhares de transações —
buscar a tabela a cada chamada as tornaria assíncronas.

Essas duas têm o teste que a regra exige:
`src/test/categorias-socio-batem-com-o-banco.test.ts`, que lê as MIGRAÇÕES e
falha quando o banco ganha uma categoria de sócio que o código não conhece.
Foi criado depois que `Aporte de Sócio` nasceu no banco, ficou fora da lista, e
R$ 2.000 de capitalização passaram a contar como faturamento.

### Duas coisas para olhar quando sobrar tempo

- **`Softwares` e `Softwares e Ferramentas`** convivem como centros de custo
  distintos nos dados. Dois nomes para a mesma coisa é a primeira armadilha.
- **Nove categorias catalogadas nunca foram usadas**: `Coprodução`,
  `Departamento Pessoal`, `Doações`, `Eventos`, `Freelancer`,
  `Investimentos Futuros`, `Marketplace`, `Material de Escritório`,
  `Treinamento e Educação`.

---

## Lógica de categorização automática

1. Nova transação chega → percorre `regras_categoria` ordenadas por `confianca DESC`
2. Match por `contains` / `exact` / `regex` no campo `descricao`
3. Match → aplica categoria, marca `status_revisao = 'auto_categorizado'`
4. Sem match → marca `pendente`, aparece na Tela 1 para revisão
5. Usuário categoriza manualmente → cria nova regra com `confianca = 1.0`
6. PIX/TED genérico sem nome claro → sempre `pendente`, nunca adivinhar

---

## Páginas

| Arquivo | Rota | Descrição |
|---|---|---|
| `FinanceiroRevisaoPage` | `/financeiro/revisao` | Tela 1 — transações pendentes de categorização |
| `FinanceiroResultadoPage` | `/financeiro/resultado` | Tela 2 — o resultado real do mês. **Absorveu o Fechamento** em 01/09/2026; `/financeiro/fechamento` redireciona |
| `FinanceiroConciliacaoPage` | `/financeiro/conciliacao` | Tela 3 — extrato categorizado completo |
| `FinanceiroNotasFiscaisPage` | `/financeiro/notas-fiscais` | Tela 4 — controle de NFs e ferramentas |
| `FinanceiroCaixaPage` | `/financeiro/caixa` | Reserva de Caixa e DRE |
| `FinanceiroGastosPage` | `/financeiro/gastos` | Gastos |

A exportação do pacote mensal (Tela 5) é uma ação/botão dentro do fechamento, não uma rota separada.

---

## Regras importantes

- **Ler pode somar; gravar exige empresa escolhida.** Em "Ambas" as telas somam
  as duas operações para olhar, o que é legítimo. Mas importar extrato, lançar
  manualmente e editar o saldo da Reserva **recusam** sem empresa selecionada: um
  extrato é de UMA conta bancária, e transação sem dono aparece nas duas telas ou
  em nenhuma, conforme o filtro — erro que só sai na conciliação do contador.
  Na Reserva a mesma regra tem outra forma: em "Ambas" o saldo mostrado é a SOMA
  dos saldos iniciais, e o `id` vai vazio de propósito para nenhuma gravação
  acertar a conta errada.
- **Parâmetros fiscais são por empresa.** `configuracoes` tem uma linha por
  (chave, empresa); nulo é a geral, que vale para quem não tem a sua. Ler sempre
  por `fn_config(chave, empresa)`. Um `UPDATE` sem `.is('empresa_id', null)`
  sobrescreve a alíquota de TODAS as empresas e devolve sucesso — há um teste que
  lê o código-fonte para impedir isso.
- **O imposto do Simples é pago sobre a receita do mês ANTERIOR.** Dividir o
  imposto pago pela receita do mesmo mês dá quase metade do real (4,23% contra
  7,84% em jul/ago 2026) e convidaria a baixar a alíquota e inflar o lucro.
- **Cada linha de dinheiro vem de UMA fonte, e a tela diz qual.** Venda, taxa e
  reembolso pela Payt; anúncio pelo Meta; imposto e custo pelo extrato. Misturar
  bases não é o erro — misturar SEM DIZER é: foi assim que o Fechamento antigo
  mostrou 57,1% de margem contra 3,2% no extrato, em agosto/2026.
- **A fatura do cartão da Meta sai dos custos do extrato.** `ehCustoOperacional`
  é aberta ("toda saída é custo, exceto sócio e reserva"), então a fatura está
  lá. Somada à linha do Meta, o anúncio entraria duas vezes e em dois meses
  diferentes. Mesma coisa com `Impostos e Tributos`, que vira linha própria.
- **`metricas_meta` começa em 01/05/2026.** Mês anterior a isso tem fatura de
  anúncio no extrato e zero dado do Meta — a maior saída fica de fora e a margem
  parece ótima (abril dava 65,6%). O Resultado detecta isso por derivação
  (`semDadosDeAnuncio`) e recusa a margem em vez de exibir ficção.
- **A diferença entre o extrato e o que a Meta reporta não é percentual de
  imposto.** O gasto de um mês é debitado no seguinte, então aquele número
  mistura imposto com atraso de cobrança. A fonte para a alíquota de mídia é a
  fatura da Meta, que traz a linha de imposto separada.

- **Nunca usar UTMify para vendas** — duplicaria com Payt. UTMify = custo e campanha apenas.
- **Idempotência no webhook** — `payt_transaction_id` é chave única. Reenvio não duplica.
- **Conversão de moeda** — para USD, usar AwesomeAPI ou exchangerate-api. Se Conta Simples já entrega convertido, usar o valor do extrato.
- **Gestta** — sem integração direta. Sistema gera os arquivos; usuário sobe manualmente.
- **E-mail/Gmail** — fora do escopo desta etapa. Não criar credencial no backend.

---

## Dados históricos disponíveis para seed

- `Fluxo_Diário_Alaskan_2026.xlsx` — métricas diárias por produto desde jan/2026
- `Fluxo_de_Caixa_Alaskan_2026.xlsx` — 500+ transações já categorizadas manualmente (fonte primária para `regras_categoria`)
