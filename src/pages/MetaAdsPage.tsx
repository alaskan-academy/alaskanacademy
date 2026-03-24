import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useFilters } from "@/contexts/FilterContext";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

type Nivel = "campanha" | "adset" | "ad";

interface MetaRow {
  nivel: Nivel;
  nivel_id: string;
  parent_id: string | null;
  nome: string;
  produto: string;
  campanha_id: string;
  campanha_nome: string;
  adset_id: string;
  adset_nome: string;
  impressoes: number;
  cliques: number;
  investimento: number;
  compras_meta: number;
  faturamento_atribuido: number;
  ctr: number;
  cpm: number;
  cpc: number;
  roas: number;
  data: string;
}

const NIVEL_LABELS: Record<Nivel, string> = {
  campanha: "Campanhas",
  adset: "Conjuntos",
  ad: "Anúncios",
};

const PROXIMOS: Record<Nivel, Nivel | null> = {
  campanha: "adset",
  adset: "ad",
  ad: null,
};

export default function MetaAdsPage() {
  const { startDateStr, endDateStr, product } = useFilters();
  const [nivel, setNivel] = useState<Nivel>("campanha");
  const [parentId, setParentId] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<{ label: string; nivel: Nivel; parentId: string | null }[]>([]);
  const [rows, setRows] = useState<MetaRow[]>([]);
  const [allRows, setAllRows] = useState<MetaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortCol, setSortCol] = useState<string>("investimento");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const productFilter = product !== "todos" ? product : null;

      let q = supabase.from("vw_metricas_meta_nivel").select("*");
      if (startDateStr && endDateStr) q = q.gte("data", startDateStr).lte("data", endDateStr);
      if (productFilter) q = q.eq("produto", productFilter);

      const { data } = await q;
      setAllRows(data || []);
      setLoading(false);
    };
    fetch();
  }, [startDateStr, endDateStr, product]);

  // Agregar linhas pelo nível + parent atual
  useEffect(() => {
    const filtered = allRows.filter((r) => r.nivel === nivel);

    // Filtrar por parent_id se não estamos no nível raiz
    const scoped = parentId ? filtered.filter((r) => r.parent_id === parentId) : filtered;

    // Agregar por nivel_id (podem ter múltiplas datas)
    const map: Record<string, any> = {};
    scoped.forEach((r) => {
      const k = r.nivel_id;
      if (!map[k]) {
        map[k] = {
          nivel_id: r.nivel_id,
          parent_id: r.parent_id,
          nome: r.nome,
          produto: r.produto,
          campanha_id: r.campanha_id,
          campanha_nome: r.campanha_nome,
          adset_id: r.adset_id,
          adset_nome: r.adset_nome,
          impressoes: 0,
          cliques: 0,
          investimento: 0,
          compras_meta: 0,
          faturamento_atribuido: 0,
        };
      }
      map[k].impressoes += Number(r.impressoes || 0);
      map[k].cliques += Number(r.cliques || 0);
      map[k].investimento += Number(r.investimento || 0);
      map[k].compras_meta += Number(r.compras_meta || 0);
      map[k].faturamento_atribuido += Number(r.faturamento_atribuido || 0);
    });

    const agg = Object.values(map).map((r: any) => ({
      ...r,
      ctr: r.impressoes > 0 ? ((r.cliques / r.impressoes) * 100).toFixed(2) : "0.00",
      cpm: r.impressoes > 0 ? ((r.investimento / r.impressoes) * 1000).toFixed(2) : "0.00",
      cpc: r.cliques > 0 ? (r.investimento / r.cliques).toFixed(2) : "0.00",
      roas: r.investimento > 0 ? (r.faturamento_atribuido / r.investimento).toFixed(2) : "0.00",
    }));

    // Ordenar
    agg.sort((a: any, b: any) => {
      const va = Number(a[sortCol]) || 0;
      const vb = Number(b[sortCol]) || 0;
      return sortDir === "desc" ? vb - va : va - vb;
    });

    setRows(agg);
  }, [allRows, nivel, parentId, sortCol, sortDir]);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const handleDrillDown = (row: any) => {
    const next = PROXIMOS[nivel];
    if (!next) return;
    setBreadcrumb((prev) => [...prev, { label: row.nome, nivel, parentId }]);
    setParentId(row.nivel_id);
    setNivel(next);
  };

  const handleBack = () => {
    const prev = breadcrumb[breadcrumb.length - 1];
    if (!prev) return;
    setBreadcrumb((b) => b.slice(0, -1));
    setNivel(prev.nivel);
    setParentId(prev.parentId);
  };

  const handleBreadcrumbClick = (idx: number) => {
    const target = breadcrumb[idx];
    setBreadcrumb((b) => b.slice(0, idx));
    setNivel(target.nivel);
    setParentId(target.parentId);
  };

  const cols = [
    { key: "nome", label: "Nome", numeric: false },
    { key: "impressoes", label: "Impressões", numeric: true },
    { key: "cliques", label: "Cliques", numeric: true },
    { key: "ctr", label: "CTR%", numeric: true },
    { key: "cpm", label: "CPM", numeric: true },
    { key: "cpc", label: "CPC", numeric: true },
    { key: "investimento", label: "Investimento", numeric: true },
    { key: "compras_meta", label: "Compras", numeric: true },
    { key: "faturamento_atribuido", label: "Faturamento", numeric: true },
    { key: "roas", label: "ROAS", numeric: true },
  ];

  const hasDrillDown = PROXIMOS[nivel] !== null;

  return (
    <DashboardLayout title="Meta Ads">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 mb-4 text-sm">
        <button
          onClick={() => {
            setNivel("campanha");
            setParentId(null);
            setBreadcrumb([]);
          }}
          className="text-primary hover:underline"
        >
          Campanhas
        </button>
        {breadcrumb.map((b, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
            <button onClick={() => handleBreadcrumbClick(i)} className="text-primary hover:underline">
              {b.label}
            </button>
          </span>
        ))}
        {breadcrumb.length > 0 && (
          <span className="flex items-center gap-1 ml-1 text-muted-foreground">
            <ChevronRight className="h-3 w-3" />
            <span>{NIVEL_LABELS[nivel]}</span>
          </span>
        )}
      </div>

      {/* Voltar */}
      {breadcrumb.length > 0 && (
        <button
          onClick={handleBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ChevronLeft className="h-4 w-4" /> Voltar
        </button>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground animate-pulse">Carregando dados...</div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground">{NIVEL_LABELS[nivel]}</h3>
            <span className="text-xs text-muted-foreground">
              {rows.length} {rows.length === 1 ? "item" : "itens"}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {cols.map((c) => (
                    <th
                      key={c.key}
                      onClick={() => c.numeric && handleSort(c.key)}
                      className={cn(
                        "px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase whitespace-nowrap",
                        c.numeric && "cursor-pointer hover:text-foreground select-none",
                        sortCol === c.key && "text-primary",
                      )}
                    >
                      {c.label} {sortCol === c.key ? (sortDir === "desc" ? "↓" : "↑") : ""}
                    </th>
                  ))}
                  {hasDrillDown && <th className="px-4 py-3 w-8" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any, i) => (
                  <tr
                    key={i}
                    className={cn("border-b border-border/50 hover:bg-secondary/50", hasDrillDown && "cursor-pointer")}
                    onClick={() => hasDrillDown && handleDrillDown(r)}
                  >
                    <td className="px-4 py-3 text-foreground max-w-xs truncate font-medium">{r.nome}</td>
                    <td className="px-4 py-3 text-foreground">{formatNumber(r.impressoes)}</td>
                    <td className="px-4 py-3 text-foreground">{formatNumber(r.cliques)}</td>
                    <td className="px-4 py-3 text-foreground">{Number(r.ctr).toFixed(2)}%</td>
                    <td className="px-4 py-3 text-foreground">R$ {Number(r.cpm).toFixed(2)}</td>
                    <td className="px-4 py-3 text-foreground">R$ {Number(r.cpc).toFixed(2)}</td>
                    <td className="px-4 py-3 text-foreground">{formatCurrency(r.investimento)}</td>
                    <td className="px-4 py-3 text-foreground">{formatNumber(r.compras_meta)}</td>
                    <td className="px-4 py-3 text-foreground">{formatCurrency(r.faturamento_atribuido)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "font-medium",
                          Number(r.roas) >= 3
                            ? "text-green-400"
                            : Number(r.roas) >= 1
                              ? "text-yellow-400"
                              : "text-red-400",
                        )}
                      >
                        {Number(r.roas).toFixed(2)}x
                      </span>
                    </td>
                    {hasDrillDown && (
                      <td className="px-4 py-3 text-muted-foreground">
                        <ChevronRight className="h-4 w-4" />
                      </td>
                    )}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={cols.length + 1} className="px-4 py-8 text-center text-muted-foreground">
                      Sem dados para o período
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
