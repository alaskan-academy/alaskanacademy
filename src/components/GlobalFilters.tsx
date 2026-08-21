import { useEffect, useState } from "react";
import { useFilters } from "@/contexts/FilterContext";
import { subDays } from "date-fns";
import { CalendarIcon, ChevronDown, Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/formatters";

interface Conta {
  id: string;
  nome: string;
  produto: string | null;
  investimento: number;
}

const DATE_OPTIONS = [
  { key: "all", label: "Todos" },
  { key: "today", label: "Hoje" },
  { key: "yesterday", label: "Ontem" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "thisMonth", label: "Este mês" },
  { key: "lastMonth", label: "Mês passado" },
] as const;

export default function GlobalFilters() {
  const {
    datePreset, setDatePreset, setCustomRange, startDateStr, endDateStr,
    contaId, setContaId,
  } = useFilters();
  const [dateOpen, setDateOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customStart, setCustomStart] = useState<Date | undefined>();
  const [customEnd, setCustomEnd] = useState<Date | undefined>();
  const [contas, setContas] = useState<Conta[]>([]);
  const [contaOpen, setContaOpen] = useState(false);

  /**
   * Só as contas que gastaram no período escolhido.
   *
   * A lista completa tem quinze e a maioria está parada; oferecer todas transforma
   * a escolha em garimpo. Num dia típico gastam cinco. A agregação é feita no banco
   * (`fn_contas_com_gasto`) porque `metricas_meta` tem quase dez mil linhas e o
   * PostgREST corta em mil sem avisar.
   */
  useEffect(() => {
    let ativo = true;
    supabase
      .rpc("fn_contas_com_gasto", { p_inicio: startDateStr, p_fim: endDateStr })
      .then(({ data }) => { if (ativo) setContas((data as Conta[]) ?? []); });
    return () => { ativo = false; };
  }, [startDateStr, endDateStr]);

  // Mudar o período pode deixar a conta escolhida sem gasto nenhum. Voltar para
  // "Todas" é mais honesto que manter um recorte que resulta em tela vazia.
  useEffect(() => {
    if (contaId && contas.length > 0 && !contas.some(c => c.id === contaId)) {
      setContaId(null);
    }
  }, [contas, contaId, setContaId]);

  const contaSelecionada = contas.find(c => c.id === contaId);

  // O tipo sai da própria lista: adicionar um preset novo lá basta, e um `key` que
  // o contexto não conheça vira erro de compilação em vez de silêncio em runtime.
  const handleDateSelect = (key: (typeof DATE_OPTIONS)[number]["key"]) => {
    setDatePreset(key);
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

  const dateLabelMap: Record<string, string> = Object.fromEntries(
    DATE_OPTIONS.map(o => [o.key, o.label]),
  );

  const dateLabel =
    datePreset === "custom" && startDateStr && endDateStr
      ? `${startDateStr.slice(8)}/${startDateStr.slice(5, 7)} – ${endDateStr.slice(8)}/${endDateStr.slice(5, 7)}`
      : dateLabelMap[datePreset] || "Período";

  return (
    <div className="flex items-center gap-2">
      {/* Conta de anúncio. Só aparece quando há alguma com gasto — sem investimento
          no período, o seletor não teria o que oferecer e viraria ruído. */}
      {contas.length > 0 && (
        <Popover open={contaOpen} onOpenChange={setContaOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn("h-8 gap-1.5 text-xs font-medium", contaId && "border-primary/50 text-primary")}
            >
              <Megaphone className="h-3.5 w-3.5" />
              <span className="max-w-[160px] truncate">
                {contaSelecionada ? contaSelecionada.nome : "Todas as contas"}
              </span>
              <ChevronDown className="h-3 w-3 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <div className="flex min-w-[240px] flex-col py-1">
              <button
                onClick={() => { setContaId(null); setContaOpen(false); }}
                className={cn(
                  "px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
                  contaId === null && "bg-accent font-semibold text-accent-foreground",
                )}
              >
                Todas as contas
              </button>

              <div className="my-1 border-t border-border" />
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                Com gasto no período
              </p>

              {contas.map(c => (
                <button
                  key={c.id}
                  onClick={() => { setContaId(c.id); setContaOpen(false); }}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
                    contaId === c.id && "bg-accent font-semibold text-accent-foreground",
                  )}
                >
                  <span className="flex-1 truncate">{c.nome}</span>
                  {/* O gasto ao lado do nome dá a escala sem precisar entrar na conta. */}
                  <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                    {formatCurrency(c.investimento)}
                  </span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}

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
    </div>
  );
}
