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
  AlertCircle,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { differenceInDays, parseISO, subDays, format } from "date-fns";

function custoFixoProp(mensal: number, start?: string, end?: string) {
  if (!mensal) return 0;
  if (!start || !end) return mensal;
  const dias = Math.max(1, differenceInDays(parseISO(end), parseISO(start)) + 1);
  return (mensal / 30) * dias;
}

function periodoAnt(start?: string, end?: string) {
  if (!start || !end) return { start: undefined, end: undefined };
  const dias = Math.max(1, differenceInDays(parseISO(end), parseISO(start)) + 1);
  return {
    start: format(subDays(parseISO(start), dias), "yyyy-MM-dd"),
    end: format(subDays(parseISO(start), 1), "yyyy-MM-dd"),
  };
}

const VarBadge = ({ atual, anterior }: { atual: number; anterior: number }) => {
  if (!anterior) return null;
  const v = ((atual - anterior) / anterior) * 100;
  return (
    <span className={cn("flex items-center gap-0.5 text-xs mt-1", v >= 0 ? "text-green-400" : "text-red-400")}>
      {v >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {Math.abs(v).toFixed(1)}% vs anterior
    </span>
  );
};

export default function OverviewPage() {
  const { startDateStr, endDateStr, product } = useFilters();
  const [kpis, setKpis] = useState<any>({});
  const [kpisAnt, setKpisAnt] = useState<any>({});
  const [obsData, setObsData] = useState<any[]>([]);
  const [upsellData, setUpsellData] = useState<any[]>([]);
  const [prodData, setProdData] = useState<any[]>([]);
  const [remData, setRemData] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const pf = product !== "todos" ? product : null;

    // Faturamento
    let q1 = supabase.from("vw_faturamento_liquido").select("*");
    if (startDateStr && endDateStr) q1 = q1.gte("data", startDateStr).lte("data", endDateStr);
    if (pf) q1 = q1.eq("produto", pf);

    // Conversões
    let q2 = supabase.from("vw_conversao_obs").select("*").order("taxa_conversao_pct", { ascending: false });
    if (pf) q2 = q2.eq("produto", pf);
    let q3 = supabase.from("vw_conversao_upsell").select("*").order("taxa_conversao_pct", { ascending: false });
    if (pf) q3 = q3.eq("produto", pf);

    // Vendas aprovadas (para contagem e ticket)
    let q4 = supabase
      .from("vendas")
      .select("valor_total,valor_oferta_principal,produto")
      .eq("status", "aprovada")
      .not("pedido_id", "like", "TEST%")
      .not("pedido_id", "like", "LC-%");
    if (startDateStr && endDateStr) q4 = q4.gte("data_venda", startDateStr).lte("data_venda", endDateStr);
    if (pf) q4 = q4.eq("produto", pf);

    // Vendas pendentes + canceladas + expiradas (TODOS os não aprovados)
    let q5 = supabase
      .from("vendas")
      .select("valor_total,status")
      .in("status", ["pendente", "cancelada", "expirada"])
      .not("pedido_id", "like", "TEST%")
      .not("pedido_id", "like", "LC-%");
    if (startDateStr && endDateStr) q5 = q5.gte("data_venda", startDateStr).lte("data_venda", endDateStr);
    if (pf) q5 = q5.eq("produto", pf);

    // Reembolsos/chargeback
    const q6 = supabase.from("vw_reembolsos").select("*").single();

    // Produtos
    let q7 = supabase.from("vw_vendas_por_produto_principal").select("*");
    if (pf) q7 = q7.eq("produto", pf);

    // Período anterior
    const ant = periodoAnt(startDateStr, endDateStr);
    let qA1 = supabase.from("vw_faturamento_liquido").select("faturamento_bruto,investimento_meta");
    if (ant.start && ant.end) qA1 = qA1.gte("data", ant.start).lte("data", ant.end);
    if (pf) qA1 = qA1.eq("produto", pf);

    let qA2 = supabase
      .from("vendas")
      .select("id")
      .eq("status", "aprovada")
      .not("pedido_id", "like", "TEST%")
      .not("pedido_id", "like", "LC-%");
    if (ant.start && ant.end) qA2 = qA2.gte("data_venda", ant.start).lte("data_venda", ant.end);
    if (pf) qA2 = qA2.eq("produto", pf);

    const [r1, r2, r3, r4, r5, r6, r7, rA1, rA2] = await Promise.all([q1, q2, q3, q4, q5, q6, q7, qA1, qA2]);

    // Faturamento
    const fatRows = r1.data || [];
    const fatBruto = fatRows.reduce((s: number, r: any) => s + Number(r.faturamento_bruto || 0), 0);
    const taxaPlat = fatRows.reduce((s: number, r: any) => s + Number(r.taxa_plataforma || 0), 0);
    const taxaPlatPct = fatBruto > 0 ? (taxaPlat / fatBruto) * 100 : 0;
    const fatLiquido = fatBruto - taxaPlat;
    const reembolsosV = fatRows.reduce((s: number, r: any) => s + Number(r.reembolsos || 0), 0);
    const impSimples = fatRows.reduce((s: number, r: any) => s + Number(r.imposto_simples || 0), 0);
    const impMeta = fatRows.reduce((s: number, r: any) => s + Number(r.imposto_meta_ads || 0), 0);
    const investimento = fatRows.reduce((s: number, r: any) => s + Number(r.investimento_meta || 0), 0);
    const simplesPct = fatRows.length > 0 ? Number(fatRows[0].simples_pct || 0) : 0;
    const metaPct = fatRows.length > 0 ? Number(fatRows[0].meta_pct || 0) : 0;
    const custoMensal = fatRows.length > 0 ? Number(fatRows[0].custo_fixo || 0) : 0;
    const custoFixo = custoFixoProp(custoMensal, startDateStr, endDateStr);

    // Lucro operacional (sem custo fixo)
    const lucro = fatBruto - taxaPlat - reembolsosV - impSimples - impMeta - investimento;
    // Lucro com custo fixo
    const lucroCC = lucro - custoFixo;
    // Margem % = operacional (SEM custo fixo)
    const margemPct = fatBruto > 0 ? (lucro / fatBruto) * 100 : 0;
    const roas = investimento > 0 ? fatBruto / investimento : 0;

    const vendasRows = r4.data || [];
    const qtdAprov = vendasRows.length;
    const ticketMedio = qtdAprov > 0 ? fatBruto / qtdAprov : 0;

    // Pendentes/canceladas/expiradas
    const naoAprov = r5.data || [];
    const pendentes = naoAprov.filter((r: any) => r.status === "pendente");
    const canceladas = naoAprov.filter((r: any) => r.status === "cancelada");
    const expiradas = naoAprov.filter((r: any) => r.status === "expirada");
    const pendVal = pendentes.reduce((s: number, r: any) => s + Number(r.valor_total || 0), 0);
    const cancelVal = canceladas.reduce((s: number, r: any) => s + Number(r.valor_total || 0), 0);
    const expVal = expiradas.reduce((s: number, r: any) => s + Number(r.valor_total || 0), 0);

    // OBs e Upsells
    const obsRows = (r2.data || []).filter((r: any) => Number(r.total_convertidos || 0) > 0);
    const taxaOb =
      obsRows.length > 0
        ? obsRows.reduce((s: number, r: any) => s + Number(r.taxa_conversao_pct || 0), 0) / obsRows.length
        : 0;
    setObsData(obsRows);

    const upsRows = (r3.data || []).filter((r: any) => Number(r.total_upsells || 0) > 0);
    const taxaUp =
      upsRows.length > 0
        ? upsRows.reduce((s: number, r: any) => s + Number(r.taxa_conversao_pct || 0), 0) / upsRows.length
        : 0;
    setUpsellData(upsRows);

    setRemData(r6.data || {});
    setProdData((r7.data || []).sort((a: any, b: any) => b.vendas_aprovadas - a.vendas_aprovadas));

    setKpis({
      fatBruto,
      fatLiquido,
      lucro,
      lucroCC,
      taxaPlat,
      taxaPlatPct,
      reembolsosV,
      impSimples,
      impMeta,
      investimento,
      custoFixo,
      custoMensal,
      margemPct,
      roas,
      simplesPct,
      metaPct,
      qtdAprov,
      ticketMedio,
      taxaOb,
      taxaUp,
      qtdPend: pendentes.length,
      pendVal,
      qtdCanc: canceladas.length,
      cancelVal,
      qtdExp: expiradas.length,
      expVal,
    });

    // Período anterior
    const antFat = (rA1.data || []).reduce((s: number, r: any) => s + Number(r.faturamento_bruto || 0), 0);
    const antInv = (rA1.data || []).reduce((s: number, r: any) => s + Number(r.investimento_meta || 0), 0);
    setKpisAnt({ fatBruto: antFat, qtdAprov: (rA2.data || []).length, roas: antInv > 0 ? antFat / antInv : 0 });

    setLastUpdate(new Date());
    setLoading(false);
  }, [startDateStr, endDateStr, product]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const margemBadge =
    kpis.margemPct > 30 ? "text-green-400" : kpis.margemPct >= 15 ? "text-yellow-400" : "text-red-400";

  const custoLabel = () => {
    if (!kpis.custoMensal) return null;
    if (!startDateStr || !endDateStr) return "mensal";
    const dias = Math.max(1, differenceInDays(parseISO(endDateStr), parseISO(startDateStr)) + 1);
    return `${dias}d`;
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
        <div className="flex items-center justify-center h-64 text-muted-foreground animate-pulse">
          Carregando dados...
        </div>
      ) : (
        <>
          {/* Faturamento: Bruto / Líquido / Lucro */}
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
                {formatNumber(kpis.qtdAprov || 0)} vendas aprovadas
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
              <div className={cn("text-2xl font-bold", (kpis.lucro || 0) >= 0 ? "text-green-400" : "text-red-400")}>
                {formatCurrency(kpis.lucro || 0)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">pós impostos e ads (sem custo fixo)</div>
            </div>
          </div>

          {/* KPIs linha 2 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="bg-card rounded-lg border border-border p-5">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Vendas Aprovadas
              </div>
              <div className="text-2xl font-bold text-foreground">{formatNumber(kpis.qtdAprov || 0)}</div>
              <VarBadge atual={kpis.qtdAprov} anterior={kpisAnt.qtdAprov} />
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
                  kpis.roas >= 3 ? "text-green-400" : kpis.roas >= 1 ? "text-yellow-400" : "text-red-400",
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

          {/* KPIs linha 3 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="bg-card rounded-lg border border-border p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase">Margem %</span>
                <Percent className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className={cn("text-2xl font-bold", margemBadge)}>{formatPercent(kpis.margemPct || 0)}</div>
              <div className="text-xs text-muted-foreground mt-1">incl. custo fixo</div>
            </div>
            <KPICard
              title="Imposto Simples"
              value={formatCurrency(kpis.impSimples || 0)}
              icon={<Receipt className="h-4 w-4" />}
            />
            <KPICard
              title="Imposto Meta Ads"
              value={formatCurrency(kpis.impMeta || 0)}
              icon={<BadgeDollarSign className="h-4 w-4" />}
            />
            <div className="bg-card rounded-lg border border-border p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase">Taxa Payt</span>
                <CreditCard className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-2xl font-bold text-foreground">{formatCurrency(kpis.taxaPlat || 0)}</div>
              <div className="text-xs text-muted-foreground mt-1">{(kpis.taxaPlatPct || 0).toFixed(2)}%</div>
            </div>
          </div>

          {/* KPIs linha 4 — status não aprovados */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <KPICard title="Taxa OB" value={formatPercent(kpis.taxaOb || 0)} icon={<Target className="h-4 w-4" />} />
            <KPICard
              title="Taxa Upsell"
              value={formatPercent(kpis.taxaUp || 0)}
              icon={<TrendingUp className="h-4 w-4" />}
            />
            {/* Pendentes */}
            <div className="bg-card rounded-lg border border-border p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase">Pendentes</span>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-xl font-bold text-foreground">{formatCurrency(kpis.pendVal || 0)}</div>
              <div className="text-xs text-yellow-400 mt-1">{kpis.qtdPend || 0} aguardando pagamento</div>
            </div>
            {/* Canceladas + Expiradas */}
            <div className="bg-card rounded-lg border border-border p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase">Canceladas</span>
                <XCircle className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-xl font-bold text-foreground">{formatCurrency(kpis.cancelVal || 0)}</div>
              <div className="text-xs text-red-400 mt-1">
                {kpis.qtdCanc || 0} canc · {kpis.qtdExp || 0} exp ({formatCurrency(kpis.expVal || 0)})
              </div>
            </div>
            {/* Reembolsos */}
            <div className="bg-card rounded-lg border border-border p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase">Reembolsos</span>
                <RefreshCcw className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-xl font-bold text-foreground">{formatCurrency(remData.valor_reembolsos || 0)}</div>
              <div className="text-xs text-red-400 mt-1">
                {remData.qtd_reembolsos || 0} · {remData.pct_reembolsos || 0}%
                {(remData.qtd_chargeback || 0) > 0 && ` | CB: ${remData.qtd_chargeback} (${remData.pct_chargeback}%)`}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Margem Detalhada */}
            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Margem Detalhada</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Faturamento bruto</span>
                  <span className="text-foreground font-medium">{formatCurrency(Math.max(0, kpis.fatBruto || 0))}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-red-400">(-) Taxa Payt ({(kpis.taxaPlatPct || 0).toFixed(2)}%)</span>
                  <span className="text-red-400">{formatCurrency(kpis.taxaPlat || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-red-400">(-) Reembolsos</span>
                  <span className="text-red-400">{formatCurrency(kpis.reembolsosV || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-red-400">(-) Simples ({formatPercent(kpis.simplesPct || 0)})</span>
                  <span className="text-red-400">{formatCurrency(kpis.impSimples || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-red-400">(-) Imp. Meta ({formatPercent(kpis.metaPct || 0)})</span>
                  <span className="text-red-400">{formatCurrency(kpis.impMeta || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-red-400">(-) Investimento Meta</span>
                  <span className="text-red-400">{formatCurrency(kpis.investimento || 0)}</span>
                </div>
                <div className="border-t border-border/50 pt-1 flex justify-between text-xs">
                  <span className="font-medium text-foreground">= Lucro (sem custo fixo)</span>
                  <span className={cn("font-semibold", (kpis.lucro || 0) >= 0 ? "text-green-400" : "text-red-400")}>
                    {formatCurrency(kpis.lucro || 0)}
                  </span>
                </div>
                {(kpis.custoFixo || 0) > 0 && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-red-400">(-) Custo fixo ({custoLabel()})</span>
                      <span className="text-red-400">{formatCurrency(kpis.custoFixo)}</span>
                    </div>
                    <div className="border-t border-border pt-2 flex justify-between font-semibold">
                      <span className="text-foreground">(=) Lucro c/ custo fixo</span>
                      <span className={cn((kpis.lucroCC || 0) >= 0 ? "text-green-400" : "text-red-400")}>
                        {formatCurrency(kpis.lucroCC || 0)}
                      </span>
                    </div>
                  </>
                )}
                <div className="flex justify-between font-semibold">
                  <span className="text-foreground">Margem</span>
                  <span className={margemBadge}>{formatPercent(kpis.margemPct || 0)}</span>
                </div>
              </div>
            </div>

            {/* Vendas por Produto */}
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

          {/* Conversões */}
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
                        Sem conversões no período
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
                        Sem upsells no período
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
