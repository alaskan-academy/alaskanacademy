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

/*
  As formas dos dados desta tela.

  Estavam todas como `any` — 31 dos 204 erros de lint do projeto moravam neste
  arquivo. `any` aqui não era preguiça: o cliente do Supabase é criado sem os
  tipos do banco, então todo `select` volta solto e cada tela inventa o próprio
  jeito de lidar com isso.

  Enquanto o cliente não for tipado, o remendo honesto é este: declarar a forma
  ao lado de quem usa, copiada das colunas REAIS das views — conferidas no
  `information_schema`, não adivinhadas. Tipo inventado é pior que `any`,
  porque cala uma verificação em vez de só não fazê-la.

  Os números vêm do Postgres como `numeric`/`bigint`, e o supabase-js entrega
  `number`. Onde o código faz `Number(x || 0)` é porque nulo acontece — está
  marcado com `| null`.
*/

/** Uma venda, com o cliente embutido pelo `select`. */
type Venda = {
  id: string;
  pedido_id: string | null;
  data_venda: string;
  produto: string | null;
  valor_total: number | null;
  status: string;
  meio_pagamento: string | null;
  utm_source: string | null;
  utm_placement: string | null;
  is_upsell: boolean | null;
  clientes: { nome: string | null; email: string | null; telefone: string | null } | null;
};

/** Linha de `venda_itens` — o que aparece no detalhe da venda. */
type ItemDaVenda = { id: string; nome: string | null; valor: number | null };

/** Um dia da série, com o rótulo que a tela acrescenta. */
type PontoTemporal = {
  data: string;
  vendas_aprovadas: number | null;
  vendas_pendentes: number | null;
  faturamento: number | null;
  dataLabel: string;
};

/** O que o gráfico de pizza por produto consome. */
type FatiaPorProduto = { name: string; value: number };

/** Por meio de pagamento, com taxa e ticket refeitos sobre os totais. */
type PorPagamento = {
  meio_pagamento: string;
  aprovadas: number;
  faturamento: number;
  total_tentativas: number;
  canceladas: number;
  expiradas: number;
  taxa_aprovacao_pct: string;
  ticket_medio: number;
};

/** Por hora do dia, em horário de Brasília. */
type PorHora = {
  hora: number; vendas_aprovadas: number; vendas_pendentes: number;
  faturamento: number; base_taxa: number; taxa_aprovacao_pct: number;
};

/** Por dia da semana. */
type PorDiaDaSemana = {
  dia_semana: number;
  dia_nome: string;
  vendas_aprovadas: number;
  faturamento: number;
};

/** Por mês. */
type PorMes = { mes_ano: string; vendas_aprovadas: number; faturamento: number };

/*
  O que `fn_vendas_agregado` devolve, recorte por recorte.

  Sao as formas CRUAS, antes das contas da tela: a taxa de aprovacao e o ticket
  medio nao vem do banco de proposito -- somar taxa de produto com taxa de
  produto e tirar media daria peso igual a um produto com 3 vendas e a outro
  com 300. Eles se refazem aqui embaixo, sobre os totais.
*/
type BrutoTemporal   = { data: string; vendas_aprovadas: number; vendas_pendentes: number; faturamento: number };
type BrutoPagamento  = { meio_pagamento: string; total_tentativas: number; aprovadas: number;
                         canceladas: number; expiradas: number; faturamento: number };
type BrutoHora       = { hora: number; vendas_aprovadas: number; vendas_pendentes: number;
                         base_taxa: number; faturamento: number };
type BrutoDiaSemana  = { dia_semana: number; dia_nome: string; vendas_aprovadas: number; faturamento: number };
type BrutoMes        = { mes_ano: string; vendas_aprovadas: number; faturamento: number };

const PAGE_SIZE = 50;

