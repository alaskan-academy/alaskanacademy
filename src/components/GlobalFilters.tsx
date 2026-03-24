import { useState, useRef, useEffect } from "react";
import { useFilters } from "@/contexts/FilterContext";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, subDays } from "date-fns";

const PRODUCTS = [
  { label: "Todos", value: "todos" },
  { label: "Velas", value: "velas" },
  { label: "Saponaria", value: "saponaria" },
  { label: "Cosméticos", value: "cosmeticos" },
] as const;

type QuickKey = "all" | "hoje" | "7d" | "30d" | "custom";

export default function GlobalFilters() {
  const { datePreset, setDatePreset, startDateStr, endDateStr, product, setProduct, setCustomRange } = useFilters();
  const [showPicker, setShowPicker] = useState(false);
  const [cs, setCs] = useState("");
  const [ce, setCe] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);

  const presetToKey: Record<string, QuickKey> = { all: "all", today: "hoje", "7d": "7d", "30d": "30d", custom: "custom" };
  const active: QuickKey = presetToKey[datePreset] || "all";

  useEffect(() => {
    if (!showPicker) return;
    const fn = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowPicker(false);
    };
    setTimeout(() => document.addEventListener("mousedown", fn), 100);
    return () => document.removeEventListener("mousedown", fn);
  }, [showPicker]);

  const applyQuick = (key: QuickKey) => {
    if (key === "custom") {
      const fmt = (d: Date) => format(d, "yyyy-MM-dd");
      setCs(startDateStr || fmt(subDays(new Date(), 6)));
      setCe(endDateStr || fmt(new Date()));
      setShowPicker(true);
      return;
    }
    setShowPicker(false);
    const map: Record<string, string> = { all: "all", hoje: "today", "7d": "7d", "30d": "30d" };
    setDatePreset(map[key] as any);
  };

  const applyCustom = () => {
    if (!cs || !ce || cs > ce) return;
    setCustomRange(new Date(cs + "T00:00:00"), new Date(ce + "T23:59:59"));
    setShowPicker(false);
  };

  const customLabel =
    active === "custom" && startDateStr && endDateStr
      ? `${startDateStr.slice(8)}/${startDateStr.slice(5, 7)} – ${endDateStr.slice(8)}/${endDateStr.slice(5, 7)}`
      : "Custom";

  const btns: { key: QuickKey; label: string }[] = [
    { key: "all", label: "Todos" },
    { key: "hoje", label: "Hoje" },
    { key: "7d", label: "7 dias" },
    { key: "30d", label: "30 dias" },
    { key: "custom", label: customLabel },
  ];

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1 bg-secondary rounded-lg p-1 relative">
        {btns.map((b) => (
          <button
            key={b.key}
            type="button"
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); applyQuick(b.key); }}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs font-medium transition-colors select-none flex items-center gap-1",
              active === b.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/80",
            )}
          >
            {b.label}
            {b.key === "custom" && <ChevronDown className="h-3 w-3 opacity-60" />}
          </button>
        ))}

        {showPicker && (
          <div ref={pickerRef} className="absolute top-11 left-0 z-[100] bg-card border border-border rounded-xl p-4 shadow-2xl w-64" onMouseDown={(e) => e.stopPropagation()}>
            <p className="text-xs font-semibold text-foreground mb-3">Período personalizado</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Data início</label>
                <input type="date" value={cs} onChange={(e) => setCs(e.target.value)} className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Data fim</label>
                <input type="date" value={ce} min={cs} onChange={(e) => setCe(e.target.value)} className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onMouseDown={(e) => { e.preventDefault(); applyCustom(); }} disabled={!cs || !ce || cs > ce} className="flex-1 bg-primary text-primary-foreground rounded-lg py-2 text-xs font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity">Aplicar</button>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); setShowPicker(false); }} className="flex-1 bg-secondary border border-border rounded-lg py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">Cancelar</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 bg-secondary rounded-lg p-1">
        {PRODUCTS.map((p) => (
          <button key={p.value} type="button" onMouseDown={(e) => { e.preventDefault(); setProduct(p.value); }} className={cn("px-3 py-1.5 rounded-md text-xs font-medium transition-colors select-none", product === p.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/80")}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
