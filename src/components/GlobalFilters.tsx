import { useState } from "react";
import { useFilters } from "@/contexts/FilterContext";
import { subDays, format } from "date-fns";
import { CalendarIcon, ChevronDown, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";

const PRODUCTS = [
  { label: "Todos", value: "todos" },
  { label: "Velas", value: "velas" },
  { label: "Saponaria", value: "saponaria" },
  { label: "Cosméticos", value: "cosmeticos" },
  { label: "Hormonal", value: "hormonal" },
  { label: "Velaroma", value: "velaroma" },
] as const;

const DATE_OPTIONS = [
  { key: "all", label: "Todos" },
  { key: "today", label: "Hoje" },
  { key: "yesterday", label: "Ontem" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
] as const;

export default function GlobalFilters() {
  const { datePreset, setDatePreset, setCustomRange, startDateStr, endDateStr, product, setProduct } = useFilters();
  const [dateOpen, setDateOpen] = useState(false);
  const [prodOpen, setProdOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customStart, setCustomStart] = useState<Date | undefined>();
  const [customEnd, setCustomEnd] = useState<Date | undefined>();

  const handleDateSelect = (key: string) => {
    setDatePreset(key as any);
    setCustomMode(false);
    setDateOpen(false);
  };

  const handleCustomStart = (d: Date | undefined) => {
    setCustomStart(d);
    if (d && customEnd && d <= customEnd) {
      setCustomRange(d, customEnd);
      setDateOpen(false);
      setCustomMode(false);
    }
  };

  const handleCustomEnd = (d: Date | undefined) => {
    setCustomEnd(d);
    if (customStart && d && customStart <= d) {
      setCustomRange(customStart, d);
      setDateOpen(false);
      setCustomMode(false);
    }
  };

  const dateLabelMap: Record<string, string> = {
    all: "Todos",
    today: "Hoje",
    yesterday: "Ontem",
    "7d": "7 dias",
    "30d": "30 dias",
  };

  const dateLabel =
    datePreset === "custom" && startDateStr && endDateStr
      ? `${startDateStr.slice(8)}/${startDateStr.slice(5, 7)} – ${endDateStr.slice(8)}/${endDateStr.slice(5, 7)}`
      : dateLabelMap[datePreset] || "Período";

  const productLabel = PRODUCTS.find((p) => p.value === product)?.label || "Produto";

  return (
    <div className="flex items-center gap-2">
      {/* Date dropdown */}
      <Popover open={dateOpen} onOpenChange={(o) => { setDateOpen(o); if (!o) setCustomMode(false); }}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs font-medium">
            <CalendarIcon className="h-3.5 w-3.5" />
            {dateLabel}
            <ChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          {!customMode ? (
            <div className="flex flex-col py-1 min-w-[140px]">
              {DATE_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => handleDateSelect(opt.key)}
                  className={cn(
                    "px-3 py-2 text-left text-sm hover:bg-accent transition-colors",
                    datePreset === opt.key && "bg-accent font-semibold text-accent-foreground"
                  )}
                >
                  {opt.label}
                </button>
              ))}
              <div className="border-t border-border my-1" />
              <button
                onClick={() => {
                  setCustomMode(true);
                  setCustomStart(startDateStr ? new Date(startDateStr) : subDays(new Date(), 6));
                  setCustomEnd(endDateStr ? new Date(endDateStr) : new Date());
                }}
                className={cn(
                  "px-3 py-2 text-left text-sm hover:bg-accent transition-colors flex items-center gap-2",
                  datePreset === "custom" && "bg-accent font-semibold text-accent-foreground"
                )}
              >
                <CalendarIcon className="h-3.5 w-3.5" />
                Personalizado
              </button>
            </div>
          ) : (
            <div className="p-3 space-y-3">
              <p className="text-xs font-semibold text-foreground">Selecione o período</p>
              <div className="space-y-2">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Início</p>
                  <Calendar
                    mode="single"
                    selected={customStart}
                    onSelect={handleCustomStart}
                    disabled={(date) => date > new Date()}
                    className={cn("p-2 pointer-events-auto rounded-md border border-border")}
                  />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Fim</p>
                  <Calendar
                    mode="single"
                    selected={customEnd}
                    onSelect={handleCustomEnd}
                    disabled={(date) => date > new Date() || (customStart ? date < customStart : false)}
                    className={cn("p-2 pointer-events-auto rounded-md border border-border")}
                  />
                </div>
              </div>
              <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setCustomMode(false)}>
                ← Voltar
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Product dropdown */}
      <Popover open={prodOpen} onOpenChange={setProdOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs font-medium">
            <Package className="h-3.5 w-3.5" />
            {productLabel}
            <ChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 min-w-[140px]" align="end">
          <div className="flex flex-col py-1">
            {PRODUCTS.map((p) => (
              <button
                key={p.value}
                onClick={() => { setProduct(p.value); setProdOpen(false); }}
                className={cn(
                  "px-3 py-2 text-left text-sm hover:bg-accent transition-colors",
                  product === p.value && "bg-accent font-semibold text-accent-foreground"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
