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

- **`FilterContext`** (`src/contexts/FilterContext.tsx`) — holds the active date range (`startDateStr`/`endDateStr` as `yyyy-MM-dd` strings) and `funilId` (selected funnel). Every page reads `useFilters()` and passes these values to Supabase queries to filter data.
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
- `venda_itens` — line items (order bumps); `converteu` boolean; `tipo` / `code_payt`
- `vw_faturamento_liquido` — view aggregating revenue, platform fees, refunds, taxes, Meta investment per day/funnel
- `vw_reembolsos` — view with refund and chargeback totals
- `funis` — funnel definitions (id, nome, produto, ativo)
- `ofertas` — offer definitions with `tipo` (e.g. `upsell`, `orderbump`)
- `configuracoes` — key/value table for fiscal params (`imposto_simples_nacional_pct`, `imposto_meta_ads_pct`, `custo_fixo_mensal`)
- `editores`, `avaliacoes_criativos`, `empresas`, `ofertas_editores` — editor performance module

### Utilities

- `src/lib/formatters.ts` — `formatCurrency` (BRL), `formatNumber`, `formatPercent`; use these for all displayed values
- `src/lib/utils.ts` — `cn()` (clsx + tailwind-merge)
- `src/components/ui/` — shadcn/ui components; do not modify these directly

### Financial calculation logic (OverviewPage)

- **Lucro operacional** = faturamento_bruto − taxa_plataforma − reembolsos − imposto_simples − imposto_meta − investimento_meta
- **Lucro c/ custo fixo** = lucro − custo_fixo (prorated by period days: `(mensal / 30) * dias`)
- **Margem %** uses lucro operacional (without fixed cost) divided by faturamento_bruto
- **Upsells** are `vendas` rows where `is_upsell = true` AND the product name matches an `ofertas` entry with `tipo = 'upsell'`
- **Order bumps** are `venda_itens` rows where `converteu = true`

### Editor performance module (EditorsPage)

Tab-based page at `/editores` with sub-components in `src/components/editores/`:
- `PerfisTab` — editor profiles
- `AvaliacoesTab` — ad assessment history  
- `DesempenhoTab` — performance charts
- `ConfiguracaoTab` — evaluation criteria
- `EmpresasOfertasTab` — companies and offers config

## UX/UI guidelines

- **Sidebar grouping**: a feature with multiple sub-pages (4+) gets ONE collapsible entry in the sidebar (icon + label + chevron that expands a sub-list), not N flat top-level entries. Follow the existing pattern in `AppSidebar.tsx` (`financeiroOpen` state, indented sub-items with `border-l`) — this is how "Financeiro" and the dashboard/funnel switcher both work. Keep the sidebar's top-level item count low; nest, don't flatten.
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
