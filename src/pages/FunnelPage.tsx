import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useFilters } from "@/contexts/FilterContext";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/formatters";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { differenceInDays, parseISO, subDays, format } from "date-fns";

// Limpa utm_campaign removendo |ID e ::TOKEN
function cleanCampaign(s: string | null): string {
  if (!s) return "organico";
  return s.split("::")[0].split("|")[0].trim();
}

function periodoAnterior(start?: string, end?: string) {
  if (!start || !end) return null;
  const dias = Math.max(1, differenceInDays(parseISO(end), parseISO(start)) + 1);
  return {
    start: format(subDays(parseISO(start), dias), "yyyy-MM-dd"),
    end: format(subDays(parseISO(start), 1), "yyyy-MM-dd"),
    dias,
  };
}

function calcFunnel(metaRows: any[], vendas: any[], obsRows: any[], upsells: any[]) {
  const agg = metaRows.reduce(
    (a: any, r: any) => {
      a.impressoes += Number(r.impressoes || 0);
      a.cliques += Number(r.cliques || 0);
      a.visualizacoes_pagina += Number(r.visualizacoes_pagina || 0);
      a.initiate_checkout += Number(r.initiate_checkout || 0);
      a.investimento += Number(r.investimento || 0);
      a.video_plays += Number(r.video_plays || 0);
      a.video_3s += Number(r.video_3s || 0);
      a.video_75pct += Number(r.video_75pct || 0);
      return a;
    },
    {
      impressoes: 0,
      cliques: 0,
      visualizacoes_pagina: 0,
      initiate_checkout: 0,
      investimento: 0,
      video_plays: 0,
      video_3s: 0,
      video_75pct: 0,
    },
  );

  const totalVendas = vendas.length;
  const fatReal = vendas.reduce((s: number, v: any) => s + Number(v.valor_total || 0), 0);
  const fatPrincipal = vendas.reduce((s: number, v: any) => s + Number(v.valor_oferta_principal || 0), 0);
  const inv = agg.investimento || 0;
  const vis = agg.visualizacoes_pagina;
  const ic = agg.initiate_checkout;
  const clk = agg.cliques;

  return {
    ...agg,
    totalVendas,
    fatReal,
    fatPrincipal,
    obsRows,
    upsells,
    resultado: fatReal - inv,
    roas: inv > 0 ? fatReal / inv : 0,
    cpa: totalVendas > 0 ? inv / totalVendas : 0,
    cpv: vis > 0 ? inv / vis : 0,
    aov: totalVendas > 0 ? fatReal / totalVendas : 0,
    taxa_vis_vendas: vis > 0 ? (totalVendas / vis) * 100 : 0,
    taxa_ic_vendas: ic > 0 ? (totalVendas / ic) * 100 : 0,
    taxa_carregamento: clk > 0 ? (vis / clk) * 100 : 0,
    taxa_vis_ic: vis > 0 ? (ic / vis) * 100 : 0,
  };
}

