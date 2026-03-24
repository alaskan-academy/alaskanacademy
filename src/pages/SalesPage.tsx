import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useFilters } from "@/contexts/FilterContext";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
} from "recharts";

const statusStyles: Record<string, string> = {
  aprovada: "bg-success/20 text-success border-success/30",
  pendente: "bg-warning/20 text-warning border-warning/30",
  cancelada: "bg-muted text-muted-foreground border-border",
  reembolsada: "bg-destructive/20 text-destructive border-destructive/30",
};

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

export default function SalesPage() {
  const { startDateStr, endDateStr, product } = useFilters();
  const [salesData, setSalesData] = useState<any[]>([]);
  const [temporal, setTemporal] = useState<any[]>([]);
  const [byProduct, setByProduct] = useState<any[]>([]);
  const [paymentData, setPaymentData] = useState<any[]>([]);
  const [placementData, setPlacementData] = useState<any[]>([]);
  const [hourlyData, setHourlyData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSale, setSelectedSale] = useState<any>(null);
  const [saleItems, setSaleItems] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState("todos");

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const productFilter = product !== "todos" ? product : null;

      // Lista de vendas
      let q = supabase
        .from("vendas")
        .select("*, clientes(nome, email, telefone)")
        .not("pedido_id", "like", "TEST%")
        .not("pedido_id", "like", "LC-%")
        .order("data_venda", { ascending: false });
      if (startDateStr && endDateStr) q = q.gte("data_venda", startDateStr).lte("data_venda", endDateStr);
      if (productFilter) q = q.eq("produto", productFilter);
      if (statusFilter !== "todos") q = q.eq("status", statusFilter);

      // Temporal
      let qT = supabase.from("vw_vendas_temporal").select("*");
      if (startDateStr && endDateStr) qT = qT.gte("data", startDateStr).lte("data", endDateStr);
      if (productFilter) qT = qT.eq("produto", productFilter);

      // Vendas aprovadas por produto
      let qP = supabase
        .from("vendas")
        .select("valor_total,produto")
        .eq("status", "aprovada")
        .not("pedido_id", "like", "TEST%")
        .not("pedido_id", "like", "LC-%");
      if (startDateStr && endDateStr) qP = qP.gte("data_venda", startDateStr).lte("data_venda", endDateStr);
      if (productFilter) qP = qP.eq("produto", productFilter);

      // Pagamento
      let q2 = supabase.from("vw_vendas_por_pagamento").select("*");
      if (productFilter) q2 = q2.eq("produto", productFilter);

      // Placement
      let q3 = supabase.from("vw_vendas_por_placement").select("*");
      if (productFilter) q3 = q3.eq("produto", productFilter);

      // Horário
      let q4 = supabase.from("vw_vendas_por_horario").select("*");
      if (productFilter) q4 = q4.eq("produto", productFilter);

      const [r1, rT, rP, r2, r3, r4] = await Promise.all([q, qT, qP, q2, q3, q4]);

      setSalesData(r1.data || []);

      // Temporal: formatar eixo X como DD
      setTemporal(
        (rT.data || []).map((r: any) => ({
          ...r,
          dataLabel: String(new Date(r.data + "T00:00:00").getDate()).padStart(2, "0"),
        })),
      );

      // Por produto
      const prodMap: Record<string, number> = {};
      (rP.data || []).forEach((v: any) => {
        const p = v.produto || "Outros";
        prodMap[p] = (prodMap[p] || 0) + Number(v.valor_total || 0);
      });
      setByProduct(Object.entries(prodMap).map(([name, value]) => ({ name, value })));

      // Pagamento: agregar por meio (sem duplicatas por produto)
      const payMap: Record<string, any> = {};
      (r2.data || []).forEach((r: any) => {
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
      setPaymentData(
        Object.values(payMap).map((r: any) => ({
          ...r,
          taxa_aprovacao_pct: r.total_tentativas > 0 ? ((r.aprovadas / r.total_tentativas) * 100).toFixed(1) : "0.0",
        })),
      );

      // Placement: agregar
      const plMap: Record<string, any> = {};
      (r3.data || []).forEach((r: any) => {
        const k = r.placement;
        if (!plMap[k]) plMap[k] = { placement: k, vendas_aprovadas: 0, faturamento: 0 };
        plMap[k].vendas_aprovadas += Number(r.vendas_aprovadas || 0);
        plMap[k].faturamento += Number(r.faturamento || 0);
      });
      setPlacementData(Object.values(plMap).sort((a, b) => b.faturamento - a.faturamento));

      setHourlyData((r4.data || []).sort((a: any, b: any) => (a.hora || 0) - (b.hora || 0)));
      setLoading(false);
    };
    fetchData();
  }, [startDateStr, endDateStr, product, statusFilter]);

  const openDetail = async (sale: any) => {
    setSelectedSale(sale);
    const { data: items } = await supabase.from("venda_itens").select("*").eq("venda_id", sale.id);
    setSaleItems(items || []);
  };

  const statuses = ["todos", "aprovada", "pendente", "cancelada", "reembolsada"];
  const displayPedidoId = (sale: any) => (sale.pedido_id?.startsWith("LC-") ? "Carrinho Abandonado" : sale.pedido_id);
  const peakHour = hourlyData.reduce(
    (max, r) => ((r.vendas_aprovadas || 0) > (max?.vendas_aprovadas || 0) ? r : max),
    hourlyData[0],
  );
  const taxaBadge = (taxa: number) => (taxa > 70 ? "text-success" : taxa >= 50 ? "text-warning" : "text-destructive");

  return (
    <DashboardLayout title="Vendas">
      <Tabs defaultValue="lista" className="space-y-4">
        <TabsList className="bg-secondary border border-border flex-wrap h-auto gap-1">
          {["lista", "faturamento", "produto", "pagamento", "placement", "horario"].map((tab) => (
            <TabsTrigger
              key={tab}
              value={tab}
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground capitalize"
            >
              {tab === "lista"
                ? "Lista"
                : tab === "faturamento"
                  ? "Fat. por Dia"
                  : tab === "produto"
                    ? "Por Produto"
                    : tab === "pagamento"
                      ? "Por Pagamento"
                      : tab === "placement"
                        ? "Por Placement"
                        : "Por Horário"}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── Lista ──────────────────────────────────────────── */}
        <TabsContent value="lista">
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="flex items-center gap-1 bg-secondary rounded-lg p-1">
              {statuses.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize",
                    statusFilter === s
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">Carregando...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {["Pedido", "Data", "Cliente", "Produto", "Status", "Total", "Pagamento", "UTM Source"].map(
                        (h) => (
                          <th
                            key={h}
                            className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {salesData.map((sale) => (
                      <tr
                        key={sale.id}
                        onClick={() => openDetail(sale)}
                        className="border-b border-border/50 hover:bg-secondary/50 transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-3 text-foreground font-mono text-xs">{displayPedidoId(sale)}</td>
                        <td className="px-4 py-3 text-foreground whitespace-nowrap">
                          {sale.data_venda ? format(new Date(sale.data_venda), "dd/MM/yy HH:mm") : "-"}
                        </td>
                        <td className="px-4 py-3 text-foreground">{sale.clientes?.nome || "-"}</td>
                        <td className="px-4 py-3 text-foreground capitalize">{sale.produto || "-"}</td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              "px-2 py-0.5 rounded-full text-xs font-medium border",
                              statusStyles[sale.status] || "",
                            )}
                          >
                            {sale.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-foreground font-medium">
                          {formatCurrency(sale.valor_total || 0)}
                        </td>
                        <td className="px-4 py-3 text-foreground capitalize">
                          {sale.meio_pagamento?.replace("_", " ") || "-"}
                        </td>
                        <td className="px-4 py-3 text-foreground text-xs">{sale.utm_source || "-"}</td>
                      </tr>
                    ))}
                    {salesData.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                          Nenhuma venda encontrada
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Faturamento por Dia ──────────────────────────── */}
        <TabsContent value="faturamento">
          <div className="bg-card border border-border rounded-lg p-5">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">Faturamento por Dia</h3>
            <ResponsiveContainer width="100%" height={320}>
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
        </TabsContent>

        {/* ── Por Produto ──────────────────────────────────── */}
        <TabsContent value="produto">
          <div className="bg-card border border-border rounded-lg p-5">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">Faturamento por Produto</h3>
            <div className="flex flex-col lg:flex-row items-center gap-6">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={byProduct}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={110}
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
              <div className="space-y-2 w-full max-w-xs">
                {byProduct.map((r, i) => (
                  <div key={i} className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="text-sm text-foreground capitalize">{r.name}</span>
                    </div>
                    <span className="text-sm font-medium text-foreground">{formatCurrency(r.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── Por Pagamento ────────────────────────────────── */}
        <TabsContent value="pagamento">
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {[
                      "Meio de Pagamento",
                      "Tentativas",
                      "Aprovadas",
                      "Canceladas",
                      "Expiradas",
                      "Faturamento",
                      "Taxa Aprov.",
                      "Ticket Médio",
                    ].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paymentData.map((r: any, i: number) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-secondary/50">
                      <td className="px-4 py-3 text-foreground font-medium">
                        {paymentLabels[r.meio_pagamento] || r.meio_pagamento}
                      </td>
                      <td className="px-4 py-3 text-foreground">{formatNumber(r.total_tentativas || 0)}</td>
                      <td className="px-4 py-3 text-foreground">{formatNumber(r.aprovadas || 0)}</td>
                      <td className="px-4 py-3 text-foreground">{formatNumber(r.canceladas || 0)}</td>
                      <td className="px-4 py-3 text-foreground">{formatNumber(r.expiradas || 0)}</td>
                      <td className="px-4 py-3 text-foreground font-medium">{formatCurrency(r.faturamento || 0)}</td>
                      <td className={cn("px-4 py-3 font-medium", taxaBadge(Number(r.taxa_aprovacao_pct) || 0))}>
                        {Number(r.taxa_aprovacao_pct).toFixed(1)}%
                      </td>
                      <td className="px-4 py-3 text-foreground">{formatCurrency(r.ticket_medio || 0)}</td>
                    </tr>
                  ))}
                  {paymentData.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                        Sem dados
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* ── Por Placement ────────────────────────────────── */}
        <TabsContent value="placement">
          <div className="bg-card border border-border rounded-lg p-5">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">Vendas por Placement</h3>
            <div className="space-y-1">
              {placementData.map((r, i) => (
                <div key={i} className="flex items-center justify-between py-3 border-b border-border/50 last:border-0">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: COLORS[i % COLORS.length] }}
                    />
                    <span className="text-sm text-foreground">{placementLabels[r.placement] || r.placement}</span>
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    <span className="text-muted-foreground">{formatNumber(r.vendas_aprovadas)} vendas</span>
                    <span className="font-semibold text-foreground">{formatCurrency(r.faturamento)}</span>
                  </div>
                </div>
              ))}
              {placementData.length === 0 && <div className="text-center text-muted-foreground py-8">Sem dados</div>}
            </div>
          </div>
        </TabsContent>

        {/* ── Por Horário ──────────────────────────────────── */}
        <TabsContent value="horario">
          <div className="bg-card border border-border rounded-lg p-5 mb-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">
              Vendas por Hora
              {peakHour && (
                <span className="text-primary ml-2">
                  | Pico: {peakHour.hora}h ({formatNumber(peakHour.vendas_aprovadas || 0)} vendas)
                </span>
              )}
            </h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,16%)" />
                <XAxis dataKey="hora" stroke="#555" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}h`} />
                <YAxis stroke="#555" tick={{ fontSize: 11 }} />
                <Tooltip {...chartTooltipStyle} />
                <Bar dataKey="vendas_aprovadas" radius={[4, 4, 0, 0]}>
                  {hourlyData.map((entry: any, i: number) => (
                    <Cell
                      key={i}
                      fill={peakHour && entry.hora === peakHour.hora ? "hsl(38,92%,50%)" : "hsl(239,84%,67%)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {["Hora", "Vendas", "Faturamento", "Taxa Aprov."].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hourlyData.map((r: any, i: number) => (
                  <tr
                    key={i}
                    className={cn(
                      "border-b border-border/50 hover:bg-secondary/50",
                      peakHour && r.hora === peakHour.hora && "bg-warning/10",
                    )}
                  >
                    <td className="px-4 py-3 text-foreground font-medium">{r.hora}h</td>
                    <td className="px-4 py-3 text-foreground">{formatNumber(r.vendas_aprovadas || 0)}</td>
                    <td className="px-4 py-3 text-foreground">{formatCurrency(r.faturamento || 0)}</td>
                    <td className="px-4 py-3 text-foreground">{formatPercent(r.taxa_aprovacao_pct || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Modal de detalhe */}
      <Dialog open={!!selectedSale} onOpenChange={() => setSelectedSale(null)}>
        <DialogContent className="max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Detalhes da Venda</DialogTitle>
          </DialogHeader>
          {selectedSale && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Pedido:</span>{" "}
                  <span className="text-foreground ml-1">{displayPedidoId(selectedSale)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <span
                    className={cn(
                      "ml-1 px-2 py-0.5 rounded-full text-xs font-medium border",
                      statusStyles[selectedSale.status],
                    )}
                  >
                    {selectedSale.status}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Produto:</span>{" "}
                  <span className="text-foreground ml-1 capitalize">{selectedSale.produto}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Total:</span>{" "}
                  <span className="text-foreground ml-1 font-medium">
                    {formatCurrency(selectedSale.valor_total || 0)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Cliente:</span>{" "}
                  <span className="text-foreground ml-1">{selectedSale.clientes?.nome}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Email:</span>{" "}
                  <span className="text-foreground ml-1">{selectedSale.clientes?.email}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Pagamento:</span>{" "}
                  <span className="text-foreground ml-1 capitalize">
                    {selectedSale.meio_pagamento?.replace("_", " ") || "-"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Placement:</span>{" "}
                  <span className="text-foreground ml-1">{selectedSale.utm_placement || "-"}</span>
                </div>
              </div>
              {saleItems.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">Order Bumps</h4>
                  <div className="space-y-2">
                    {saleItems.map((item: any) => (
                      <div
                        key={item.id}
                        className="flex justify-between items-center bg-secondary rounded-md px-3 py-2 text-sm"
                      >
                        <span className="text-foreground">{item.nome}</span>
                        <span className="text-foreground font-medium">{formatCurrency(item.valor || 0)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
