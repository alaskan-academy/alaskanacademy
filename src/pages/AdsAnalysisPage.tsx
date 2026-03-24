import { useEffect, useState, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useFilters } from "@/contexts/FilterContext";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trophy, TrendingUp, DollarSign, ShoppingBag, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

type SortKey = "compras_meta" | "roas" | "lucro" | "investimento" | "faturamento_atribuido" | "ctr" | "cpc" | "cpm" | "hook_rate";
type SortDir = "asc" | "desc";

interface AdRow {
  ad_id: string;
  ad_nome: string;
  campanha_nome: string;
  produto: string;
  impressoes: number;
  cliques: number;
  ctr: number;
  cpm: number;
  cpc: number;
  investimento: number;
  compras_meta: number;
  faturamento_atribuido: number;
  roas: number;
  cpa: number | null;
  visualizacoes_pagina: number;
  initiate_checkout: number;
  video_plays: number;
  video_3s: number;
  video_75pct: number;
  hook_rate: number;
  lucro: number;
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ArrowUpDown className="h-3 w-3 opacity-30" />;
  return sortDir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />;
}

export default function AdsAnalysisPage() {
  const { startDateStr, endDateStr, product } = useFilters();
  const [rawData, setRawData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("compras_meta");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [tab, setTab] = useState("vendas");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const pf = product !== "todos" ? product : null;
      let q = supabase
        .from("vw_metricas_meta_nivel")
        .select("*")
        .eq("nivel", "ad");
      if (startDateStr && endDateStr) q = q.gte("data", startDateStr).lte("data", endDateStr);
      if (pf) q = q.eq("produto", pf);

      const { data } = await q;
      setRawData(data || []);
      setLoading(false);
    };
    load();
  }, [startDateStr, endDateStr, product]);

  // Agregar por ad_id (pode ter múltiplos dias)
  const ads: AdRow[] = useMemo(() => {
    const map = new Map<string, AdRow>();
    for (const r of rawData) {
      const key = r.ad_id;
      const existing = map.get(key);
      if (existing) {
        existing.impressoes += Number(r.impressoes || 0);
        existing.cliques += Number(r.cliques || 0);
        existing.investimento += Number(r.investimento || 0);
        existing.compras_meta += Number(r.compras_meta || 0);
        existing.faturamento_atribuido += Number(r.faturamento_atribuido || 0);
        existing.visualizacoes_pagina += Number(r.visualizacoes_pagina || 0);
        existing.initiate_checkout += Number(r.initiate_checkout || 0);
        existing.video_plays += Number(r.video_plays || 0);
        existing.video_3s += Number(r.video_3s || 0);
        existing.video_75pct += Number(r.video_75pct || 0);
      } else {
        map.set(key, {
          ad_id: key,
          ad_nome: r.ad_nome || r.nome || "",
          campanha_nome: r.campanha_nome || "",
          produto: r.produto || "",
          impressoes: Number(r.impressoes || 0),
          cliques: Number(r.cliques || 0),
          ctr: 0,
          cpm: 0,
          cpc: 0,
          investimento: Number(r.investimento || 0),
          compras_meta: Number(r.compras_meta || 0),
          faturamento_atribuido: Number(r.faturamento_atribuido || 0),
          roas: 0,
          cpa: null,
          visualizacoes_pagina: Number(r.visualizacoes_pagina || 0),
          initiate_checkout: Number(r.initiate_checkout || 0),
          video_plays: Number(r.video_plays || 0),
          video_3s: Number(r.video_3s || 0),
          video_75pct: Number(r.video_75pct || 0),
          hook_rate: 0,
          lucro: 0,
        });
      }
    }
    // Recalcular métricas derivadas
    return [...map.values()].map((ad) => ({
      ...ad,
      ctr: ad.impressoes > 0 ? (ad.cliques / ad.impressoes) * 100 : 0,
      cpm: ad.impressoes > 0 ? (ad.investimento / ad.impressoes) * 1000 : 0,
      cpc: ad.cliques > 0 ? ad.investimento / ad.cliques : 0,
      roas: ad.investimento > 0 ? ad.faturamento_atribuido / ad.investimento : 0,
      cpa: ad.compras_meta > 0 ? ad.investimento / ad.compras_meta : null,
      hook_rate: ad.impressoes > 0 ? (ad.video_3s / ad.impressoes) * 100 : 0,
      lucro: ad.faturamento_atribuido - ad.investimento,
    }));
  }, [rawData]);

  const sorted = useMemo(() => {
    return [...ads].sort((a, b) => {
      const av = Number(a[sortKey] ?? 0);
      const bv = Number(b[sortKey] ?? 0);
      return sortDir === "desc" ? bv - av : av - bv;
    });
  }, [ads, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  // Top 5 por cada métrica
  const topVendas = useMemo(() => [...ads].sort((a, b) => b.compras_meta - a.compras_meta).slice(0, 5), [ads]);
  const topRoas = useMemo(() => [...ads].filter((a) => a.investimento > 5).sort((a, b) => b.roas - a.roas).slice(0, 5), [ads]);
  const topLucro = useMemo(() => [...ads].sort((a, b) => b.lucro - a.lucro).slice(0, 5), [ads]);

  const handleTabChange = (value: string) => {
    setTab(value);
    if (value === "vendas") { setSortKey("compras_meta"); setSortDir("desc"); }
    else if (value === "roas") { setSortKey("roas"); setSortDir("desc"); }
    else if (value === "lucro") { setSortKey("lucro"); setSortDir("desc"); }
  };

  const cols: { label: string; key: SortKey; fmt: (v: number) => string; align?: string }[] = [
    { label: "Compras", key: "compras_meta", fmt: (v) => String(Math.round(v)) },
    { label: "Faturamento", key: "faturamento_atribuido", fmt: formatCurrency },
    { label: "Investimento", key: "investimento", fmt: formatCurrency },
    { label: "ROAS", key: "roas", fmt: (v) => `${v.toFixed(2)}x` },
    { label: "Lucro", key: "lucro", fmt: formatCurrency },
    { label: "CTR", key: "ctr", fmt: (v) => `${v.toFixed(2)}%` },
    { label: "CPC", key: "cpc", fmt: formatCurrency },
    { label: "CPM", key: "cpm", fmt: formatCurrency },
  ];

  if (loading)
    return (
      <DashboardLayout title="Análise de Ads">
        <div className="flex items-center justify-center h-64 text-muted-foreground animate-pulse">Carregando...</div>
      </DashboardLayout>
    );

  return (
    <DashboardLayout title="Análise de Ads">
      {/* Top cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="flex items-center gap-2 mb-3">
            <ShoppingBag className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-medium text-muted-foreground uppercase">Top Vendas</h3>
          </div>
          <div className="space-y-2">
            {topVendas.map((ad, i) => (
              <div key={ad.ad_id} className="flex items-center gap-2">
                <span className={cn(
                  "flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold",
                  i === 0 ? "bg-yellow-500/20 text-yellow-400" : "bg-secondary text-muted-foreground"
                )}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-foreground truncate">{ad.ad_nome}</div>
                  <div className="text-xs text-muted-foreground truncate">{ad.campanha_nome}</div>
                </div>
                <span className="text-xs font-bold text-foreground">{ad.compras_meta}</span>
              </div>
            ))}
            {topVendas.length === 0 && <div className="text-xs text-muted-foreground">Sem dados</div>}
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-5">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-medium text-muted-foreground uppercase">Top ROAS</h3>
          </div>
          <div className="space-y-2">
            {topRoas.map((ad, i) => (
              <div key={ad.ad_id} className="flex items-center gap-2">
                <span className={cn(
                  "flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold",
                  i === 0 ? "bg-green-500/20 text-green-400" : "bg-secondary text-muted-foreground"
                )}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-foreground truncate">{ad.ad_nome}</div>
                  <div className="text-xs text-muted-foreground truncate">{ad.campanha_nome}</div>
                </div>
                <span className={cn("text-xs font-bold", ad.roas >= 3 ? "text-green-400" : ad.roas >= 1 ? "text-yellow-400" : "text-red-400")}>
                  {ad.roas.toFixed(2)}x
                </span>
              </div>
            ))}
            {topRoas.length === 0 && <div className="text-xs text-muted-foreground">Sem dados</div>}
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-5">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-medium text-muted-foreground uppercase">Top Lucro</h3>
          </div>
          <div className="space-y-2">
            {topLucro.map((ad, i) => (
              <div key={ad.ad_id} className="flex items-center gap-2">
                <span className={cn(
                  "flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold",
                  i === 0 ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground"
                )}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-foreground truncate">{ad.ad_nome}</div>
                  <div className="text-xs text-muted-foreground truncate">{ad.campanha_nome}</div>
                </div>
                <span className={cn("text-xs font-bold", ad.lucro >= 0 ? "text-green-400" : "text-red-400")}>
                  {formatCurrency(ad.lucro)}
                </span>
              </div>
            ))}
            {topLucro.length === 0 && <div className="text-xs text-muted-foreground">Sem dados</div>}
          </div>
        </div>
      </div>

      {/* KPIs resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground mb-1">Total Ads Ativos</div>
          <div className="text-xl font-bold text-foreground">{ads.length}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground mb-1">Total Compras</div>
          <div className="text-xl font-bold text-foreground">{ads.reduce((s, a) => s + a.compras_meta, 0)}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground mb-1">Investimento Total</div>
          <div className="text-xl font-bold text-foreground">{formatCurrency(ads.reduce((s, a) => s + a.investimento, 0))}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground mb-1">ROAS Médio</div>
          {(() => {
            const totalInv = ads.reduce((s, a) => s + a.investimento, 0);
            const totalFat = ads.reduce((s, a) => s + a.faturamento_atribuido, 0);
            const roas = totalInv > 0 ? totalFat / totalInv : 0;
            return <div className={cn("text-xl font-bold", roas >= 3 ? "text-green-400" : roas >= 1 ? "text-yellow-400" : "text-red-400")}>{roas.toFixed(2)}x</div>;
          })()}
        </div>
      </div>

      {/* Tabela completa */}
      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList className="bg-secondary border border-border mb-4">
          <TabsTrigger value="vendas" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <ShoppingBag className="h-3 w-3 mr-1" /> Por Vendas
          </TabsTrigger>
          <TabsTrigger value="roas" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <TrendingUp className="h-3 w-3 mr-1" /> Por ROAS
          </TabsTrigger>
          <TabsTrigger value="lucro" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <DollarSign className="h-3 w-3 mr-1" /> Por Lucro
          </TabsTrigger>
        </TabsList>

        {["vendas", "roas", "lucro"].map((t) => (
          <TabsContent key={t} value={t}>
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">#</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase min-w-[200px]">Ad</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Campanha</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Produto</th>
                      {cols.map((c) => (
                        <th
                          key={c.key}
                          onClick={() => toggleSort(c.key)}
                          className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase cursor-pointer hover:text-foreground transition-colors"
                        >
                          <span className="flex items-center justify-end gap-1">
                            {c.label}
                            <SortIcon col={c.key} sortKey={sortKey} sortDir={sortDir} />
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((ad, i) => (
                      <tr key={ad.ad_id} className="border-b border-border/50 hover:bg-secondary/50 transition-colors">
                        <td className="px-4 py-3 text-muted-foreground text-xs">{i + 1}</td>
                        <td className="px-4 py-3">
                          <div className="text-foreground font-medium text-xs">{ad.ad_nome}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{ad.campanha_nome}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary capitalize">{ad.produto}</span>
                        </td>
                        {cols.map((c) => {
                          const val = Number(ad[c.key] ?? 0);
                          let color = "text-foreground";
                          if (c.key === "roas") color = val >= 3 ? "text-green-400" : val >= 1 ? "text-yellow-400" : "text-red-400";
                          if (c.key === "lucro") color = val >= 0 ? "text-green-400" : "text-red-400";
                          return (
                            <td key={c.key} className={cn("px-4 py-3 text-right text-xs font-medium", color)}>
                              {c.fmt(val)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {sorted.length === 0 && (
                      <tr>
                        <td colSpan={12} className="px-4 py-8 text-center text-muted-foreground">
                          Sem dados de ads para o período selecionado
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </DashboardLayout>
  );
}
