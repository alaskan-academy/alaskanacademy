import { useCallback, useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useFilters } from "@/contexts/FilterContext";
import { supabase } from "@/lib/supabase";
import { formatNumber } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { RastreioNav } from "../components/RastreioNav";

/**
 * Eventos — a tela 2 do prompt do curso: "tabela filtrável + modal com
 * payload/response".
 *
 * ── A pergunta que ela responde ──────────────────────────────────────────
 *
 * "O que exatamente a gente mandou para a Meta nesta visita?" Até hoje isso
 * só existia rodando SQL à mão, e foi assim que se achou o `fbp` em 25%, o
 * `fbc` derivado e o `event_source_url` apontando para o checkout.
 *
 * ── Três coisas que a tela precisa DISTINGUIR, e que parecem iguais ─────
 *
 * 1. **Nunca enviado** (sem payload, sem expurgo) — pode ser de propósito
 *    (PageView não vai pela API, produto sem pixel não envia, o navegador
 *    avisou que o pixel dele não subiu) ou defeito.
 * 2. **Expurgado** (`expurgado_em` preenchido) — o payload FOI mandado e
 *    depois apagado pelos 14 dias. A política publicada promete esse prazo.
 * 3. **Recusado** — a Meta respondeu erro. Esse é o único que é defeito
 *    sempre, e tem alarme na Saúde do Sistema.
 *
 * Mostrar os três como "sem payload" seria esconder a diferença entre
 * "previsto", "esperando" e "quebrado".
 *
 * ── Por que 200 linhas e não todas ──────────────────────────────────────
 *
 * `events_log` passa de mil por dia. O PostgREST corta em 1.000 e devolve
 * 200 sem avisar; `todasAsLinhas` resolveria, mas carregar 20 mil linhas no
 * navegador para alguém ler as últimas não ajuda ninguém. Então: as 200 mais
 * recentes, com o TOTAL do período dito em cima. Truncar é aceitável;
 * truncar em silêncio não é.
 */

interface LinhaEvento {
  id: string;
  criado_em: string;
  event_name: string;
  event_id: string;
  trck_user_id: string | null;
  produto_code: string | null;
  page_url: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  pais: string | null;
  estado: string | null;
  cidade: string | null;
  payload_meta: unknown;
  response_meta: { events_received?: number; falha?: string; messages?: unknown[] } | null;
  expurgado_em: string | null;
}

const EVENTO_LABEL: Record<string, string> = {
  page_view: "PageView",
  view_content: "Ver conteúdo",
  initiate_checkout: "Iniciar finalização",
  video_progress: "Vídeo",
  scroll_depth: "Rolagem",
  button_visible: "Botão visível",
};

/** Os seis que `/api/event` aceita. Lista fixa de propósito: nome livre vira
 *  cardápio que ninguém lê, e a rota já recusa o que não está nela. */
const FILTROS = ["todos", "page_view", "view_content", "initiate_checkout"] as const;
type Filtro = (typeof FILTROS)[number];

/** O estado do envio, e os quatro são diferentes entre si. */
function situacao(l: LinhaEvento) {
  if (l.response_meta?.falha) {
    return { label: "Recusado", classe: "bg-destructive/15 text-destructive", detalhe: l.response_meta.falha };
  }
  if (l.expurgado_em) {
    return { label: "Expurgado", classe: "bg-secondary text-muted-foreground", detalhe: "payload apagado aos 14 dias" };
  }
  if (l.response_meta) {
    const n = l.response_meta.events_received;
    return { label: "Aceito", classe: "bg-primary/15 text-primary", detalhe: `events_received: ${n ?? "?"}` };
  }
  return { label: "Não enviado", classe: "bg-secondary text-muted-foreground", detalhe: "não foi para a Meta" };
}

