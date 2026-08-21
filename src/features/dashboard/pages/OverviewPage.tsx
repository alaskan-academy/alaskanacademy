import { useEffect, useState, useCallback, type ReactNode } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useFilters } from "@/contexts/FilterContext";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/formatters";
import {
  DollarSign,
  ShoppingBag,
  Target,
  TrendingUp,
  BarChart3,
  Percent,
  Receipt,
  BadgeDollarSign,
  CreditCard,
  RefreshCw,
  TrendingDown,
  AlertCircle,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { differenceInDays, parseISO, subDays, format } from "date-fns";
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { inicioDiaBRT, fimDiaBRT } from "@/lib/periodo";

/** Origem da venda. Tráfego = venda com ad_id do Meta; back-end = sem ad_id. */
type Segmento = "trafego" | "backend" | "misto";

const SEGMENTOS: { key: Segmento; label: string; descricao: string }[] = [
  { key: "trafego", label: "Tráfego", descricao: "Vendas atribuídas a um anúncio do Meta" },
  { key: "backend", label: "Back-end", descricao: "Recompra, e-mail, orgânico e área de membros" },
  { key: "misto",   label: "Misto",    descricao: "Todas as vendas do período" },
];

function custoFixoProp(mensal: number, start?: string, end?: string) {
  if (!mensal) return 0;
  if (!start || !end) return mensal;
  const dias = Math.max(1, differenceInDays(parseISO(end), parseISO(start)) + 1);
  return (mensal / 30) * dias;
}

function periodoAnt(start?: string, end?: string) {
  if (!start || !end) return { start: undefined, end: undefined };
  const dias = Math.max(1, differenceInDays(parseISO(end), parseISO(start)) + 1);
  return {
    start: format(subDays(parseISO(start), dias), "yyyy-MM-dd"),
    end: format(subDays(parseISO(start), 1), "yyyy-MM-dd"),
  };
}

const VarBadge = ({ atual, anterior }: { atual: number; anterior: number }) => {
  if (!anterior) return null;
  const v = ((atual - anterior) / anterior) * 100;
  return (
    <span className={cn("flex items-center gap-0.5 text-xs mt-1", v >= 0 ? "text-success" : "text-destructive")}>
      {v >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {Math.abs(v).toFixed(1)}% vs anterior
    </span>
  );
};

type AbaOperacional = "trafego" | "monetizacao" | "perdas" | "produtos" | "links";

const ABAS: { key: AbaOperacional; label: string }[] = [
  { key: "trafego",     label: "Tráfego" },
  { key: "monetizacao", label: "Monetização" },
  { key: "perdas",      label: "Perdas" },
  { key: "produtos",    label: "Produtos" },
  { key: "links",       label: "Links" },
];

/**
 * Card de métrica neutro. A cor é opcional e reservada para quando o número
 * carrega julgamento (ROAS baixo, chargeback acima de zero) — não para rotular
 * a seção a que pertence.
 */
function Metrica({
  rotulo, valor, detalhe, rodape, cor,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  rodape?: ReactNode;
  cor?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-4">
      <span className="block text-xs font-medium uppercase tracking-wider text-muted-foreground">{rotulo}</span>
      {/* `text-[clamp()]` encolhe o número em vez de deixá-lo vazar do card quando a
          sidebar está aberta e a coluna fica estreita. */}
      <div
        className={cn(
          "mt-1.5 font-bold tabular-nums leading-tight [font-size:clamp(1rem,2.2vw,1.25rem)]",
          cor || "text-foreground",
        )}
      >
        {valor}
      </div>
      {detalhe && <div className="mt-1 text-xs leading-snug text-muted-foreground">{detalhe}</div>}
      {rodape}
    </div>
  );
}

function Linha({
  rotulo, valor, negativo, forte, cor,
}: {
  rotulo: string;
  valor: string;
  negativo?: boolean;
  forte?: boolean;
  cor?: string;
}) {
  return (
    <div className={cn("flex justify-between", forte && "font-semibold")}>
      <span className={cn(negativo ? "text-muted-foreground" : "text-foreground")}>
        {negativo && "− "}
        {rotulo}
      </span>
      <span className={cn(cor || (negativo ? "text-muted-foreground" : "text-foreground"))}>{valor}</span>
    </div>
  );
}

function Painel({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <h3 className="px-5 pb-3 pt-5 text-sm font-medium text-foreground">{titulo}</h3>
      {children}
    </div>
  );
}

function Tabela({ colunas, linhas, vazio }: { colunas: string[]; linhas: ReactNode[]; vazio: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[380px] text-sm">
        <thead>
          <tr className="border-b border-border">
            {colunas.map(c => (
              <th key={c} className="px-4 py-2 text-left text-xs font-medium uppercase text-muted-foreground">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.length > 0 ? (
            linhas
          ) : (
            <tr>
              <td colSpan={colunas.length} className="px-4 py-6 text-center text-muted-foreground">
                {vazio}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function OverviewPage() {
  const { startDateStr, endDateStr, startISO, endISO, funilId } = useFilters();
  const [segmento, setSegmento] = useState<Segmento>("misto");
  const [abaOp, setAbaOp] = useState<AbaOperacional>("trafego");
  const [kpis, setKpis] = useState<any>({});
  const [kpisAnt, setKpisAnt] = useState<any>({});
  const [obsData, setObsData] = useState<any[]>([]);
  const [upsellData, setUpsellData] = useState<any[]>([]);
  const [prodData, setProdData] = useState<any[]>([]);
  const [serieDiaria, setSerieDiaria] = useState<any[]>([]);
  const [linkData, setLinkData] = useState<any[]>([]);
  const [remData, setRemData] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);

    // Uma chamada só, agregando no banco.
    //
    // Antes a página buscava as linhas de `vendas` e somava no JavaScript. O
    // PostgREST corta em 1.000 linhas por padrão e não avisa — devolve 200 com mil
    // linhas. Agosto tem mais de 1.300 vendas aprovadas, então o faturamento
    // aparecia truncado para menos, sem parecer erro em lugar nenhum.
    //
    // `startISO`/`endISO` já vêm com o offset de Brasília: `data_venda` é
    // timestamptz e comparar com data solta faria o Postgres ler em UTC, puxando as
    // 21h–23h59 do dia anterior para dentro do período.
    const ant = periodoAnt(startDateStr, endDateStr);
    const argsBase = { p_segmento: segmento, p_funil: funilId ?? null };

    const [atual, anterior] = await Promise.all([
      supabase.rpc("fn_overview", { ...argsBase, p_inicio: startISO, p_fim: endISO }),
      ant.start && ant.end
        ? supabase.rpc("fn_overview", {
            ...argsBase,
            p_inicio: inicioDiaBRT(ant.start),
            p_fim: fimDiaBRT(ant.end),
          })
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (atual.error || !atual.data) {
      // Erro visível em vez de tela com zeros: zero e "não consegui ler" são coisas
      // diferentes, e confundi-los foi a origem de metade dos defeitos que este
      // dashboard já teve.
      console.error("fn_overview:", atual.error?.message);
      setErro(atual.error?.message ?? "Não foi possível carregar os dados.");
      setLoading(false);
      return;
    }
    setErro(null);

    const d = atual.data as any;
    const num = (v: any) => Number(v ?? 0);

    const fatBruto = num(d.fat_bruto);
    const juros = num(d.juros);
    const receita = num(d.receita);
    const taxaPlat = num(d.taxa_plataforma);
    // Percentual sobre a receita, não sobre o pago: senão o juro de parcelamento
    // faria a taxa parecer maior do que a Payt cobra.
    const taxaPlatPct = receita > 0 ? (taxaPlat / receita) * 100 : 0;

    // Custos e impostos só existem no total do período; são rateados pela
    // participação deste recorte no faturamento. O investimento em ads é a exceção:
    // pertence 100% ao tráfego pago.
    const fatTotalPeriodo = num(d.fat_bruto_total);
    const share = fatTotalPeriodo > 0
      ? Math.min(fatBruto / fatTotalPeriodo, 1)
      : (fatBruto > 0 ? 1 : 0);

    const fiscal = d.fiscal ?? {};
    const reembolsosV = num(fiscal.reembolsos) * share;
    const impSimples = num(fiscal.imposto_simples) * share;
    const impMeta = num(fiscal.imposto_meta) * share;
    const investimento = segmento === "backend" ? 0 : num(fiscal.investimento_meta);
    const simplesPct = num(fiscal.simples_pct);
    const metaPct = num(fiscal.meta_pct);
    const custoMensal = num(fiscal.custo_fixo_mensal);
    const custoFixo = custoFixoProp(custoMensal, startDateStr, endDateStr) * share;

    // Tudo a partir de `receita` (sem juros), não do pago pelo cliente: quem paga o
    // juro é o cliente e quem recebe é a adquirente — nunca foi dinheiro da casa.
    const fatLiquido = receita - taxaPlat - impSimples;
    const lucro = receita - taxaPlat - reembolsosV - impSimples - impMeta - investimento;
    const lucroCC = lucro - custoFixo;
    const margemPct = receita > 0 ? (lucro / receita) * 100 : 0;
    const margemCcPct = receita > 0 ? (lucroCC / receita) * 100 : 0;
    const roas = investimento > 0 ? receita / investimento : 0;

    const qtdAprov = num(d.qtd_aprovadas);
    const ticketMedio = qtdAprov > 0 ? receita / qtdAprov : 0;
    const cpa = investimento > 0 && qtdAprov > 0 ? investimento / qtdAprov : 0;

    // Não aprovadas e perdas vêm agrupadas por status.
    const naoAprov = d.nao_aprovadas ?? {};
    const perdas = d.perdas ?? {};
    const grupo = (o: any, chave: string) => ({
      qtd: num(o?.[chave]?.qtd),
      valor: num(o?.[chave]?.valor),
    });
    const pendentes = grupo(naoAprov, "pendente");
    const canceladas = grupo(naoAprov, "cancelada");
    const expiradas = grupo(naoAprov, "expirada");
    const reembolsadas = grupo(perdas, "reembolsada");
    const chargebacks = grupo(perdas, "chargeback");

    // Percentuais sobre a base do período: aprovadas + as próprias perdas.
    const baseReemb = qtdAprov + reembolsadas.qtd;
    const baseCb = baseReemb + chargebacks.qtd;
    setRemData({
      qtd_reembolsos: reembolsadas.qtd,
      valor_reembolsos: reembolsadas.valor,
      pct_reembolsos: baseReemb > 0 ? (reembolsadas.qtd / baseReemb) * 100 : 0,
      qtd_chargeback: chargebacks.qtd,
      valor_chargeback: chargebacks.valor,
      pct_chargeback: baseCb > 0 ? (chargebacks.qtd / baseCb) * 100 : 0,
    });

    const obs = (d.order_bumps ?? []).map((o: any) => ({
      nome_ob: o.nome,
      tipo_ob: o.tipo,
      total_convertidos: num(o.qtd),
      receita_total_ob: num(o.receita),
      vendas_com_ob: num(o.vendas_com_ob),
      taxa_conversao_pct: qtdAprov > 0 ? (num(o.vendas_com_ob) / qtdAprov) * 100 : 0,
    }));
    setObsData([...obs].sort((a: any, b: any) => b.taxa_conversao_pct - a.taxa_conversao_pct));
    const receitaOb = obs.reduce((s: number, o: any) => s + o.receita_total_ob, 0);
    const taxaOb = qtdAprov > 0 ? (num(d.vendas_com_ob) / qtdAprov) * 100 : 0;

    // Upsell é resolvido no banco. `is_upsell` vem de `tipo_venda`, campo da própria
    // Payt, e não mais da heurística de segunda compra em 30 min — que marcava
    // compra dupla legítima como upsell e perdia upsell fora da janela.
    const ups = (d.upsells ?? []).map((u: any) => ({
      nome_upsell: u.nome,
      total_upsells: num(u.qtd),
      receita_total: num(u.receita),
      taxa_conversao_pct: qtdAprov > 0 ? (num(u.qtd) / qtdAprov) * 100 : 0,
    }));
    setUpsellData(ups);
    const receitaUp = ups.reduce((s: number, u: any) => s + u.receita_total, 0);
    const taxaUp = qtdAprov > 0 ? (num(d.qtd_upsells) / qtdAprov) * 100 : 0;

    const qtdBackend = num(d.qtd_backend);
    const valBackend = num(d.receita_backend);
    const pctBackend = qtdAprov > 0 ? (qtdBackend / qtdAprov) * 100 : 0;

    // Agrupado pelo nome real vindo da Payt. `produto` é o enum de categoria — só 6
    // valores — e não distingue "Curso Saponaria Brasil" de "Arte Floral em
    // Sabonetes". Upsell fica de fora: tem painel próprio em Monetização, e
    // listá-lo aqui contava a mesma venda duas vezes.
    setProdData(
      (d.por_produto ?? []).map((p: any) => ({
        produto: p.produto,
        categoria: p.categoria,
        vendas_aprovadas: num(p.vendas),
        faturamento_principal: num(p.faturamento_principal),
        ticket_medio: num(p.ticket_medio),
      })),
    );

    // Receita por link de checkout, com quanto de cada um chega rastreado. Serve
    // para achar o link que precisa de UTM: um link com 0% de atribuição cai
    // inteiro em "back-end" sem ser back-end de verdade.
    setLinkData(
      (d.por_link ?? []).map((l: any) => ({
        link: l.link,
        vendas: num(l.vendas),
        valor: num(l.valor),
        pct_rastreado: num(l.pct_rastreado),
      })),
    );

    // O dia já vem calculado em BRT pelo banco: a Payt entrega `paid_at` em horário
    // de Brasília e ~5% das vendas caem entre 21h e 23h59, que em UTC seriam
    // contadas no dia seguinte.
    const dias = d.por_dia ?? [];
    const investimentoDia = investimento > 0 && dias.length > 0 ? investimento / dias.length : 0;
    const margemSobreBruto = fatBruto > 0 ? lucro / fatBruto : 0;
    setSerieDiaria(
      dias.map((x: any) => ({
        dia: x.dia,
        faturamento: num(x.faturamento),
        vendas: num(x.vendas),
        rotulo: format(parseISO(x.dia), "dd/MM"),
        investimento: investimentoDia,
        lucro: num(x.faturamento) * margemSobreBruto,
      })),
    );

    setKpis({
      cpa, juros, receita, fatBruto, fatLiquido, lucro, lucroCC,
      taxaPlat, taxaPlatPct, reembolsosV, impSimples, impMeta,
      investimento, custoFixo, custoMensal,
      margemPct, margemCcPct, roas, simplesPct, metaPct,
      qtdAprov, ticketMedio, taxaOb, taxaUp, receitaOb, receitaUp,
      qtdBackend, valBackend, pctBackend,
      qtdPend: pendentes.qtd, pendVal: pendentes.valor,
      qtdCanc: canceladas.qtd, cancelVal: canceladas.valor,
      qtdExp: expiradas.qtd, expVal: expiradas.valor,
    });

    const a = (anterior?.data ?? null) as any;
    const antReceita = num(a?.receita);
    const antQtd = num(a?.qtd_aprovadas);
    const antInv = segmento === "backend" ? 0 : num(a?.fiscal?.investimento_meta);
    setKpisAnt({
      fatBruto: num(a?.fat_bruto),
      qtdAprov: antQtd,
      ticketMedio: antQtd > 0 ? antReceita / antQtd : 0,
      roas: antInv > 0 ? antReceita / antInv : 0,
    });

    setLastUpdate(new Date());
    setLoading(false);
  }, [startDateStr, endDateStr, startISO, endISO, funilId, segmento]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const corDaMargem = (pct: number) =>
    pct > 30 ? "text-success" : pct >= 15 ? "text-warning" : "text-destructive";

  const margemCor = corDaMargem(kpis.margemPct || 0);
  const margemCcCor = corDaMargem(kpis.margemCcPct || 0);

  const custoLabel = () => {
    if (!kpis.custoMensal) return null;
    if (!startDateStr || !endDateStr) return "mensal";
    const dias = Math.max(1, differenceInDays(parseISO(endDateStr), parseISO(startDateStr)) + 1);
    return `${dias}d`;
  };

  const abasDisponiveis = ABAS.filter(a => !(a.key === "trafego" && segmento === "backend"));
  const abaAtiva = abasDisponiveis.some(a => a.key === abaOp) ? abaOp : abasDisponiveis[0].key;

  return (
    <DashboardLayout title="Visão Geral">
      {/* ── Origem do tráfego + atualizar ───────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          {SEGMENTOS.map(s => (
            <button
              key={s.key}
              onClick={() => setSegmento(s.key)}
              title={s.descricao}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                segmento === s.key
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-secondary border border-border rounded-lg hover:border-primary/50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          {loading ? "Atualizando..." : lastUpdate ? `Atualizado ${format(lastUpdate, "HH:mm")}` : "Atualizar"}
        </button>
      </div>

      {segmento !== "misto" && (
        <p className="mb-4 text-xs text-muted-foreground">
          {SEGMENTOS.find(s => s.key === segmento)?.descricao}. Taxas, impostos e custo fixo são
          rateados pela participação deste segmento no faturamento.
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64 text-muted-foreground animate-pulse">
          Carregando dados...
        </div>
      ) : erro ? (
        /* Falha de leitura tem que aparecer como falha. Renderizar a tela com zeros
           faria a página mentir com a mesma cara de sempre — que é exatamente como
           os defeitos anteriores passaram meses sem ser vistos. */
        <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
          <AlertCircle className="h-6 w-6 text-destructive" />
          <div>
            <p className="font-medium text-foreground">Não foi possível carregar os números</p>
            <p className="mt-1 text-xs text-muted-foreground">{erro}</p>
          </div>
          <button
            onClick={fetchData}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
          >
            Tentar de novo
          </button>
        </div>
      ) : (
        <>
          {/* ══ 1. O resultado ═══════════════════════════════════════════ */}
          <section className="grid gap-4 lg:grid-cols-3 mb-6">
            <div className="rounded-lg border border-border bg-card p-6">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Lucro operacional
              </span>
              <div
                className={cn(
                  "mt-2 text-4xl font-bold tabular-nums",
                  (kpis.lucro || 0) >= 0 ? "text-success" : "text-destructive",
                )}
              >
                {formatCurrency(kpis.lucro || 0)}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className={cn("rounded bg-secondary px-2 py-0.5 font-semibold", margemCor)}>
                  margem {formatPercent(kpis.margemPct || 0)}
                </span>
                <span className="text-muted-foreground">antes do custo fixo</span>
              </div>

              {/* Mesma estrutura do bloco acima, em escala menor: rótulo, valor, badge.
                  O paralelismo é o que faz as duas margens se lerem como um par —
                  antes o valor ia para a direita e quebrava o ritmo.
                  A margem operacional diz se o funil se paga; esta, se a empresa se
                  paga. Hoje são 25,2% contra 11,2%. */}
              {(kpis.custoFixo || 0) > 0 && (
                <div className="mt-4 border-t border-border/60 pt-3">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Depois do custo fixo
                  </span>
                  <div
                    className={cn(
                      "mt-1 text-2xl font-bold tabular-nums",
                      (kpis.lucroCC || 0) >= 0 ? "text-success" : "text-destructive",
                    )}
                  >
                    {formatCurrency(kpis.lucroCC || 0)}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className={cn("rounded bg-secondary px-2 py-0.5 font-semibold", margemCcCor)}>
                      margem {formatPercent(kpis.margemCcPct || 0)}
                    </span>
                    <span className="text-muted-foreground">
                      −{formatCurrency(kpis.custoFixo || 0)} de custo fixo
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Só vai a 4 colunas em xl: em lg, com a sidebar aberta, a coluna fica
                estreita demais e os valores cortavam. */}
            <div className="lg:col-span-2 grid grid-cols-2 gap-4 xl:grid-cols-4">
              <Metrica
                rotulo="Pago pelos clientes"
                valor={formatCurrency(Math.max(0, kpis.fatBruto || 0))}
                detalhe={(kpis.juros || 0) > 0 ? `inclui ${formatCurrency(kpis.juros)} de juros` : undefined}
                rodape={<VarBadge atual={kpis.fatBruto} anterior={kpisAnt.fatBruto} />}
              />
              <Metrica
                rotulo="Faturamento líquido"
                valor={formatCurrency(Math.max(0, kpis.fatLiquido || 0))}
                detalhe="após taxa e Simples"
              />
              <Metrica
                rotulo="Vendas aprovadas"
                valor={formatNumber(kpis.qtdAprov || 0)}
                rodape={<VarBadge atual={kpis.qtdAprov} anterior={kpisAnt.qtdAprov} />}
              />
              <Metrica
                rotulo="Ticket médio"
                valor={formatCurrency(kpis.ticketMedio || 0)}
                rodape={<VarBadge atual={kpis.ticketMedio} anterior={kpisAnt.ticketMedio} />}
              />
            </div>
          </section>

          {/* ══ 2. Para onde foi o dinheiro ══════════════════════════════ */}
          <section className="grid gap-4 lg:grid-cols-5 mb-6">
            <div className="lg:col-span-3 rounded-lg border border-border bg-card p-5">
              <div className="mb-4 flex items-baseline justify-between">
                <h3 className="text-sm font-medium text-foreground">Faturamento por dia</h3>
                <span className="text-xs text-muted-foreground">
                  {serieDiaria.length} {serieDiaria.length === 1 ? "dia" : "dias"}
                </span>
              </div>
              {serieDiaria.length === 0 ? (
                <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
                  Sem vendas no período selecionado
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={serieDiaria} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                    <defs>
                      <linearGradient id="gradFaturamento" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="rotulo"
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={16}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      width={64}
                      tickFormatter={(v: number) => `R$ ${Math.round(v / 1000)}k`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: "hsl(var(--foreground))" }}
                      formatter={(v: number, nome: string) => [
                        formatCurrency(v),
                        nome === "lucro" ? "Lucro estimado" : "Faturamento",
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="faturamento"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      fill="url(#gradFaturamento)"
                    />
                    <Line type="monotone" dataKey="lucro" stroke="hsl(var(--success))" strokeWidth={1.5} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Cascata: substitui os cards de Receita e Custos Diretos, que repetiam
                exatamente estes mesmos números uma seção acima. */}
            <div className="lg:col-span-2 rounded-lg border border-border bg-card p-5">
              <h3 className="mb-4 text-sm font-medium text-foreground">Do pago ao lucro</h3>
              <div className="space-y-1.5 text-sm tabular-nums">
                <Linha rotulo="Pago pelos clientes" valor={formatCurrency(Math.max(0, kpis.fatBruto || 0))} forte />
                {(kpis.juros || 0) > 0 && (
                  <>
                    <Linha
                      rotulo="Juros de parcelamento"
                      valor={formatCurrency(kpis.juros)}
                      negativo
                    />
                    <div className="border-t border-border/60 pt-1.5">
                      <Linha rotulo="Receita" valor={formatCurrency(kpis.receita || 0)} forte />
                    </div>
                  </>
                )}
                <Linha
                  rotulo={`Taxa Payt (${(kpis.taxaPlatPct || 0).toFixed(2)}%)`}
                  valor={formatCurrency(kpis.taxaPlat || 0)}
                  negativo
                />
                <Linha rotulo="Reembolsos" valor={formatCurrency(kpis.reembolsosV || 0)} negativo />
                <Linha
                  rotulo={`Simples (${formatPercent(kpis.simplesPct || 0)})`}
                  valor={formatCurrency(kpis.impSimples || 0)}
                  negativo
                />
                <Linha
                  rotulo={`Imposto Meta (${formatPercent(kpis.metaPct || 0)})`}
                  valor={formatCurrency(kpis.impMeta || 0)}
                  negativo
                />
                <Linha rotulo="Investimento em ads" valor={formatCurrency(kpis.investimento || 0)} negativo />
                <div className="border-t border-border pt-1.5">
                  <Linha
                    rotulo="Lucro operacional"
                    valor={formatCurrency(kpis.lucro || 0)}
                    forte
                    cor={(kpis.lucro || 0) >= 0 ? "text-success" : "text-destructive"}
                  />
                </div>
                {(kpis.custoFixo || 0) > 0 && (
                  <>
                    <Linha rotulo={`Custo fixo (${custoLabel()})`} valor={formatCurrency(kpis.custoFixo)} negativo />
                    <div className="border-t border-border pt-1.5">
                      <Linha
                        rotulo="Lucro c/ custo fixo"
                        valor={formatCurrency(kpis.lucroCC || 0)}
                        forte
                        cor={(kpis.lucroCC || 0) >= 0 ? "text-success" : "text-destructive"}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>

          {/* ══ 3. Detalhe operacional ═══════════════════════════════════ */}
          <section>
            <div className="mb-4 inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1">
              {abasDisponiveis.map(a => (
                <button
                  key={a.key}
                  onClick={() => setAbaOp(a.key)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    abaAtiva === a.key
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {a.label}
                </button>
              ))}
            </div>

            {abaAtiva === "trafego" && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Metrica
                  rotulo="Investimento Meta"
                  valor={formatCurrency(kpis.investimento || 0)}
                  detalhe={!kpis.investimento ? "sem dados de ads no período" : undefined}
                />
                <Metrica
                  rotulo="ROAS"
                  valor={kpis.roas ? `${kpis.roas.toFixed(2)}x` : "—"}
                  cor={kpis.roas >= 3 ? "text-success" : kpis.roas >= 1 ? "text-warning" : undefined}
                  rodape={kpis.roas ? <VarBadge atual={kpis.roas} anterior={kpisAnt.roas} /> : undefined}
                />
                <Metrica
                  rotulo="CPA"
                  valor={kpis.cpa ? formatCurrency(kpis.cpa) : "—"}
                  detalhe="custo por venda aprovada"
                />
              </div>
            )}

            {abaAtiva === "monetizacao" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <Metrica
                    rotulo="Order bumps"
                    valor={formatCurrency(kpis.receitaOb || 0)}
                    detalhe={`taxa ${formatPercent(kpis.taxaOb || 0)}`}
                  />
                  <Metrica
                    rotulo="Upsells"
                    valor={formatCurrency(kpis.receitaUp || 0)}
                    detalhe={`taxa ${formatPercent(kpis.taxaUp || 0)}`}
                  />
                  <Metrica
                    rotulo="Vendas back-end"
                    valor={formatCurrency(kpis.valBackend || 0)}
                    detalhe={`${formatNumber(kpis.qtdBackend || 0)} vendas · ${formatPercent(kpis.pctBackend || 0)}`}
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <Painel titulo="Conversão de order bumps">
                    <Tabela
                      colunas={["OB", "Tipo", "Conv.", "Receita", "Taxa"]}
                      vazio="Sem conversões no período"
                      linhas={obsData.map((r, i) => (
                        <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-secondary/40">
                          <td className="px-4 py-2 text-foreground">{r.nome_ob}</td>
                          <td className="px-4 py-2">
                            <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                              {(r.tipo_ob || "").replace("orderbump_", "OB").toUpperCase()}
                            </span>
                          </td>
                          <td className="px-4 py-2 tabular-nums text-foreground">{formatNumber(r.total_convertidos || 0)}</td>
                          <td className="px-4 py-2 tabular-nums text-foreground">{formatCurrency(r.receita_total_ob || 0)}</td>
                          <td className="px-4 py-2 tabular-nums text-foreground">{(Number(r.taxa_conversao_pct) || 0).toFixed(2)}%</td>
                        </tr>
                      ))}
                    />
                  </Painel>
                  <Painel titulo="Conversão de upsells">
                    <Tabela
                      colunas={["Upsell", "Conv.", "Receita", "Taxa"]}
                      vazio="Sem upsells no período"
                      linhas={upsellData.map((r, i) => (
                        <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-secondary/40">
                          <td className="px-4 py-2 text-foreground">{r.nome_upsell}</td>
                          <td className="px-4 py-2 tabular-nums text-foreground">{formatNumber(r.total_upsells || 0)}</td>
                          <td className="px-4 py-2 tabular-nums text-foreground">{formatCurrency(r.receita_total || 0)}</td>
                          <td className="px-4 py-2 tabular-nums text-foreground">{(Number(r.taxa_conversao_pct) || 0).toFixed(2)}%</td>
                        </tr>
                      ))}
                    />
                  </Painel>
                </div>
              </div>
            )}

            {abaAtiva === "perdas" && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-lg border border-border bg-card p-4">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Não aprovadas
                  </span>
                  <div className="mt-1.5 text-xl font-bold tabular-nums text-foreground">
                    {formatCurrency((kpis.pendVal || 0) + (kpis.cancelVal || 0) + (kpis.expVal || 0))}
                  </div>
                  <div className="mt-2 space-y-1 text-xs">
                    {[
                      ["Pendentes", kpis.qtdPend, kpis.pendVal],
                      ["Canceladas", kpis.qtdCanc, kpis.cancelVal],
                      ["Expiradas", kpis.qtdExp, kpis.expVal],
                    ].map(([rot, qtd, val]) => (
                      <div key={rot as string} className="flex justify-between text-muted-foreground">
                        <span>{rot as string}</span>
                        <span className="tabular-nums">
                          {(qtd as number) || 0} · {formatCurrency((val as number) || 0)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <Metrica
                  rotulo="Reembolsos"
                  valor={formatCurrency(remData.valor_reembolsos || 0)}
                  detalhe={`${remData.qtd_reembolsos || 0} · ${(remData.pct_reembolsos || 0).toFixed(1)}%`}
                />
                <Metrica
                  rotulo="Chargebacks"
                  valor={formatCurrency(remData.valor_chargeback || 0)}
                  cor={(remData.valor_chargeback || 0) > 0 ? "text-destructive" : undefined}
                  detalhe={`${remData.qtd_chargeback || 0} · ${(remData.pct_chargeback || 0).toFixed(1)}%`}
                />
              </div>
            )}

            {abaAtiva === "links" && (
              <Painel titulo="Receita por link de checkout">
                <p className="px-5 pb-3 text-xs text-muted-foreground">
                  Link com 0% rastreado não carrega UTM, então a venda cai em back-end mesmo
                  quando veio de anúncio. É onde vale configurar o rastreio.
                </p>
                <Tabela
                  colunas={["Link", "Vendas", "Receita", "Rastreado"]}
                  vazio="Sem vendas no período"
                  linhas={linkData.map((l, i) => (
                    <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-secondary/40">
                      <td className="px-4 py-2 text-foreground">{l.link}</td>
                      <td className="px-4 py-2 tabular-nums text-foreground">{formatNumber(l.vendas)}</td>
                      <td className="px-4 py-2 tabular-nums text-foreground">{formatCurrency(l.valor)}</td>
                      <td className="px-4 py-2">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums",
                            l.pct_rastreado >= 90
                              ? "bg-success/10 text-success"
                              : l.pct_rastreado > 0
                                ? "bg-warning/10 text-warning"
                                : "bg-destructive/10 text-destructive",
                          )}
                        >
                          {l.pct_rastreado.toFixed(0)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                />
              </Painel>
            )}

            {abaAtiva === "produtos" && (
              <Painel titulo="Vendas por produto">
                <div className="px-5 pb-5">
                  {prodData.length === 0 ? (
                    <div className="py-6 text-center text-sm text-muted-foreground">Sem dados no período</div>
                  ) : (
                    prodData.map((r: any, i: number) => (
                      <div
                        key={i}
                        className="flex items-center justify-between border-b border-border/50 py-2.5 last:border-0"
                      >
                        <div className="min-w-0 pr-4">
                          <span className="text-sm font-medium text-foreground">{r.produto}</span>
                          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                            {r.categoria && (
                              <span className="rounded bg-secondary px-1.5 py-0.5 capitalize">{r.categoria}</span>
                            )}
                            <span>
                              {formatNumber(r.vendas_aprovadas)} vendas · TM {formatCurrency(r.ticket_medio || 0)}
                            </span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold tabular-nums text-foreground">
                            {formatCurrency(r.faturamento_principal || 0)}
                          </div>
                          <div className="text-xs text-muted-foreground">fat. principal</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Painel>
            )}
          </section>
        </>
      )}
    </DashboardLayout>
  );
}
