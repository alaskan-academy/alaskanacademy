import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useFilters } from "@/contexts/FilterContext";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type Nivel = "campanha" | "adset" | "ad";

// Todas as colunas pedidas
const COLS = [
  { key: "nome", label: "Nome", fixed: true },
  { key: "investimento", label: "Gastos", money: true },
  { key: "faturamento_atribuido", label: "Faturamento", money: true },
  { key: "resultado", label: "Lucro", money: true },
  { key: "margem", label: "Margem %", pct: true },
  { key: "roas", label: "ROAS", suffix: "x" },
  { key: "compras_meta", label: "Vendas", num: true },
  { key: "cpa", label: "CPA", money: true },
  { key: "taxa_video_3s", label: "V3s/Imp %", pct: true },
  { key: "taxa_video_75pct", label: "V75%/Inic %", pct: true },
  { key: "taxa_compras_video75", label: "Comp/V75% %", pct: true },
  { key: "ctr", label: "CTR %", pct: true },
  { key: "cpc", label: "CPC", money: true },
  { key: "cpm", label: "CPM", money: true },
  { key: "initiate_checkout", label: "ICs", num: true },
  { key: "taxa_ic", label: "Taxa IC %", pct: true },
  { key: "custo_por_ic", label: "Custo/IC", money: true },
  { key: "taxa_conv_checkout", label: "Conv. Checkout %", pct: true },
  { key: "taxa_conexao", label: "Taxa Conexão %", pct: true },
  { key: "custo_por_vis_pagina", label: "Custo/VisPag", money: true },
  { key: "taxa_vendas_vis_pagina", label: "Vend/VisPag %", pct: true },
  { key: "visualizacoes_pagina", label: "Vis. Pág.", num: true },
  { key: "cliques", label: "Cliques", num: true },
  { key: "impressoes", label: "Impressões", num: true },
];

function fmtCell(row: any, col: (typeof COLS)[number]) {
  const v = Number(row[col.key] ?? 0);
  if (col.money) return `R$ ${v.toFixed(2)}`;
  if (col.pct) return `${v.toFixed(2)}%`;
  if (col.suffix) return `${v.toFixed(2)}${col.suffix}`;
  if (col.num) return formatNumber(v);
  return row[col.key] ?? "-";
}

function roasColor(v: number) {
  return v >= 3 ? "text-green-400" : v >= 1 ? "text-yellow-400" : "text-red-400";
}
function margemColor(v: number) {
  return v >= 30 ? "text-green-400" : v >= 15 ? "text-yellow-400" : "text-red-400";
}

