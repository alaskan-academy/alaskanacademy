import { useEffect, useState } from "react";
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
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { cn } from "@/lib/utils";

const COLORS = ["hsl(239,84%,67%)", "hsl(160,60%,45%)", "hsl(38,92%,50%)", "hsl(0,72%,51%)", "hsl(280,65%,60%)"];

const chartTooltipStyle = {
  contentStyle: {
    backgroundColor: "hsl(0,0%,10%)",
    border: "1px solid hsl(0,0%,16%)",
    borderRadius: "8px",
    color: "#fff",
  },
  labelStyle: { color: "#aaa" },
};

const paymentLabels: Record<string, string> = {
  pix: "Pix",
  cartao_credito: "Cartão de Crédito",
  boleto: "Boleto",
  desconhecido: "Desconhecido",
};

const placementLabels: Record<string, string> = {
  feed: "Feed",
  stories: "Stories",
  reels: "Reels",
  marketplace: "Marketplace",
  search: "Search",
  audience_network: "Audience Network",
  messenger: "Messenger",
  outro: "Outro",
};

export default function OverviewPage() {
  const { startDateStr, endDateStr, product } = useFilters();
  const [kpis, setKpis] = useState<any>({});
  const [temporal, setTemporal] = useState<any[]>([]);
  const [byPayment, setByPayment] = useState<any[]>([]);
  const [byPlacement, setByPlacement] = useState<any[]>([]);
  const [byProduct, setByProduct] = useState<any[]>([]);
  const [obsData, setObsData] = useState<any[]>([]);
  const [upsellData, setUpsellData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const productFilter = product !== "todos" ? product : null;

      let q1 = supabase.from("vw_faturamento_liquido").select("*");
      if (startDateStr && endDateStr) q1 = q1.gte("data", startDateStr).lte("data", endDateStr);
      if (productFilter) q1 = q1.eq("produto", productFilter);

      let q2 = supabase.from("vw_conversao_obs").select("*");
      if (productFilter) q2 = q2.eq("produto", productFilter);

      let q3 = supabase.from("vw_conversao_upsell").select("*");
      if (productFilter) q3 = q3.eq("produto", productFilter);

      let q4 = supabase.from("vw_vendas_temporal").select("*");
      if (startDateStr && endDateStr) q4 = q4.gte("data", startDateStr).lte("data", endDateStr);
      if (productFilter) q4 = q4.eq("produto", productFilter);

      let q5 = supabase.from("vw_vendas_por_pagamento").select("*");
      if (productFilter) q5 = q5.eq("produto", productFilter);

      let q6 = supabase.from("vw_vendas_por_placement").select("*");
      if (productFilter) q6 = q6.eq("produto", productFilter);

      let q7 = supabase
        .from("vendas")
        .select("valor_total,produto")
        .eq("status", "aprovada")
        .not("pedido_id", "like", "TEST%")
        .not("pedido_id", "like", "LC-%");
      if (startDateStr && endDateStr) q7 = q7.gte("data_venda", startDateStr).lte("data_venda", endDateStr);
      if (productFilter) q7 = q7.eq("produto", productFilter);

      let q8 = supabase
        .from("vendas")
        .select("valor_total")
        .eq("status", "pendente")
        .not("pedido_id", "like", "TEST%")
        .not("pedido_id", "like", "LC-%");
      if (startDateStr && endDateStr) q8 = q8.gte("data_venda", startDateStr).lte("data_venda", endDateStr);
      if (productFilter) q8 = q8.eq("produto", productFilter);

      const [r1, r2, r3, r4, r5, r6, r7, r8] = await Promise.all([q1, q2, q3, q4, q5, q6, q7, q8]);

      const fatRows = r1.data || [];
      const fatLiquido = fatRows.reduce((s: number, r: any) => s + Number(r.faturamento_liquido || 0), 0);
      const fatBruto = fatRows.reduce((s: number, r: any) => s + Number(r.faturamento_bruto || 0), 0);
      const taxaPlat = fatRows.reduce((s: number, r: any) => s + Number(r.taxa_plataforma || 0), 0);
      const taxaPlatPct = fatBruto > 0 ? (taxaPlat / fatBruto) * 100 : 0;
      const reembolsos = fatRows.reduce((s: number, r: any) => s + Number(r.reembolsos || 0), 0);
      const impostoSimples = fatRows.reduce((s: number, r: any) => s + Number(r.imposto_simples || 0), 0);
      const impostoMeta = fatRows.reduce((s: number, r: any) => s + Number(r.imposto_meta_ads || 0), 0);
      const investimento = fatRows.reduce((s: number, r: any) => s + Number(r.investimento_meta || 0), 0);
      const custoFixo = fatRows.length > 0 ? Number(fatRows[0].custo_fixo || 0) : 0;
      const margemPct = fatBruto > 0 ? (fatLiquido / fatBruto) * 100 : 0;
      const roas = investimento > 0 ? fatBruto / investimento : 0;
      const simplesPct = fatRows.length > 0 ? Number(fatRows[0].simples_pct || 0) : 0;
      const metaPct = fatRows.length > 0 ? Number(fatRows[0].meta_pct || 0) : 0;

      const vendasAprovadas = r7.data?.length || 0;
      const ticketMedio = vendasAprovadas > 0 ? fatBruto / vendasAprovadas : 0;

      const pendentes = r8.data || [];
      const pendentesValor = pendentes.reduce((s: number, r: any) => s + Number(r.valor_total || 0), 0);

      const obsRows = r2.data || [];
      const taxaOb =
        obsRows.length > 0
          ? obsRows.reduce((s: number, r: any) => s + Number(r.taxa_conversao_pct || 0), 0) / obsRows.length
          : 0;
      setObsData(obsRows);

      const upsellRows = r3.data || [];
      const taxaUpsell =
        upsellRows.length > 0
          ? upsellRows.reduce((s: number, r: any) => s + Number(r.taxa_conversao_pct || 0), 0) / upsellRows.length
          : 0;
      setUpsellData(upsellRows);

      setKpis({
        fatLiquido,
        fatBruto,
        taxaPlat,
        taxaPlatPct,
        reembolsos,
        impostoSimples,
        impostoMeta,
        investimento,
        custoFixo,
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

      // Faturamento por dia: dataLabel = DD (ex: "23")
      setTemporal(
        (r4.data || []).map((r: any) => ({
          ...r,
          dataLabel: String(new Date(r.data + "T00:00:00").getDate()).padStart(2, "0"),
        })),
      );

      // Pagamento: agregar por meio_pagamento (eliminar duplicatas por produto)
      const payMap: Record<string, any> = {};
      (r5.data || []).forEach((r: any) => {
        const k = r.meio_pagamento;
        if (!payMap[k])
          payMap[k] = {
            meio_pagamento: k,
            aprovadas: 0,
            faturamento: 0,
            total_tentativas: 0,
            canceladas: 0,
            expiradas: 0,
          };
        payMap[k].aprovadas += Number(r.aprovadas || 0);
        payMap[k].faturamento += Number(r.faturamento || 0);
        payMap[k].total_tentativas += Number(r.total_tentativas || 0);
        payMap[k].canceladas += Number(r.canceladas || 0);
        payMap[k].expiradas += Number(r.expiradas || 0);
      });
      setByPayment(
        Object.values(payMap).map((r: any) => ({
          ...r,
          taxa_aprovacao_pct: r.total_tentativas > 0 ? ((r.aprovadas / r.total_tentativas) * 100).toFixed(1) : "0.0",
        })),
      );

      // Placement: agregar por placement
      const plMap: Record<string, any> = {};
      (r6.data || []).forEach((r: any) => {
        const k = r.placement;
        if (!plMap[k]) plMap[k] = { placement: k, vendas_aprovadas: 0, faturamento: 0 };
        plMap[k].vendas_aprovadas += Number(r.vendas_aprovadas || 0);
        plMap[k].faturamento += Number(r.faturamento || 0);
      });
      setByPlacement(Object.values(plMap).sort((a, b) => b.faturamento - a.faturamento));

      const prodMap: Record<string, number> = {};
      (r7.data || []).forEach((v: any) => {
        const p = v.produto || "Outros";
        prodMap[p] = (prodMap[p] || 0) + Number(v.valor_total || 0);
      });
      setByProduct(Object.entries(prodMap).map(([name, value]) => ({ name, value })));

      setLoading(false);
    };
    fetchData();
  }, [startDateStr, endDateStr, product]);

  const margemBadge = kpis.margemPct > 30 ? "text-success" : kpis.margemPct >= 15 ? "text-warning" : "text-destructive";

  return (
    <DashboardLayout title="Visão Geral">
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground animate-pulse">Carregando dados...</div>
        </div>
      ) : (
        <>
          {/* Linha 1 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <KPICard
              title="Faturamento Líquido"
              value={formatCurrency(kpis.fatLiquido || 0)}
              icon={<DollarSign className="h-4 w-4" />}
            />
            <KPICard
              title="Vendas Aprovadas"
              value={formatNumber(kpis.vendasAprovadas || 0)}
              icon={<ShoppingBag className="h-4 w-4" />}
            />
            <KPICard
              title="Ticket Médio"
              value={formatCurrency(kpis.ticketMedio || 0)}
              icon={<Target className="h-4 w-4" />}
            />
            <KPICard title="ROAS" value={`${(kpis.roas || 0).toFixed(2)}x`} icon={<BarChart3 className="h-4 w-4" />} />
          </div>

          {/* Linha 2 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <KPICard
              title="Investimento Meta"
              value={formatCurrency(kpis.investimento || 0)}
              icon={<TrendingUp className="h-4 w-4" />}
            />
            <div className="bg-card rounded-lg border border-border p-5 transition-colors hover:border-primary/30">
              <div className="flex items-center justify-between mb-3">
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
          </div>

          {/* Linha 3 — Taxa Payt calculada */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <div className="bg-card rounded-lg border border-border p-5 transition-colors hover:border-primary/30">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Taxa Payt</span>
                <CreditCard className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-2xl font-bold text-foreground">{formatCurrency(kpis.taxaPlat || 0)}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {(kpis.taxaPlatPct || 0).toFixed(2)}% do faturamento
              </div>
            </div>
            <KPICard title="Taxa OB" value={formatPercent(kpis.taxaOb || 0)} icon={<Target className="h-4 w-4" />} />
            <KPICard
              title="Taxa Upsell"
              value={formatPercent(kpis.taxaUpsell || 0)}
              icon={<TrendingUp className="h-4 w-4" />}
            />
            <KPICard
              title="Reembolsos"
              value={formatCurrency(kpis.reembolsos || 0)}
              icon={<RefreshCcw className="h-4 w-4" />}
            />
            <KPICard
              title="Vendas Pendentes"
              value={formatCurrency(kpis.pendentesValor || 0)}
              subtitle={`${kpis.pendentesQtd || 0} pendentes`}
              icon={<Clock className="h-4 w-4" />}
            />
          </div>

          {/* Margem Detalhada */}
          <div className="bg-card border border-border rounded-lg p-5 mb-6 max-w-md">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">Margem Detalhada</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Faturamento bruto</span>
                <span className="text-foreground">{formatCurrency(kpis.fatBruto || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-destructive">
                  (-) Taxa plataforma Payt ({(kpis.taxaPlatPct || 0).toFixed(2)}%)
                </span>
                <span className="text-destructive">{formatCurrency(kpis.taxaPlat || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-destructive">(-) Reembolsos</span>
                <span className="text-destructive">{formatCurrency(kpis.reembolsos || 0)}</span>
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
                  <span className="text-destructive">(-) Custo fixo</span>
                  <span className="text-destructive">{formatCurrency(kpis.custoFixo)}</span>
                </div>
              )}
              <div className="border-t border-border pt-2 flex justify-between font-semibold">
                <span className="text-foreground">(=) Faturamento líquido</span>
                <span className="text-foreground">{formatCurrency(kpis.fatLiquido || 0)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span className="text-foreground">Margem</span>
                <span className={margemBadge}>{formatPercent(kpis.margemPct || 0)}</span>
              </div>
            </div>
          </div>

          {/* Tabelas de Conversão */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
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
                        Sem dados
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
                        Sem dados
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Gráficos */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Faturamento por Dia — colunas, eixo X = DD */}
            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Faturamento por Dia</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={temporal}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,16%)" />
                  <XAxis dataKey="dataLabel" stroke="#555" tick={{ fontSize: 11 }} />
                  <YAxis stroke="#555" tick={{ fontSize: 11 }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    {...chartTooltipStyle}
                    formatter={(v: any) => [`R$ ${Number(v).toFixed(2)}`, "Faturamento"]}
                    labelFormatter={(l) => `Dia ${l}`}
                  />
                  <Bar dataKey="faturamento" fill="hsl(239,84%,67%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Faturamento por Produto */}
            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Faturamento por Produto</h3>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={byProduct}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {byProduct.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    {...chartTooltipStyle}
                    formatter={(v: any) => [`R$ ${Number(v).toFixed(2)}`, "Faturamento"]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Vendas por Pagamento — lista com taxa de aprovação */}
            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Vendas por Meio de Pagamento</h3>
              <div className="space-y-1">
                {byPayment.map((r, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-3 border-b border-border/50 last:border-0"
                  >
                    <div>
                      <span className="text-sm font-medium text-foreground">
                        {paymentLabels[r.meio_pagamento] || r.meio_pagamento}
                      </span>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {formatNumber(r.aprovadas)} aprovadas · {formatNumber(r.total_tentativas)} tentativas
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-foreground">{formatCurrency(r.faturamento)}</div>
                      <div
                        className={cn(
                          "text-xs font-medium",
                          Number(r.taxa_aprovacao_pct) >= 70
                            ? "text-green-400"
                            : Number(r.taxa_aprovacao_pct) >= 50
                              ? "text-yellow-400"
                              : "text-red-400",
                        )}
                      >
                        {Number(r.taxa_aprovacao_pct).toFixed(1)}% aprovação
                      </div>
                    </div>
                  </div>
                ))}
                {byPayment.length === 0 && <div className="text-center text-muted-foreground py-8">Sem dados</div>}
              </div>
            </div>

            {/* Vendas por Placement — lista */}
            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Vendas por Placement</h3>
              <div className="space-y-1">
                {byPlacement.map((r, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-3 border-b border-border/50 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: COLORS[i % COLORS.length] }}
                      />
                      <span className="text-sm text-foreground">{placementLabels[r.placement] || r.placement}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-foreground">{formatCurrency(r.faturamento)}</div>
                      <div className="text-xs text-muted-foreground">{formatNumber(r.vendas_aprovadas)} vendas</div>
                    </div>
                  </div>
                ))}
                {byPlacement.length === 0 && <div className="text-center text-muted-foreground py-8">Sem dados</div>}
              </div>
            </div>
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
