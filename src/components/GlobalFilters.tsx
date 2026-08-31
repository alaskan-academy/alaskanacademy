import { useEffect, useState } from "react";
import { useFilters } from "@/contexts/FilterContext";
import { subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, Check, ChevronDown, Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { daYMD } from "@/lib/recorrencia";
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
    contaIds, setContaIds,
    empresaId,
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
      .rpc("fn_contas_com_gasto", {
        p_inicio: startDateStr,
        p_fim: endDateStr,
        // Em cascata: escolhida a empresa, só as contas dela aparecem. Oferecer
        // conta de outra empresa seria oferecer um recorte que devolve zero.
        p_empresa: empresaId,
      })
      .then(({ data }) => { if (ativo) setContas((data as Conta[]) ?? []); });
    return () => { ativo = false; };
  }, [startDateStr, endDateStr, empresaId]);

  // Mudar o período pode deixar contas escolhidas sem gasto nenhum. Elas caem
  // fora — manter um recorte que resulta em tela vazia é pior do que soltá-lo.
  //
  // Com lista, a limpeza é por conta e não tudo-ou-nada: se três estavam
  // escolhidas e uma parou de gastar, as outras duas ficam. Antes, com uma só,
  // qualquer perda voltava para "Todas".
  useEffect(() => {
    if (contaIds.length === 0 || contas.length === 0) return;
    const sobrevivem = contaIds.filter(id => contas.some(c => c.id === id));
    if (sobrevivem.length !== contaIds.length) setContaIds(sobrevivem);
  }, [contas, contaIds, setContaIds]);

  /**
   * O que o botão diz.
   *
   * Uma conta mostra o nome; várias mostram a contagem, porque cinco nomes
   * não cabem e um nome sozinho mentiria sobre as outras quatro.
   */
  const rotuloDasContas =
    contaIds.length === 0 ? 'Todas as contas'
    : contaIds.length === 1 ? (contas.find(c => c.id === contaIds[0])?.nome ?? '1 conta')
    : `${contaIds.length} contas`;

  // O tipo sai da própria lista: adicionar um preset novo lá basta, e um `key` que
  // o contexto não conheça vira erro de compilação em vez de silêncio em runtime.
  const handleDateSelect = (key: (typeof DATE_OPTIONS)[number]["key"]) => {
    setDatePreset(key);
    setCustomMode(false);
    setDateOpen(false);
  };

  /*
    O personalizado fechava no PRIMEIRO clique.

    Abrir "Personalizado" preenchia início E fim com o período que já estava
    valendo. Com o fim já preenchido, o primeiro clique no calendário de início
    satisfazia `d && customEnd && d <= customEnd` e aplicava na hora:
    escolher 05/08 fechava a janela com "05/08 – 27/08", onde o 27/08 não foi
    escolhido por ninguém — era o resto do período anterior.

    E havia o avesso: escolher um início DEPOIS do fim antigo não satisfazia a
    condição e não fazia nada. Clique sem efeito e sem explicação, que é o que
    faz a pessoa concluir que o botão está quebrado.

    Agora a ordem é explícita: o início só marca o início, e é o fim que aplica
    e fecha. Abrir o personalizado limpa o fim justamente para que o primeiro
    clique não caia numa regra já satisfeita.
  */
  const abrirPersonalizado = () => {
    setCustomMode(true);
    // `daYMD` e não `new Date(str)`: 'yyyy-MM-dd' puro é lido como UTC e
    // volta um dia no Brasil — o calendário acendia o dia anterior ao do rótulo.
    setCustomStart(startDateStr ? daYMD(startDateStr) : subDays(new Date(), 6));
    setCustomEnd(undefined);
  };

  const handleCustomStart = (d: Date | undefined) => {
    if (!d) return;
    setCustomStart(d);
    // Um fim anterior ao novo início deixaria o intervalo invertido.
    setCustomEnd(prev => (prev && prev < d ? undefined : prev));
  };

  const handleCustomEnd = (d: Date | undefined) => {
    if (!d || !customStart || d < customStart) return;
    setCustomEnd(d);
    setCustomRange(customStart, d);
    setDateOpen(false);
    setCustomMode(false);
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
              className={cn("h-8 gap-1.5 text-xs font-medium", contaIds.length > 0 && "border-primary/50 text-primary")}
            >
              <Megaphone className="h-3.5 w-3.5" />
              <span className="max-w-[160px] truncate">{rotuloDasContas}</span>
              <ChevronDown className="h-3 w-3 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            {/*
              Era uma conta por vez. Comparar duas exigia olhar uma, anotar,
              trocar e olhar a outra — e o número da primeira só existia na
              memória de quem estava olhando.

              O popover não fecha mais a cada escolha, porque escolher várias é
              o ponto: fechar depois da primeira faria reabrir para cada conta.
            */}
            <div className="flex min-w-[260px] flex-col py-1">
              <button
                onClick={() => setContaIds([])}
                className={cn(
                  "px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
                  contaIds.length === 0 && "bg-accent font-semibold text-accent-foreground",
                )}
              >
                Todas as contas
              </button>

              <div className="my-1 border-t border-border" />
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                Com gasto no período
              </p>

              {contas.map(c => {
                const marcada = contaIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => setContaIds(
                      marcada ? contaIds.filter(x => x !== c.id) : [...contaIds, c.id],
                    )}
                    className="flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                  >
                    <span className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      marcada ? 'border-primary bg-primary' : 'border-border',
                    )}>
                      {marcada && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                    </span>
                    <span className="flex-1 truncate">{c.nome}</span>
                    {/* O gasto ao lado do nome dá a escala sem precisar entrar na conta. */}
                    <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                      {formatCurrency(c.investimento)}
                    </span>
                  </button>
                );
              })}

              {contaIds.length > 0 && (
                <>
                  <div className="my-1 border-t border-border" />
                  <button
                    onClick={() => setContaIds([])}
                    className="px-3 py-1.5 text-center text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Limpar seleção
                  </button>
                </>
              )}
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
                onClick={abrirPersonalizado}
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
              {/* A instrução diz em que passo a pessoa está: dois calendários
                  iguais, um sobre o outro, não dizem de quem é a vez. */}
              <p className="text-xs font-semibold text-foreground">
                {customEnd ? 'Período selecionado' : customStart ? 'Agora escolha o fim' : 'Escolha o início'}
              </p>
              <div className="space-y-2">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    Início
                    {customStart && (
                      <span className="ml-1.5 text-foreground">
                        {String(customStart.getDate()).padStart(2, '0')}/
                        {String(customStart.getMonth() + 1).padStart(2, '0')}
                      </span>
                    )}
                  </p>
                  <Calendar
                    mode="single"
                    selected={customStart}
                    onSelect={handleCustomStart}
                    locale={ptBR}
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
                    locale={ptBR}
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
