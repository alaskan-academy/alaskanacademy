import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { toast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/formatters";
import { inicioDiaBRT, fimDiaBRT } from "@/lib/periodo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScanLine, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Cobra a conferência do dashboard contra o relatório da Payt.
 *
 * Os alertas do projeto cobrem *ausência* de dado. A classe que mais custou até hoje é
 * a outra — **dado presente e errado** —, e ela não dispara nada porque parece normal:
 * reembolso descontado duas vezes, média de razões no lugar da razão dos totais, upsell
 * inflando o denominador. Todos foram pegos por alguém olhando a tela, nenhum por
 * alerta.
 *
 * Nenhum código detecta isso sozinho — o dashboard não tem contra o que se comparar. O
 * que dá para fazer é garantir que a comparação humana aconteça, fique registrada, e
 * que a tela cobre quando atrasar.
 */

/** Acima disso a diferença deixa de ser arredondamento e vira pergunta. */
const LIMIAR_PCT = 1;

/**
 * Quinzenal nos dois primeiros ciclos, mensal depois.
 *
 * A troca sai do próprio histórico, não de uma data no calendário: ninguém precisa
 * lembrar de afrouxar o intervalo. Os dois primeiros são apertados porque é quando
 * ainda não se sabe se o dashboard e a Payt andam juntos; confirmado duas vezes,
 * mensal basta — e um lembrete que aparece demais vira parte do cenário.
 */
const CICLOS_APERTADOS = 2;

const intervaloDias = (jaConferidas: number) =>
  jaConferidas < CICLOS_APERTADOS ? 15 : 30;

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

interface Conferencia {
  periodo_ini: string;
  periodo_fim: string;
  diferenca_pct: number;
  criado_em: string;
}

export function LembreteConferencia() {
  const [ultima, setUltima] = useState<Conferencia | null>(null);
  const [quantas, setQuantas] = useState(0);
  const [carregou, setCarregou] = useState(false);
  const [aberto, setAberto] = useState(false);

  const carregar = useCallback(async () => {
    const { data, count } = await supabase
      .from("conferencias_payt")
      .select("periodo_ini, periodo_fim, diferenca_pct, criado_em", { count: "exact" })
      .order("criado_em", { ascending: false })
      .limit(1);
    setUltima((data?.[0] as Conferencia) ?? null);
    setQuantas(count ?? 0);
    setCarregou(true);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  if (!carregou) return null;

  const cadencia = intervaloDias(quantas);
  const diasDesde = ultima
    ? Math.floor((Date.now() - new Date(ultima.criado_em).getTime()) / 86400000)
    : null;
  const atrasada = diasDesde === null || diasDesde >= cadencia;

  /**
   * Entre uma conferência e outra, a tela fica calada.
   *
   * O aviso cobrava todo dia até alguém agir, e lembrete que aparece sempre vira
   * paisagem — ninguém lê mais, inclusive no dia em que importa. Some depois de
   * conferida e reaparece no dia certo.
   *
   * A única exceção é divergência não resolvida: esconder um número que já se sabe
   * errado seria trocar ruído visual por silêncio sobre um problema conhecido, que é
   * exatamente o defeito que esta tela existe para combater.
   */
  if (!atrasada) {
    const divergiu = Math.abs(Number(ultima!.diferenca_pct)) > LIMIAR_PCT;
    if (!divergiu) return null;
    return (
      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
        <span>
          A conferência de {ultima!.periodo_ini.slice(8)}/{ultima!.periodo_ini.slice(5, 7)} a{" "}
          {ultima!.periodo_fim.slice(8)}/{ultima!.periodo_fim.slice(5, 7)} deu{" "}
          <span className="text-amber-400">
            {Number(ultima!.diferenca_pct).toFixed(2)}% de diferença
          </span>{" "}
          e continua sem explicação.
        </span>
        <button onClick={() => setAberto(true)} className="underline underline-offset-2 hover:text-foreground">
          conferir de novo
        </button>
        <DialogoConferencia aberto={aberto} setAberto={setAberto} aoSalvar={carregar} ultima={ultima} cadencia={cadencia} />
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5">
        <ScanLine className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        {/* A comparação de verdade é venda a venda, e isso se faz no chat: foi assim
            que apareceram os reembolsos com valor de tabela, o {'{{ad.id}}'} literal e os
            upsells sem anúncio. O formulário abaixo serve para registrar o resultado. */}
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-amber-200/90">
          <span className="text-amber-100">Hoje é dia de conferir contra a Payt.</span>{" "}
          Exporte as vendas, as origens e os upsells{" "}
          {ultima
            ? `de ${ultima.periodo_fim.slice(8)}/${ultima.periodo_fim.slice(5, 7)} para cá`
            : "do período"}{" "}
          e mande no chat — dá para bater venda a venda e investigar o que divergir.
          Depois é só registrar o resultado aqui.
        </p>
        <Button size="sm" variant="outline" className="h-7 shrink-0 text-xs" onClick={() => setAberto(true)}>
          Registrar
        </Button>
      </div>
      <DialogoConferencia aberto={aberto} setAberto={setAberto} aoSalvar={carregar} ultima={ultima} cadencia={cadencia} />
    </>
  );
}

/**
 * A conferência em si.
 *
 * A tela busca os próprios números e pede só os da Payt — se pedisse os dois, o erro de
 * digitação de um lado passaria por divergência do outro.
 */
function DialogoConferencia({ aberto, setAberto, aoSalvar, ultima, cadencia }: {
  aberto: boolean; setAberto: (v: boolean) => void; aoSalvar: () => void;
  ultima: Conferencia | null; cadencia: number;
}) {
  // O período emenda no último conferido, em vez de sobrepor ou deixar buraco: um dia
  // que nunca entrou em conferência nenhuma é exatamente onde um defeito se esconde.
  // Hoje fica de fora porque o dia ainda corre e o relatório da Payt não fechou.
  const ontem = new Date(Date.now() - 86400000);
  const inicioPadrao = ultima
    ? new Date(new Date(`${ultima.periodo_fim}T12:00:00`).getTime() + 86400000)
    : new Date(Date.now() - cadencia * 86400000);

  const [ini, setIni] = useState(iso(inicioPadrao));
  const [fim, setFim] = useState(iso(ontem));
  const [nosso, setNosso] = useState<{ receita: number; vendas: number } | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [receitaPayt, setReceitaPayt] = useState("");
  const [vendasPayt, setVendasPayt] = useState("");
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);

  const buscarNossos = useCallback(async () => {
    setBuscando(true);
    setNosso(null);
    const { data, error } = await supabase.rpc("fn_overview", {
      p_inicio: inicioDiaBRT(ini),
      p_fim: fimDiaBRT(fim),
    });
    setBuscando(false);
    if (error) {
      toast({ title: "Não consegui buscar", description: error.message, variant: "destructive" });
      return;
    }
    const d = data as Record<string, unknown>;
    setNosso({
      // `fat_bruto` é o valor com juros de parcelamento — a mesma base que a Payt
      // reporta. Comparar contra a receita sem juros acusaria divergência todo dia.
      receita: Number(d?.fat_bruto ?? 0),
      vendas: Number(d?.qtd_aprovadas ?? 0),
    });
  }, [ini, fim]);

  useEffect(() => { if (aberto) buscarNossos(); }, [aberto, buscarNossos]);

  const num = (s: string) => Number(s.replace(/\./g, "").replace(",", ".")) || 0;
  const rPayt = num(receitaPayt);
  const diferenca = nosso && rPayt > 0 ? ((nosso.receita - rPayt) / rPayt) * 100 : null;
  const bate = diferenca !== null && Math.abs(diferenca) <= LIMIAR_PCT;

  const salvar = async () => {
    if (!nosso || rPayt <= 0) return;
    setSalvando(true);
    const { data: sessao } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("conferencias_payt")
      .insert({
        periodo_ini: ini,
        periodo_fim: fim,
        receita_dashboard: nosso.receita,
        receita_payt: rPayt,
        vendas_dashboard: nosso.vendas,
        vendas_payt: vendasPayt ? num(vendasPayt) : null,
        diferenca_pct: diferenca ?? 0,
        observacao: observacao || null,
        conferido_por: sessao?.user?.id ?? null,
      })
      .select("id");
    setSalvando(false);

    if (error || !data?.length) {
      toast({
        title: "Não salvou",
        description: error?.message ?? "Nenhuma linha gravada — provável falta de permissão.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Conferência registrada" });
    setAberto(false);
    setReceitaPayt(""); setVendasPayt(""); setObservacao("");
    aoSalvar();
  };

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Conferir contra a Payt</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-muted-foreground">De</label>
              <Input type="date" value={ini} onChange={e => setIni(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs text-muted-foreground">Até</label>
              <Input type="date" value={fim} onChange={e => setFim(e.target.value)} className="h-8 text-xs" />
            </div>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={buscarNossos} disabled={buscando}>
              {buscando ? "Buscando..." : "Atualizar"}
            </Button>
          </div>

          <div className="rounded-lg border border-border bg-secondary/30 p-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              O dashboard diz
            </p>
            {buscando ? (
              <p className="mt-1 text-sm text-muted-foreground">Buscando...</p>
            ) : nosso ? (
              <p className="mt-1 text-sm tabular-nums text-foreground">
                {formatCurrency(nosso.receita)}{" "}
                <span className="text-muted-foreground">em {nosso.vendas} vendas aprovadas</span>
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">—</p>
            )}
            <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground/70">
              Faturamento bruto, com juros de parcelamento — a mesma base do relatório da
              Payt. Order bumps não contam como venda separada aqui; se o relatório contar,
              o número de vendas vai divergir sem que nada esteja errado.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Faturamento na Payt</label>
              <Input
                value={receitaPayt}
                onChange={e => setReceitaPayt(e.target.value)}
                placeholder="0,00"
                inputMode="decimal"
                className="h-8 text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Vendas na Payt (opcional)</label>
              <Input
                value={vendasPayt}
                onChange={e => setVendasPayt(e.target.value)}
                placeholder="0"
                inputMode="numeric"
                className="h-8 text-xs"
              />
            </div>
          </div>

          {diferenca !== null && (
            <div className={cn(
              "rounded-lg border px-3 py-2.5",
              bate ? "border-success/30 bg-success/10" : "border-destructive/30 bg-destructive/10",
            )}>
              <p className={cn("text-sm font-medium tabular-nums", bate ? "text-success" : "text-destructive")}>
                {bate ? "Bate" : "Diverge"} — {diferenca > 0 ? "+" : ""}{diferenca.toFixed(2)}%
                <span className="ml-1.5 font-normal text-muted-foreground">
                  ({formatCurrency(nosso!.receita - rPayt)})
                </span>
              </p>
              {!bate && (
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Registre mesmo assim e anote o que encontrar. Uma divergência registrada
                  e não explicada vale mais que uma que ninguém escreveu.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Observação</label>
            <Input
              value={observacao}
              onChange={e => setObservacao(e.target.value)}
              placeholder="o que explica a diferença, se houver"
              className="h-8 text-xs"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" className="text-xs" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              className="text-xs"
              onClick={salvar}
              disabled={salvando || !nosso || rPayt <= 0}
            >
              {salvando ? "Salvando..." : "Registrar conferência"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