function FunnelDisplay({ data, title, compare }: { data: any; title?: string; compare?: any }) {
  if (!data) return <div className="text-center text-muted-foreground py-8">Sem dados</div>;

  const steps = [
    { label: "Impressões", value: data.impressoes, color: "hsl(239,84%,67%)" },
    { label: "Cliques", value: data.cliques, color: "hsl(239,84%,60%)" },
    { label: "Vis. de Página", value: data.visualizacoes_pagina, color: "hsl(239,84%,53%)" },
    { label: "ICs", value: data.initiate_checkout, color: "hsl(239,84%,46%)" },
    { label: "Vendas", value: data.totalVendas, color: "hsl(160,60%,45%)" },
  ];
  const maxV = Math.max(...steps.map((s) => s.value), 1);
  const totalBreakdown = data.fatReal || 1;

  const Var = ({ cur, prev }: { cur: number; prev?: number }) => {
    if (!prev || !compare) return null;
    const v = ((cur - prev) / (prev || 1)) * 100;
    return (
      <span className={cn("text-xs ml-1", v >= 0 ? "text-success" : "text-destructive")}>
        {v >= 0 ? "▲" : "▼"}
        {Math.abs(v).toFixed(1)}%
      </span>
    );
  };

  return (
    <div className="space-y-5">
      {title && <h3 className="text-sm font-semibold text-primary">{title}</h3>}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Investimento", key: "investimento", fmt: formatCurrency, color: "" },
          { label: "Faturamento", key: "fatReal", fmt: formatCurrency, color: "" },
          {
            label: "Resultado",
            key: "resultado",
            fmt: formatCurrency,
            color: data.resultado >= 0 ? "text-success" : "text-destructive",
          },
          {
            label: "ROAS",
            key: "roas",
            fmt: (v: number) => `${v.toFixed(2)}x`,
            color: data.roas >= 3 ? "text-success" : data.roas >= 1 ? "text-warning" : "text-destructive",
          },
          { label: "Vendas", key: "totalVendas", fmt: formatNumber, color: "" },
          { label: "CPA", key: "cpa", fmt: formatCurrency, color: "" },
          { label: "CPV", key: "cpv", fmt: formatCurrency, color: "" },
          { label: "AOV", key: "aov", fmt: formatCurrency, color: "" },
        ].map((k) => (
          <div key={k.label} className="bg-card border border-border rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-1">{k.label}</div>
            <div className={cn("text-lg font-bold", k.color || "text-foreground")}>
              {k.fmt(Number(data[k.key] || 0))}
              <Var cur={Number(data[k.key] || 0)} prev={compare ? Number(compare[k.key] || 0) : undefined} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Funil */}
        <div className="bg-card border border-border rounded-lg p-5">
          <h4 className="text-xs font-medium text-muted-foreground mb-4">Funil de Conversão</h4>
          <div className="space-y-2">
            {steps.map((step, i) => {
              const w = Math.max((step.value / maxV) * 100, 3);
              const prev = steps[i - 1];
              const taxa = prev && prev.value > 0 ? ((step.value / prev.value) * 100).toFixed(1) : null;
              return (
                <div key={step.label}>
                  {taxa && <div className="text-xs text-muted-foreground text-center mb-1">↓ {taxa}%</div>}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-28 text-right shrink-0">{step.label}</span>
                    <div className="flex-1">
                      <div
                        className="h-8 rounded-md flex items-center px-2"
                        style={{ width: `${w}%`, backgroundColor: step.color }}
                      >
                        <span className="text-xs font-semibold text-white">{formatNumber(step.value)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Breakdown */}
        <div className="bg-card border border-border rounded-lg p-5">
          <h4 className="text-xs font-medium text-muted-foreground mb-4">Breakdown de Vendas</h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between py-1 border-b border-border/50">
              <span className="font-medium text-foreground">Oferta principal</span>
              <div className="text-right">
                <div className="font-semibold text-foreground">{formatCurrency(data.fatPrincipal)}</div>
                <div className="text-xs text-muted-foreground">
                  {((data.fatPrincipal / totalBreakdown) * 100).toFixed(1)}%
                </div>
              </div>
            </div>
            {(data.obsRows || []).map((ob: any, i: number) => (
              <div key={i} className="flex justify-between py-1 border-b border-border/50">
                <div>
                  <span className="text-foreground">{ob.nome_ob}</span>
                  <span className="text-xs px-1 rounded bg-primary/20 text-primary ml-1">
                    {formatPercent(ob.taxa_conversao_pct || 0)}
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-foreground">{formatCurrency(ob.receita_total_ob || 0)}</div>
                  <div className="text-xs text-muted-foreground">
                    {(((ob.receita_total_ob || 0) / totalBreakdown) * 100).toFixed(1)}%
                  </div>
                </div>
              </div>
            ))}
            {(data.upsells || []).map((up: any, i: number) => (
              <div key={i} className="flex justify-between py-1 border-b border-border/50">
                <div>
                  <span className="text-foreground">{up.nome_upsell}</span>
                  <span className="text-xs px-1 rounded bg-yellow-500/20 text-yellow-400 ml-1">
                    {formatPercent(up.taxa_conversao_pct || 0)}
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-foreground">{formatCurrency(up.receita_total || 0)}</div>
                  <div className="text-xs text-muted-foreground">
                    {(((up.receita_total || 0) / totalBreakdown) * 100).toFixed(1)}%
                  </div>
                </div>
              </div>
            ))}
            <div className="flex justify-between pt-1 font-semibold border-t border-border">
              <span className="text-foreground">Total</span>
              <span className="text-foreground">{formatCurrency(data.fatReal)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Taxas */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Taxa Conexão", key: "taxa_carregamento" },
          { label: "Taxa IC", key: "taxa_vis_ic" },
          { label: "Conv. Checkout", key: "taxa_ic_vendas" },
          { label: "Vis→Vendas", key: "taxa_vis_vendas" },
        ].map((k) => (
          <div key={k.label} className="bg-secondary/50 rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-1">{k.label}</div>
            <div className="text-sm font-semibold text-foreground">
              {Number(data[k.key] || 0).toFixed(1)}%
              <Var cur={Number(data[k.key] || 0)} prev={compare ? Number(compare[k.key] || 0) : undefined} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FunnelPage() {
  const { startDateStr, endDateStr, product } = useFilters();
  const [allFunil, setAllFunil] = useState<any[]>([]);
  const [allVendas, setAllVendas] = useState<any[]>([]);
  const [allVendasAnt, setAllVendasAnt] = useState<any[]>([]);
  const [allFunilAnt, setAllFunilAnt] = useState<any[]>([]);
  const [obsData, setObsData] = useState<any[]>([]);
  const [upsellData, setUpsellData] = useState<any[]>([]);
  const [campanhas, setCampanhas] = useState<string[]>([]);
  const [selectedCamps, setSelectedCamps] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPeriodoAnt, setShowPeriodoAnt] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const pf = product !== "todos" ? product : null;
      const ant = periodoAnterior(startDateStr, endDateStr);

      let q1 = supabase.from("vw_funil").select("*");
      if (startDateStr && endDateStr) q1 = q1.gte("data", startDateStr).lte("data", endDateStr);
      if (pf) q1 = q1.eq("produto", pf);

      let q2 = supabase
        .from("vendas")
        .select("valor_total,valor_oferta_principal,utm_campaign")
        .eq("status", "aprovada")
        .not("pedido_id", "like", "TEST%")
        .not("pedido_id", "like", "LC-%");
      if (startDateStr && endDateStr) q2 = q2.gte("data_venda", startDateStr).lte("data_venda", endDateStr);
      if (pf) q2 = q2.eq("produto", pf);

      let q3 = supabase.from("vw_conversao_obs").select("*");
      if (pf) q3 = q3.eq("produto", pf);

      let q4 = supabase.from("vw_conversao_upsell").select("*");
      if (pf) q4 = q4.eq("produto", pf);

      let q5 = supabase.from("metricas_meta").select("campanha_nome").eq("nivel", "campanha");
      if (startDateStr && endDateStr) q5 = q5.gte("data", startDateStr).lte("data", endDateStr);
      if (pf) q5 = q5.eq("produto", pf);

      // Período anterior
      let q1a = supabase.from("vw_funil").select("*");
      let q2a = supabase
        .from("vendas")
        .select("valor_total,valor_oferta_principal,utm_campaign")
        .eq("status", "aprovada")
        .not("pedido_id", "like", "TEST%")
        .not("pedido_id", "like", "LC-%");
      if (ant) {
        q1a = q1a.gte("data", ant.start).lte("data", ant.end);
        q2a = q2a.gte("data_venda", ant.start).lte("data_venda", ant.end);
      }
      if (pf) {
        q1a = q1a.eq("produto", pf);
        q2a = q2a.eq("produto", pf);
      }

      const [r1, r2, r3, r4, r5, r1a, r2a] = await Promise.all([q1, q2, q3, q4, q5, q1a, q2a]);

      setAllFunil(r1.data || []);
      setAllVendas(r2.data || []);
      setObsData((r3.data || []).filter((r: any) => r.total_convertidos > 0));
      setUpsellData((r4.data || []).filter((r: any) => r.total_upsells > 0));
      setAllFunilAnt(r1a.data || []);
      setAllVendasAnt(r2a.data || []);

      const camps = [...new Set((r5.data || []).map((r: any) => r.campanha_nome).filter(Boolean))].sort() as string[];
      setCampanhas(camps);
      setLoading(false);
    };
    load();
  }, [startDateStr, endDateStr, product]);

  const funnelGeral = calcFunnel(allFunil, allVendas, obsData, upsellData);
  const funnelGeralAnt = calcFunnel(allFunilAnt, allVendasAnt, obsData, upsellData);

  // Filtrar vendas por campanha (utm_campaign limpo)
  const vendasPorCamp = (camp: string) =>
    allVendas.filter((v) => cleanCampaign(v.utm_campaign) === cleanCampaign(camp));

  const funnelPorCamp = selectedCamps.map((camp) => ({
    camp,
    data: calcFunnel(allFunil, vendasPorCamp(camp), obsData, upsellData),
  }));

  const toggleCamp = (c: string) =>
    setSelectedCamps((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const antInfo = periodoAnterior(startDateStr, endDateStr);

  if (loading)
    return (
      <DashboardLayout title="Funil">
        <div className="flex items-center justify-center h-64 text-muted-foreground animate-pulse">Carregando...</div>
      </DashboardLayout>
    );

  return (
    <DashboardLayout title="Funil">
      <Tabs defaultValue="geral">
        <TabsList className="bg-secondary border border-border mb-4">
          <TabsTrigger
            value="geral"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            Geral
          </TabsTrigger>
          <TabsTrigger
            value="campanha"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            Por Campanha / A/B
          </TabsTrigger>
        </TabsList>

        {/* ── Funil Geral ─────────────────────────────────── */}
        <TabsContent value="geral">
          {/* Toggle comparação período anterior */}
          {antInfo && (
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={() => setShowPeriodoAnt((v) => !v)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
                  showPeriodoAnt
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {showPeriodoAnt ? "✓ " : ""}Comparar com período anterior
              </button>
              {showPeriodoAnt && antInfo && (
                <span className="text-xs text-muted-foreground">
                  ({antInfo.start} → {antInfo.end})
                </span>
              )}
            </div>
          )}

          {showPeriodoAnt ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-card border border-border rounded-lg p-5">
                <FunnelDisplay data={funnelGeral} title="Período Atual" compare={funnelGeralAnt} />
              </div>
              <div className="bg-card border border-border rounded-lg p-5">
                <FunnelDisplay data={funnelGeralAnt} title={`Período Anterior (${antInfo?.dias}d atrás)`} />
              </div>
            </div>
          ) : funnelGeral ? (
            <FunnelDisplay data={funnelGeral} />
          ) : (
            <div className="flex items-center justify-center h-64 text-muted-foreground">Sem dados para o período</div>
          )}
        </TabsContent>

        {/* ── Por Campanha / A/B ───────────────────────────── */}
        <TabsContent value="campanha">
          <div className="bg-card border border-border rounded-lg p-4 mb-6">
            <h3 className="text-sm font-medium text-foreground mb-3">
              Selecione campanhas
              <span className="text-xs text-muted-foreground ml-2">({selectedCamps.length} selecionada(s))</span>
            </h3>
            <div className="flex flex-wrap gap-2">
              {campanhas.map((c) => (
                <button
                  key={c}
                  onClick={() => toggleCamp(c)}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
                    selectedCamps.includes(c)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-secondary text-muted-foreground border-border hover:text-foreground",
                  )}
                >
                  {c}
                </button>
              ))}
              {campanhas.length === 0 && <span className="text-xs text-muted-foreground">Nenhuma campanha</span>}
            </div>
            {selectedCamps.length > 0 && (
              <button onClick={() => setSelectedCamps([])} className="text-xs text-primary hover:underline mt-2 block">
                Limpar seleção
              </button>
            )}
          </div>

          {selectedCamps.length === 0 && (
            <div className="text-center text-muted-foreground py-12">
              Selecione campanhas acima para visualizar os funis
            </div>
          )}

          {selectedCamps.length === 1 && <FunnelDisplay data={funnelPorCamp[0]?.data} title={funnelPorCamp[0]?.camp} />}

          {selectedCamps.length >= 2 && (
            <div className="space-y-6">
              {/* Tabela comparativa */}
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="px-5 py-3 border-b border-border">
                  <h3 className="text-sm font-medium text-foreground">Comparação entre campanhas</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Métrica</th>
                        {funnelPorCamp.map(({ camp }) => (
                          <th key={camp} className="px-4 py-3 text-left text-xs text-primary uppercase">
                            {camp}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: "Receita", key: "fatReal", fmt: formatCurrency },
                        { label: "Vendas", key: "totalVendas", fmt: formatNumber },
                        { label: "Investimento", key: "investimento", fmt: formatCurrency },
                        { label: "ROAS", key: "roas", fmt: (v: number) => `${v.toFixed(2)}x` },
                        { label: "CPA", key: "cpa", fmt: formatCurrency },
                        { label: "Ticket Médio", key: "aov", fmt: formatCurrency },
                        { label: "Taxa Vis→IC", key: "taxa_vis_ic", fmt: (v: number) => `${v.toFixed(1)}%` },
                        { label: "Taxa IC→Venda", key: "taxa_ic_vendas", fmt: (v: number) => `${v.toFixed(1)}%` },
                        { label: "Taxa Vis→Venda", key: "taxa_vis_vendas", fmt: (v: number) => `${v.toFixed(1)}%` },
                        { label: "Taxa Conexão", key: "taxa_carregamento", fmt: (v: number) => `${v.toFixed(1)}%` },
                      ].map((row) => (
                        <tr key={row.label} className="border-b border-border/50 hover:bg-secondary/50">
                          <td className="px-4 py-2 text-muted-foreground text-xs">{row.label}</td>
                          {funnelPorCamp.map(({ camp, data }) => (
                            <td key={camp} className="px-4 py-2 text-foreground font-medium">
                              {data ? row.fmt(Number(data[row.key] || 0)) : "-"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Funis individuais */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {funnelPorCamp.map(({ camp, data }) => (
                  <div key={camp} className="bg-card border border-border rounded-lg p-5">
                    <FunnelDisplay data={data} title={camp} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
}
