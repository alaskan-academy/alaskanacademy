import { useState, useRef, useEffect } from "react";
import { useFilters } from "@/contexts/FilterContext";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const QUICK_FILTERS = [
  { label: "Hoje", key: "hoje" },
  { label: "Ontem", key: "ontem" },
  { label: "7 dias", key: "7d" },
  { label: "30 dias", key: "30d" },
  { label: "Custom", key: "custom" },
] as const;

const PRODUCTS = [
  { label: "Todos", value: "todos" },
  { label: "Velas", value: "velas" },
  { label: "Saponaria", value: "saponaria" },
  { label: "Cosméticos", value: "cosmeticos" },
] as const;

export default function GlobalFilters() {
  const { startDateStr, endDateStr, product, setStartDate, setEndDate, setProduct } = useFilters();
  const [activeQuick, setActiveQuick] = useState<string>("7d");
  const [showCustom, setShowCustom] = useState(false);
  const [customStart, setCustomStart] = useState(startDateStr || "");
  const [customEnd, setCustomEnd] = useState(endDateStr || "");
  const customRef = useRef<HTMLDivElement>(null);

  // Fechar custom ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (customRef.current && !customRef.current.contains(e.target as Node)) {
        setShowCustom(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const applyQuick = (key: string) => {
    const today = new Date();
    if (key === "hoje") {
      const d = format(today, "yyyy-MM-dd");
      setStartDate(d);
      setEndDate(d);
    } else if (key === "ontem") {
      const d = format(subDays(today, 1), "yyyy-MM-dd");
      setStartDate(d);
      setEndDate(d);
    } else if (key === "7d") {
      setStartDate(format(subDays(today, 6), "yyyy-MM-dd"));
      setEndDate(format(today, "yyyy-MM-dd"));
    } else if (key === "30d") {
      setStartDate(format(subDays(today, 29), "yyyy-MM-dd"));
      setEndDate(format(today, "yyyy-MM-dd"));
    } else if (key === "custom") {
      setShowCustom(true);
      return; // não fechar ainda
    }
    setActiveQuick(key);
    setShowCustom(false);
  };

  const applyCustom = () => {
    if (customStart && customEnd && customStart <= customEnd) {
      setStartDate(customStart);
      setEndDate(customEnd);
      setActiveQuick("custom");
      setShowCustom(false);
    }
  };

  const customLabel =
    activeQuick === "custom" && startDateStr && endDateStr
      ? `${format(new Date(startDateStr + "T00:00:00"), "dd/MM")} – ${format(new Date(endDateStr + "T00:00:00"), "dd/MM")}`
      : null;

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Filtros rápidos de data */}
      <div className="flex items-center gap-1 bg-secondary rounded-lg p-1 relative">
        {QUICK_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => applyQuick(f.key)}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              activeQuick === f.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {f.key === "custom" && customLabel ? customLabel : f.label}
            {f.key === "custom" && <ChevronDown className="h-3 w-3 ml-1 inline" />}
          </button>
        ))}

        {/* Picker customizado */}
        {showCustom && (
          <div
            ref={customRef}
            className="absolute top-10 left-0 z-50 bg-card border border-border rounded-lg p-4 shadow-lg min-w-64"
          >
            <div className="text-xs font-medium text-muted-foreground mb-3">Período personalizado</div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Data início</label>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Data fim</label>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  min={customStart}
                  className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={applyCustom}
                  disabled={!customStart || !customEnd || customStart > customEnd}
                  className="flex-1 bg-primary text-primary-foreground rounded-md py-2 text-xs font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
                >
                  Aplicar
                </button>
                <button
                  onClick={() => setShowCustom(false)}
                  className="flex-1 bg-secondary border border-border rounded-md py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Filtro de produto */}
      <div className="flex items-center gap-1 bg-secondary rounded-lg p-1">
        {PRODUCTS.map((p) => (
          <button
            key={p.value}
            onClick={() => setProduct(p.value)}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              product === p.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
