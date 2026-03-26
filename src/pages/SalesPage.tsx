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
  expirada: "bg-muted text-muted-foreground border-border",
  reembolsada: "bg-destructive/20 text-destructive border-destructive/30",
};

const COLORS = ["hsl(239,84%,67%)", "hsl(160,60%,45%)", "hsl(38,92%,50%)", "hsl(0,72%,51%)", "hsl(280,65%,60%)"];

const chartTooltip = {
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

export default function SalesPage() {
  const { startDateStr, endDateStr, funilId } = useFilters();
  const [salesData, setSalesData] = useState<any[]>([]);
  const [temporal, setTemporal] = useState<any[]>([]);
  const [byProduct, setByProduct] = useState<any[]>([]);
  const [paymentData, setPaymentData] = useState<any[]>([]);
  const [hourlyData, setHourlyData] = useState<any[]>([]);
  const [weekData, setWeekData] = useState<any[]>([]);
  const [monthData, setMonthData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSale, setSelectedSale] = useState<any>(null);
  const [saleItems, setSaleItems] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState("todos");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      
      const endDateEnd = endDateStr ? `${endDateStr}T23:59:59` : null;

      // Busca is_upsell junto com as vendas
      let qSales = supabase
        .from("vendas")
        .select("*, clientes(nome, email, telefone)")
        .not("pedido_id", "like", "TEST%")
        .not("pedido_id", "like", "LC-%")
        .order("data_venda", { ascending: false });
      if (startDateStr && endDateEnd) qSales = qSales.gte("data_venda", startDateStr).lte("data_venda", endDateEnd);
      if (funilId) qSales = qSales.eq("funil_id", funilId);
      if (statusFilter !== "todos") qSales = qSales.eq("status", statusFilter);

      let qT = supabase.from("vw_vendas_temporal").select("*");
      if (startDateStr && endDateStr) qT = qT.gte("data", startDateStr).lte("data", endDateStr);
      if (funilId) qT = qT.eq("funil_id", funilId);

      let qP = supabase
        .from("vendas")
        .select("valor_total,produto")
        .eq("status", "aprovada")
        .not("pedido_id", "like", "TEST%")
        .not("pedido_id", "like", "LC-%");
      if (startDateStr && endDateEnd) qP = qP.gte("data_venda", startDateStr).lte("data_venda", endDateEnd);
      if (funilId) qP = qP.eq("funil_id", funilId);

      let qPay = supabase.from("vw_vendas_por_pagamento").select("*");
      if (funilId) qPay = qPay.eq("funil_id", funilId);

      let qH = supabase.from("vw_vendas_por_horario").select("*");
      if (funilId) qH = qH.eq("funil_id", funilId);

      let qW = supabase.from("vw_vendas_por_dia_semana").select("*");
      if (funilId) qW = qW.eq("funil_id", funilId);

      let qM = supabase.from("vw_vendas_por_mes").select("*").order("mes_ano", { ascending: true });
      if (funilId) qM = qM.eq("funil_id", funilId);

      const [rS, rT, rP, rPay, rH, rW, rM] = await Promise.all([qSales, qT, qP, qPay, qH, qW, qM]);

      setSalesData(rS.data || []);

      setTemporal(
        (rT.data || []).map((r: any) => ({
          ...r,
          dataLabel: String(new Date(r.data + "T00:00:00").getDate()).padStart(2, "0"),
        })),
      );

      const prodMap: Record<string, number> = {};
      (rP.data || []).forEach((v: any) => {
        const p = v.produto || "Outros";
        prodMap[p] = (prodMap[p] || 0) + Number(v.valor_total || 0);
      });
      setByProduct(Object.entries(prodMap).map(([name, value]) => ({ name, value })));

      const payMap: Record<string, any> = {};
      (rPay.data || []).forEach((r: any) => {
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

      setHourlyData((rH.data || []).sort((a: any, b: any) => (a.hora || 0) - (b.hora || 0)));

      const weekOrder = [1, 2, 3, 4, 5, 6, 0];
      const weekMap: Record<number, any> = {};
      (rW.data || []).forEach((r: any) => {
        const d = r.dia_semana;
        if (!weekMap[d]) weekMap[d] = { dia_semana: d, dia_nome: r.dia_nome, vendas_aprovadas: 0, faturamento: 0 };
        weekMap[d].vendas_aprovadas += Number(r.vendas_aprovadas || 0);
        weekMap[d].faturamento += Number(r.faturamento || 0);
      });
      setWeekData(
        weekOrder.map(
          (d) =>
            weekMap[d] || {
              dia_semana: d,
              dia_nome: ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][d],
              vendas_aprovadas: 0,
              faturamento: 0,
            },
        ),
      );

      const monthMap: Record<string, any> = {};
      (rM.data || []).forEach((r: any) => {
        const k = r.mes_ano;
        if (!monthMap[k]) monthMap[k] = { mes_ano: k, vendas_aprovadas: 0, faturamento: 0 };
        monthMap[k].vendas_aprovadas += Number(r.vendas_aprovadas || 0);
        monthMap[k].faturamento += Number(r.faturamento || 0);
      });
      setMonthData(Object.values(monthMap).sort((a: any, b: any) => a.mes_ano.localeCompare(b.mes_ano)));

      setLoading(false);
    };
    load();
  }, [startDateStr, endDateStr, funilId, statusFilter]);

  const openDetail = async (sale: any) => {
    setSelectedSale(sale);
    const { data: items } = await supabase.from("venda_itens").select("*").eq("venda_id", sale.id);
    setSaleItems(items || []);
  };

  // Inclui expirada nos filtros
  const statuses = ["todos", "aprovada", "pendente", "cancelada", "expirada", "reembolsada"];
  const displayId = (sale: any) => (sale.pedido_id?.startsWith("LC-") ? "Carrinho Abandonado" : sale.pedido_id);
  const peakHour = hourlyData.reduce(
    (max, r) => ((r.vendas_aprovadas || 0) > (max?.vendas_aprovadas || 0) ? r : max),
    hourlyData[0],
  );
  const taxaBadge = (t: number) => (t > 70 ? "text-success" : t >= 50 ? "text-warning" : "text-destructive");

  const tabs = [
    { value: "horario", label: "Horário" },
    { value: "dia", label: "Dia da Sem." },
    { value: "lista", label: "Por Data" },
    { value: "mes", label: "Por Mês" },
    { value: "produto", label: "Por Produto" },
    { value: "pagamento", label: "Pagamento" },
  ];

  return (
    <DashboardLayout title="Vendas">
      <Tabs defaultValue="horario" className="space-y-4">
        <TabsList className="bg-secondary border border-border flex-wrap h-auto gap-1 p-1">
          {tabs.map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs"
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── Por Horário ─────────────────────────────────── */}
        <TabsContent value="horario">
          <div className="bg-card border border-border rounded-lg p-5 mb-4">
            <h3 className="text-sm font-medium text-muted-foreground mb-3">
              Vendas por Hora
              {peakHour && <span className="text-primary ml-2">| Pico: {peakHour.hora}h</span>}
            </h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,16%)" />
                <XAxis dataKey="hora" stroke="#555" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}h`} />
                <YAxis stroke="#555" tick={{ fontSize: 10 }} />
                <Tooltip {...chartTooltip} />
                <Bar dataKey="vendas_aprovadas" radius={[4, 4, 0, 0]}>
                  {hourlyData.map((e: any, i: number) => (
                    <Cell
                      key={i}
                      fill={peakHour && e.hora === peakHour.hora ? "hsl(38,92%,50%)" : "hsl(239,84%,67%)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <TableCard headers={["Hora", "Vendas", "Faturamento", "Taxa Aprov."]}>
            {hourlyData.map((r: any, i: number) => (
              <tr
                key={i}
                className={cn(
                  "border-b border-border/50 hover:bg-secondary/50",
                  peakHour && r.hora === peakHour.hora && "bg-warning/10",
                )}
              >
                <td className="px-4 py-2 font-medium text-foreground">{r.hora}h</td>
                <td className="px-4 py-2 text-foreground">{formatNumber(r.vendas_aprovadas || 0)}</td>
                <td className="px-4 py-2 text-foreground">{formatCurrency(r.faturamento || 0)}</td>
                <td className="px-4 py-2 text-foreground">{formatPercent(r.taxa_aprovacao_pct || 0)}</td>
              </tr>
            ))}
          </TableCard>
        </TabsContent>

        {/* ── Por Dia da Semana ────────────────────────────── */}
        <TabsContent value="dia">
          <div className="bg-card border border-border rounded-lg p-5 mb-4">
            <h3 className="text-sm font-medium text-muted-foreground mb-3">Vendas por Dia da Semana</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={weekData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,16%)" />
                <XAxis dataKey="dia_nome" stroke="#555" tick={{ fontSize: 10 }} />
                <YAxis stroke="#555" tick={{ fontSize: 10 }} />
                <Tooltip {...chartTooltip} />
                <Bar dataKey="vendas_aprovadas" fill="hsl(239,84%,67%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <TableCard headers={["Dia", "Vendas", "Faturamento"]}>
            {weekData.map((r: any, i: number) => (
              <tr key={i} className="border-b border-border/50 hover:bg-secondary/50">
                <td className="px-4 py-2 font-medium text-foreground">{r.dia_nome}</td>
                <td className="px-4 py-2 text-foreground">{formatNumber(r.vendas_aprovadas || 0)}</td>
                <td className="px-4 py-2 text-foreground">{formatCurrency(r.faturamento || 0)}</td>
              </tr>
            ))}
          </TableCard>
        </TabsContent>

        {/* ── Lista / Por Data ─────────────────────────────── */}
        <TabsContent value="lista">
          <div className="space-y-3">
            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Faturamento por Dia</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={temporal}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,16%)" />
                  <XAxis dataKey="dataLabel" stroke="#555" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#555" tick={{ fontSize: 10 }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    {...chartTooltip}
                    formatter={(v: any) => [`R$ ${Number(v).toFixed(2)}`, "Faturamento"]}
                    labelFormatter={(l) => `Dia ${l}`}
                  />
                  <Bar dataKey="faturamento" fill="hsl(239,84%,67%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Filtro status */}
            <div className="flex items-center gap-1 bg-secondary rounded-lg p-1 w-fit flex-wrap">
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

            {/* Tabela com coluna Tipo */}
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              {loading ? (
                <div className="p-8 text-center text-muted-foreground">Carregando...</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        {[
                          "Pedido",
                          "Tipo",
                          "Data",
                          "Cliente",
                          "Produto",
                          "Status",
                          "Total",
                          "Pagamento",
                          "UTM Source",
                        ].map((h) => (
                          <th
                            key={h}
                            className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {salesData.map((sale) => (
                        <tr
                          key={sale.id}
                          onClick={() => openDetail(sale)}
                          className="border-b border-border/50 hover:bg-secondary/50 cursor-pointer"
                        >
                          <td className="px-4 py-3 font-mono text-xs text-foreground">{displayId(sale)}</td>
                          {/* Coluna Tipo: Upsell ou Normal */}
                          <td className="px-4 py-3">
                            {sale.is_upsell ? (
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 whitespace-nowrap">
                                Upsell
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-muted-foreground border border-border">
                                Normal
                              </span>
                            )}
                          </td>
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
                          <td className="px-4 py-3 font-medium text-foreground">
                            {formatCurrency(sale.valor_total || 0)}
                          </td>
                          <td className="px-4 py-3 text-foreground capitalize">
                            {sale.meio_pagamento?.replace("_", " ") || "-"}
                          </td>
                          <td className="px-4 py-3 text-xs text-foreground">{sale.utm_source || "-"}</td>
                        </tr>
                      ))}
                      {salesData.length === 0 && (
                        <tr>
                          <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                            Nenhuma venda
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── Por Mês ──────────────────────────────────────── */}
        <TabsContent value="mes">
          <div className="bg-card border border-border rounded-lg p-5 mb-4">
            <h3 className="text-sm font-medium text-muted-foreground mb-3">Faturamento por Mês</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,16%)" />
                <XAxis dataKey="mes_ano" stroke="#555" tick={{ fontSize: 10 }} />
                <YAxis stroke="#555" tick={{ fontSize: 10 }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                <Tooltip {...chartTooltip} formatter={(v: any) => [`R$ ${Number(v).toFixed(2)}`, "Faturamento"]} />
                <Bar dataKey="faturamento" fill="hsl(160,60%,45%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <TableCard headers={["Mês", "Vendas", "Faturamento", "Ticket Médio"]}>
            {monthData.map((r: any, i: number) => (
              <tr key={i} className="border-b border-border/50 hover:bg-secondary/50">
                <td className="px-4 py-2 font-medium text-foreground">{r.mes_ano}</td>
                <td className="px-4 py-2 text-foreground">{formatNumber(r.vendas_aprovadas || 0)}</td>
                <td className="px-4 py-2 text-foreground">{formatCurrency(r.faturamento || 0)}</td>
                <td className="px-4 py-2 text-foreground">
                  {r.vendas_aprovadas > 0 ? formatCurrency(r.faturamento / r.vendas_aprovadas) : "-"}
                </td>
              </tr>
            ))}
          </TableCard>
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
                  <Tooltip {...chartTooltip} formatter={(v: any) => [`R$ ${Number(v).toFixed(2)}`, "Faturamento"]} />
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

        {/* ── Pagamento ────────────────────────────────────── */}
        <TabsContent value="pagamento">
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {[
                      "Meio",
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
                      <td className="px-4 py-3 font-medium text-foreground">
                        {paymentLabels[r.meio_pagamento] || r.meio_pagamento}
                      </td>
                      <td className="px-4 py-3 text-foreground">{formatNumber(r.total_tentativas || 0)}</td>
                      <td className="px-4 py-3 text-foreground">{formatNumber(r.aprovadas || 0)}</td>
                      <td className="px-4 py-3 text-foreground">{formatNumber(r.canceladas || 0)}</td>
                      <td className="px-4 py-3 text-foreground">{formatNumber(r.expiradas || 0)}</td>
                      <td className="px-4 py-3 font-medium text-foreground">{formatCurrency(r.faturamento || 0)}</td>
                      <td className={cn("px-4 py-3 font-medium", taxaBadge(Number(r.taxa_aprovacao_pct)))}>
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
      </Tabs>

      {/* Modal detalhe */}
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
                  <span className="text-foreground ml-1">{displayId(selectedSale)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Tipo:</span>
                  {selectedSale.is_upsell ? (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                      Upsell
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-muted-foreground border border-border">
                      Normal
                    </span>
                  )}
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

function TableCard({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border overflow-hidden rounded-lg">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {headers.map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}
