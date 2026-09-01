# Plano de Implementação — Módulo Financeiro

Baseado no PRD Financeiro Alaskan, seção 4 (Escopo) e 10 (Critérios de Aceitação).

---

## Status atual

- [x] Estrutura de pastas criada (`pages/`, `components/`)
- [x] 4 páginas em branco criadas
- [x] CLAUDE.md do módulo escrito
- [x] Rotas adicionadas ao App.tsx
- [x] Entradas no sidebar (AppSidebar.tsx)
- [x] Schema do banco aplicado no Supabase
- [x] Implementação das telas

---

## Fase 1 — Infraestrutura (sem UI)

### 1.1 Rotas e navegação
- Adicionar rotas `/financeiro/*` no `App.tsx`
- Adicionar grupo "Financeiro" no `AppSidebar.tsx` com 4 sub-itens
- Rota padrão `/financeiro` → redireciona para `/financeiro/revisao`

### 1.2 Schema do Supabase

Executar o SQL abaixo no Supabase MCP (projeto `prtkfwwqpcziexgipoqk`):

```sql
-- Transações do extrato bancário (Conta Simples)
CREATE TABLE transacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data date NOT NULL,
  descricao text NOT NULL,
  valor numeric(12,2) NOT NULL,           -- positivo = entrada, negativo = saída
  categoria text,
  centro_custo text,
  status_revisao text DEFAULT 'pendente', -- 'pendente' | 'auto_categorizado' | 'confirmado'
  fonte text DEFAULT 'conta_simples',
  referencia_externa text,                -- ID da transação na Conta Simples
  created_at timestamptz DEFAULT now()
);

-- Regras de categorização automática
CREATE TABLE regras_categoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  padrao text NOT NULL,                   -- texto a buscar na descrição
  tipo_match text DEFAULT 'contains',     -- 'contains' | 'exact' | 'regex'
  categoria text NOT NULL,
  centro_custo text,
  confianca numeric(3,2) DEFAULT 1.0,     -- 0.0 a 1.0
  ativo boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Vendas recebidas via webhook da Payt
CREATE TABLE vendas_payt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payt_transaction_id text UNIQUE NOT NULL,
  data_venda timestamptz NOT NULL,
  produto text NOT NULL,
  valor_bruto numeric(12,2) NOT NULL,
  valor_liquido numeric(12,2),
  cliente_email text,
  status text,                            -- 'approved' | 'refunded' | etc.
  raw_payload jsonb,
  created_at timestamptz DEFAULT now()
);

-- Métricas diárias importadas da UTMify
CREATE TABLE metricas_diarias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data date NOT NULL,
  produto text,
  gasto_ads numeric(12,2),
  receita numeric(12,2),
  leads integer,
  cpl numeric(10,2),
  origem text DEFAULT 'utmify',
  created_at timestamptz DEFAULT now(),
  UNIQUE(data, produto)
);

-- Ferramentas SaaS e assinaturas recorrentes
CREATE TABLE ferramentas_saas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  categoria text,
  valor_mensal numeric(10,2),
  moeda text DEFAULT 'BRL',
  renovacao_dia integer,                  -- dia do mês que renova
  ativo boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Controle de notas fiscais
CREATE TABLE notas_fiscais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ferramenta_id uuid REFERENCES ferramentas_saas(id),
  mes date NOT NULL,                      -- primeiro dia do mês de competência
  status text DEFAULT 'pendente',         -- 'pendente' | 'recebida' | 'enviada'
  drive_url text,
  observacoes text,
  created_at timestamptz DEFAULT now()
);

-- RLS básico (ajustar conforme política de acesso)
ALTER TABLE transacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE regras_categoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendas_payt ENABLE ROW LEVEL SECURITY;
ALTER TABLE metricas_diarias ENABLE ROW LEVEL SECURITY;
ALTER TABLE ferramentas_saas ENABLE ROW LEVEL SECURITY;
ALTER TABLE notas_fiscais ENABLE ROW LEVEL SECURITY;
```

### 1.3 Seed de regras de categorização
- Importar regras do `Fluxo_de_Caixa_Alaskan_2026.xlsx` (500+ transações históricas)
- Script de seed: analisar descrições únicas → criar `regras_categoria`
- **Fazer isso após tela 1 estar funcional**, pois o usuário pode refinar as regras pelo UI

---

## Fase 2 — Tela 1: Revisão diária (`/financeiro/revisao`)

**Objetivo:** ver e categorizar transações pendentes.

Componentes a criar:
- `TransacoesPendentesTable` — lista transações com `status_revisao = 'pendente'`
- `CategorizarModal` — seleciona categoria + centro de custo + opção "criar regra"
- `ResumoRevisao` — contador de pendentes / categorizadas hoje

Fluxo:
1. Busca `transacoes WHERE status_revisao = 'pendente' ORDER BY data DESC`
2. Usuário clica em uma linha → modal de categorização
3. Salva categoria + muda status para `'confirmado'`
4. Se "criar regra" marcado → insere em `regras_categoria`

Upload de extrato (Fase 2b):
- Botão "Importar extrato" → upload CSV/OFX da Conta Simples
- Parser no frontend → insert em `transacoes` com `status_revisao = 'pendente'`
- Aplica regras automaticamente antes de salvar