export default function SalesPage() {
  const { startDateStr, endDateStr, startISO, endISO, contaIds } = useFilters();
  const [salesData, setSalesData] = useState<Venda[]>([]);
  const [salesTotal, setSalesTotal] = useState(0);
  const [salesPage, setSalesPage] = useState(0);
  const [temporal, setTemporal] = useState<PontoTemporal[]>([]);
  const [byProduct, setByProduct] = useState<FatiaPorProduto[]>([]);
  const [paymentData, setPaymentData] = useState<PorPagamento[]>([]);
  const [hourlyData, setHourlyData] = useState<PorHora[]>([]);
  const [weekData, setWeekData] = useState<PorDiaDaSemana[]>([]);
  const [monthData, setMonthData] = useState<PorMes[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSales, setLoadingSales] = useState(false);
  const [selectedSale, setSelectedSale] = useState<Venda | null>(null);
  const [saleItems, setSaleItems] = useState<ItemDaVenda[]>([]);
  const [statusFilter, setStatusFilter] = useState("todos");
  /*
    Vendas aprovadas sem hora registrada.

    Não é ruído: são 4.288 no histórico, todas da carga inicial, que só trouxe
    a data. O recorte por hora tem que deixá-las de fora — senão metade do
    histórico empilha na meia-noite e inventa um pico que nunca existiu —, mas
    a tela precisa dizer que deixou.
  */
  const [semRelogio, setSemRelogio] = useState(0);

  // Reset page when filters change
  useEffect(() => { setSalesPage(0); }, [startDateStr, endDateStr, contaIds, statusFilter]);

  // Paginated sales fetch (runs when page OR filters change)
  useEffect(() => {
    const loadSales = async () => {
      setLoadingSales(true);
      const endDateEnd = endISO;
      const from = salesPage * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;

      let q = supabase
        .from("vendas")
        .select("*, clientes(nome, email, telefone)", { count: "exact" })
        .not("pedido_id", "like", "TEST%")
        .not("pedido_id", "like", "LC-%")
        .order("data_venda", { ascending: false })
        .range(from, to);
      if (startISO && endDateEnd) q = q.gte("data_venda", startISO).lte("data_venda", endDateEnd);
      if (contaIds.length) q = q.in("ad_account_id", contaIds);
      if (statusFilter !== "todos") q = q.eq("status", statusFilter);

      const { data, count } = await q;
      setSalesData(data ?? []);
      setSalesTotal(count ?? 0);
      setLoadingSales(false);
    };
    loadSales();
  }, [salesPage, startDateStr, endDateStr, contaIds, statusFilter]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      /*
        Uma chamada, e o filtro de período valendo para as seis abas.

        Quatro delas ignoravam o período — e não por descuido de quem escreveu
        a página: `vw_vendas_por_pagamento`, `_por_horario`, `_por_dia_semana`
        e `_por_mes` não TÊM coluna de data, agregam o histórico inteiro. Com
        "Hoje" selecionado (1 venda), a aba de horário mostrava 4.410 vendas e
        a de pagamento, 9.105. Sem nenhum sinal na tela.

        A aba de produtos tinha o outro defeito da casa: lia linhas cruas de
        `vendas` — 2.462 em agosto — e o PostgREST corta em 1.000.

        E as views discordavam entre si sobre o que é uma venda: três excluíam
        `LC-%` e duas não; quatro descontavam upsell pela heurística aposentada
        (`upsell_de`, 69 linhas) em vez do campo atual (`is_upsell`, 403). Eram
        358 upsells contados como venda normal aqui e em nenhuma outra tela.

        Agora a regra está escrita uma vez, dentro de `fn_vendas_agregado`.
      */
      const { data: agg, error } = await supabase.rpc("fn_vendas_agregado", {
        p_inicio: startISO || null,
        p_fim: endISO || null,
        p_contas: contaIds,
      });
      if (error) console.error("fn_vendas_agregado:", error.message);

      /*
        `unknown` e não `any`: cada recorte é lido logo abaixo com o tipo que
        a tela já declara, e o `unknown` obriga essa passagem a ser explícita.
        Com `any`, um campo renomeado no SQL viraria uma aba vazia em silêncio.
      */
      const dados = (agg ?? {}) as Record<string, unknown>;
      /** Cada recorte vem como lista; `lista` faz a leitura explicita uma vez. */
      const lista = <T,>(chave: string) => (dados[chave] ?? []) as T[];

      const rT   = { data: lista<BrutoTemporal>("temporal") };
      const rPay = { data: lista<BrutoPagamento>("por_pagamento") };
      const rH   = { data: lista<BrutoHora>("por_hora") };
      const rW   = { data: lista<BrutoDiaSemana>("por_dia_semana") };
      const rM   = { data: lista<BrutoMes>("por_mes") };
      setSemRelogio(Number(dados.horas_sem_relogio ?? 0));
      setByProduct(lista<FatiaPorProduto>("por_produto"));

      setTemporal(
        (rT.data ?? []).map((r): PontoTemporal => ({
          ...r,
          dataLabel: String(new Date(r.data + "T00:00:00").getDate()).padStart(2, "0"),
        })),
      );

      const payMap: Record<string, Omit<PorPagamento, 'taxa_aprovacao_pct' | 'ticket_medio'>> = {};
      (rPay.data ?? []).forEach((r) => {
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
      // A taxa ja era recalculada aqui; o ticket medio nao vinha junto e a coluna
      // mostrava R$ 0,00 para todos os meios. Os dois saem dos totais somados.
      setPaymentData(
        Object.values(payMap).map((r): PorPagamento => ({
          ...r,
          taxa_aprovacao_pct: r.total_tentativas > 0 ? ((r.aprovadas / r.total_tentativas) * 100).toFixed(1) : "0.0",
          ticket_medio: r.aprovadas > 0 ? r.faturamento / r.aprovadas : 0,
        })),
      );

      // A view devolve uma linha por produto (e agora por conta), entao 24 horas viram
      // ~100 linhas. Antes so ordenava, e o grafico desenhava a mesma hora varias vezes.
      // Os outros tres graficos ja somavam; este era o unico que nao.
      const hourMap: Record<number, PorHora> = {};
      (rH.data ?? []).forEach((r: Record<string, unknown>) => {
        const h = Number(r.hora ?? 0);
        if (!hourMap[h]) {
          hourMap[h] = { hora: h, vendas_aprovadas: 0, vendas_pendentes: 0,
                         faturamento: 0, base_taxa: 0, taxa_aprovacao_pct: 0 };
        }
        hourMap[h].vendas_aprovadas += Number(r.vendas_aprovadas || 0);
        hourMap[h].vendas_pendentes += Number(r.vendas_pendentes || 0);
        hourMap[h].faturamento      += Number(r.faturamento || 0);
        hourMap[h].base_taxa        += Number(r.base_taxa || 0);
      });
      // A taxa se recalcula sobre os totais somados. Somar as taxas de cada produto e
      // tirar a media daria peso igual a um produto com 3 vendas e a outro com 300.
      Object.values(hourMap).forEach((x) => {
        x.taxa_aprovacao_pct = x.base_taxa > 0
          ? Number(((x.vendas_aprovadas / x.base_taxa) * 100).toFixed(2))
          : 0;
      });
      setHourlyData(Object.values(hourMap).sort((a, b) => a.hora - b.hora));

      const weekOrder = [1, 2, 3, 4, 5, 6, 0];
      const weekMap: Record<number, PorDiaDaSemana> = {};
      (rW.data ?? []).forEach((r) => {
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

      const monthMap: Record<string, PorMes> = {};
      (rM.data ?? []).forEach((r) => {
        const k = r.mes_ano;
        if (!monthMap[k]) monthMap[k] = { mes_ano: k, vendas_aprovadas: 0, faturamento: 0 };
        monthMap[k].vendas_aprovadas += Number(r.vendas_aprovadas || 0);
        monthMap[k].faturamento += Number(r.faturamento || 0);
      });
      setMonthData(Object.values(monthMap).sort((a, b) => a.mes_ano.localeCompare(b.mes_ano)));

      setLoading(false);
    };
    load();
  }, [startDateStr, endDateStr, contaIds, statusFilter]);

  const openDetail = async (sale: Venda) => {
    setSelectedSale(sale);
    const { data: items } = await supabase.from("venda_itens").select("*").eq("venda_id", sale.id);
    setSaleItems(items || []);
  };

  // Inclui expirada nos filtros
  const statuses = ["todos", "aprovada", "pendente", "cancelada", "expirada", "reembolsada"];
  const displayId = (sale: Venda) => (sale.pedido_id?.startsWith("LC-") ? "Carrinho Abandonado" : sale.pedido_id);
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
    <DashboardLayout title="Vendas" hideTitle>
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
            <h3 className="text-sm font-medium text-muted-foreground mb-1">
              Vendas por Hora
              {peakHour && <span className="text-primary ml-2">| Pico: {peakHour.hora}h</span>}
            </h3>
            {/*
              O que ficou de fora, dito na tela.

              Venda sem hora registrada é descartada aqui — se não fosse, metade
              do histórico empilharia na meia-noite e o gráfico anunciaria um
              pico que nunca existiu. Mas descartar em silêncio é o defeito que
              esta noite inteira vem caçando: o número precisa aparecer.

              São 4.288 no histórico, todas da carga inicial, que só trouxe a
              data. De julho em diante a Payt manda a hora, e em agosto isto é
              zero — a faixa some sozinha nos períodos recentes.
            */}
            {semRelogio > 0 && (
              <p className="mb-3 text-xs text-muted-foreground">
                {formatNumber(semRelogio)} venda(s) do período não entram aqui: vieram sem hora
                registrada, da carga inicial.
              </p>
            )}
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,16%)" />
                <XAxis dataKey="hora" stroke="#555" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}h`} />
                <YAxis stroke="#555" tick={{ fontSize: 10 }} />
                <Tooltip {...chartTooltip} />
                <Bar dataKey="vendas_aprovadas" radius={[4, 4, 0, 0]}>
                  {hourlyData.map((e, i) => (
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
            {hourlyData.map((r, i) => (
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
            {weekData.map((r, i) => (
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
                    formatter={(v: number | string) => [`R$ ${Number(v).toFixed(2)}`, "Faturamento"]}
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
              {loading || loadingSales ? (
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
            {salesTotal > PAGE_SIZE && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border text-xs text-muted-foreground">
                <span>
                  {salesPage * PAGE_SIZE + 1}–{Math.min((salesPage + 1) * PAGE_SIZE, salesTotal)} de {salesTotal.toLocaleString('pt-BR')}
                </span>
                <div className="flex gap-1">
                  <button
                    disabled={salesPage === 0}
                    onClick={() => setSalesPage(p => p - 1)}
                    className="px-3 py-1 rounded border border-border disabled:opacity-40 hover:bg-accent transition-colors"
                  >
                    ← Anterior
                  </button>
                  <button
                    disabled={(salesPage + 1) * PAGE_SIZE >= salesTotal}
                    onClick={() => setSalesPage(p => p + 1)}
                    className="px-3 py-1 rounded border border-border disabled:opacity-40 hover:bg-accent transition-colors"
                  >
                    Próxima →
                  </button>
                </div>
              </div>
            )}
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
                <Tooltip {...chartTooltip} formatter={(v: number | string) => [`R$ ${Number(v).toFixed(2)}`, "Faturamento"]} />
                <Bar dataKey="faturamento" fill="hsl(160,60%,45%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <TableCard headers={["Mês", "Vendas", "Faturamento", "Ticket Médio"]}>
            {monthData.map((r, i) => (
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
                  <Tooltip {...chartTooltip} formatter={(v: number | string) => [`R$ ${Number(v).toFixed(2)}`, "Faturamento"]} />
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
                  {paymentData.map((r, i) => (
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
                    {saleItems.map((item) => (
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
