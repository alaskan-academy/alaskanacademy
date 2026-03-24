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

type QuickKey = "hoje" | "ontem" | "7d" | "30d" | "custom";

export default function GlobalFilters() {
  const { startDateStr, endDateStr, product, setStartDate, setEndDate, setProduct } = useFilters();
  const [active, setActive] = useState<QuickKey>("7d");
  const [showPicker, setShowPicker] = useState(false);
  const [cs, setCs] = useState(""); // customStart
  const [ce, setCe] = useState(""); // customEnd
  const pickerRef = useRef<HTMLDivElement>(null);

  // Inicializar com 7 dias
  useEffect(() => {
    const today = new Date();
    const fmt = (d: Date) => format(d, "yyyy-MM-dd");
    if (!startDateStr) {
      setStartDate(fmt(subDays(today, 6)));
      setEndDate(fmt(today));
    }
  }, []);

  // Fechar picker ao clicar fora
  useEffect(() => {
    if (!showPicker) return;
    const fn = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    };
    // Delay para não capturar o próprio clique que abriu
    setTimeout(() => document.addEventListener("mousedown", fn), 100);
    return () => document.removeEventListener("mousedown", fn);
  }, [showPicker]);

  const fmt = (d: Date) => format(d, "yyyy-MM-dd");
  const today = new Date();

  const applyQuick = (key: QuickKey) => {
    if (key === "custom") {
      setCs(startDateStr || fmt(subDays(today, 6)));
      setCe(endDateStr || fmt(today));
      setShowPicker(true);
      return;
    }
    setShowPicker(false);
    setActive(key);
    if (key === "hoje") {
      const d = fmt(today);
      setStartDate(d);
      setEndDate(d);
    } else if (key === "ontem") {
      const d = fmt(subDays(today, 1));
      setStartDate(d);
      setEndDate(d);
    } else if (key === "7d") {
      setStartDate(fmt(subDays(today, 6)));
      setEndDate(fmt(today));
    } else if (key === "30d") {
      setStartDate(fmt(subDays(today, 29)));
      setEndDate(fmt(today));
    }
  };

  const applyCustom = () => {
    if (!cs || !ce || cs > ce) return;
    setStartDate(cs);
    setEndDate(ce);
    setActive("custom");
    setShowPicker(false);
  };

  const customLabel =
    active === "custom" && startDateStr && endDateStr
      ? `${startDateStr.slice(8)}/${startDateStr.slice(5, 7)} – ${endDateStr.slice(8)}/${endDateStr.slice(5, 7)}`
      : "Custom";

  const btns: { key: QuickKey; label: string }[] = [
    { key: "hoje", label: "Hoje" },
    { key: "ontem", label: "Ontem" },
    { key: "7d", label: "7 dias" },
    { key: "30d", label: "30 dias" },
    { key: "custom", label: customLabel },
  ];

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Botões de período */}
      <div className="flex items-center gap-1 bg-secondary rounded-lg p-1 relative">
        {btns.map((b) => (
          <button
            key={b.key}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              applyQuick(b.key);
            }}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs font-medium transition-colors select-none flex items-center gap-1",
              active === b.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/80",
            )}
          >
            {b.label}
            {b.key === "custom" && <ChevronDown className="h-3 w-3 opacity-60" />}
          </button>
        ))}

        {/* Date picker */}
        {showPicker && (
          <div
            ref={pickerRef}
            className="absolute top-11 left-0 z-[100] bg-card border border-border rounded-xl p-4 shadow-2xl w-64"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p className="text-xs font-semibold text-foreground mb-3">Período personalizado</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Data início</label>
                <input
                  type="date"
                  value={cs}
                  onChange={(e) => setCs(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Data fim</label>
                <input
                  type="date"
                  value={ce}
                  min={cs}
                  onChange={(e) => setCe(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyCustom();
                  }}
                  disabled={!cs || !ce || cs > ce}
                  className="flex-1 bg-primary text-primary-foreground rounded-lg py-2 text-xs font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                  Aplicar
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setShowPicker(false);
                  }}
                  className="flex-1 bg-secondary border border-border rounded-lg py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Filtro produto */}
      <div className="flex items-center gap-1 bg-secondary rounded-lg p-1">
        {PRODUCTS.map((p) => (
          <button
            key={p.value}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              setProduct(p.value);
            }}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs font-medium transition-colors select-none",
              product === p.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/80",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
