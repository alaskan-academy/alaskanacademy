# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
bun run dev        # Start Vite dev server

# Build
bun run build      # Production build
bun run build:dev  # Development build

# Quality
bun run lint       # ESLint

# Tests
bun run test       # Run all tests once (Vitest)
bun run test:watch # Watch mode
```

Run a single test file: `bun run test src/test/example.test.ts`

## Architecture

This is a **React + TypeScript + Vite** dashboard (Alaskan) for an e-commerce business selling physical products (velas, cosméticos, etc.). All data comes from **Supabase** (`src/lib/supabase.ts`) — no REST API layer in between; pages query Supabase directly.

### Global state via React Context

Two contexts wrap the entire app (`src/App.tsx`):

- **`FilterContext`** (`src/contexts/FilterContext.tsx`) — holds the active date range (`startDateStr`/`endDateStr` as `yyyy-MM-dd` strings), `contaIds` (contas de anúncio escolhidas; vazio = todas) e `empresaId` (empresa em foco; `null` = **Ambas**). Every page reads `useFilters()` and passes these values to Supabase queries to filter data. `empresaId` **sobrevive ao recarregar** (localStorage), diferente do período e das contas — ver a seção "Duas empresas" abaixo.
- **`SidebarContext`** (`src/contexts/SidebarContext.tsx`) — tracks sidebar collapsed/mobile state.

### Page + layout pattern

Every page follows this pattern:
1. Wrap content with `<DashboardLayout title="...">` (provides sidebar + sticky header with `GlobalFilters`).
2. Read `{ startDateStr, endDateStr, funilId }` from `useFilters()`.
3. Fetch data inside a `useCallback` that depends on those filter values, called by `useEffect`.
4. All queries filter by `gte("data_venda", startDateStr)` / `lte(...)` and `.eq("funil_id", funilId)` when set.
5. Exclude test orders: `.not("pedido_id", "like", "TEST%").not("pedido_id", "like", "LC-")`.

### Routes (src/App.tsx)

| Path | Page | Description |
|---|---|---|
| `/` | OverviewPage | Financial KPIs: revenue, costs, profit, margin, OBs, upsells |
| `/meta-ads` | MetaAdsPage | Meta Ads spend and performance |
| `/funil` | FunnelPage | Funnel conversion |
| `/vendas` | SalesPage | Sales list |
| `/utm` | UTMPage | UTM attribution analysis |
| `/clientes` | ClientsPage | Customer list |
| `/editores` | EditorsPage | Video editor performance tracking |
| `/configuracoes` | SettingsPage | Tax parameters + dashboard settings |
| `/financeiro/revisao` | FinanceiroRevisaoPage | Daily transaction review (pending categorization) |
| `/financeiro/fechamento` | FinanceiroFechamentoPage | Monthly closing with KPIs |
| `/financeiro/conciliacao` | FinanceiroConciliacaoPage | Full categorized bank statement |
| `/financeiro/notas-fiscais` | FinanceiroNotasFiscaisPage | Invoice and SaaS tools control |

**Financeiro module context:** `src/features/financeiro/CLAUDE.md`
**Financeiro implementation plan:** `src/features/financeiro/plan.md`

### Sidebar / dashboard switching

The sidebar (`AppSidebar`) lists funnels fetched from the `funis` table. Selecting a funnel sets `funilId` in `FilterContext`, which all pages react to. "Geral" means `funilId = null` (no funnel filter).

### Key Supabase tables/views

- `vendas` — sales records; `status` can be `aprovada`, `pendente`, `cancelada`, `expirada`; `is_upsell` flag; `utm_source` for traffic attribution
- `venda_itens` — line items (order bumps); `tipo` / `code_payt`. A coluna `converteu` existe mas é **constante**: `true` em 3.884 de 3.884 linhas, porque `fn_normalizar_venda_payt` grava `true` literal e o array `order_bumps` do payload da Payt só lista o que a pessoa levou. Não filtre por ela — a existência da linha *é* a conversão
- `vw_faturamento_liquido` — view aggregating revenue, platform fees, refunds, taxes, Meta investment per day/funnel
- `vw_reembolsos` — view with refund and chargeback totals
- `funis` — funnel definitions (id, nome, produto, ativo)
- `ofertas` — offer definitions with `tipo` (e.g. `upsell`, `orderbump`)
- `configuracoes` — key/value for fiscal params (`imposto_simples_nacional_pct`, `imposto_meta_ads_pct`, `custo_fixo_mensal`). **Uma linha por (chave, empresa)**: nulo é a geral. Ler por `fn_config(chave, empresa)`; `vw_config_por_empresa` diz se o número é próprio ou herdado
- `empresas` — Alaskan Academy · Aeliss Ltda · Ravenna (inativa). `slug` escolhe o token de cor em `index.css` (`--empresa-<slug>`); **nunca guardar hex aqui**
- `ofertas_editores` — é a tabela de **PROJETOS**, apesar do nome (dívida antiga). `producoes`, `funis`, `ad_accounts` e `utm_links` apontam para ela por `projeto_id`, e é dela que sai `empresa_id`
- `vw_dinheiro_sem_empresa` — vendas, transações e métricas que nasceram sem dono. Deve ficar em zero
- `fn_sugestao_parametros(empresa)` — o que os parâmetros fiscais foram DE VERDADE nos dois últimos meses fechados. O imposto sai sobre a receita do mês **anterior**, que é a base legal do Simples: sobre o mês corrente o número dá quase metade
- `editores`, `avaliacoes_criativos`, `empresas`, `ofertas_editores` — editor performance module

### Utilities

- `src/lib/formatters.ts` — `formatCurrency` (BRL), `formatNumber`, `formatPercent`; use these for all displayed values
- `src/lib/utils.ts` — `cn()` (clsx + tailwind-merge)
- `src/components/ui/` — shadcn/ui components; do not modify these directly

### Financial calculation logic (OverviewPage)

- **Lucro operacional** = faturamento_bruto − taxa_plataforma − reembolsos − imposto_simples − imposto_meta − investimento_meta
- **Lucro c/ custo fixo** = lucro − custo_fixo (prorated by period days: `(mensal / 30) * dias`)
- **Margem %** uses lucro operacional (without fixed cost) divided by faturamento_bruto
- **Upsells** são `vendas` com `is_upsell = true`, e **só isso**. O campo tem **duas fontes**, e é a armadilha 4 bem resolvida: `fn_marcar_upsell` (gatilho, lê `payload_webhook->>'type' IN ('upsell','manual_upsell')`) mantém o presente, e os backfills preencheram o passado — hoje **608 dos 650 vieram de backfill** e só 42 do webhook, porque a maioria das vendas é anterior à integração. **Nunca re-derivar `is_upsell` do payload**: isso apagaria 608 marcações, já que as linhas antigas não têm payload nenhum. **Nunca cruzar com `ofertas.tipo`**: um mesmo produto vende como upsell e direto (o Handify Completo: 57 e 9), então o tipo é da venda e não do produto. Exigir os dois em `vw_conversao_upsell` cortava 384 vendas / R$ 28.895,49 e deixava a análise vazia — armadilha 1 em forma de filtro. `ofertas` serve para dar **nome** ao upsell, por `LEFT JOIN`, jamais para decidir se ele é um
- **Order bumps** are `venda_itens` rows — uma linha só existe se a pessoa levou o bump. `vendas.valor_total` **já inclui** os bumps: receita de bump é uma fatia do faturamento, nunca uma parcela a somar por fora (medido: `valor_total − bumps` bate com o preço de quem comprou sem bump, ±R$ 0,80 nos três produtos de maior volume)

### Editor performance module (EditorsPage)

Tab-based page at `/editores` with sub-components in `src/components/editores/`:
- `PerfisTab` — editor profiles
- `AvaliacoesTab` — ad assessment history  
- `DesempenhoTab` — performance charts
- `ConfiguracaoTab` — evaluation criteria
- `EmpresasOfertasTab` — companies and offers config

## Duas empresas: o que CARIMBA e o que DERIVA

Desde 01/09/2026 o painel atende duas operações — **Alaskan Academy** e
**Aeliss Ltda** — e a regra que separa as duas cabe numa linha:

> **Quem escreve dinheiro CARIMBA a empresa. O resto DERIVA do projeto.**

| | de onde vem | comportamento |
|---|---|---|
| `vendas` / `vendas_payt` | **qual Payt recebeu** (a chave de integração) | carimbada, imutável |
| `transacoes` | **qual conta bancária** (carimbada na importação) | carimbada, imutável |
| `metricas_meta` | conta → projeto, **carimbada no INSERT** | passado congela sozinho |
| `documentos_fiscais`, `caixa_config` | a empresa dona da NF / da conta | carimbada |
| produção, criativos, funis, UTM, radar | `ofertas_editores.empresa_id`, lido AGORA | **acompanha** o projeto |

O motivo de serem dois mecanismos: faturamento **congela** porque quem recebeu
recebeu — quando um projeto troca de empresa, as vendas passadas continuam de
quem as recebeu. Trabalho **acompanha**, porque quando o Desafios virou Aeliss os
289 cards dele viraram junto.

**Nunca dar `empresa_id` a `producoes`.** Seria espelho precisando de gatilho —
a quarta armadilha logo abaixo. A empresa de um card sai de
`useProjetosDaEmpresa()` (`src/hooks/use-projetos-da-empresa.ts`), que tem três
estados e o terceiro importa: `undefined` = ainda não sei, **quem chama espera**.
Sem ele a primeira busca sai sem filtro e a tela mostra as duas empresas por um
instante — o suficiente para alguém mexer no card errado.

**Ler pode somar; gravar exige empresa escolhida.** Em "Ambas" os números
aparecem lado a lado ou somados com o rótulo dizendo isso, mas importação de
extrato, lançamento manual e edição do saldo da Reserva **recusam** sem uma
empresa selecionada: um extrato é de uma conta bancária, e gravar num limbo não
é o mesmo que somar para olhar.

**Nunca casar dinheiro por `produto`.** `produto` é rótulo, não dono: `velas`
existe nas duas empresas. `vw_faturamento_liquido` e `vw_conciliacao_meta` levam
a empresa na chave do casamento desde 31/08/2026.

**`configuracoes` deixou de ter uma linha por chave.** `empresa_id` nulo é a
geral; preenchido sobrepõe. Ler sempre por `fn_config(chave, empresa)`, nunca
direto da tabela — e um `UPDATE` sem `.is('empresa_id', null)` sobrescreve a
alíquota de todas as empresas devolvendo sucesso. Há um teste que lê o
código-fonte para impedir isso (`src/test/configuracoes-por-empresa.test.ts`).

## Quatro armadilhas que já custaram caro neste projeto

Não são princípios gerais de engenharia: são os quatro erros que apareceram
repetidamente aqui, cada um com o preço que cobraram. Vale checar contra esta
lista antes de criar campo, tela ou tabela.

### 1. Dois campos dizendo a mesma coisa — eles SEMPRE divergem

Cinco casos encontrados: `funis.ativo` × `funis.status`, `testes_funis.kpi` ×
`metrica`, `testes_funis.funil_id` × `funil_ids`, `funis.oferta_id` ×
`projeto_id`, e dois blocos de checkout no mesmo formulário.

O preço: `ativo=false` com `status='ativo'` escondeu **4 REVs de Produção** por
meses — `.eq('ativo', true)` em `dataCache.ts`, `KanbanView.tsx` e
`CriativoFormModal.tsx` os filtrava fora, e o sistema dizia "1 funil ativo"
quando havia 5. E dos 7 testes com `kpi` e `metrica` preenchidos, **6 se
contradiziam**, porque ninguém sabia qual campo era para quê.

**Antes de criar um campo, procurar se algum existente já responde aquilo.**
Quando os dois precisam coexistir por compatibilidade, derivar um do outro por
gatilho — nunca deixar os dois editáveis.

### 2. Criar sem medir

134 links de UTM gerados e nenhuma tela dizendo qual vendeu. 38 testes com 3
vencedores preenchidos. 36 order bumps cadastrados, 10 dos quais nunca venderam
nada. O Google Chat registrando alterações que ninguém voltava para avaliar.

O padrão é sempre o mesmo: a tela de cadastro existe, a de resultado não — e
sem resultado ninguém volta, então o cadastro envelhece e vira ficção.

**Nenhuma tela de cadastro sem a coluna de resultado ao lado.** Foi o que
consertou os UTMs (vendas por link) e os order bumps (que viraram leitura de
`venda_itens` em vez de campo digitado).

### 3. Lista fixa no código que envelhece em silêncio

O DRE do Financeiro escondia **R$ 10.065** porque as categorias estavam
listadas à mão e uma nova não entrou. `fn_checklist_fiscal` e o mapa de custos
tinham o mesmo defeito.

**Derivar de tabela, nunca listar no código.** Se a lista precisa existir no
código, ela precisa de um teste que falhe quando o banco ganhar um item novo.

### 4. Retrato único que nunca se atualiza

`funil_checkouts` nasceu de um `insert ... select` das vendas existentes e
nada inseria checkout novo. Um checkout criado depois nunca apareceria, e as
vendas dele ficariam sem REV para sempre — sem nada na tela denunciando, porque
a fila continuaria mostrando os mesmos 97. Já havia 1 venda órfã quando foi
descoberto, e só porque alguém perguntou.

**Todo espelho precisa de gatilho, não de carga inicial.** A carga inicial
preenche o passado; o gatilho é que mantém o presente.

### E uma regra de leitura, que vale para as quatro

Vários destes só apareceram porque alguém desconfiou de um número — "283 vendas
e só 8 order bumps?" levou a descobrir que carrinho abandonado estava sendo
contado como venda. **Quando um número parecer estranho, ele provavelmente
está.** Conferir contra uma segunda fonte antes de explicá-lo.

## UX/UI guidelines

- **Sidebar stays flat**: a feature with multiple sub-pages gets exactly ONE top-level sidebar entry (same as every other item, no chevron/expand-in-sidebar). Sub-page switching happens *inside* the feature's pages via an in-page nav rendered at the top of `DashboardLayout`'s content — see `FinanceiroNav.tsx` (pill-style `NavLink` row) used by all `src/features/financeiro/pages/*`. Do not nest sub-items inside the sidebar itself — **nem para o seletor de dashboard, que deixou de existir**: o grupo "Geral" que aninhava Resumo/Meta Ads/Vendas/UTM/Tendências foi desfeito quando os funis saíram da barra e o recorte por conta virou filtro do cabeçalho. Hoje a sidebar não tem exceção: nenhum item abre.
- **A identidade da Alaskan vive nos tokens de `src/index.css`** — nunca em hex escrito dentro de componente. O manual tem quatro cores (`#BD1218` vermelho · `#004283` azul · `#19255A` marinho · `#BEB9B0` cinza), todas pensadas para impresso: o que se ajusta para tela escura é a **luminosidade**, matiz e saturação continuam sendo os do Pantone. A regra que organiza tudo: **vermelho é a MARCA (`--marca`, só o símbolo) e o que se PERDE (`--destructive`); azul (`--primary`) é o que se clica.** Se o vermelho virar cor de interface, o número negativo perde o único sinal que tem. Vermelho também fica fora das séries de gráfico (`--chart-*`) pelo mesmo motivo. Verde e âmbar não vêm da marca porque não podem: "deu certo" e "atenção" são convenções que o olho traz de fora.
- **Inter para a interface, Poppins (`font-display`) para a marca e títulos**: o manual especifica Poppins para a assinatura, não para corpo de texto — ela é larga e perde legibilidade em tabela de 11px.
- **Sidebar = onde eu vou; cabeçalho = quem eu sou e o que é meu**: controle global (busca, **empresa**, notificações, conta) vive na faixa fixa do `DashboardLayout`, nunca na sidebar. O **seletor de empresa** mora ali e não na fila de filtros por essa mesma regra — filtro recorta o conteúdo abaixo, empresa troca a operação inteira —, e também por uma razão prática: o Financeiro passa `hideFilters`, e lá embaixo o seletor sumiria justo na área onde a separação mais importa. Ele só aparece com mais de uma empresa ativa, e cada uma leva um ponto de 6px com a cor da marca (`--empresa-<slug>`). Ela lista lugares; sino e conta não são lugares, e no rodapé eles dividiam uma coluna de ícones com o recolher — três classes de ação desenhadas igual, sendo que uma encerrava a sessão num clique. O recolher ficou na sidebar, no topo ao lado da marca, porque é propriedade da barra e não da pessoa.
- **Os grupos da sidebar são perguntas, não tipos de conteúdo**: `Resultado` (quanto entrou e sobrou) · `Aquisição` (de onde vêm as vendas e o que a mídia faz) · `Operação` (o trabalho do dia) · `Estrutura` (cadastro, acesso, parâmetro). Página nova entra pelo motivo de abrir, não pelo que ela tem dentro — "é número" não é critério, senão Financeiro e Meta Ads voltam para a mesma gaveta.
- **Consistency over novelty**: new pages reuse existing visual patterns (summary cards row → toolbar/filter row → table or content) rather than inventing new layouts. Check a sibling page (e.g. `EditorsPage`, `ProcessosPage`) before designing a new screen.
- **Status/state always has a visual cue**: pending/auto/confirmed-style states use colored badges (see `STATUS_LABEL` pattern in `FinanceiroRevisaoPage.tsx`), not just text.
- **Empty and loading states are mandatory** for any table/list — never leave a blank table mid-fetch or on zero results; show a centered muted message.
- **Destructive or bulk actions require a confirmation step** (modal or `useConfirm` hook) — never fire on a single click with no undo path.

## Security guidelines

- **Never commit credentials, API keys, or tokens** to any file in this repo (including `.md` docs, scripts, or comments). Admin/test credentials used during development must stay only in chat/local environment — never in source control.
- **RLS is mandatory** on every new Supabase table. Default policy for internal admin-tool tables: `FOR ALL TO authenticated USING (true) WITH CHECK (true)` unless the data needs per-user scoping — never leave a table with RLS disabled or `anon` write access.
- **Validate/sanitize any user-supplied text rendered as HTML** (e.g. `MarkdownRenderer`) — no `dangerouslySetInnerHTML` with unescaped input.
- **CSV/file imports are untrusted input**: parse defensively (the `parseCsv` pattern in `FinanceiroRevisaoPage.tsx` skips malformed rows instead of throwing), never `eval`/dynamically execute imported content.
- **Webhooks** (e.g. future Payt webhook) must validate signatures and use idempotency keys — never trust payload data blindly or process the same event twice.
