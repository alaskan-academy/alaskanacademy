import { useEffect, useState, useCallback } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { KPICard } from "@/components/KPICard";
import { useFilters } from "@/contexts/FilterContext";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/formatters";
import {
  DollarSign,
  ShoppingBag,
  Target,
  TrendingUp,
  BarChart3,
  RefreshCcw,
  Clock,
  Percent,
  Receipt,
  BadgeDollarSign,
  CreditCard,
  RefreshCw,
  TrendingDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { differenceInDays, parseISO, subDays, format } from "date-fns";

function custoFixoProporcional(mensal: number, start?: string, end?: string) {
  if (!mensal) return 0;
  if (!start || !end) return mensal;
  const dias = Math.max(1, differenceInDays(parseISO(end), parseISO(start)) + 1);
  return (mensal / 30) * dias;
}

function periodoAnterior(start?: string, end?: string) {
  if (!start || !end) return { start: undefined, end: undefined };
  const dias = Math.max(1, differenceInDays(parseISO(end), parseISO(start)) + 1);
  const novoEnd = format(subDays(parseISO(start), 1), "yyyy-MM-dd");
  const novoStart = format(subDays(parseISO(start), dias), "yyyy-MM-dd");
  return { start: novoStart, end: novoEnd };
}

function variacao(atual: number, anterior: number) {
  if (!anterior) return null;
  return ((atual - anterior) / anterior) * 100;
}

export default function OverviewPage() {
  const { startDateStr, endDateStr, product } = useFilters();
  const [kpis, setKpis] = useState<any>({});
  const [kpisAnt, setKpisAnt] = useState<any>({});
  const [obsData, setObsData] = useState<any[]>([]);
  const [upsellData, setUpsellData] = useState<any[]>([]);
  const [prodData, setProdData] = useState<any[]>([]);
  const [reembolsos, setReembolsos] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const pf = product !== "todos" ? product : null;

    // ── Período atual ──────────────────────────────────────────
    let q1 = supabase.from("vw_faturamento_liquido").select("*");
    if (startDateStr && endDateStr) q1 = q1.gte("data", startDateStr).lte("data", endDateStr);
    if (pf) q1 = q1.eq("produto", pf);

    let q2 = supabase.from("vw_conversao_obs").select("*").order("taxa_conversao_pct", { ascending: false });
    if (pf) q2 = q2.eq("produto", pf);

    let q3 = supabase.from("vw_conversao_upsell").select("*").order("taxa_conversao_pct", { ascending: false });
    if (pf) q3 = q3.eq("produto", pf);

    let q4 = supabase
      .from("vendas")
      .select("valor_total,valor_oferta_principal,produto")
      .eq("status", "aprovada")
      .not("pedido_id", "like", "TEST%")
      .not("pedido_id", "like", "LC-%");
    if (startDateStr && endDateStr) q4 = q4.gte("data_venda", startDateStr).lte("data_venda", endDateStr);
    if (pf) q4 = q4.eq("produto", pf);

    let q5 = supabase
      .from("vendas")
      .select("valor_total")
      .eq("status", "pendente")
      .not("pedido_id", "like", "TEST%")
      .not("pedido_id", "like", "LC-%");
    if (startDateStr && endDateStr) q5 = q5.gte("data_venda", startDateStr).lte("data_venda", endDateStr);
    if (pf) q5 = q5.eq("produto", pf);

    const q6 = supabase.from("vw_reembolsos").select("*").single();

    let q7 = supabase.from("vw_vendas_por_produto_principal").select("*");
    if (pf) q7 = q7.eq("produto", pf);

    // ── Período anterior ──────────────────────────────────────
    const ant = periodoAnterior(startDateStr, endDateStr);
    let qAnt = supabase.from("vw_faturamento_liquido").select("faturamento_bruto,investimento_meta");
    if (ant.start && ant.end) qAnt = qAnt.gte("data", ant.start).lte("data", ant.end);
    if (pf) qAnt = qAnt.eq("produto", pf);

    let qAntV = supabase
      .from("vendas")
      .select("valor_total,valor_oferta_principal")
      .eq("status", "aprovada")
      .not("pedido_id", "like", "TEST%")
      .not("pedido_id", "like", "LC-%");
    if (ant.start && ant.end) qAntV = qAntV.gte("data_venda", ant.start).lte("data_venda", ant.end);
    if (pf) qAntV = qAntV.eq("produto", pf);

    const [r1, r2, r3, r4, r5, r6, r7, rAnt, rAntV] = await Promise.all([q1, q2, q3, q4, q5, q6, q7, qAnt, qAntV]);

    // ── Calcular KPIs ─────────────────────────────────────────
    const fatRows = r1.data || [];
    const fatBruto = fatRows.reduce((s: number, r: any) => s + Number(r.faturamento_bruto || 0), 0);
    const taxaPlat = fatRows.reduce((s: number, r: any) => s + Number(r.taxa_plataforma || 0), 0);
    const taxaPlatPct = fatBruto > 0 ? (taxaPlat / fatBruto) * 100 : 0;
    const fatLiquido = fatBruto - taxaPlat; // após taxa plataforma
    const impostoSimples = fatRows.reduce((s: number, r: any) => s + Number(r.imposto_simples || 0), 0);
    const impostoMeta = fatRows.reduce((s: number, r: any) => s + Number(r.imposto_meta_ads || 0), 0);
    const investimento = fatRows.reduce((s: number, r: any) => s + Number(r.investimento_meta || 0), 0);
    const simplesPct = fatRows.length > 0 ? Number(fatRows[0].simples_pct || 0) : 0;
    const metaPct = fatRows.length > 0 ? Number(fatRows[0].meta_pct || 0) : 0;
    const custoMensal = fatRows.length > 0 ? Number(fatRows[0].custo_fixo || 0) : 0;
    const custoFixo = custoFixoProporcional(custoMensal, startDateStr, endDateStr);
    const reembolsosVal = fatRows.reduce((s: number, r: any) => s + Number(r.reembolsos || 0), 0);
    // Lucro real = fat bruto - todas deduções
    const lucro = fatBruto - taxaPlat - reembolsosVal - impostoSimples - impostoMeta - investimento - custoFixo;
    const margemPct = fatBruto > 0 ? (lucro / fatBruto) * 100 : 0;
    const roas = investimento > 0 ? fatBruto / investimento : 0;

    const vendasRows = r4.data || [];
    const vendasAprovadas = vendasRows.length;
    const ticketMedio = vendasAprovadas > 0 ? fatBruto / vendasAprovadas : 0;

    const pendentes = r5.data || [];
    const pendentesValor = pendentes.reduce((s: number, r: any) => s + Number(r.valor_total || 0), 0);

    const obsRows = (r2.data || []).filter((r: any) => (r.total_convertidos || 0) > 0);
    const taxaOb =
      obsRows.length > 0
        ? obsRows.reduce((s: number, r: any) => s + Number(r.taxa_conversao_pct || 0), 0) / obsRows.length
        : 0;
    setObsData(obsRows);

    const upsellRows = (r3.data || []).filter((r: any) => (r.total_upsells || 0) > 0);
    const taxaUpsell =
      upsellRows.length > 0
        ? upsellRows.reduce((s: number, r: any) => s + Number(r.taxa_conversao_pct || 0), 0) / upsellRows.length
        : 0;
    setUpsellData(upsellRows);

    // Reembolsos e chargeback
    const remObj = r6.data || {};
    setReembolsos(remObj);

    // Produtos
    setProdData((r7.data || []).sort((a: any, b: any) => b.vendas_aprovadas - a.vendas_aprovadas));

    setKpis({
      fatBruto,
      fatLiquido,
      lucro,
      taxaPlat,
      taxaPlatPct,
      reembolsosVal,
      impostoSimples,
      impostoMeta,
      investimento,
      custoFixo,
      custoMensal,
      margemPct,
      roas,
      simplesPct,
      metaPct,
      vendasAprovadas,
      ticketMedio,
      taxaOb,
      taxaUpsell,
      pendentesQtd: pendentes.length,
      pendentesValor,
    });

    // ── Período anterior ──────────────────────────────────────
    const antFatRows = rAnt.data || [];
    const antFatBruto = antFatRows.reduce((s: number, r: any) => s + Number(r.faturamento_bruto || 0), 0);
    const antInv = antFatRows.reduce((s: number, r: any) => s + Number(r.investimento_meta || 0), 0);
    const antVendas = (rAntV.data || []).length;
    const antRoas = antInv > 0 ? antFatBruto / antInv : 0;
    setKpisAnt({ fatBruto: antFatBruto, vendasAprovadas: antVendas, roas: antRoas });

    setLastUpdate(new Date());
    setLoading(false);
  }, [startDateStr, endDateStr, product]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const margemBadge = kpis.margemPct > 30 ? "text-success" : kpis.margemPct >= 15 ? "text-warning" : "text-destructive";

  const custoLabel = () => {
    if (!kpis.custoMensal) return null;
    if (!startDateStr || !endDateStr) return "mensal";
    const dias = Math.max(1, differenceInDays(parseISO(endDateStr), parseISO(startDateStr)) + 1);
    return `${dias}d (${dias}/30)`;
  };

  const VarBadge = ({ atual, anterior }: { atual: number; anterior: number }) => {
    const v = variacao(atual, anterior);
    if (v === null) return null;
    const pos = v >= 0;
    return (
      <span
        className={cn("flex items-center gap-0.5 text-xs font-medium mt-1", pos ? "text-success" : "text-destructive")}
      >
        {pos ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
        {Math.abs(v).toFixed(1)}% vs período anterior
      </span>
    );
  };

  return (
    <DashboardLayout title="Visão Geral">
      {/* Botão Atualizar */}
      <div className="flex justify-end mb-4">
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-secondary border border-border rounded-lg hover:border-primary/50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          {loading ? "Atualizando..." : lastUpdate ? `Atualizado ${format(lastUpdate, "HH:mm")}` : "Atualizar"}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground animate-pulse">Carregando dados...</div>
        </div>
      ) : (
        <>
          {/* ── Faturamento: bruto / líquido / lucro ─────────── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="bg-card rounded-lg border border-border p-5">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Faturamento Bruto
              </div>
              <div className="text-2xl font-bold text-foreground">
                {formatCurrency(Math.max(0, kpis.fatBruto || 0))}
              </div>
              <VarBadge atual={kpis.fatBruto} anterior={kpisAnt.fatBruto} />
              <div className="text-xs text-muted-foreground mt-1">
                {formatNumber(kpis.vendasAprovadas || 0)} vendas aprovadas
              </div>
            </div>
            <div className="bg-card rounded-lg border border-border p-5">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Faturamento Líquido
              </div>
              <div className="text-2xl font-bold text-foreground">
                {formatCurrency(Math.max(0, kpis.fatLiquido || 0))}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                após taxa Payt ({(kpis.taxaPlatPct || 0).toFixed(2)}%)
              </div>
            </div>
            <div className="bg-card rounded-lg border border-border p-5">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Lucro</div>
              <div className={cn("text-2xl font-bold", (kpis.lucro || 0) >= 0 ? "text-success" : "text-destructive")}>
                {formatCurrency(kpis.lucro || 0)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">pós impostos e investimento</div>
            </div>
          </div>

          {/* ── KPIs linha 2 ─────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="bg-card rounded-lg border border-border p-5">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Vendas Aprovadas
              </div>
              <div className="text-2xl font-bold text-foreground">{formatNumber(kpis.vendasAprovadas || 0)}</div>
              <VarBadge atual={kpis.vendasAprovadas} anterior={kpisAnt.vendasAprovadas} />
            </div>
            <KPICard
              title="Ticket Médio"
              value={formatCurrency(kpis.ticketMedio || 0)}
              icon={<Target className="h-4 w-4" />}
            />
            <div className="bg-card rounded-lg border border-border p-5">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ROAS</div>
              <div
                className={cn(
                  "text-2xl font-bold",
                  kpis.roas >= 3 ? "text-success" : kpis.roas >= 1 ? "text-warning" : "text-destructive",
                )}
              >
                {(kpis.roas || 0).toFixed(2)}x
              </div>
              <VarBadge atual={kpis.roas} anterior={kpisAnt.roas} />
            </div>
            <KPICard
              title="Investimento Meta"
              value={formatCurrency(kpis.investimento || 0)}
              icon={<TrendingUp className="h-4 w-4" />}
            />
          </div>

          {/* ── KPIs linha 3 ─────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="bg-card rounded-lg border border-border p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Margem %</span>
                <Percent className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className={cn("text-2xl font-bold", margemBadge)}>{formatPercent(kpis.margemPct || 0)}</div>
            </div>
            <KPICard
              title="Imposto Simples"
              value={formatCurrency(kpis.impostoSimples || 0)}
              icon={<Receipt className="h-4 w-4" />}
            />
            <KPICard
              title="Imposto Meta Ads"
              value={formatCurrency(kpis.impostoMeta || 0)}
              icon={<BadgeDollarSign className="h-4 w-4" />}
            />
            <div className="bg-card rounded-lg border border-border p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Taxa Payt</span>
                <CreditCard className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-2xl font-bold text-foreground">{formatCurrency(kpis.taxaPlat || 0)}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {(kpis.taxaPlatPct || 0).toFixed(2)}% do faturamento
              </div>
            </div>
          </div>

          {/* ── KPIs linha 4 ─────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <KPICard title="Taxa OB" value={formatPercent(kpis.taxaOb || 0)} icon={<Target className="h-4 w-4" />} />
            <KPICard
              title="Taxa Upsell"
              value={formatPercent(kpis.taxaUpsell || 0)}
              icon={<TrendingUp className="h-4 w-4" />}
            />
            {/* Reembolsos com % */}
            <div className="bg-card rounded-lg border border-border p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Reembolsos</span>
                <RefreshCcw className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-2xl font-bold text-foreground">
                {formatCurrency(reembolsos.valor_reembolsos || 0)}
              </div>
              <div className="text-xs text-destructive mt-1">
                {reembolsos.qtd_reembolsos || 0} · {reembolsos.pct_reembolsos || 0}% do total
              </div>
            </div>
            {/* Chargeback com % */}
            <div className="bg-card rounded-lg border border-border p-5">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Chargeback</div>
              <div className="text-2xl font-bold text-foreground">
                {formatCurrency(reembolsos.valor_chargeback || 0)}
              </div>
              <div className="text-xs text-destructive mt-1">
                {reembolsos.qtd_chargeback || 0} · {reembolsos.pct_chargeback || 0}%
              </div>
            </div>
            <KPICard
              title="Vendas Pendentes"
              value={formatCurrency(kpis.pendentesValor || 0)}
              subtitle={`${kpis.pendentesQtd || 0} pendentes`}
              icon={<Clock className="h-4 w-4" />}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* ── Margem Detalhada ─────────────────────────────── */}
            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Margem Detalhada</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Faturamento bruto</span>
                  <span className="text-foreground font-medium">{formatCurrency(Math.max(0, kpis.fatBruto || 0))}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-destructive">(-) Taxa Payt ({(kpis.taxaPlatPct || 0).toFixed(2)}%)</span>
                  <span className="text-destructive">{formatCurrency(kpis.taxaPlat || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-destructive">(-) Reembolsos</span>
                  <span className="text-destructive">{formatCurrency(kpis.reembolsosVal || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-destructive">(-) Simples Nacional ({formatPercent(kpis.simplesPct || 0)})</span>
                  <span className="text-destructive">{formatCurrency(kpis.impostoSimples || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-destructive">(-) Imposto Meta Ads ({formatPercent(kpis.metaPct || 0)})</span>
                  <span className="text-destructive">{formatCurrency(kpis.impostoMeta || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-destructive">(-) Investimento Meta</span>
                  <span className="text-destructive">{formatCurrency(kpis.investimento || 0)}</span>
                </div>
                {(kpis.custoFixo || 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-destructive">
                      (-) Custo fixo <span className="text-xs opacity-70">({custoLabel()})</span>
                    </span>
                    <span className="text-destructive">{formatCurrency(kpis.custoFixo)}</span>
                  </div>
                )}
                <div className="border-t border-border pt-2 flex justify-between font-semibold">
                  <span className="text-foreground">(=) Lucro</span>
                  <span className={cn("font-bold", (kpis.lucro || 0) >= 0 ? "text-success" : "text-destructive")}>
                    {formatCurrency(kpis.lucro || 0)}
                  </span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span className="text-foreground">Margem</span>
                  <span className={margemBadge}>{formatPercent(kpis.margemPct || 0)}</span>
                </div>
              </div>
            </div>

            {/* ── Vendas por Produto Principal ─────────────────── */}
            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Vendas por Produto Principal</h3>
              <div className="space-y-3">
                {prodData.map((r: any, i: number) => (
                  <div
                    key={i}
                    className="flex justify-between items-center py-2 border-b border-border/50 last:border-0"
                  >
                    <div>
                      <span className="text-sm font-medium text-foreground capitalize">{r.produto}</span>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {formatNumber(r.vendas_aprovadas)} vendas · TM {formatCurrency(r.ticket_medio || 0)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-foreground">
                        {formatCurrency(r.faturamento_principal || 0)}
                      </div>
                      <div className="text-xs text-muted-foreground">fat. principal</div>
                    </div>
                  </div>
                ))}
                {prodData.length === 0 && <div className="text-center text-muted-foreground py-4">Sem dados</div>}
              </div>
            </div>
          </div>

          {/* ── Tabelas de Conversão ─────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <h3 className="text-sm font-medium text-muted-foreground px-5 pt-5 mb-3">Conversão OBs</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {["OB", "Convertidos", "Receita", "Taxa"].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {obsData.map((r, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-secondary/50">
                      <td className="px-4 py-2 text-foreground">{r.nome_ob}</td>
                      <td className="px-4 py-2 text-foreground">{formatNumber(r.total_convertidos || 0)}</td>
                      <td className="px-4 py-2 text-foreground">{formatCurrency(r.receita_total_ob || 0)}</td>
                      <td className="px-4 py-2 text-foreground">{formatPercent(r.taxa_conversao_pct || 0)}</td>
                    </tr>
                  ))}
                  {obsData.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-4 text-center text-muted-foreground">
                        Sem conversões
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <h3 className="text-sm font-medium text-muted-foreground px-5 pt-5 mb-3">Conversão Upsells</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {["Upsell", "Convertidos", "Receita", "Taxa"].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {upsellData.map((r, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-secondary/50">
                      <td className="px-4 py-2 text-foreground">{r.nome_upsell}</td>
                      <td className="px-4 py-2 text-foreground">{formatNumber(r.total_upsells || 0)}</td>
                      <td className="px-4 py-2 text-foreground">{formatCurrency(r.receita_total || 0)}</td>
                      <td className="px-4 py-2 text-foreground">{formatPercent(r.taxa_conversao_pct || 0)}</td>
                    </tr>
                  ))}
                  {upsellData.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-4 text-center text-muted-foreground">
                        Sem conversões
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