---

## Fase 3 — Tela 3: Conciliação bancária (`/financeiro/conciliacao`)

**Objetivo:** visão completa do extrato categorizado com filtros.

Componentes:
- `ExtratoTable` — todas as transações, filtráveis por mês/categoria/centro_custo
- `FiltrosExtrato` — date range, categoria, centro de custo, status
- `TotaisPorCategoria` — sidebar com somatório por categoria no período

---

## Fase 4 — Tela 2: Fechamento mensal (`/financeiro/fechamento`)

**Objetivo:** visão gerencial do mês com KPIs e comparativos.

KPIs principais (do PRD):
- Receita bruta (Payt) vs líquida
- Total de custos por centro de custo
- Margem operacional
- Gasto com ads vs receita (ROAS)
- Custo por lead (UTMify)

Componentes:
- `KPICards` — 6-8 métricas em cards
- `GraficoCustosPorCategoria` — pizza ou barras
- `ComparativoMensal` — tabela mês a mês últimos 6 meses
- Botão "Exportar pacote" → gera planilha + lista NFs do período

---

## Fase 5 — Tela 4: Notas fiscais (`/financeiro/notas-fiscais`)

**Objetivo:** controlar quais ferramentas enviaram NF no mês.

Componentes:
- `FerramentasTable` — lista de `ferramentas_saas` ativas
- `StatusNFBadge` — pendente / recebida / enviada
- `MesSelector` — navegar entre meses
- Ação: marcar como recebida + colar link do Drive

---

## Fase 6 — Webhook Payt (backend)

Criar Supabase Edge Function `payt-webhook`:
- `POST /functions/v1/payt-webhook`
- Valida assinatura do webhook
- Insere em `vendas_payt` com idempotência (`ON CONFLICT (payt_transaction_id) DO NOTHING`)
- Retorna 200 imediatamente

---

## Prioridade de execução

1. **Fase 1.1** — rotas + sidebar (hoje)
2. **Fase 1.2** — schema Supabase (hoje, requer aprovação do SQL)
3. **Fase 2** — Tela de Revisão (primeira implementação real)
4. **Fase 3** → **Fase 4** → **Fase 5** → **Fase 6**

---

# Fase 7 — Resultado por projeto

A tela `/financeiro/resultado` responde "quanto sobrou este mês" para a empresa
inteira. O recorte por projeto é o passo seguinte, e **não** é a mesma tela com
um filtro: há dois problemas de fundo que precisam ser resolvidos antes, senão
o número sai estruturalmente errado.

## 7.1 — A chave: `ofertas.projeto_id`

Hoje a venda vira projeto pelo NOME DO PRODUTO, e o nome não é dono:
`velas` aponta para três projetos diferentes (Desafios, Velas Lembrancinhas,
Workshop Buquê) em mais de mil vendas.

Medido em 01/09/2026:

    receita atribuível a um projeto     65,5%
    gasto do Meta atribuível             99,7%

Com essa diferença, o lucro por projeto sai negativo por construção — 34% da
receita fica de fora enquanto quase todo o custo entra. **Nenhuma tela conserta
isso**; é a chave que está errada.

O conserto é uma coluna `projeto_id` em `ofertas` (57 linhas, 47 com categoria),
e a atribuição passa a sair dela em vez do texto. Enquanto isso não existir, a
Fase 7.2 não deve ser construída.

Junto: `vw_faturamento_liquido` e `vw_conciliacao_meta` já levam a empresa na
chave do casamento; o projeto entra do mesmo jeito.

## 7.2 — A diluição do custo da empresa

O custo que não é de nenhum projeto (contabilidade, jurídico, ferramentas)
precisa ser rateado. Duas decisões, e as duas são ESCOLHA e não fato — então a
régua fica visível na tela, não escondida na fórmula.

**Quem entra no rateio.** "Projeto ativo vendendo agora" precisa de definição.
Proposta: teve venda aprovada no período OU teve gasto de anúncio no período.
Só `ofertas_editores.ativo` não serve — projeto pode estar ativo no cadastro e
parado há meses.

**Como se divide.** Por fatia da receita, não por partes iguais. Partes iguais
fazem um projeto pequeno carregar o mesmo peso de um grande, e a conclusão se
inverte. O filtro da tela mostra qual régua está em uso.

**A armadilha da diluição:** projeto que não vendeu no mês recebe zero de custo
fixo e aparece melhor do que é. Se o rateio for por receita, isso é inevitável
— então a tela precisa dizer quantos projetos entraram no rateio naquele mês.

## 7.3 — O que NÃO muda

A cascata é a mesma, com as mesmas fontes e as mesmas etiquetas. O imposto
continua vindo do extrato (ou presumido), e imposto não tem projeto: ele é da
empresa e entra no rateio junto com o custo da empresa.

## Ordem

1. **7.1** `ofertas.projeto_id` + migração da atribuição — bloqueia o resto
2. medir de novo os 65,5%: só seguir quando estiver perto dos 99,7%
3. **7.2** filtro de projeto na tela de Resultado, com a régua do rateio visível
