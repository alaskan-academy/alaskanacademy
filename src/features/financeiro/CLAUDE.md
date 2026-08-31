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
- `ferramentas_saas` — lista de ferramentas e assinaturas recorrentes
- `notas_fiscais` — controle de NFs por ferramenta/mês
- `documentos_fiscais` — as NFs em si, com `empresa_id`: NF e conciliação são separadas por empresa para a contabilidade
- `caixa_config` — saldo inicial da Reserva, um por empresa (é de uma conta bancária)

---

## Categorias de custo (preservar exatamente — são as do usuário)

```
Anúncios (Facebook ADs) | Aplicativos e Ferramentas | IAs | WhatsApp
Consultorias e Mentorias | Contabilidade | Cursos e Formações
Departamento Pessoal | Doações | Edição de Vídeo | Eletrônicos
Endereço Fiscal | Eventos | Impostos e Tributos | Jurídico
Marketplace | Material de Escritório | Meios de Pagamento
Ofertas | Outros | Pró-labore | Recarga e Chip
Registros e Documentos | Reserva de Caixa | Retirada de Lucro
Sócios | Treinamento e Educação | Expansão | Investimentos Futuros
Coprodução | Produtos | Serviços | Receita Financeira
```

**Centros de custo:** Anúncios | Cursos e Formações | Funcionários | Jurídico | Outros | Reserva de Caixa | Sócios | Softwares e Ferramentas

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
| `FinanceiroFechamentoPage` | `/financeiro/fechamento` | Tela 2 — fechamento mensal com KPIs |
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
