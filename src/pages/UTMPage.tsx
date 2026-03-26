import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { KPICard } from "@/components/KPICard";
import { useFilters } from "@/contexts/FilterContext";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/formatters";
import { ChevronRight, ArrowLeft } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const LEVELS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_placement"] as const;
type UTMLevel = (typeof LEVELS)[number];

const LEVEL_LABELS: Record<string, string> = {
  utm_source: "Source",
  utm_medium: "Medium",
  utm_campaign: "Campaign",
  utm_content: "Content",
  utm_placement: "Placement",
};

// Placement: rede social explícita
const placementInfo: Record<string, { label: string; network: string; color: string }> = {
  feed: { label: "Feed", network: "Facebook", color: "hsl(214,89%,52%)" },
  stories: { label: "Stories", network: "Instagram", color: "hsl(329,86%,56%)" },
  reels: { label: "Reels", network: "Instagram", color: "hsl(329,86%,50%)" },
  marketplace: { label: "Marketplace", network: "Facebook", color: "hsl(214,89%,45%)" },
  search: { label: "Search", network: "Facebook", color: "hsl(214,89%,38%)" },
  audience_network: { label: "Audience Network", network: "Meta", color: "hsl(239,84%,60%)" },
  messenger: { label: "Messenger", network: "Facebook", color: "hsl(214,89%,60%)" },
  outro: { label: "Outro", network: "Outro", color: "hsl(0,0%,50%)" },
};

const sourceColors: Record<string, string> = {
  "meta ads": "hsl(214,89%,52%)",
  instagram: "hsl(329,86%,56%)",
  google: "hsl(4,90%,58%)",
  organico: "hsl(160,60%,45%)",
};

const normalizeText = (value: string | null | undefined) => String(value ?? "").replace(/\s+/g, " ").trim();

const cleanPlacementValue = (value: string | null | undefined) => {
  const raw = normalizeText(value);
  if (!raw) return "(vazio)";

  const base = raw
    .split("::")[0]
    .split("|")[0]
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

  if (base.includes("stories")) return "stories";
  if (base.includes("reels")) return "reels";
  if (base.includes("marketplace")) return "marketplace";
  if (base.includes("audience_network")) return "audience_network";
  if (base.includes("messenger")) return "messenger";
  if (base.includes("search")) return "search";
  if (base.includes("feed")) return "feed";

  return base || "(vazio)";
};

const cleanUtmValue = (value: string | null | undefined, level: UTMLevel) => {
  const raw = normalizeText(value);
  if (!raw) return "(vazio)";

  const base = raw.split("::")[0].split("|")[0].trim();
  const lower = base.toLowerCase();

  if (level === "utm_source") {
    if (lower.includes("instagram") || /^ig[a-z0-9]+$/i.test(base)) return "instagram";
    if (lower.includes("facebook") || /^fb[a-z0-9]+$/i.test(base)) return "meta ads";
    if (lower.includes("google") || /^g[a-z0-9]{6,}$/i.test(base)) return "google";
    if (lower.includes("organ")) return "organico";
    return base;
  }

  if (level === "utm_placement") {
    return cleanPlacementValue(base);
  }

  return base;
};

const displayUtmValue = (value: string, level: UTMLevel) => {
  if (value === "(vazio)") return value;
  if (level === "utm_placement") return placementInfo[value]?.label || value.replace(/_/g, " ");
  return value.replace(/_/g, " ");
};

