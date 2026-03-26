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
    const endDateEnd = endDateStr ? `${endDateStr}T23:59:59` : null;

    // Faturamento
    let q1 = supabase.from("vw_faturamento_liquido").select("*");
    if (startDateStr && endDateStr) q1 = q1.gte("data", startDateStr).lte("data", endDateStr);
    if (pf) q1 = q1.eq("produto", pf);

    // OBs e Upsells (via venda_itens com join para filtrar por data)
    let q2 = supabase
      .from("venda_itens")
      .select("code_payt,tipo,nome,valor,converteu,venda_id,vendas!inner(data_venda,produto,status)")
      .eq("converteu", true)
      .eq("vendas.status", "aprovada");
    if (startDateStr && endDateEnd) q2 = q2.gte("vendas.data_venda", startDateStr).lte("vendas.data_venda", endDateEnd);
    if (pf) q2 = q2.eq("vendas.produto", pf);

    // Vendas aprovadas (para contagem e ticket)
    let q4 = supabase
      .from("vendas")
      .select("valor_total,valor_oferta_principal,produto")
      .eq("status", "aprovada")
      .not("pedido_id", "like", "TEST%")
      .not("pedido_id", "like", "LC-%");
    if (startDateStr && endDateEnd) q4 = q4.gte("data_venda", startDateStr).lte("data_venda", endDateEnd);
    if (pf) q4 = q4.eq("produto", pf);

    // Vendas pendentes + canceladas + expiradas (TODOS os não aprovados)
    let q5 = supabase
      .from("vendas")
      .select("valor_total,status")
      .in("status", ["pendente", "cancelada", "expirada"])
      .not("pedido_id", "like", "TEST%")
      .not("pedido_id", "like", "LC-%");
    if (startDateStr && endDateEnd) q5 = q5.gte("data_venda", startDateStr).lte("data_venda", endDateEnd);
    if (pf) q5 = q5.eq("produto", pf);

    // Reembolsos/chargeback
    const q6 = supabase.from("vw_reembolsos").select("*").single();

    // Produtos — será calculado a partir de vendasRows (q4)

    // Vendas backend (sem tráfego pago = utm_source é null)
    let q8 = supabase
      .from("vendas")
      .select("valor_total,produto")
      .eq("status", "aprovada")
      .is("utm_source", null)
      .not("pedido_id", "like", "TEST%")
      .not("pedido_id", "like", "LC-%");
    if (startDateStr && endDateEnd) q8 = q8.gte("data_venda", startDateStr).lte("data_venda", endDateEnd);
    if (pf) q8 = q8.eq("produto", pf);

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
    if (ant.start && ant.end) qA2 = qA2.gte("data_venda", ant.start).lte("data_venda", `${ant.end}T23:59:59`);
    if (pf) qA2 = qA2.eq("produto", pf);

    const [r1, r2, r3, r4, r5, r6, r8, rA1, rA2] = await Promise.all([q1, q2, q3, q4, q5, q6, q8, qA1, qA2]);

    // Faturamento
    const fatRows = r1.data || [];
    const fatBruto = fatRows.reduce((s: number, r: any) => s + Number(r.faturamento_bruto || 0), 0);
    const taxaPlat = fatRows.reduce((s: number, r: any) => s + Number(r.taxa_plataforma || 0), 0);
    const taxaPlatPct = fatBruto > 0 ? (taxaPlat / fatBruto) * 100 : 0;
    const reembolsosV = fatRows.reduce((s: number, r: any) => s + Number(r.reembolsos || 0), 0);
    const impSimples = fatRows.reduce((s: number, r: any) => s + Number(r.imposto_simples || 0), 0);
    const impMeta = fatRows.reduce((s: number, r: any) => s + Number(r.imposto_meta_ads || 0), 0);
    const investimento = fatRows.reduce((s: number, r: any) => s + Number(r.investimento_meta || 0), 0);
    const simplesPct = fatRows.length > 0 ? Number(fatRows[0].simples_pct || 0) : 0;
    const metaPct = fatRows.length > 0 ? Number(fatRows[0].meta_pct || 0) : 0;
    const custoMensal = fatRows.length > 0 ? Number(fatRows[0].custo_fixo || 0) : 0;
    const custoFixo = custoFixoProp(custoMensal, startDateStr, endDateStr);
    // Faturamento líquido = bruto - taxa Payt - imposto Simples
    const fatLiquido = fatBruto - taxaPlat - impSimples;

    // Lucro operacional (sem custo fixo)
    const lucro = fatBruto - taxaPlat - reembolsosV - impSimples - impMeta - investimento;
    // Lucro com custo fixo
    const lucroCC = lucro - custoFixo;
    // Margem % = operacional (SEM custo fixo)
    const margemPct = fatBruto > 0 ? (lucro / fatBruto) * 100 : 0;
    const roas = investimento > 0 ? fatBruto / investimento : 0;

    const vendasRows = r4.data || [];
    // Vendas aprovadas = apenas produtos principais (valor_oferta_principal > 0)
    const vendasPrincipal = vendasRows.filter((r: any) => Number(r.valor_oferta_principal || 0) > 0);
    const qtdAprov = vendasPrincipal.length;
    const ticketMedio = qtdAprov > 0 ? fatBruto / qtdAprov : 0;

    // Pendentes/canceladas/expiradas
    const naoAprov = r5.data || [];
    const pendentes = naoAprov.filter((r: any) => r.status === "pendente");
    const canceladas = naoAprov.filter((r: any) => r.status === "cancelada");
    const expiradas = naoAprov.filter((r: any) => r.status === "expirada");
    const pendVal = pendentes.reduce((s: number, r: any) => s + Number(r.valor_total || 0), 0);
    const cancelVal = canceladas.reduce((s: number, r: any) => s + Number(r.valor_total || 0), 0);
    const expVal = expiradas.reduce((s: number, r: any) => s + Number(r.valor_total || 0), 0);

    // OBs: direto da view
    const obsRows = (r2.data || []).filter((r: any) => Number(r.total_convertidos || 0) > 0);
    const receitaOb = obsRows.reduce((s: number, r: any) => s + Number(r.receita_total_ob || 0), 0);
    const taxaOb = obsRows.length > 0
      ? obsRows.reduce((s: number, r: any) => s + Number(r.taxa_conversao_pct || 0), 0) / obsRows.length
      : 0;
    setObsData(obsRows);

    // Upsells: direto da view
    const upsRows = (r3.data || []).filter((r: any) => Number(r.total_upsells || 0) > 0);
    const taxaUp = upsRows.length > 0
      ? upsRows.reduce((s: number, r: any) => s + Number(r.taxa_conversao_pct || 0), 0) / upsRows.length
      : 0;
    const receitaUp = upsRows.reduce((s: number, r: any) => s + Number(r.receita_total || 0), 0);
    setUpsellData(upsRows);

    // Vendas backend (sem tráfego pago)
    const backendRows = r8.data || [];
    const qtdBackend = backendRows.length;
    const valBackend = backendRows.reduce((s: number, r: any) => s + Number(r.valor_total || 0), 0);
    const pctBackend = qtdAprov > 0 ? (qtdBackend / qtdAprov) * 100 : 0;

    setRemData(r6.data || {});
    // Compute prodData from vendasRows (already filtered by date/product)
    const prodMap = new Map<string, { produto: string; vendas_aprovadas: number; faturamento_principal: number; faturamento_total: number }>();
    for (const v of vendasPrincipal) {
      const p = v.produto || "outros";
      const existing = prodMap.get(p) || { produto: p, vendas_aprovadas: 0, faturamento_principal: 0, faturamento_total: 0 };
      existing.vendas_aprovadas += 1;
      existing.faturamento_principal += Number(v.valor_oferta_principal || 0);
      existing.faturamento_total += Number(v.valor_total || 0);
      prodMap.set(p, existing);
    }
    const computedProdData = [...prodMap.values()].map(p => ({
      ...p,
      ticket_medio: p.vendas_aprovadas > 0 ? p.faturamento_total / p.vendas_aprovadas : 0,
    }));
    setProdData(computedProdData.sort((a, b) => b.vendas_aprovadas - a.vendas_aprovadas));

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
      receitaOb,
      receitaUp,
      qtdBackend,
      valBackend,
      pctBackend,
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
          {/* ═══ 1. RECEITA ═══ */}
          <div className="mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Receita</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-card rounded-lg border border-border p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Faturamento Bruto</span>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-2xl font-bold text-foreground">{formatCurrency(Math.max(0, kpis.fatBruto || 0))}</div>
              <VarBadge atual={kpis.fatBruto} anterior={kpisAnt.fatBruto} />
            </div>
            <div className="bg-card rounded-lg border border-border p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Vendas Aprovadas</span>
                <ShoppingBag className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-2xl font-bold text-foreground">{formatNumber(kpis.qtdAprov || 0)}</div>
              <VarBadge atual={kpis.qtdAprov} anterior={kpisAnt.qtdAprov} />
            </div>
            <div className="bg-card rounded-lg border border-border p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Ticket Médio</span>
                <Target className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-2xl font-bold text-foreground">{formatCurrency(kpis.ticketMedio || 0)}</div>
            </div>
          </div>

          {/* ═══ 2. CUSTOS DIRETOS ═══ */}
          <div className="mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-warning/60">Custos Diretos</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-card rounded-lg border border-warning/20 p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Taxa Payt</span>
                <CreditCard className="h-4 w-4 text-warning" />
              </div>
              <div className="text-2xl font-bold text-foreground">{formatCurrency(kpis.taxaPlat || 0)}</div>
              <div className="text-xs text-warning mt-1">{(kpis.taxaPlatPct || 0).toFixed(2)}%</div>
            </div>
            <div className="bg-card rounded-lg border border-warning/20 p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Imposto Simples</span>
                <Receipt className="h-4 w-4 text-warning" />
              </div>
              <div className="text-2xl font-bold text-foreground">{formatCurrency(kpis.impSimples || 0)}</div>
              <div className="text-xs text-warning mt-1">{formatPercent(kpis.simplesPct || 0)}</div>
            </div>
            <div className="bg-card rounded-lg border border-warning/20 p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Imposto Meta Ads</span>
                <BadgeDollarSign className="h-4 w-4 text-warning" />
              </div>
              <div className="text-2xl font-bold text-foreground">{formatCurrency(kpis.impMeta || 0)}</div>
              <div className="text-xs text-warning mt-1">{formatPercent(kpis.metaPct || 0)}</div>
            </div>
          </div>

          {/* ═══ 3. TRÁFEGO ═══ */}
          <div className="mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-info/60">Tráfego</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="bg-card rounded-lg border border-info/20 p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Investimento Meta</span>
                <TrendingUp className="h-4 w-4 text-info" />
              </div>
              <div className="text-2xl font-bold text-foreground">{formatCurrency(kpis.investimento || 0)}</div>
            </div>
            <div className="bg-card rounded-lg border border-info/20 p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">ROAS</span>
                <BarChart3 className="h-4 w-4 text-info" />
              </div>
              <div className={cn("text-2xl font-bold", kpis.roas >= 3 ? "text-success" : kpis.roas >= 1 ? "text-warning" : "text-destructive")}>
                {(kpis.roas || 0).toFixed(2)}x
              </div>
              <VarBadge atual={kpis.roas} anterior={kpisAnt.roas} />
            </div>
          </div>

          {/* ═══ 4. FUNIL / MONETIZAÇÃO ═══ */}
          <div className="mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-primary/60">Funil / Monetização</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-card rounded-lg border border-primary/20 p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Order Bumps</span>
                <Target className="h-4 w-4 text-primary" />
              </div>
              <div className="text-2xl font-bold text-foreground">{formatCurrency(kpis.receitaOb || 0)}</div>
              <div className="text-xs text-primary mt-1">Taxa: {formatPercent(kpis.taxaOb || 0)}</div>
            </div>
            <div className="bg-card rounded-lg border border-primary/20 p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Upsells</span>
                <TrendingUp className="h-4 w-4 text-primary" />
              </div>
              <div className="text-2xl font-bold text-foreground">{formatCurrency(kpis.receitaUp || 0)}</div>
              <div className="text-xs text-primary mt-1">Taxa: {formatPercent(kpis.taxaUp || 0)}</div>
            </div>
            <div className="bg-card rounded-lg border border-primary/20 p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Vendas Backend</span>
                <ShoppingBag className="h-4 w-4 text-primary" />
              </div>
              <div className="text-2xl font-bold text-foreground">{formatCurrency(kpis.valBackend || 0)}</div>
              <div className="text-xs text-primary mt-1">{formatNumber(kpis.qtdBackend || 0)} vendas · {formatPercent(kpis.pctBackend || 0)}</div>
            </div>
          </div>

          {/* ═══ 5. PERDAS ═══ */}
          <div className="mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-destructive/60">Perdas</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {/* Não Aprovadas */}
            <div className="bg-card rounded-lg border border-destructive/20 p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Não Aprovadas</span>
                <XCircle className="h-4 w-4 text-destructive" />
              </div>
              <div className="text-xl font-bold text-foreground">
                {formatCurrency((kpis.pendVal || 0) + (kpis.cancelVal || 0) + (kpis.expVal || 0))}
              </div>
              <div className="text-xs text-muted-foreground mt-2 space-y-0.5">
                <div className="flex justify-between"><span className="text-yellow-400">Pendentes</span><span className="text-yellow-400">{kpis.qtdPend || 0} · {formatCurrency(kpis.pendVal || 0)}</span></div>
                <div className="flex justify-between"><span className="text-red-400">Canceladas</span><span className="text-red-400">{kpis.qtdCanc || 0} · {formatCurrency(kpis.cancelVal || 0)}</span></div>
                <div className="flex justify-between"><span className="text-orange-400">Expiradas</span><span className="text-orange-400">{kpis.qtdExp || 0} · {formatCurrency(kpis.expVal || 0)}</span></div>
              </div>
            </div>
            {/* Reembolsos */}
            <div className="bg-card rounded-lg border border-destructive/20 p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Reembolsos</span>
                <RefreshCcw className="h-4 w-4 text-destructive" />
              </div>
              <div className="text-xl font-bold text-foreground">{formatCurrency(remData.valor_reembolsos || 0)}</div>
              <div className="text-xs text-destructive mt-1">
                {remData.qtd_reembolsos || 0} · {(remData.pct_reembolsos || 0).toFixed(1)}%
              </div>
            </div>
            {/* Chargebacks */}
            <div className="bg-card rounded-lg border border-destructive/20 p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Chargebacks</span>
                <AlertCircle className="h-4 w-4 text-destructive" />
              </div>
              <div className="text-xl font-bold text-destructive">{formatCurrency(remData.valor_chargeback || 0)}</div>
              <div className="text-xs text-destructive mt-1">
                {remData.qtd_chargeback || 0} · {(remData.pct_chargeback || 0).toFixed(1)}%
              </div>
            </div>
          </div>

          {/* ═══ 6. RESULTADO FINAL ═══ */}
          <div className="mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-success/60">Resultado Final</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-card rounded-lg border-2 border-success/30 p-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-success uppercase tracking-wider">Faturamento Líquido</span>
                <DollarSign className="h-4 w-4 text-success" />
              </div>
              <div className="text-3xl font-bold text-foreground">{formatCurrency(Math.max(0, kpis.fatLiquido || 0))}</div>
              <div className="text-xs text-muted-foreground mt-1">após taxa Payt + Simples</div>
            </div>
            <div className="bg-card rounded-lg border-2 border-success/30 p-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-success uppercase tracking-wider">Lucro</span>
                <TrendingUp className="h-4 w-4 text-success" />
              </div>
              <div className={cn("text-3xl font-bold", (kpis.lucro || 0) >= 0 ? "text-success" : "text-destructive")}>
                {formatCurrency(kpis.lucro || 0)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">pós taxas, impostos e ads</div>
            </div>
            <div className="bg-card rounded-lg border-2 border-success/30 p-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-success uppercase tracking-wider">Margem %</span>
                <Percent className="h-4 w-4 text-success" />
              </div>
              <div className={cn("text-3xl font-bold", kpis.margemPct > 30 ? "text-success" : kpis.margemPct >= 15 ? "text-warning" : "text-destructive")}>
                {formatPercent(kpis.margemPct || 0)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">margem operacional</div>
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
                  <span className="text-foreground">Margem operacional</span>
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
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[400px]">
                <thead>
                  <tr className="border-b border-border">
                    {["OB", "Tipo", "Convertidos", "Receita", "Taxa"].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {obsData.map((r, i) => {
                    const tipoBadge = (r.tipo_ob || "").replace("orderbump_", "OB").toUpperCase();
                    return (
                      <tr key={i} className="border-b border-border/50 hover:bg-secondary/50">
                        <td className="px-4 py-2 text-foreground">{r.nome_ob}</td>
                        <td className="px-4 py-2">
                          <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-primary/10 text-primary">{tipoBadge}</span>
                        </td>
                        <td className="px-4 py-2 text-foreground">{formatNumber(r.total_convertidos || 0)}</td>
                        <td className="px-4 py-2 text-foreground">{formatCurrency(r.receita_total_ob || 0)}</td>
                        <td className="px-4 py-2 text-foreground">{(Number(r.taxa_conversao_pct) || 0).toFixed(2)}%</td>
                      </tr>
                    );
                  })}
                  {obsData.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-4 text-center text-muted-foreground">
                        Sem conversões no período
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            </div>
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <h3 className="text-sm font-medium text-muted-foreground px-5 pt-5 mb-3">Conversão Upsells</h3>
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[400px]">
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
                      <td className="px-4 py-2 text-foreground">{(Number(r.taxa_conversao_pct) || 0).toFixed(2)}%</td>
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
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
