import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Plus, ShieldCheck } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { KPICard } from "@/components/KPICard";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConfirm } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { useFilters } from "@/contexts/FilterContext";
import { supabase } from "@/lib/supabase";
import { formatNumber, formatPercent } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { RastreioNav } from "../components/RastreioNav";

/**
 * Privacidade — o consentimento e a fila de pedidos da LGPD.
 *
 * ── Por que esta tela existe, e não é burocracia ────────────────────────
 *
 * `/privacidade` está publicada e promete duas coisas com número: os sete
 * direitos do artigo 18, e **resposta em 15 dias**. Sem fila, um pedido que
 * chega por e-mail vive na caixa de entrada de alguém e vence sem que
 * ninguém perceba — e o prazo vencido é o que a ANPD pergunta primeiro.
 *
 * ── O que esta tela NÃO faz, de propósito ───────────────────────────────
 *
 * Ela não apaga nada sozinha. Toda a execução mora em funções do banco
 * (`fn_lgpd_*`), e `fn_lgpd_atender` **levanta exceção** se o pedido não
 * passou por `em_revisao`. A ordem "pedido → revisa → confirma → executa" é
 * uma regra do Postgres, não um `disabled` de botão: trava que vive só na
 * tela some na próxima vez que alguém editar o componente.
 *
 * O painel sequer tem permissão de escrita nestas tabelas — `authenticated`
 * só tem SELECT, e tudo passa pelas funções.
 *
 * ── Os rótulos vêm do banco ─────────────────────────────────────────────
 *
 * `lgpd_direitos` é a fonte dos sete direitos. Repetir a lista aqui em
 * TypeScript seria a terceira armadilha de novo: a política muda, o banco
 * ganha um código, e a tela continua oferecendo os antigos.
 *
 * ── O alcance, dito na tela em vez de presumido ─────────────────────────
 *
 * Esta fila age sobre o RASTREIO. `public.vendas`, que é o dinheiro do
 * painel, e a Payt, que é operadora com a mesma obrigação fiscal, ficam de
 * fora — e isso está escrito no rodapé do cartão, porque deixar parecer que
 * um clique resolveu tudo é pior do que não ter a tela.
 */

interface Direito {
  codigo: string;
  rotulo: string;
  descricao: string;
  artigo: string | null;
  acao: "apagar" | "bloquear" | null;
  ordem: number;
}

interface Pedido {
  id: string;
  identificador: string;
  tipo: string;
  pedido: string;
  pedido_rotulo: string | null;
  pedido_acao: "apagar" | "bloquear" | null;
  situacao: string;
  observacao: string | null;
  resultado: Record<string, number | string> | null;
  pedido_em: string;
  revisado_em: string | null;
  atendido_em: string | null;
  dias_para_vencer: number;
  vencido: boolean;
}

interface LinhaConsentimento {
  dia: string;
  visitantes_total: number;
  visitantes_recusou: number;
  banner_aceitou: number;
  banner_recusou: number;
  banner_parcial: number;
}

const SITUACAO: Record<string, { label: string; classe: string }> = {
  pendente: { label: "Pendente", classe: "bg-amber-500/15 text-amber-500" },
  em_revisao: { label: "Em revisão", classe: "bg-primary/15 text-primary" },
  atendido: { label: "Atendido", classe: "bg-secondary text-muted-foreground" },
  recusado: { label: "Recusado", classe: "bg-destructive/15 text-destructive" },
};

const ACAO_TEXTO: Record<string, string> = {
  apagar:
    "Apaga a visita, os eventos e o consentimento. A compra NÃO é apagada — é registro fiscal: " +
    "ela fica sem nome, e-mail, telefone, CPF e sem o payload bruto do webhook.",
  bloquear: "Marca o visitante como tendo recusado, e a coleta para. Nada é apagado.",
};

const data = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });

