import { useCallback, useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { KPICard } from "@/components/KPICard";
import { useFilters } from "@/contexts/FilterContext";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/**
 * Visão geral do rastreamento server-side — a Fase 6.
 *
 * ── O que esta tela é, e o que ela NÃO é ─────────────────────────────────
 *
 * Ela mostra o funil medido pelo NOSSO rastreio, não pela Meta. O `/meta-ads`
 * já mostra o funil que a Meta conta, e os dois vão divergir — é esperado, e
 * é o ponto: a diferença entre os dois é o que a plataforma não enxerga.
 *
 * Por isso todo número daqui é rotulado "medido pelo rastreio", nunca
 * "faturamento". `vendas` continua sendo o dinheiro oficial da casa.
 *
 * ── Primeira página do painel a ler o schema `tracking` ──────────────────
 *
 * Não havia nenhuma: zero `.schema(` em todo o `src/` antes desta. Funciona
 * sem mexer no cliente — o PostgREST já expõe o schema e `authenticated` tem
 * acesso de leitura por RLS. Trocar o `createClient` para
 * `db: { schema: 'tracking' }` quebraria o resto do painel, que é todo
 * `public`; o `.schema()` por consulta é o caminho.
 *
 * E não dá para ler deslogado: sem sessão a resposta é `42501`, não lista
 * vazia. É mais um motivo para erro e vazio nunca se confundirem aqui.
 *
 * ── As datas são `date`, não `timestamptz` ───────────────────────────────
 *
 * As vistas expõem `dia` já convertido para o fuso de São Paulo, então o
 * filtro certo é `startDateStr`/`endDateStr`. Usar `startISO` compararia um
 * timestamp com uma data e o Postgres leria em UTC — a tela discordaria do
 * `/resumo` toda madrugada.
 */

interface LinhaVisitantes {
  dia: string;
  empresa_id: string | null;
  visitantes: number;
  verificadores: number;
  com_fbclid: number;
  com_fbp: number;
  com_fbc: number;
  com_ga: number;
  recusaram: number;
}

interface LinhaFunil {
  dia: string;
  empresa_id: string | null;
  visitou: number;
  viu_conteudo: number;
  foi_ao_checkout: number;
  comprou: number;
  comprou_com_checkout: number;
}

interface LinhaCasamento {
  dia: string;
  empresa_id: string | null;
  match_como: string;
  compras: number;
  valor: number | null;
  enviadas_a_meta: number;
}

interface LinhaEnvios {
  dia: string;
  empresa_id: string | null;
  event_name: string;
  gravados: number;
  enviados: number;
  aceitos: number;
  falharam: number;
  com_fbp: number;
  com_fbc: number;
}

interface LinhaGeo {
  pais: string;
  estado: string;
  cidade: string;
  visitantes: number;
  e_resto: boolean;
}

/** Como a venda casou com a visita, do degrau mais forte para o mais fraco. */
const MATCH_LABEL: Record<string, { label: string; classe: string }> = {
  trck_user_id: { label: "Pelo id da visita", classe: "bg-primary/15 text-primary" },
  upsell_from: { label: "Pelo pedido-pai", classe: "bg-primary/10 text-primary/80" },
  email: { label: "Por e-mail", classe: "bg-amber-500/15 text-amber-400" },
  telefone: { label: "Por telefone", classe: "bg-amber-500/15 text-amber-400" },
  nao_casou: { label: "Não casou", classe: "bg-destructive/15 text-destructive" },
};

/** Nome do evento como a Meta o chama, que é como ela aparece no painel dela. */
const EVENTO_LABEL: Record<string, string> = {
  page_view: "PageView",
  view_content: "Ver conteúdo",
  initiate_checkout: "Iniciar finalização",
  video_progress: "Vídeo",
  scroll_depth: "Rolagem",
  button_visible: "Botão visível",
};

const soma = <T,>(linhas: T[], campo: (l: T) => number) =>
  linhas.reduce((t, l) => t + (campo(l) || 0), 0);

/** Divisão que não explode em zero — a tela nasceu sem dado nenhum. */
const pct = (parte: number, todo: number) => (todo > 0 ? (100 * parte) / todo : 0);

export default function RastreioPage() {
  const { startDateStr, endDateStr, empresaId } = useFilters();

  const [visitantes, setVisitantes] = useState<LinhaVisitantes[]>([]);
  const [funil, setFunil] = useState<LinhaFunil[]>([]);
  const [casamento, setCasamento] = useState<LinhaCasamento[]>([]);
  const [envios, setEnvios] = useState<LinhaEnvios[]>([]);
  const [geo, setGeo] = useState<LinhaGeo[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    const t = supabase.schema("tracking");

    /* O recorte por empresa é o do cabeçalho: `null` quer dizer "Ambas", e
       nesse caso não se filtra nada. Não é o mesmo que "sem empresa" — essa
       linha existe e aparece, para produto sem projeto mapeado não sumir. */
    const porEmpresa = <Q extends { eq: (c: string, v: string) => Q }>(q: Q) =>
      empresaId ? q.eq("empresa_id", empresaId) : q;

    const noPeriodo = <Q extends { gte: (c: string, v: string) => Q; lte: (c: string, v: string) => Q }>(q: Q) =>
      q.gte("dia", startDateStr).lte("dia", endDateStr);

    const [v, f, c, e, g] = await Promise.all([
      porEmpresa(noPeriodo(t.from("vw_rastreio_visitantes_dia").select("*"))),
      porEmpresa(noPeriodo(t.from("vw_rastreio_funil_dia").select("*"))),
      porEmpresa(noPeriodo(t.from("vw_rastreio_casamento_dia").select("*"))),
      porEmpresa(noPeriodo(t.from("vw_rastreio_envios_dia").select("*"))),
      /* O geo agrega no banco: em grão diário ele cruzaria o teto de 1.000
         linhas do PostgREST em uma semana, e o teto corta devolvendo 200 sem
         avisar. A linha `e_resto` traz o excedente somado. */
      t.rpc("fn_rastreio_geo", {
        p_de: startDateStr,
        p_ate: endDateStr,
        p_empresa: empresaId ?? null,
        p_limite: 12,
      }),
    ]);

    /* Erro NUNCA vira tela de zeros. "Zero" e "não consegui ler" são coisas
       diferentes, e confundi-los é a origem de metade dos defeitos que este
       painel já teve — está escrito assim em OverviewPage.tsx:295. */
    const falhou = [v, f, c, e, g].find((r) => r.error);
    if (falhou?.error) {
      console.error("rastreio:", falhou.error.message);
      setErro(falhou.error.message);
      setLoading(false);
      return;
    }

    setErro(null);
    setVisitantes((v.data ?? []) as LinhaVisitantes[]);
    setFunil((f.data ?? []) as LinhaFunil[]);
    setCasamento((c.data ?? []) as LinhaCasamento[]);
    setEnvios((e.data ?? []) as LinhaEnvios[]);
    setGeo((g.data ?? []) as LinhaGeo[]);
    setLoading(false);
  }, [startDateStr, endDateStr, empresaId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  /* ── Os números, somados sobre o período que o filtro escolheu ──────── */
  const visitou = soma(funil, (l) => l.visitou);
  const viuConteudo = soma(funil, (l) => l.viu_conteudo);
  const checkout = soma(funil, (l) => l.foi_ao_checkout);
  const comprou = soma(funil, (l) => l.comprou);
  const comprouComCheckout = soma(funil, (l) => l.comprou_com_checkout);

  const verificadores = soma(visitantes, (l) => l.verificadores);
  const comFbc = soma(visitantes, (l) => l.com_fbc);
  const comFbp = soma(visitantes, (l) => l.com_fbp);
  const comFbclid = soma(visitantes, (l) => l.com_fbclid);
  const baseVisitantes = soma(visitantes, (l) => l.visitantes);

  const enviados = soma(envios, (l) => l.enviados);
  const aceitos = soma(envios, (l) => l.aceitos);
  const falharam = soma(envios, (l) => l.falharam);

  const comprasCasadas = soma(casamento, (l) => l.compras);
  const receita = soma(casamento, (l) => Number(l.valor ?? 0));

  const temAlgumDado = visitou > 0 || comprasCasadas > 0 || enviados > 0;

  /* O funil é desenhado sobre VISITOU, nunca sobre a etapa anterior. Dá para
     comprar sem disparar o checkout — botão da VSL, link direto, visitante
     que voltou — e em 14/10 isso deu 2 compras para 1 checkout: a leitura
     passo-a-passo mostraria 200%. Ver o comentário de `vw_rastreio_funil_dia`. */
  const etapas = [
    { nome: "Visitou", valor: visitou },
    { nome: "Viu conteúdo", valor: viuConteudo },
    { nome: "Foi ao checkout", valor: checkout },
    { nome: "Comprou", valor: comprou },
  ];

  const casamentoAgrupado = Object.values(
    casamento.reduce<Record<string, { match: string; compras: number; valor: number; enviadas: number }>>(
      (acc, l) => {
        const k = l.match_como;
        acc[k] = acc[k] ?? { match: k, compras: 0, valor: 0, enviadas: 0 };
        acc[k].compras += l.compras;
        acc[k].valor += Number(l.valor ?? 0);
        acc[k].enviadas += l.enviadas_a_meta;
        return acc;
      },
      {},
    ),
  ).sort((a, b) => b.compras - a.compras);

  const enviosAgrupado = Object.values(
    envios.reduce<Record<string, LinhaEnvios & { chave: string }>>((acc, l) => {
      const k = l.event_name;
      acc[k] = acc[k] ?? { ...l, chave: k, gravados: 0, enviados: 0, aceitos: 0, falharam: 0, com_fbp: 0, com_fbc: 0 };
      acc[k].gravados += l.gravados;
      acc[k].enviados += l.enviados;
      acc[k].aceitos += l.aceitos;
      acc[k].falharam += l.falharam;
      acc[k].com_fbp += l.com_fbp;
      acc[k].com_fbc += l.com_fbc;
      return acc;
    }, {}),
  ).sort((a, b) => b.gravados - a.gravados);

  return (
    <DashboardLayout title="Rastreio" hideTitle>
      {loading ? (
        <div className="flex h-64 items-center justify-center text-muted-foreground animate-pulse">
          Carregando o rastreio…
        </div>
      ) : erro ? (
        <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
          <AlertCircle className="h-6 w-6 text-destructive" />
          <div>
            <p className="font-medium text-foreground">Não foi possível ler o rastreio</p>
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
          {/* A faixa colada: as divisórias são o `bg-border` do contêiner
              aparecendo pelo `gap-px`, por isso cada cartão vai sem borda. */}
          <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 xl:grid-cols-6">
            <KPICard
              title="Visitantes"
              value={formatNumber(visitou)}
              subtitle={
                verificadores > 0
                  ? `${formatNumber(verificadores)} verificador(es) da Meta descartado(s)`
                  : "nenhum verificador no período"
              }
              className="rounded-none border-0"
            />
            <KPICard
              title="Viram conteúdo"
              value={formatNumber(viuConteudo)}
              subtitle={`${formatPercent(pct(viuConteudo, visitou))} de quem visitou`}
              className="rounded-none border-0"
            />
            <KPICard
              title="Foram ao checkout"
              value={formatNumber(checkout)}
              subtitle={`${formatPercent(pct(checkout, visitou))} de quem visitou`}
              className="rounded-none border-0"
            />
            <KPICard
              title="Compraram"
              value={formatNumber(comprou)}
              subtitle={
                comprou > 0
                  ? `${formatNumber(comprouComCheckout)} com checkout rastreado`
                  : `${formatPercent(pct(comprou, visitou))} de quem visitou`
              }
              className="rounded-none border-0"
            />
            <KPICard
              title="Sinal: fbc"
              value={formatPercent(pct(comFbc, baseVisitantes))}
              subtitle={`fbp ${formatPercent(pct(comFbp, baseVisitantes))} · fbclid ${formatPercent(pct(comFbclid, baseVisitantes))}`}
              className="rounded-none border-0"
            />
            <KPICard
              title="Aceitos pela Meta"
              value={formatNumber(aceitos)}
              subtitle={
                falharam > 0
                  ? `${formatNumber(falharam)} recusado(s) — ver alertas`
                  : `de ${formatNumber(enviados)} enviados`
              }
              className="rounded-none border-0"
            />
          </div>

          {!temAlgumDado && (
            <div className="mb-6 rounded-lg border border-border bg-card p-8 text-center">
              <p className="text-sm text-foreground">Nenhum rastreio no período</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {empresaId
                  ? "Nenhum produto desta empresa está no rastreio ainda — hoje ele cobre só a Lumiieduca."
                  : "O rastreio enxerga a partir de 14/10/2026, quando o script entrou na página."}
              </p>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {/* ── O funil ───────────────────────────────────────────── */}
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="text-sm font-medium text-foreground">O caminho até a compra</h2>
                <span className="text-xs text-muted-foreground">medido pelo rastreio</span>
              </div>
              {visitou === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Sem visitas no período</p>
              ) : (
                <div className="space-y-2">
                  {etapas.map((e) => (
                    <div key={e.nome}>
                      <div className="mb-1 flex items-baseline justify-between text-xs">
                        <span className="text-foreground">{e.nome}</span>
                        <span className="text-muted-foreground">
                          {formatNumber(e.valor)} · {formatPercent(pct(e.valor, visitou))}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.max(pct(e.valor, visitou), e.valor > 0 ? 1 : 0)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  {/* A porcentagem é sempre sobre "Visitou". Entre etapas ela
                      passaria de 100% quando alguém compra sem disparar o
                      checkout, e um funil com 200% parece quebrado. */}
                  <p className="pt-2 text-[11px] text-muted-foreground">
                    Cada etapa é a fatia de quem visitou, não da etapa anterior: dá para comprar sem
                    passar pelo checkout rastreado — pelo botão da VSL, por link direto ou voltando depois.
                  </p>
                </div>
              )}
            </div>

            {/* ── Como a venda casou ────────────────────────────────── */}
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="text-sm font-medium text-foreground">Como a venda achou a visita</h2>
                <span className="text-xs text-muted-foreground">
                  {formatNumber(comprasCasadas)} compra(s) · {formatCurrency(receita)}
                </span>
              </div>
              {casamentoAgrupado.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Sem compras no período</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {casamentoAgrupado.map((l) => {
                      const m = MATCH_LABEL[l.match] ?? { label: l.match, classe: "bg-secondary text-muted-foreground" };
                      return (
                        <tr key={l.match} className="border-b border-border/50 last:border-0">
                          <td className="py-2">
                            <span className={cn("rounded px-2 py-0.5 text-xs font-medium", m.classe)}>{m.label}</span>
                          </td>
                          <td className="py-2 text-right text-foreground">{formatNumber(l.compras)}</td>
                          <td className="py-2 text-right text-muted-foreground">{formatCurrency(l.valor)}</td>
                          <td className="py-2 text-right text-xs text-muted-foreground">
                            {l.enviadas === l.compras
                              ? "todas na Meta"
                              : `${formatNumber(l.enviadas)} na Meta`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* ── O que sai para a Meta ─────────────────────────────── */}
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="text-sm font-medium text-foreground">O que sai para a Meta</h2>
                <span className="text-xs text-muted-foreground">evento a evento</span>
              </div>
              {enviosAgrupado.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Nenhum evento no período</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="pb-2 text-left font-semibold">Evento</th>
                      <th className="pb-2 text-right font-semibold">Gravados</th>
                      <th className="pb-2 text-right font-semibold">Aceitos</th>
                      <th className="pb-2 text-right font-semibold">fbp</th>
                      <th className="pb-2 text-right font-semibold">fbc</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enviosAgrupado.map((l) => (
                      <tr key={l.chave} className="border-b border-border/50 last:border-0">
                        <td className="py-2 text-foreground">{EVENTO_LABEL[l.chave] ?? l.chave}</td>
                        <td className="py-2 text-right text-muted-foreground">{formatNumber(l.gravados)}</td>
                        <td className={cn("py-2 text-right", l.falharam > 0 ? "text-destructive" : "text-foreground")}>
                          {l.enviados === 0 ? "—" : formatNumber(l.aceitos)}
                          {l.falharam > 0 && ` (${formatNumber(l.falharam)} recusado)`}
                        </td>
                        <td className="py-2 text-right text-muted-foreground">
                          {l.enviados === 0 ? "—" : formatPercent(pct(l.com_fbp, l.enviados))}
                        </td>
                        <td className="py-2 text-right text-muted-foreground">
                          {l.enviados === 0 ? "—" : formatPercent(pct(l.com_fbc, l.enviados))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {/* Gravado maior que enviado é NORMAL e tem três causas boas —
                  dizer isso na tela evita a pergunta de toda semana. */}
              <p className="pt-3 text-[11px] text-muted-foreground">
                Gravado maior que aceito não é erro: o PageView não vai pela API de propósito, produto sem
                pixel não é enviado, e o navegador avisa quando o pixel dele não subiu. O que é defeito
                aparece em vermelho, e tem alarme na Saúde do Sistema.
              </p>
            </div>

            {/* ── De onde vêm ───────────────────────────────────────── */}
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="text-sm font-medium text-foreground">De onde vêm</h2>
                <span className="text-xs text-muted-foreground">sem os verificadores</span>
              </div>
              {geo.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Sem visitas no período</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {geo.map((l) => (
                      <tr
                        key={`${l.pais}-${l.estado}-${l.cidade}`}
                        className={cn("border-b border-border/50 last:border-0", l.e_resto && "text-muted-foreground")}
                      >
                        <td className="py-1.5 text-foreground">
                          {l.e_resto ? l.cidade : `${l.cidade}`}
                          {!l.e_resto && <span className="ml-1.5 text-xs text-muted-foreground">{l.estado}</span>}
                        </td>
                        <td className="py-1.5 text-right">{formatNumber(l.visitantes)}</td>
                        <td className="w-24 py-1.5 pl-3">
                          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                            <div
                              className="h-full rounded-full bg-primary/60"
                              style={{ width: `${pct(l.visitantes, baseVisitantes)}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
