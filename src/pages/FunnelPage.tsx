import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useFilters } from "@/contexts/FilterContext";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/formatters";
import { cn } from "@/lib/utils";

export default function FunnelPage() {
  const { startDateStr, endDateStr, product } = useFilters();
  const [data, setData] = useState<any>(null);
  const [obsDetail, setObsDetail] = useState<any[]>([]);
  const [upsellDetail, setUpsellDetail] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const productFilter = product !== "todos" ? product : null;

      let q1 = supabase.from("vw_funil").select("*");
      if (startDateStr && endDateStr) q1 = q1.gte("data", startDateStr).lte("data", endDateStr);
      if (productFilter) q1 = q1.eq("produto", productFilter);

      let q2 = supabase.from("vw_conversao_obs").select("*");
      if (productFilter) q2 = q2.eq("produto", productFilter);

      let q3 = supabase.from("vw_conversao_upsell").select("*");
      if (productFilter) q3 = q3.eq("produto", productFilter);

      // Vendas reais aprovadas para cruzar com dados Meta
      let q4 = supabase
        .from("vendas")
        .select("valor_total, valor_oferta_principal, valor_obs")
        .eq("status", "aprovada")
        .not("pedido_id", "like", "TEST%")
        .not("pedido_id", "like", "LC-%");
      if (startDateStr && endDateStr) q4 = q4.gte("data_venda", startDateStr).lte("data_venda", endDateStr);
      if (productFilter) q4 = q4.eq("produto", productFilter);

      const [r1, r2, r3, r4] = await Promise.all([q1, q2, q3, q4]);

      const rows = r1.data || [];
      if (rows.length === 0) {
        setData(null);
        setLoading(false);
        return;
      }

      // Agregar funil
      const agg = rows.reduce(
        (acc: any, row: any) => {
          acc.impressoes += Number(row.impressoes || 0);
          acc.cliques += Number(row.cliques || 0);
          acc.cliques_link += Number(row.cliques_link || 0);
          acc.visualizacoes_pagina += Number(row.visualizacoes_pagina || 0);
          acc.initiate_checkout += Number(row.initiate_checkout || 0);
          acc.compras_meta += Number(row.compras_meta || 0);
          acc.investimento += Number(row.investimento || 0);
          acc.faturamento_atribuido += Number(row.faturamento_atribuido || 0);
          acc.video_plays += Number(row.video_plays || 0);
          acc.video_3s += Number(row.video_3s || 0);
          acc.video_75pct += Number(row.video_75pct || 0);
          acc.vendas_aprovadas += Number(row.vendas_aprovadas || 0);
          acc.faturamento_principal += Number(row.faturamento_principal || 0);
          acc.faturamento_obs += Number(row.faturamento_obs || 0);
          acc.faturamento_total += Number(row.faturamento_total || 0);
          acc.obs_convertidos += Number(row.obs_convertidos || 0);
          return acc;
        },
        {
          impressoes: 0,
          cliques: 0,
          cliques_link: 0,
          visualizacoes_pagina: 0,
          initiate_checkout: 0,
          compras_meta: 0,
          investimento: 0,
          faturamento_atribuido: 0,
          video_plays: 0,
          video_3s: 0,
          video_75pct: 0,
          vendas_aprovadas: 0,
          faturamento_principal: 0,
          faturamento_obs: 0,
          faturamento_total: 0,
          obs_convertidos: 0,
        },
      );

      // Vendas reais
      const vendasReais = r4.data || [];
      const totalVendas = vendasReais.length;
      const fatReal = vendasReais.reduce((s: number, v: any) => s + Number(v.valor_total || 0), 0);

      const inv = agg.investimento || 1;
      const vis = agg.visualizacoes_pagina || 0;
      const ic = agg.initiate_checkout || 0;
      const clk = agg.cliques || 0;

      setData({
        ...agg,
        totalVendas,
        fatReal,
        // Métricas derivadas
        resultado: fatReal - inv,
        margem: fatReal > 0 ? ((fatReal - inv) / fatReal) * 100 : 0,
        roas: inv > 0 ? fatReal / inv : 0,
        cpa: totalVendas > 0 ? inv / totalVendas : 0,
        cpv: vis > 0 ? inv / vis : 0,
        epc: clk > 0 ? fatReal / clk : 0,
        aov: totalVendas > 0 ? fatReal / totalVendas : 0,
        // Taxas
        taxa_vis_vendas: vis > 0 ? (totalVendas / vis) * 100 : 0,
        taxa_ic_vendas: ic > 0 ? (totalVendas / ic) * 100 : 0,
        taxa_carregamento: clk > 0 ? (vis / clk) * 100 : 0,
        taxa_vis_ic: vis > 0 ? (ic / vis) * 100 : 0,
        taxa_conv_checkout: ic > 0 ? (totalVendas / ic) * 100 : 0,
        taxa_video_3s: agg.impressoes > 0 ? (agg.video_3s / agg.impressoes) * 100 : 0,
        taxa_video_75: agg.video_plays > 0 ? (agg.video_75pct / agg.video_plays) * 100 : 0,
        taxa_compras_v75: agg.video_75pct > 0 ? (totalVendas / agg.video_75pct) * 100 : 0,
        epc_cpv: (clk > 0 ? fatReal / clk : 0) - (vis > 0 ? inv / vis : 0),
      });

      setObsDetail(r2.data || []);
      setUpsellDetail(r3.data || []);
      setLoading(false);
    };
    fetchData();
  }, [startDateStr, endDateStr, product]);

  if (loading)
    return (
      <DashboardLayout title="Funil">
        <div className="flex items-center justify-center h-64 text-muted-foreground animate-pulse">Carregando...</div>
      </DashboardLayout>
    );

  if (!data)
    return (
      <DashboardLayout title="Funil">
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          Nenhum dado encontrado para o período selecionado
        </div>
      </DashboardLayout>
    );

  // Etapas do funil
  const funnelSteps = [
    { label: "Impressões", value: data.impressoes, color: "hsl(239,84%,67%)" },
    { label: "Cliques", value: data.cliques, color: "hsl(239,84%,60%)" },
    { label: "Visualizações Pág.", value: data.visualizacoes_pagina, color: "hsl(239,84%,53%)" },
    { label: "ICs (Checkout)", value: data.initiate_checkout, color: "hsl(239,84%,46%)" },
    { label: "Vendas Aprovadas", value: data.totalVendas, color: "hsl(160,60%,45%)" },
    { label: "OBs Convertidos", value: data.obs_convertidos, color: "hsl(160,60%,38%)" },
  ];
  const maxFunnel = Math.max(...funnelSteps.map((s) => s.value), 1);

  const metric = (label: string, value: string, sub?: string) => (
    <div className="bg-secondary/50 rounded-lg p-3">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-sm font-semibold text-foreground">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );

  return (
    <DashboardLayout title="Funil">
      {/* ── KPIs principais ────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground mb-1">Investimento</div>
          <div className="text-xl font-bold text-foreground">{formatCurrency(data.investimento)}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground mb-1">Faturamento</div>
          <div className="text-xl font-bold text-foreground">{formatCurrency(data.fatReal)}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground mb-1">Resultado</div>
          <div className={cn("text-xl font-bold", data.resultado >= 0 ? "text-success" : "text-destructive")}>
            {formatCurrency(data.resultado)}
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground mb-1">Vendas</div>
          <div className="text-xl font-bold text-foreground">{formatNumber(data.totalVendas)}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground mb-1">ROAS</div>
          <div
            className={cn(
              "text-xl font-bold",
              data.roas >= 3 ? "text-success" : data.roas >= 1 ? "text-warning" : "text-destructive",
            )}
          >
            {data.roas.toFixed(2)}x
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground mb-1">CPA</div>
          <div className="text-xl font-bold text-foreground">{formatCurrency(data.cpa)}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground mb-1">Margem</div>
          <div
            className={cn(
              "text-xl font-bold",
              data.margem >= 30 ? "text-success" : data.margem >= 15 ? "text-warning" : "text-destructive",
            )}
          >
            {data.margem.toFixed(1)}%
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground mb-1">Lucro</div>
          <div className={cn("text-xl font-bold", data.resultado >= 0 ? "text-success" : "text-destructive")}>
            {formatCurrency(data.resultado)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* ── Funil visual ───────────────────────────────────────── */}
        <div className="bg-card border border-border rounded-lg p-5">
          <h3 className="text-sm font-medium text-muted-foreground mb-5">Funil de Conversão</h3>
          <div className="space-y-2">
            {funnelSteps.map((step, i) => {
              const width = Math.max((step.value / maxFunnel) * 100, 4);
              const prev = funnelSteps[i - 1];
              const taxa = prev && prev.value > 0 ? ((step.value / prev.value) * 100).toFixed(1) : null;
              return (
                <div key={step.label}>
                  {taxa && <div className="text-xs text-muted-foreground text-center mb-1">↓ {taxa}%</div>}
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-36 text-right shrink-0">{step.label}</span>
                    <div className="flex-1">
                      <div
                        className="h-9 rounded-md flex items-center px-3 transition-all"
                        style={{ width: `${width}%`, backgroundColor: step.color }}
                      >
                        <span className="text-xs font-semibold text-white whitespace-nowrap">
                          {formatNumber(step.value)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Breakdown de vendas ──────────────────────────────── */}
        <div className="bg-card border border-border rounded-lg p-5">
          <h3 className="text-sm font-medium text-muted-foreground mb-4">Breakdown de Vendas</h3>
          <div className="space-y-2 text-sm">
            {/* Oferta principal */}
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-foreground font-medium">Oferta principal</span>
              <div className="text-right">
                <div className="font-semibold text-foreground">{formatCurrency(data.faturamento_principal)}</div>
                <div className="text-xs text-muted-foreground">{formatNumber(data.totalVendas)} vendas</div>
              </div>
            </div>
            {/* OBs */}
            {obsDetail.map((ob, i) => (
              <div key={i} className="flex justify-between items-center py-2 border-b border-border/50">
                <div>
                  <span className="text-foreground">{ob.nome_ob}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    ({formatPercent(ob.taxa_conversao_pct || 0)})
                  </span>
                </div>
                <div className="text-right">
                  <div className="font-medium text-foreground">{formatCurrency(ob.receita_total_ob || 0)}</div>
                  <div className="text-xs text-muted-foreground">{formatNumber(ob.total_convertidos || 0)} conv.</div>
                </div>
              </div>
            ))}
            {/* Upsells */}
            {upsellDetail.map((up, i) => (
              <div key={i} className="flex justify-between items-center py-2 border-b border-border/50">
                <div>
                  <span className="text-foreground">{up.nome_upsell}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    ({formatPercent(up.taxa_conversao_pct || 0)})
                  </span>
                </div>
                <div className="text-right">
                  <div className="font-medium text-foreground">{formatCurrency(up.receita_total || 0)}</div>
                  <div className="text-xs text-muted-foreground">{formatNumber(up.total_upsells || 0)} conv.</div>
                </div>
              </div>
            ))}
            <div className="flex justify-between items-center pt-2 font-semibold">
              <span className="text-foreground">Total</span>
              <span className="text-foreground">{formatCurrency(data.fatReal)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Métricas detalhadas ─────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Métricas de cliques/página */}
        <div className="bg-card border border-border rounded-lg p-5">
          <h3 className="text-sm font-medium text-muted-foreground mb-4">Métricas de Tráfego</h3>
          <div className="grid grid-cols-2 gap-3">
            {metric(
              "Cliques",
              formatNumber(data.cliques),
              `R$ ${data.cliques > 0 ? (data.investimento / data.cliques).toFixed(2) : "0,00"} / clique`,
            )}
            {metric("Visualizações de Página", formatNumber(data.visualizacoes_pagina))}
            {metric("CPV (custo por visitante)", formatCurrency(data.cpv))}
            {metric("Taxa de Conexão", formatPercent(data.taxa_carregamento), "vis. pág / cliques")}
            {metric("ICs (Finalizações Iniciadas)", formatNumber(data.initiate_checkout))}
            {metric(
              "Custo por IC",
              formatCurrency(
                data.investimento > 0 && data.initiate_checkout > 0 ? data.investimento / data.initiate_checkout : 0,
              ),
            )}
            {metric("Taxa IC", formatPercent(data.taxa_vis_ic), "ICs / vis. página")}
            {metric("Conversão Checkout", formatPercent(data.taxa_conv_checkout), "vendas / ICs")}
          </div>
        </div>

        {/* Métricas de conversão/valor */}
        <div className="bg-card border border-border rounded-lg p-5">
          <h3 className="text-sm font-medium text-muted-foreground mb-4">Métricas de Conversão</h3>
          <div className="grid grid-cols-2 gap-3">
            {metric("CPA (custo por aprovação)", formatCurrency(data.cpa))}
            {metric("EPC (receita por clique)", formatCurrency(data.epc))}
            {metric("AOV (ticket médio)", formatCurrency(data.aov))}
            {metric("EPC - CPV", formatCurrency(data.epc_cpv))}
            {metric("Vis. → Vendas", formatPercent(data.taxa_vis_vendas), "vendas / vis. pág")}
            {metric("IC → Vendas", formatPercent(data.taxa_ic_vendas), "conversão do checkout")}
            {metric("Vis. → IC", formatPercent(data.taxa_vis_ic), "taxa de IC")}
            {metric("Carregamento Pág.", formatPercent(data.taxa_carregamento), "vis. pág / cliques")}
          </div>
        </div>

        {/* Métricas de vídeo */}
        {data.video_plays > 0 && (
          <div className="bg-card border border-border rounded-lg p-5">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">Métricas de Vídeo</h3>
            <div className="grid grid-cols-2 gap-3">
              {metric("Vídeos Iniciados", formatNumber(data.video_plays))}
              {metric("Vídeos 3s", formatNumber(data.video_3s), `${data.taxa_video_3s.toFixed(1)}% das impressões`)}
              {metric("Vídeos 75%", formatNumber(data.video_75pct), `${data.taxa_video_75.toFixed(1)}% dos iniciados`)}
              {metric("Compras / Vídeo 75%", formatPercent(data.taxa_compras_v75))}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
