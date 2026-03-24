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

export default function GlobalFilters() {
  const { startDateStr, endDateStr, product, setStartDate, setEndDate, setProduct } = useFilters();
  const [activeQuick, setActiveQuick] = useState<string>("7d");
  const [showCustom, setShowCustom] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);

  // Fechar picker ao clicar fora
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowCustom(false);
      }
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  const apply = (key: string) => {
    const today = new Date();
    const fmt = (d: Date) => format(d, "yyyy-MM-dd");
    if (key === "hoje") {
      const d = fmt(today);
      setStartDate(d);
      setEndDate(d);
      setActiveQuick("hoje");
      setShowCustom(false);
    } else if (key === "ontem") {
      const d = fmt(subDays(today, 1));
      setStartDate(d);
      setEndDate(d);
      setActiveQuick("ontem");
      setShowCustom(false);
    } else if (key === "7d") {
      setStartDate(fmt(subDays(today, 6)));
      setEndDate(fmt(today));
      setActiveQuick("7d");
      setShowCustom(false);
    } else if (key === "30d") {
      setStartDate(fmt(subDays(today, 29)));
      setEndDate(fmt(today));
      setActiveQuick("30d");
      setShowCustom(false);
    } else if (key === "custom") {
      // Pré-popular com período atual
      setCustomStart(startDateStr || fmt(subDays(today, 6)));
      setCustomEnd(endDateStr || fmt(today));
      setShowCustom(true);
    }
  };

  const applyCustom = () => {
    if (!customStart || !customEnd || customStart > customEnd) return;
    setStartDate(customStart);
    setEndDate(customEnd);
    setActiveQuick("custom");
    setShowCustom(false);
  };

  const customLabel =
    activeQuick === "custom" && startDateStr && endDateStr
      ? `${startDateStr.slice(8)}/${startDateStr.slice(5, 7)} – ${endDateStr.slice(8)}/${endDateStr.slice(5, 7)}`
      : "Custom";

  const quickBtns = [
    { key: "hoje", label: "Hoje" },
    { key: "ontem", label: "Ontem" },
    { key: "7d", label: "7 dias" },
    { key: "30d", label: "30 dias" },
    { key: "custom", label: customLabel },
  ];

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Datas */}
      <div className="flex items-center gap-1 bg-secondary rounded-lg p-1 relative" ref={pickerRef}>
        {quickBtns.map((b) => (
          <button
            key={b.key}
            onClick={() => apply(b.key)}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1",
              activeQuick === b.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {b.label}
            {b.key === "custom" && <ChevronDown className="h-3 w-3" />}
          </button>
        ))}

        {/* Picker */}
        {showCustom && (
          <div className="absolute top-11 left-0 z-50 bg-card border border-border rounded-lg p-4 shadow-xl min-w-56">
            <p className="text-xs font-medium text-muted-foreground mb-3">Período personalizado</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Data início</label>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Data fim</label>
                <input
                  type="date"
                  value={customEnd}
                  min={customStart}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={applyCustom}
                  disabled={!customStart || !customEnd || customStart > customEnd}
                  className="flex-1 bg-primary text-primary-foreground rounded-md py-1.5 text-xs font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                  Aplicar
                </button>
                <button
                  onClick={() => setShowCustom(false)}
                  className="flex-1 bg-secondary border border-border rounded-md py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
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
