import { useState, useRef, useEffect } from "react";
import { useFilters } from "@/contexts/FilterContext";
import { format, subDays } from "date-fns";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const PRODUCTS = [
  { label: "Todos", value: "todos" },
  { label: "Velas", value: "velas" },
  { label: "Saponaria", value: "saponaria" },
  { label: "Cosméticos", value: "cosmeticos" },
] as const;

const fmt = (d: Date) => format(d, "yyyy-MM-dd");
const today = () => new Date();

export default function GlobalFilters() {
  const { startDateStr, endDateStr, product, setStartDate, setEndDate, setProduct } = useFilters();
  const [active, setActive] = useState<string>("7d");
  const [showPicker, setShowPicker] = useState(false);
  const [cs, setCs] = useState("");
  const [ce, setCe] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);

  // Fechar picker ao clicar fora
  useEffect(() => {
    if (!showPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [showPicker]);

  const applyRange = (start: string, end: string, key: string) => {
    setStartDate(start);
    setEndDate(end);
    setActive(key);
  };

  const handleQuick = (key: string) => {
    const t = today();
    if (key === "hoje") {
      applyRange(fmt(t), fmt(t), "hoje");
    } else if (key === "ontem") {
      const y = fmt(subDays(t, 1));
      applyRange(y, y, "ontem");
    } else if (key === "7d") {
      applyRange(fmt(subDays(t, 6)), fmt(t), "7d");
    } else if (key === "30d") {
      applyRange(fmt(subDays(t, 29)), fmt(t), "30d");
    } else if (key === "custom") {
      setCs(startDateStr || fmt(subDays(t, 6)));
      setCe(endDateStr || fmt(t));
      setShowPicker((prev) => !prev);
    }
  };

  const applyCustom = () => {
    if (cs && ce && cs <= ce) {
      applyRange(cs, ce, "custom");
      setShowPicker(false);
    }
  };

  const customLabel =
    active === "custom" && startDateStr && endDateStr
      ? `${startDateStr.slice(8)}/${startDateStr.slice(5, 7)} – ${endDateStr.slice(8)}/${endDateStr.slice(5, 7)}`
      : "Custom";

  const btns = [
    { key: "hoje", label: "Hoje" },
    { key: "ontem", label: "Ontem" },
    { key: "7d", label: "7 dias" },
    { key: "30d", label: "30 dias" },
    { key: "custom", label: customLabel },
  ];

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Período */}
      <div className="flex items-center gap-1 bg-secondary rounded-lg p-1 relative">
        {btns.map((b) => (
          <button
            key={b.key}
            onClick={() => handleQuick(b.key)}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1",
              active === b.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {b.label}
            {b.key === "custom" && <ChevronDown className="h-3 w-3" />}
          </button>
        ))}

        {/* Date picker dropdown */}
        {showPicker && (
          <div
            ref={pickerRef}
            onClick={(e) => e.stopPropagation()}
            className="absolute top-11 left-0 z-50 bg-card border border-border rounded-xl shadow-xl p-4 w-60"
          >
            <p className="text-xs font-semibold text-foreground mb-3">Período personalizado</p>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-muted-foreground">Início</label>
                <input
                  type="date"
                  value={cs}
                  onChange={(e) => setCs(e.target.value)}
                  className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Fim</label>
                <input
                  type="date"
                  value={ce}
                  min={cs}
                  onChange={(e) => setCe(e.target.value)}
                  className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={applyCustom}
                  disabled={!cs || !ce || cs > ce}
                  className="flex-1 bg-primary text-primary-foreground rounded-lg py-2 text-xs font-semibold disabled:opacity-40"
                >
                  Aplicar
                </button>
                <button
                  onClick={() => setShowPicker(false)}
                  className="flex-1 bg-secondary border border-border rounded-lg py-2 text-xs text-muted-foreground"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Produto */}
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