export default function MetaAdsPage() {
  const { startDateStr, endDateStr, funilId } = useFilters();
  const [allRows, setAllRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortCol, setSortCol] = useState("investimento");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  // Checkboxes: IDs selecionados por nível pai (para filtrar filhos)
  const [selectedCamp, setSelectedCamp] = useState<Set<string>>(new Set());
  const [selectedAdset, setSelectedAdset] = useState<Set<string>>(new Set());

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const pf = product !== "todos" ? product : null;
      let q = supabase.from("vw_metricas_meta_nivel").select("*");
      if (startDateStr && endDateStr) q = q.gte("data", startDateStr).lte("data", endDateStr);
      if (pf) q = q.eq("produto", pf);
      const { data } = await q;
      setAllRows(data || []);
      setLoading(false);
    };
    load();
  }, [startDateStr, endDateStr, product]);

  // Agregar rows de um nível, filtrando pelo parent se necessário
  const aggregate = (nivel: Nivel, parentIds?: Set<string>) => {
    const filtered = allRows.filter((r) => {
      if (r.nivel !== nivel) return false;
      if (parentIds && parentIds.size > 0 && r.parent_id) {
        return parentIds.has(r.parent_id);
      }
      return true;
    });

    const map: Record<string, any> = {};
    filtered.forEach((r) => {
      const k = r.nivel_id;
      if (!map[k])
        map[k] = {
          nivel_id: k,
          parent_id: r.parent_id,
          nome: r.nome,
          produto: r.produto,
          campanha_id: r.campanha_id,
          campanha_nome: r.campanha_nome,
          adset_id: r.adset_id,
          adset_nome: r.adset_nome,
          impressoes: 0,
          cliques: 0,
          cliques_link: 0,
          investimento: 0,
          compras_meta: 0,
          faturamento_atribuido: 0,
          initiate_checkout: 0,
          visualizacoes_pagina: 0,
          video_plays: 0,
          video_3s: 0,
          video_75pct: 0,
        };
      const m = map[k];
      m.impressoes += Number(r.impressoes || 0);
      m.cliques += Number(r.cliques || 0);
      m.investimento += Number(r.investimento || 0);
      m.compras_meta += Number(r.compras_meta || 0);
      m.faturamento_atribuido += Number(r.faturamento_atribuido || 0);
      m.initiate_checkout += Number(r.initiate_checkout || 0);
      m.visualizacoes_pagina += Number(r.visualizacoes_pagina || 0);
      m.video_plays += Number(r.video_plays || 0);
      m.video_3s += Number(r.video_3s || 0);
      m.video_75pct += Number(r.video_75pct || 0);
    });

    return Object.values(map)
      .map((r: any) => {
        const inv = r.investimento;
        const fat = r.faturamento_atribuido;
        const luc = fat - inv;
        return {
          ...r,
          resultado: luc,
          margem: fat > 0 ? (luc / fat) * 100 : 0,
          roas: inv > 0 ? fat / inv : 0,
          cpa: r.compras_meta > 0 ? inv / r.compras_meta : 0,
          ctr: r.impressoes > 0 ? (r.cliques / r.impressoes) * 100 : 0,
          cpm: r.impressoes > 0 ? (inv / r.impressoes) * 1000 : 0,
          cpc: r.cliques > 0 ? inv / r.cliques : 0,
          taxa_video_3s: r.impressoes > 0 ? (r.video_3s / r.impressoes) * 100 : 0,
          taxa_video_75pct: r.video_plays > 0 ? (r.video_75pct / r.video_plays) * 100 : 0,
          taxa_compras_video75: r.video_75pct > 0 ? (r.compras_meta / r.video_75pct) * 100 : 0,
          taxa_ic: r.visualizacoes_pagina > 0 ? (r.initiate_checkout / r.visualizacoes_pagina) * 100 : 0,
          custo_por_ic: r.initiate_checkout > 0 ? inv / r.initiate_checkout : 0,
          taxa_conv_checkout: r.initiate_checkout > 0 ? (r.compras_meta / r.initiate_checkout) * 100 : 0,
          taxa_conexao: r.cliques > 0 ? (r.visualizacoes_pagina / r.cliques) * 100 : 0,
          custo_por_vis_pagina: r.visualizacoes_pagina > 0 ? inv / r.visualizacoes_pagina : 0,
          taxa_vendas_vis_pagina: r.visualizacoes_pagina > 0 ? (r.compras_meta / r.visualizacoes_pagina) * 100 : 0,
        };
      })
      .sort((a: any, b: any) => {
        const va = Number(a[sortCol]) || 0;
        const vb = Number(b[sortCol]) || 0;
        return sortDir === "desc" ? vb - va : va - vb;
      });
  };

  const handleSort = (key: string) => {
    if (sortCol === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortCol(key);
      setSortDir("desc");
    }
  };

  const toggleCamp = (id: string) =>
    setSelectedCamp((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleAdset = (id: string) =>
    setSelectedAdset((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const campRows = aggregate("campanha");
  const adsetRows = aggregate("adset", selectedCamp.size > 0 ? selectedCamp : undefined);
  const adRows = aggregate("ad", selectedAdset.size > 0 ? selectedAdset : undefined);

  const renderTable = (
    rows: any[],
    nivel: Nivel,
    showCheck?: boolean,
    onCheck?: (id: string) => void,
    checked?: Set<string>,
  ) =>
    loading ? (
      <div className="p-8 text-center text-muted-foreground animate-pulse">Carregando...</div>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {showCheck && <th className="px-3 py-3 w-8" />}
              {COLS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => !c.fixed && handleSort(c.key)}
                  className={cn(
                    "px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase whitespace-nowrap",
                    !c.fixed && "cursor-pointer hover:text-foreground select-none",
                    sortCol === c.key && "text-primary",
                  )}
                >
                  {c.label}
                  {sortCol === c.key ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border/50 hover:bg-secondary/50">
                {showCheck && onCheck && (
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={checked?.has(r.nivel_id) || false}
                      onChange={() => onCheck(r.nivel_id)}
                      className="accent-primary cursor-pointer"
                    />
                  </td>
                )}
                {COLS.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-3 py-2 whitespace-nowrap",
                      c.key === "nome" && "text-foreground font-medium max-w-48 truncate",
                      c.key === "roas" && roasColor(Number(r.roas)),
                      c.key === "margem" && margemColor(Number(r.margem)),
                      c.key === "resultado" && (Number(r.resultado) >= 0 ? "text-green-400" : "text-red-400"),
                      !["nome", "roas", "margem", "resultado"].includes(c.key) && "text-foreground",
                    )}
                  >
                    {c.key === "nome" ? <span title={r.nome}>{r.nome}</span> : fmtCell(r, c)}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLS.length + (showCheck ? 1 : 0)} className="px-4 py-8 text-center text-muted-foreground">
                  {showCheck && checked?.size === 0 ? "Selecione campanhas na aba anterior para filtrar" : "Sem dados"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );

  return (
    <DashboardLayout title="Meta Ads">
      <Tabs defaultValue="campanhas">
        <TabsList className="bg-secondary border border-border mb-4">
          <TabsTrigger
            value="campanhas"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            Campanhas
          </TabsTrigger>
          <TabsTrigger
            value="conjuntos"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            Conjuntos
          </TabsTrigger>
          <TabsTrigger
            value="anuncios"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            Anúncios
          </TabsTrigger>
        </TabsList>

        <TabsContent value="campanhas">
          {selectedCamp.size > 0 && (
            <div className="mb-3 flex items-center gap-2 text-xs text-primary">
              <span>{selectedCamp.size} campanha(s) selecionada(s) — conjuntos e anúncios filtrados</span>
              <button
                onClick={() => {
                  setSelectedCamp(new Set());
                  setSelectedAdset(new Set());
                }}
                className="underline hover:no-underline"
              >
                Limpar
              </button>
            </div>
          )}
          <p className="text-xs text-muted-foreground mb-2">
            Marque campanhas para filtrar conjuntos e anúncios nas abas seguintes.
          </p>
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {renderTable(campRows, "campanha", true, toggleCamp, selectedCamp)}
          </div>
        </TabsContent>

        <TabsContent value="conjuntos">
          {selectedCamp.size > 0 && (
            <div className="mb-3 text-xs text-primary">
              Mostrando conjuntos de {selectedCamp.size} campanha(s) selecionada(s)
              {selectedAdset.size > 0 && <span> · {selectedAdset.size} conjunto(s) marcado(s)</span>}
            </div>
          )}
          <p className="text-xs text-muted-foreground mb-2">Marque conjuntos para filtrar anúncios na aba seguinte.</p>
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {renderTable(adsetRows, "adset", true, toggleAdset, selectedAdset)}
          </div>
        </TabsContent>

        <TabsContent value="anuncios">
          {selectedAdset.size > 0 && (
            <div className="mb-3 text-xs text-primary">
              Mostrando anúncios de {selectedAdset.size} conjunto(s) selecionado(s)
            </div>
          )}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {renderTable(adRows, "ad", false)}
          </div>
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
}