export default function RastreioPrivacidadePage() {
  const { startDateStr, endDateStr, empresaId } = useFilters();
  const confirmar = useConfirm();
  const { toast } = useToast();

  const [direitos, setDireitos] = useState<Direito[]>([]);
  const [fila, setFila] = useState<Pedido[]>([]);
  const [consent, setConsent] = useState<LinhaConsentimento[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [novo, setNovo] = useState(false);
  const [decisao, setDecisao] = useState<{ pedido: Pedido; modo: "atender" | "recusar" } | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    const t = supabase.schema("tracking");

    /* O recorte por empresa vale para o consentimento, que é por visitante.
       A FILA não se recorta: um pedido é de uma PESSOA, e a mesma pessoa
       pode ter comprado nas duas empresas — esconder metade dela porque o
       cabeçalho está numa seria atender pela metade. */
    /* "Todos" manda `startDateStr` nulo, e `.gte('dia', null)` vira
       `dia=gte.null`, que o Postgres recusa com 400. Sem data, não se
       filtra — ver a nota em `RastreioPage.tsx`. */
    let q = t.from("vw_lgpd_consentimento_dia").select("*");
    if (startDateStr && endDateStr) q = q.gte("dia", startDateStr).lte("dia", endDateStr);
    if (empresaId) q = q.eq("empresa_id", empresaId);

    const [d, f, c] = await Promise.all([
      t.from("lgpd_direitos").select("*").order("ordem"),
      t.from("vw_lgpd_fila").select("*").order("pedido_em", { ascending: false }),
      q,
    ]);

    const falhou = [d, f, c].find((r) => r.error);
    if (falhou?.error) {
      console.error("rastreio/privacidade:", falhou.error.message);
      setErro(falhou.error.message);
      setLoading(false);
      return;
    }

    setErro(null);
    setDireitos((d.data ?? []) as Direito[]);
    setFila((f.data ?? []) as Pedido[]);
    setConsent((c.data ?? []) as LinhaConsentimento[]);
    setLoading(false);
  }, [startDateStr, endDateStr, empresaId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const totais = useMemo(() => {
    const soma = (f: (l: LinhaConsentimento) => number) => consent.reduce((a, l) => a + (f(l) || 0), 0);
    const visitantes = soma((l) => l.visitantes_total);
    const recusou = soma((l) => l.visitantes_recusou);
    return {
      visitantes,
      recusou,
      pctRecusou: visitantes > 0 ? (100 * recusou) / visitantes : 0,
      bannerAceitou: soma((l) => l.banner_aceitou),
      bannerRecusou: soma((l) => l.banner_recusou),
      bannerParcial: soma((l) => l.banner_parcial),
    };
  }, [consent]);

  const abertos = fila.filter((p) => p.situacao === "pendente" || p.situacao === "em_revisao");
  const vencidos = abertos.filter((p) => p.vencido);

  async function revisar(p: Pedido) {
    const { data: r, error } = await supabase.schema("tracking").rpc("fn_lgpd_revisar", { p_id: p.id });
    if (error) {
      toast({ title: "Não deu para revisar", description: error.message, variant: "destructive" });
      return;
    }
    const n = r as Record<string, number>;
    toast({
      title: "Revisado",
      description:
        `Alcança ${formatNumber(n.visitantes ?? 0)} visita(s), ${formatNumber(n.eventos ?? 0)} evento(s) ` +
        `e ${formatNumber(n.compras ?? 0)} compra(s).`,
    });
    carregar();
  }

  return (
    <DashboardLayout title="Rastreio" hideTitle>
      <RastreioNav />

      {loading ? (
        <div className="flex h-64 items-center justify-center text-muted-foreground animate-pulse">Carregando…</div>
      ) : erro ? (
        <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
          <AlertCircle className="h-6 w-6 text-destructive" />
          <div>
            <p className="font-medium text-foreground">Não foi possível ler a privacidade</p>
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
        <>
          <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
            <KPICard
              title="Visitantes no período"
              value={formatNumber(totais.visitantes)}
              subtitle="sem os verificadores da Meta"
            />
            <KPICard
              title="Recusaram a coleta"
              value={formatNumber(totais.recusou)}
              subtitle={`${formatPercent(totais.pctRecusou)} — pelo opt-out de /privacidade`}
            />
            <KPICard
              title="Pedidos em aberto"
              value={formatNumber(abertos.length)}
              subtitle={vencidos.length > 0 ? `${vencidos.length} passou dos 15 dias` : "nenhum vencido"}
            />
            <KPICard
              title="Cliques no banner"
              value={formatNumber(totais.bannerAceitou + totais.bannerRecusou + totais.bannerParcial)}
              subtitle={
                totais.bannerAceitou + totais.bannerRecusou + totais.bannerParcial === 0
                  ? "zero até o banner subir"
                  : `${formatNumber(totais.bannerAceitou)} aceitou · ${formatNumber(totais.bannerRecusou)} recusou`
              }
            />
          </div>

          {/* ── A fila ─────────────────────────────────────────────── */}
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium text-foreground">Pedidos dos titulares</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Chegam por e-mail em contato@lumiieduca.com.br — a política não oferece formulário
                </p>
              </div>
              <button
                onClick={() => setNovo(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-3.5 w-3.5" />
                Registrar pedido
              </button>
            </div>

            {fila.length === 0 ? (
              <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Nenhum pedido até agora.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="pb-2 text-left font-semibold">Pessoa</th>
                      <th className="pb-2 text-left font-semibold">Pedido</th>
                      <th className="pb-2 text-left font-semibold">Situação</th>
                      <th className="pb-2 text-left font-semibold">Prazo</th>
                      <th className="pb-2 text-right font-semibold">O que fazer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fila.map((p) => {
                      const s = SITUACAO[p.situacao] ?? { label: p.situacao, classe: "bg-secondary" };
                      const aberto = p.situacao === "pendente" || p.situacao === "em_revisao";
                      return (
                        <tr key={p.id} className="border-b border-border/50 last:border-0">
                          <td className="py-2.5 text-foreground">
                            {p.identificador}
                            <span className="ml-1.5 text-[10px] uppercase text-muted-foreground">{p.tipo}</span>
                          </td>
                          <td className="py-2.5 text-muted-foreground">{p.pedido_rotulo ?? p.pedido}</td>
                          <td className="py-2.5">
                            <span className={cn("rounded px-2 py-0.5 text-xs font-medium", s.classe)}>{s.label}</span>
                          </td>
                          <td className="py-2.5 text-xs">
                            {!aberto ? (
                              <span className="text-muted-foreground">
                                {p.atendido_em ? data(p.atendido_em) : "—"}
                              </span>
                            ) : p.vencido ? (
                              <span className="font-medium text-destructive">
                                venceu há {Math.abs(p.dias_para_vencer)} dia(s)
                              </span>
                            ) : (
                              <span className={cn(p.dias_para_vencer <= 3 ? "text-amber-500" : "text-muted-foreground")}>
                                {p.dias_para_vencer} dia(s)
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 text-right">
                            {p.situacao === "pendente" && (
                              <button
                                onClick={() => revisar(p)}
                                className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-secondary"
                              >
                                Revisar
                              </button>
                            )}
                            {p.situacao === "em_revisao" && (
                              <div className="flex justify-end gap-1.5">
                                <button
                                  onClick={() => setDecisao({ pedido: p, modo: "recusar" })}
                                  className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-secondary"
                                >
                                  Recusar
                                </button>
                                <button
                                  onClick={() => setDecisao({ pedido: p, modo: "atender" })}
                                  className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                                >
                                  Atender
                                </button>
                              </div>
                            )}
                            {!aberto && p.resultado && (
                              <span className="text-[11px] text-muted-foreground">
                                {resumoDoResultado(p.resultado)}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* O alcance, dito. Deixar parecer que um clique resolveu tudo é
                pior do que não ter a tela. */}
            <p className="mt-4 border-t border-border pt-3 text-[11px] text-muted-foreground">
              Esta fila age sobre o rastreio. O registro da venda no painel e os dados na Payt, que é operadora
              com a mesma obrigação fiscal, não são alcançados daqui — um pedido completo precisa dos dois.
            </p>
          </div>
        </>
      )}

      <DialogNovoPedido
        aberto={novo}
        direitos={direitos}
        aoFechar={() => setNovo(false)}
        aoSalvar={() => {
          setNovo(false);
          carregar();
        }}
      />

      <DialogDecisao
        decisao={decisao}
        confirmar={confirmar}
        aoFechar={() => setDecisao(null)}
        aoSalvar={() => {
          setDecisao(null);
          carregar();
        }}
      />
    </DashboardLayout>
  );
}

/** O resumo do que a execução fez, lido do jsonb que a função guardou. */
function resumoDoResultado(r: Record<string, number | string>): string {
  if (r.acao === "apagar") {
    return `${r.eventos_apagados ?? 0} evento(s), ${r.visitantes_apagados ?? 0} visita(s), ${r.compras_anonimizadas ?? 0} compra(s) anonimizada(s)`;
  }
  if (r.acao === "bloquear") return `${r.visitantes_bloqueados ?? 0} visitante(s) bloqueado(s)`;
  if (r.acao === "respondido por e-mail") return "respondido por e-mail";
  return "";
}

function DialogNovoPedido({
  aberto,
  direitos,
  aoFechar,
  aoSalvar,
}: {
  aberto: boolean;
  direitos: Direito[];
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const { toast } = useToast();
  const [identificador, setIdentificador] = useState("");
  const [tipo, setTipo] = useState("email");
  const [codigo, setCodigo] = useState("");
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);

  /* A data em que o E-MAIL chegou, não a de hoje. O prazo de 15 dias que
     /privacidade publica conta de lá; usar a data da transcrição dava dias
     que a pessoa não tem — se o e-mail ficou 5 dias na caixa, a tela diria
     "15" quando restam 10. Começa em hoje porque é o caso comum. */
  const hoje = new Date().toISOString().slice(0, 10);
  const [chegouEm, setChegouEm] = useState(hoje);

  const escolhido = direitos.find((d) => d.codigo === codigo);

  async function salvar() {
    setSalvando(true);
    const { error } = await supabase.schema("tracking").rpc("fn_lgpd_registrar", {
      p_identificador: identificador,
      p_tipo: tipo,
      p_pedido: codigo,
      p_observacao: observacao || null,
      p_chegou_em: chegouEm || null,
    });
    setSalvando(false);
    if (error) {
      toast({ title: "Não deu para registrar", description: error.message, variant: "destructive" });
      return;
    }
    setIdentificador("");
    setCodigo("");
    setObservacao("");
    aoSalvar();
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar pedido</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Como a pessoa se identificou</label>
            <div className="flex gap-2">
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              >
                <option value="email">E-mail</option>
                <option value="telefone">Telefone</option>
              </select>
              <input
                value={identificador}
                onChange={(e) => setIdentificador(e.target.value)}
                placeholder={tipo === "email" ? "o e-mail da compra" : "o telefone da compra"}
                className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              />
            </div>
            {/* A política diz exatamente isto: "o e-mail usado na compra, ou
                o telefone". Quem só navegou não tem como se identificar —
                para essa pessoa a saída é o opt-out, que é um clique. */}
            <p className="mt-1 text-[11px] text-muted-foreground">
              São os dois que a política pede. Quem só navegou e nunca se identificou não aparece por aqui — para
              essa pessoa a saída é o opt-out da própria página.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">O que ela pediu</label>
            <select
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">escolha…</option>
              {direitos.map((d) => (
                <option key={d.codigo} value={d.codigo}>
                  {d.rotulo} — {d.artigo}
                </option>
              ))}
            </select>
            {escolhido && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {escolhido.descricao}.{" "}
                {escolhido.acao
                  ? ACAO_TEXTO[escolhido.acao]
                  : "Este se responde por e-mail: a fila guarda o prazo, e você marca atendido quando responder."}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Quando o e-mail chegou</label>
            <input
              type="date"
              value={chegouEm}
              max={hoje}
              onChange={(e) => setChegouEm(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Os 15 dias que a política promete contam daqui, não de hoje. Se o e-mail ficou dias na caixa,
              marcar hoje daria um prazo que a pessoa não tem.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Observação (opcional)</label>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <button
            onClick={aoFechar}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary"
          >
            Cancelar
          </button>
          <button
            onClick={salvar}
            disabled={salvando || !identificador.trim() || !codigo}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            Registrar
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogDecisao({
  decisao,
  confirmar,
  aoFechar,
  aoSalvar,
}: {
  decisao: { pedido: Pedido; modo: "atender" | "recusar" } | null;
  confirmar: ReturnType<typeof useConfirm>;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const { toast } = useToast();
  const [texto, setTexto] = useState("");
  const [indo, setIndo] = useState(false);

  const p = decisao?.pedido;
  const modo = decisao?.modo;

  /* O diálogo não desmonta entre um pedido e outro, então `texto` sobrevivia:
     o motivo de recusa escrito para um titular reaparecia preenchido no
     pedido do titular seguinte, e bastava um clique em Recusar para gravá-lo
     no registro errado. Zerar ao trocar de pedido OU de modo. */
  useEffect(() => {
    setTexto("");
  }, [p?.id, modo]);
  const r = (p?.resultado ?? {}) as Record<string, number>;
  /* Pedido sem ação executável precisa da observação dizendo o que foi
     respondido — senão "atendido" não significa nada e a fila vira enfeite,
     que é a segunda armadilha. */
  const precisaTexto = modo === "recusar" || (modo === "atender" && !p?.pedido_acao);

  async function executar() {
    if (!p || !modo) return;
    const t = supabase.schema("tracking");

    if (modo === "atender" && p.pedido_acao) {
      const ok = await confirmar({
        title: p.pedido_acao === "apagar" ? "Apagar os dados desta pessoa?" : "Bloquear a coleta desta pessoa?",
        description:
          `${ACAO_TEXTO[p.pedido_acao]}\n\n` +
          `A revisão encontrou ${r.visitantes ?? 0} visita(s), ${r.eventos ?? 0} evento(s) e ` +
          `${r.compras ?? 0} compra(s). Não há como desfazer.`,
        confirmText: p.pedido_acao === "apagar" ? "Apagar" : "Bloquear",
      });
      if (!ok) return;
    }

    setIndo(true);
    const { error } =
      modo === "recusar"
        ? await t.rpc("fn_lgpd_recusar", { p_id: p.id, p_motivo: texto })
        : await t.rpc("fn_lgpd_atender", { p_id: p.id, p_observacao: texto || null });
    setIndo(false);

    if (error) {
      toast({ title: "Não deu certo", description: error.message, variant: "destructive" });
      return;
    }
    setTexto("");
    toast({ title: modo === "recusar" ? "Pedido recusado" : "Pedido atendido" });
    aoSalvar();
  }

  return (
    <Dialog open={Boolean(decisao)} onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {modo === "recusar" ? "Recusar pedido" : `Atender: ${p?.pedido_rotulo ?? ""}`}
          </DialogTitle>
        </DialogHeader>

        {p && (
          <div className="space-y-3 text-sm">
            <div className="rounded-md bg-secondary p-3 text-xs">
              <p className="text-foreground">{p.identificador}</p>
              <p className="mt-1 text-muted-foreground">
                A revisão de {p.revisado_em ? data(p.revisado_em) : "—"} encontrou{" "}
                <strong className="text-foreground">{formatNumber(r.visitantes ?? 0)}</strong> visita(s),{" "}
                <strong className="text-foreground">{formatNumber(r.eventos ?? 0)}</strong> evento(s) e{" "}
                <strong className="text-foreground">{formatNumber(r.compras ?? 0)}</strong> compra(s).
              </p>
            </div>

            {modo === "atender" && p.pedido_acao && (
              <p className="text-xs text-destructive">{ACAO_TEXTO[p.pedido_acao]}</p>
            )}

            {precisaTexto && (
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  {modo === "recusar" ? "Por que está sendo recusado" : "O que foi respondido à pessoa"}
                </label>
                <textarea
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Obrigatório — o banco recusa sem isto.
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <button
            onClick={aoFechar}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary"
          >
            Cancelar
          </button>
          <button
            onClick={executar}
            disabled={indo || (precisaTexto && !texto.trim())}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-40",
              modo === "recusar"
                ? "border border-border text-foreground hover:bg-secondary"
                : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            {modo === "recusar" ? "Recusar" : "Continuar"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