const hora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function RastreioEventosPage() {
  const { startDateStr, endDateStr } = useFilters();

  const [linhas, setLinhas] = useState<LinhaEvento[]>([]);
  const [total, setTotal] = useState(0);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [aberto, setAberto] = useState<LinhaEvento | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const TETO = 200;

  const carregar = useCallback(async () => {
    setLoading(true);

    /* `criado_em` é `timestamptz`, então aqui o par certo é o de data com o
       dia inteiro — `endDateStr` sozinho cortaria no começo do último dia.
       Por isso o `lt` no dia seguinte em vez de `lte` no mesmo. */
    const diaSeguinte = new Date(`${endDateStr}T00:00:00-03:00`);
    diaSeguinte.setDate(diaSeguinte.getDate() + 1);

    let q = supabase
      .schema("tracking")
      .from("events_log")
      .select(
        "id,criado_em,event_name,event_id,trck_user_id,produto_code,page_url,utm_source,utm_campaign,pais,estado,cidade,payload_meta,response_meta,expurgado_em",
        { count: "exact" },
      )
      .gte("criado_em", `${startDateStr}T00:00:00-03:00`)
      .lt("criado_em", diaSeguinte.toISOString())
      /* Desempate por `id` (uuid, chave primária): sem ele, duas leituras da
         mesma faixa podem repetir uma linha e perder outra. */
      .order("criado_em", { ascending: false })
      .order("id")
      .limit(TETO);

    if (filtro !== "todos") q = q.eq("event_name", filtro);

    const { data, error, count } = await q;

    if (error) {
      console.error("rastreio/eventos:", error.message);
      setErro(error.message);
      setLoading(false);
      return;
    }
    setErro(null);
    setLinhas((data ?? []) as LinhaEvento[]);
    setTotal(count ?? 0);
    setLoading(false);
  }, [startDateStr, endDateStr, filtro]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  return (
    <DashboardLayout title="Rastreio" hideTitle>
      <RastreioNav />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg bg-secondary p-1">
          {FILTROS.map((f) => (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                filtro === f ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f === "todos" ? "Todos" : (EVENTO_LABEL[f] ?? f)}
            </button>
          ))}
        </div>
        {!loading && !erro && (
          <span className="text-xs text-muted-foreground">
            {total > TETO
              ? `mostrando os ${TETO} mais recentes de ${formatNumber(total)} no período`
              : `${formatNumber(total)} evento(s) no período`}
          </span>
        )}
      </div>

      {erro ? (
        <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
          <AlertCircle className="h-6 w-6 text-destructive" />
          <div>
            <p className="font-medium text-foreground">Não foi possível ler os eventos</p>
            <p className="mt-1 text-xs text-muted-foreground">{erro}</p>
          </div>
          <button
            onClick={carregar}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary"
          >
            Tentar de novo
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 text-left font-semibold">Quando</th>
                <th className="px-4 py-2 text-left font-semibold">Evento</th>
                <th className="px-4 py-2 text-left font-semibold">Origem</th>
                <th className="px-4 py-2 text-left font-semibold">Onde</th>
                <th className="px-4 py-2 text-left font-semibold">Meta</th>
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    {loading
                      ? "Carregando…"
                      : filtro !== "todos"
                        ? `Nenhum ${EVENTO_LABEL[filtro] ?? filtro} no período.`
                        : "Nenhum evento no período."}
                  </td>
                </tr>
              )}
              {linhas.map((l) => {
                const s = situacao(l);
                return (
                  <tr
                    key={l.id}
                    onClick={() => setAberto(l)}
                    className="cursor-pointer border-b border-border/50 last:border-0 hover:bg-secondary/40"
                  >
                    <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{hora(l.criado_em)}</td>
                    <td className="px-4 py-2 text-foreground">{EVENTO_LABEL[l.event_name] ?? l.event_name}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {l.utm_source ?? "—"}
                      {l.utm_campaign && (
                        <span className="ml-1.5 text-xs opacity-70">{l.utm_campaign.split("|")[0]}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {l.cidade ? `${l.cidade}${l.estado ? ` · ${l.estado}` : ""}` : (l.pais ?? "—")}
                    </td>
                    <td className="px-4 py-2">
                      <span className={cn("rounded px-2 py-0.5 text-xs font-medium", s.classe)}>{s.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── O que foi mandado, e o que voltou ────────────────────────── */}
      <Dialog open={aberto !== null} onOpenChange={(v) => !v && setAberto(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {aberto ? (EVENTO_LABEL[aberto.event_name] ?? aberto.event_name) : ""}
            </DialogTitle>
          </DialogHeader>

          {aberto && (
            <div className="space-y-4 text-sm">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">Quando</dt>
                  <dd className="text-foreground">{new Date(aberto.criado_em).toLocaleString("pt-BR")}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Produto</dt>
                  <dd className="text-foreground">{aberto.produto_code ?? "—"}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground">event_id</dt>
                  {/* O mesmo id que o pixel usou — é ele que faz a Meta contar
                      uma vez só. Fica visível porque é o que se confere
                      quando alguém desconfia de contagem dobrada. */}
                  <dd className="break-all font-mono text-[11px] text-foreground">{aberto.event_id}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Visitante</dt>
                  <dd className="break-all font-mono text-[11px] text-foreground">{aberto.trck_user_id ?? "—"}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Página</dt>
                  <dd className="break-all text-[11px] text-foreground">{aberto.page_url ?? "—"}</dd>
                </div>
              </dl>

              <div>
                <p className="mb-1 text-xs font-medium text-foreground">O que foi para a Meta</p>
                {aberto.payload_meta ? (
                  <pre className="max-h-64 overflow-auto rounded-md bg-secondary p-3 font-mono text-[11px] leading-relaxed text-foreground">
                    {JSON.stringify(aberto.payload_meta, null, 2)}
                  </pre>
                ) : (
                  <p className="rounded-md bg-secondary p-3 text-xs text-muted-foreground">
                    {aberto.expurgado_em
                      ? `Apagado em ${new Date(aberto.expurgado_em).toLocaleDateString("pt-BR")} pela retenção de 14 dias — o evento FOI enviado.`
                      : "Nunca enviado. Pode ser de propósito: o PageView não vai pela API, produto sem pixel não é enviado, e o navegador avisa quando o pixel dele não subiu."}
                  </p>
                )}
              </div>

              <div>
                <p className="mb-1 text-xs font-medium text-foreground">O que a Meta respondeu</p>
                {aberto.response_meta ? (
                  <pre
                    className={cn(
                      "max-h-48 overflow-auto rounded-md p-3 font-mono text-[11px] leading-relaxed",
                      aberto.response_meta.falha ? "bg-destructive/10 text-destructive" : "bg-secondary text-foreground",
                    )}
                  >
                    {JSON.stringify(aberto.response_meta, null, 2)}
                  </pre>
                ) : (
                  <p className="rounded-md bg-secondary p-3 text-xs text-muted-foreground">Sem resposta registrada.</p>
                )}
              </div>

              {/* O GA4 nasce vazio e a tela diz isso, em vez de mostrar um
                  bloco em branco que parece defeito. */}
              <p className="text-[11px] text-muted-foreground">
                O lado GA4 ainda não existe: nenhum evento foi enviado pelo Measurement Protocol até agora.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