export default function UTMPage() {
  const { startDateStr, endDateStr, product } = useFilters();
  const [levelIndex, setLevelIndex] = useState(0);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [utmData, setUtmData] = useState<any[]>([]);
  const [allUtm, setAllUtm] = useState<any[]>([]);
  const [placementData, setPlacementData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const currentLevel = LEVELS[levelIndex];

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const pf = product !== "todos" ? product : null;

      let q1 = supabase
        .from("vendas")
        .select("utm_source,utm_medium,utm_campaign,utm_content,utm_term,produto,status,valor_total,valor_oferta_principal,data_venda,pedido_id,is_upsell")
        .not("pedido_id", "like", "TEST%")
        .not("pedido_id", "like", "LC-%")
        .neq("is_upsell", true);

      if (startDateStr) q1 = q1.gte("data_venda", startDateStr);
      if (endDateStr) q1 = q1.lte("data_venda", `${endDateStr}T23:59:59`);
      if (pf) q1 = q1.eq("produto", pf);

      const r1 = await q1;
      const rawVendas = r1.data || [];

      const utmMap: Record<string, any> = {};
      rawVendas.forEach((v: any) => {
        const utmSource = cleanUtmValue(v.utm_source, "utm_source");
        const utmMedium = cleanUtmValue(v.utm_medium, "utm_medium");
        const utmCampaign = cleanUtmValue(v.utm_campaign, "utm_campaign");
        const utmContent = cleanUtmValue(v.utm_content, "utm_content");
        const utmPlacement = cleanUtmValue(v.utm_term, "utm_placement");

        const key = [utmSource, utmMedium, utmCampaign, utmContent, utmPlacement].join("|||");
        if (!utmMap[key]) {
          utmMap[key] = {
            utm_source: utmSource,
            utm_medium: utmMedium,
            utm_campaign: utmCampaign,
            utm_content: utmContent,
            utm_term: utmPlacement,
            utm_placement: utmPlacement,
            produto: v.produto,
            vendas_aprovadas: 0,
            vendas_pendentes: 0,
            vendas_canceladas: 0,
            faturamento: 0,
          };
        }
        if (v.status === "aprovada") {
          utmMap[key].vendas_aprovadas += 1;
          utmMap[key].faturamento += Number(v.valor_oferta_principal || 0);
        } else if (v.status === "pendente") {
          utmMap[key].vendas_pendentes += 1;
        } else if (v.status === "cancelada" || v.status === "expirada") {
          utmMap[key].vendas_canceladas += 1;
        }
      });

      const utmRows = Object.values(utmMap).map((r: any) => {
        const total = r.vendas_aprovadas + r.vendas_pendentes + r.vendas_canceladas;
        return {
          ...r,
          taxa_aprovacao_pct: total > 0 ? (r.vendas_aprovadas / total) * 100 : 0,
          ticket_medio: r.vendas_aprovadas > 0 ? r.faturamento / r.vendas_aprovadas : 0,
        };
      });
      setAllUtm(utmRows);

      const plMap: Record<string, any> = {};
      utmRows.forEach((r: any) => {
        const k = r.utm_placement || "(vazio)";
        if (!plMap[k]) plMap[k] = { placement: k, vendas_aprovadas: 0, faturamento: 0 };
        plMap[k].vendas_aprovadas += Number(r.vendas_aprovadas || 0);
        plMap[k].faturamento += Number(r.faturamento || 0);
      });
      setPlacementData(Object.values(plMap).sort((a, b) => b.faturamento - a.faturamento));
      setLoading(false);
    };
    load();
  }, [product, startDateStr, endDateStr]);

  useEffect(() => {
    let rows = allUtm;

    Object.entries(filters).forEach(([key, value]) => {
      rows = rows.filter((r: any) => (r[key] || "(vazio)") === value);
    });

    const grouped: Record<string, any> = {};
    rows.forEach((r: any) => {
      const key = r[currentLevel] || "(vazio)";
      if (!grouped[key]) grouped[key] = { vendas_aprovadas: 0, faturamento: 0, taxa_sum: 0, count: 0 };
      grouped[key].vendas_aprovadas += Number(r.vendas_aprovadas || 0);
      grouped[key].faturamento += Number(r.faturamento || 0);
      grouped[key].taxa_sum += Number(r.taxa_aprovacao_pct || 0);
      grouped[key].count += 1;
    });

    const table = Object.entries(grouped)
      .map(([name, v]: any) => ({
        name,
        displayName: displayUtmValue(name, currentLevel),
        vendas_aprovadas: v.vendas_aprovadas,
        faturamento: v.faturamento,
        taxa_aprovacao_pct: v.count > 0 ? v.taxa_sum / v.count : 0,
        ticket_medio: v.vendas_aprovadas > 0 ? v.faturamento / v.vendas_aprovadas : 0,
      }))
      .sort((a, b) => b.faturamento - a.faturamento);

    setUtmData(table);
  }, [allUtm, levelIndex, filters, currentLevel]);

  const totals = utmData.reduce(
    (acc, r) => ({ vendas: acc.vendas + r.vendas_aprovadas, faturamento: acc.faturamento + r.faturamento }),
    { vendas: 0, faturamento: 0 },
  );
  const avgTaxa = utmData.length > 0 ? utmData.reduce((s, r) => s + r.taxa_aprovacao_pct, 0) / utmData.length : 0;
  const avgTicket = totals.vendas > 0 ? totals.faturamento / totals.vendas : 0;

  const drillDown = (value: string) => {
    if (levelIndex < LEVELS.length - 1) {
      setFilters((prev) => ({ ...prev, [currentLevel]: value }));
      setLevelIndex((prev) => prev + 1);
    }
  };

  const goBack = () => {
    if (levelIndex > 0) {
      const newFilters = { ...filters };
      delete newFilters[LEVELS[levelIndex - 1]];
      setFilters(newFilters);
      setLevelIndex((prev) => prev - 1);
    }
  };

  const resetAll = () => {
    setFilters({});
    setLevelIndex(0);
  };

  const breadcrumbs = LEVELS.slice(0, levelIndex).map((level) => ({
    label: LEVEL_LABELS[level],
    value: displayUtmValue(filters[level], level),
  }));

  const sourceRows = (() => {
    const map: Record<string, any> = {};
    allUtm.forEach((r: any) => {
      const k = r.utm_source || "organico";
      if (!map[k]) map[k] = { source: k, displaySource: displayUtmValue(k, "utm_source"), vendas_aprovadas: 0, faturamento: 0 };
      map[k].vendas_aprovadas += Number(r.vendas_aprovadas || 0);
      map[k].faturamento += Number(r.faturamento || 0);
    });
    return Object.values(map).sort((a: any, b: any) => b.faturamento - a.faturamento);
  })();
  const srcTotal = sourceRows.reduce((s: number, r: any) => s + r.faturamento, 0);
  const plTotal = placementData.reduce((s: number, r: any) => s + r.faturamento, 0);

  return (
    <DashboardLayout title="Análise UTM">
      <Tabs defaultValue="drilldown">
        <TabsList className="bg-secondary border border-border mb-4">
          <TabsTrigger
            value="drilldown"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            UTM Drill-down
          </TabsTrigger>
          <TabsTrigger
            value="source"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            Por Source
          </TabsTrigger>
          <TabsTrigger
            value="placement"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            Por Placement
          </TabsTrigger>
        </TabsList>

        {/* ── UTM Drill-down (código original preservado) ─── */}
        <TabsContent value="drilldown">
          {/* Breadcrumb */}
          {breadcrumbs.length > 0 && (
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <button onClick={resetAll} className="text-xs text-primary hover:underline">
                Início
              </button>
              {breadcrumbs.map((b, i) => (
                <span key={i} className="flex items-center gap-1 text-xs text-muted-foreground">
                  <ChevronRight className="h-3 w-3" />
                  <span className="text-foreground">{b.value}</span>
                </span>
              ))}
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs font-medium text-primary">{LEVEL_LABELS[currentLevel]}</span>
            </div>
          )}

          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <KPICard title="Total Vendas" value={formatNumber(totals.vendas)} />
            <KPICard title="Faturamento" value={formatCurrency(totals.faturamento)} />
            <KPICard title="Taxa Aprovação" value={formatPercent(avgTaxa)} />
            <KPICard title="Ticket Médio" value={formatCurrency(avgTicket)} />
          </div>

          {/* Voltar */}
          {levelIndex > 0 && (
            <button onClick={goBack} className="flex items-center gap-1 text-xs text-primary hover:underline mb-4">
              <ArrowLeft className="h-3 w-3" /> Voltar para {LEVEL_LABELS[LEVELS[levelIndex - 1]]}
            </button>
          )}

          {/* Tabela */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">Carregando...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        {LEVEL_LABELS[currentLevel]}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        Vendas
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        Faturamento
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        % Total
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        Taxa Aprov.
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        Ticket Médio
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {utmData.map((row, i) => (
                      <tr
                        key={i}
                        onClick={() => drillDown(row.name)}
                        className={cn(
                          "border-b border-border/50 hover:bg-secondary/50 transition-colors",
                          levelIndex < LEVELS.length - 1 && "cursor-pointer",
                        )}
                      >
                        <td className="px-4 py-3 text-primary font-medium">{row.name}</td>
                        <td className="px-4 py-3 text-foreground">{formatNumber(row.vendas_aprovadas)}</td>
                        <td className="px-4 py-3 text-foreground">{formatCurrency(row.faturamento)}</td>
                        <td className="px-4 py-3 text-foreground">
                          <div className="flex items-center gap-2">
                            <div className="w-16 bg-secondary rounded-full h-1.5">
                              <div
                                className="h-1.5 rounded-full bg-primary"
                                style={{
                                  width: `${totals.faturamento > 0 ? (row.faturamento / totals.faturamento) * 100 : 0}%`,
                                }}
                              />
                            </div>
                            <span>
                              {totals.faturamento > 0 ? ((row.faturamento / totals.faturamento) * 100).toFixed(1) : 0}%
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-foreground">{formatPercent(row.taxa_aprovacao_pct)}</td>
                        <td className="px-4 py-3 text-foreground">{formatCurrency(row.ticket_medio)}</td>
                      </tr>
                    ))}
                    {utmData.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                          Nenhum dado encontrado
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Por Source ───────────────────────────────────── */}
        <TabsContent value="source">
          <div className="bg-card border border-border rounded-lg p-5">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">Vendas por UTM Source</h3>
            <div className="space-y-2">
              {sourceRows.map((r: any, i: number) => (
                <div key={i} className="flex items-center justify-between py-3 border-b border-border/50 last:border-0">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: sourceColors[r.source] || "hsl(0,0%,50%)" }}
                    />
                    <span className="text-sm font-medium text-foreground capitalize">{r.source}</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-24 bg-secondary rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full"
                          style={{
                            width: `${srcTotal > 0 ? (r.faturamento / srcTotal) * 100 : 0}%`,
                            backgroundColor: sourceColors[r.source] || "hsl(239,84%,67%)",
                          }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-10">
                        {srcTotal > 0 ? ((r.faturamento / srcTotal) * 100).toFixed(1) : 0}%
                      </span>
                    </div>
                    <span className="text-muted-foreground">{formatNumber(r.vendas_aprovadas)} vendas</span>
                    <span className="font-semibold text-foreground w-24 text-right">
                      {formatCurrency(r.faturamento)}
                    </span>
                  </div>
                </div>
              ))}
              {sourceRows.length === 0 && <div className="text-center text-muted-foreground py-8">Sem dados</div>}
            </div>
          </div>
        </TabsContent>

        {/* ── Por Placement ────────────────────────────────── */}
        <TabsContent value="placement">
          <div className="bg-card border border-border rounded-lg p-5">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">Vendas por Placement</h3>
            <div className="space-y-2">
              {placementData.map((r: any, i: number) => {
                const info = placementInfo[r.placement] || {
                  label: r.placement,
                  network: "Outro",
                  color: "hsl(0,0%,50%)",
                };
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between py-3 border-b border-border/50 last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: info.color }} />
                      <div>
                        <span className="text-sm font-medium text-foreground">{info.label}</span>
                        <span
                          className="ml-2 text-xs px-1.5 py-0.5 rounded text-white font-medium"
                          style={{ backgroundColor: info.color }}
                        >
                          {info.network}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-24 bg-secondary rounded-full h-1.5">
                          <div
                            className="h-1.5 rounded-full"
                            style={{
                              width: `${plTotal > 0 ? (r.faturamento / plTotal) * 100 : 0}%`,
                              backgroundColor: info.color,
                            }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-10">
                          {plTotal > 0 ? ((r.faturamento / plTotal) * 100).toFixed(1) : 0}%
                        </span>
                      </div>
                      <span className="text-muted-foreground">{formatNumber(r.vendas_aprovadas)} vendas</span>
                      <span className="font-semibold text-foreground w-24 text-right">
                        {formatCurrency(r.faturamento)}
                      </span>
                    </div>
                  </div>
                );
              })}
              {placementData.length === 0 && (
                <div className="text-center text-muted-foreground py-8">Sem dados de placement</div>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
}
