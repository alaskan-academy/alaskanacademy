import { useEffect, useState, useCallback, type ReactNode } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { AlertaSyncMeta } from "@/features/ads/AlertaSyncMeta";
import GlobalFilters from "@/components/GlobalFilters";
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
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { inicioDiaBRT, fimDiaBRT } from "@/lib/periodo";
import {
  calcularResultado,
  ratearCustoFixo,
  participacao,
  ticketMedio,
  roas,
  cpa,
  taxaPlataformaPct,
} from "@/lib/financeiro";
import { impostoSobre, diasDoCustoFixo, lucroPorDia } from "@/lib/resumo";
import { LembreteConferencia } from "@/features/dashboard/components/LembreteConferencia";

/**
 * Origem da venda.
 *
 * Tráfego é venda com `ad_id` do Meta **ou** marcada em `trafego_pago` — o segundo
 * caso cobre o checkout que rodou sem UTM e cujas vendas, por isso, caíam em
 * back-end e faziam o segmento pago parecer deficitário.
 */
type Segmento = "trafego" | "backend" | "misto";

const SEGMENTOS: { key: Segmento; label: string; descricao: string }[] = [
  { key: "trafego", label: "Tráfego", descricao: "Vendas vindas de anúncio, inclusive as de link que rodou sem UTM" },
  { key: "backend", label: "Back-end", descricao: "Recompra, e-mail, orgânico e área de membros" },
  { key: "misto",   label: "Misto",    descricao: "Todas as vendas do período" },
];

/** Dias do período, inclusivo nas duas pontas. 0 quando não há período definido. */
function diasDoPeriodo(start?: string, end?: string) {
  if (!start || !end) return 0;
  return Math.max(1, differenceInDays(parseISO(end), parseISO(start)) + 1);
}

function periodoAnt(start?: string, end?: string) {
  if (!start || !end) return { start: undefined, end: undefined };
  const dias = diasDoPeriodo(start, end);
  return {
    start: format(subDays(parseISO(start), dias), "yyyy-MM-dd"),
    end: format(subDays(parseISO(start), 1), "yyyy-MM-dd"),
  };
}

/**
 * Variação contra o período anterior.
 *
 * `tom` existe porque subir não quer dizer melhorar em todo indicador. Em CPA, uma
 * alta é piora; em investimento, não é nem uma coisa nem outra. Pintar tudo de
 * verde para cima faria a cor mentir — que é o mesmo defeito, em outra forma, de
 * mostrar um número truncado com cara de número certo.
 */
const VarBadge = ({
  atual, anterior, tom = "positivo",
}: {
  atual: number;
  anterior: number;
  tom?: "positivo" | "inverso" | "neutro";
}) => {
  if (!anterior) return null;
  const v = ((atual - anterior) / anterior) * 100;
  const subiu = v >= 0;
  const cor =
    tom === "neutro"  ? "text-muted-foreground"
    : tom === "inverso" ? (subiu ? "text-destructive" : "text-success")
    : (subiu ? "text-success" : "text-destructive");

  return (
    <span className={cn("flex items-center gap-0.5 text-xs mt-1", cor)}>
      {subiu ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
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

/**
 * Uma linha da cascata, com o peso do item sobre a receita.
 *
 * A base é a receita, não o pago pelo cliente. É dela que tudo é descontado, e é ela
 * que a margem usa — então a última linha da coluna fecha exatamente com a margem
 * mostrada no topo da página. Sobre o pago, os percentuais não reconciliariam com
 * nada, porque o juro de parcelamento entraria no denominador.
 *
 * Por isso "Pago pelos clientes" aparece acima de 100%: ele é maior que a receita,
 * na exata medida do juro que o cliente paga à adquirente.
 */
function Linha({
  rotulo, valor, pct, negativo, forte, cor,
}: {
  rotulo: string;
  valor: string;
  pct?: number;
  negativo?: boolean;
  forte?: boolean;
  cor?: string;
}) {
  return (
    <div className={cn("flex items-baseline gap-3", forte && "font-semibold")}>
      <span className={cn("flex-1", negativo ? "text-muted-foreground" : "text-foreground")}>
        {negativo && "− "}
        {rotulo}
      </span>
      <span className={cn("shrink-0", cor || (negativo ? "text-muted-foreground" : "text-foreground"))}>
        {valor}
      </span>
      <span
        className={cn(
          "w-14 shrink-0 text-right text-xs",
          forte ? "text-muted-foreground" : "text-muted-foreground/60",
        )}
      >
        {pct === undefined ? "" : `${pct.toFixed(1)}%`}
      </span>
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
  const { startDateStr, endDateStr, startISO, endISO, contaIds, empresaId } = useFilters();
  const [segmento, setSegmento] = useState<Segmento>("misto");
  const [abaOp, setAbaOp] = useState<AbaOperacional>("trafego");
  const [kpis, setKpis] = useState<any>({});
  const [kpisAnt, setKpisAnt] = useState<any>({});
  const [obsData, setObsData] = useState<any[]>([]);
  const [upsellData, setUpsellData] = useState<any[]>([]);
  const [prodData, setProdData] = useState<any[]>([]);
  const [serieDiaria, setSerieDiaria] = useState<any[]>([]);
  const [linkData, setLinkData] = useState<any[]>([]);
  const [origemData, setOrigemData] = useState<any[]>([]);
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

    /*
      `p_contas`, no plural e como array.

      A página mandava `p_conta: contaIds ?? null` para uma função que recebia
      um `uuid` escalar. Com nenhuma conta escolhida — o estado padrão — o que
      chegava era `[]`, virava a string "[]" no PostgREST, e o Resumo morria
      com "invalid input syntax for type uuid". Não era só com conta
      selecionada: era sempre.

      O `?? null` parecia um cuidado e nunca rodou: `??` só pega null e
      undefined, e `[]` não é nenhum dos dois. Foi ele que fez o defeito
      parecer tratado.

      Do lado do banco, nulo e vazio significam a mesma coisa: todas as contas.
    */
    /*
      `p_empresa` recorta as três pontas do resultado pela fonte certa de cada
      uma: a venda pelo carimbo da Payt que recebeu, a mídia pelo carimbo da
      conta de anúncio, e a alíquota com o custo fixo por `fn_config`.

      Nulo é "Ambas", e soma tudo — o que o Resumo sempre fez. A soma só é
      honesta enquanto o rótulo no cabeçalho disser "Ambas": um número que
      mistura duas empresas sem avisar deixa de ser um total.
    */
    const argsBase = { p_segmento: segmento, p_contas: contaIds, p_empresa: empresaId };

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
    const taxaPlatPct = taxaPlataformaPct(taxaPlat, receita);

    // Custos e impostos só existem no total do período; são rateados pela
    // participação deste recorte no faturamento. O investimento em ads é a exceção:
    // pertence 100% ao tráfego pago.
    const share = participacao(fatBruto, num(d.fat_bruto_total));

    const fiscal = d.fiscal ?? {};

    /*
      O Simples sai da receita DESTE recorte, e não do rateio do total.

      Mesmo defeito do imposto do Meta, na linha de cima da cascata: com a conta
      Saponaria em agosto, o rótulo dizia "Simples (10.00%)" e o número era
      R$ 6.379,00 sobre R$ 64.050,95 — 9,96%. A diferença vinha de ratear um
      imposto que incide sobre a RECEITA usando a participação no faturamento
      BRUTO, que inclui juros de parcelamento.

      Conferido: a própria view faz essa conta assim — em agosto,
      R$ 173.777,54 x 10% = R$ 17.377,75 contra os R$ 17.377,76 que ela soma.
    */
    const impSimples = impostoSobre(receita, num(fiscal.simples_pct));
    // Custo de anúncio não existe no back-end, e o imposto sobre ele também não. O
    // imposto do Meta incide sobre o gasto, não sobre a receita — ratear pela
    // participação no faturamento fazia o back-end pagar imposto de mídia que ele
    // nunca comprou, e a margem dele saía menor do que é.
    const eBackend = segmento === "backend";
    const investimento = eBackend ? 0 : num(fiscal.investimento_meta);

    /*
      O imposto do Meta sai do GASTO que está sendo mostrado, e não do rateio
      pela receita.

      O comentário acima já dizia a regra certa — "o imposto do Meta incide
      sobre o gasto, não sobre a receita" — mas ela só era aplicada para zerar o
      back-end. Nos outros dois recortes o investimento vinha inteiro e o
      imposto vinha rateado pela participação no faturamento, que são bases
      diferentes.

      O que isso custava, medido: com a conta "Saponaria" escolhida em agosto, a
      tela cobrava R$ 4.687,18 de imposto sobre um gasto de R$ 43.915,63 que
      gera R$ 5.489,45. R$ 802,27 de lucro a mais do que existe. A distorção
      aparece sempre que a conta pesa mais no gasto do que na receita — e a
      "Saponaria Brasil - VSL" é o caso extremo: 0,0% da receita e 0,8% do
      gasto, ou seja, imposto praticamente zero sobre R$ 829,53 queimados.
      O mesmo valia para o segmento Tráfego, que levava o investimento inteiro
      e só uma fração do imposto dele.

      Uma linha só resolve os três casos, inclusive o back-end: gasto zero dá
      imposto zero sozinho. E a conta bate com a da propria view — em agosto,
      R$ 102.150,97 x 12,5% = R$ 12.768,87 contra os R$ 12.768,90 que ela soma.
    */
    const impMeta = investimento * (num(fiscal.meta_pct) / 100);
    const simplesPct = num(fiscal.simples_pct);
    const metaPct = num(fiscal.meta_pct);
    const custoMensal = num(fiscal.custo_fixo_mensal);
    // Sem filtro de data, a extensão sai da primeira e da última venda do
    // recorte — que o banco agora devolve. O 30 fixo sobrou só para o caso sem
    // venda nenhuma, onde não há o que medir.
    const diasCusto = diasDoCustoFixo(startDateStr, endDateStr, d.dia_min, d.dia_max);
    const custoFixo = ratearCustoFixo(custoMensal, diasCusto) * share;

    const resultado = calcularResultado({
      receita,
      taxaPlataforma: taxaPlat,

      impostoSimples: impSimples,
      impostoMeta: impMeta,
      investimento,
      custoFixo,
    });
    const fatLiquido = resultado.faturamentoLiquido;
    const lucro = resultado.lucroOperacional;
    const lucroCC = resultado.lucroComCustoFixo;
    const margemPct = resultado.margemPct;
    const margemCcPct = resultado.margemComCustoFixoPct;

    const qtdAprov = num(d.qtd_aprovadas);
    const roasPeriodo = roas(receita, investimento);
    // Dois ROAS porque são duas perguntas. Sem upsell responde "o anúncio se paga com
    // a oferta e os bumps?"; com upsell responde "o funil inteiro fecha?". O bump fica
    // dentro dos dois: está no mesmo carrinho e é quase três vezes maior que o upsell,
    // então tirá-lo de um deles seria arbitrário.
    const roasSemUpsell = roas(num(d.receita_sem_upsell), investimento);
    const ticketMedioPeriodo = ticketMedio(receita, qtdAprov);
    const cpaPeriodo = cpa(investimento, qtdAprov);

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

    // Back-end aberto por procedência. O `utm_source` da Payt vem como origem colada
    // num identificador de sessão ("whatsapp" + "jLj6a..."), e o banco já devolve
    // limpo — sem isso o back-end era um bloco de R$ 23 mil sem dizer de onde.
    setOrigemData(
      (d.por_origem ?? []).map((o: any) => ({
        origem: o.origem,
        vendas: num(o.vendas),
        receita: num(o.receita),
      })),
    );

    // O dia já vem calculado em BRT pelo banco: a Payt entrega `paid_at` em horário
    // de Brasília e ~5% das vendas caem entre 21h e 23h59, que em UTC seriam
    // contadas no dia seguinte.
    /*
      O lucro por dia, agora medido.

      A versão anterior era o faturamento do dia vezes a margem do PERÍODO
      INTEIRO — a mesma curva multiplicada por uma constante, incapaz de mostrar
      um dia no vermelho. Agora cada dia traz a taxa que a Payt cobrou nele e o
      gasto de anúncio daquele dia, vindos do banco, e o lucro sai das mesmas
      contas do topo da tela.

      A consequência prática é o dia com gasto e sem venda: ele não existia na
      lista (que saía só das vendas) e agora aparece, no vermelho, que é
      exatamente o dia que se procura num gráfico assim.
    */
    setSerieDiaria(
      lucroPorDia(
        (d.por_dia ?? []).map((x: any) => ({
          dia: x.dia,
          faturamento: num(x.faturamento),
          vendas: num(x.vendas),
          taxa: num(x.taxa),
          investimento: num(x.investimento),
        })),
        { simplesPct: num(fiscal.simples_pct), metaPct: num(fiscal.meta_pct), contarAds: !eBackend },
      ),
    );

    setKpis({
      juros, receita, fatBruto, fatLiquido, lucro, lucroCC,
      cpa: cpaPeriodo, roas: roasPeriodo, roasSemUpsell, ticketMedio: ticketMedioPeriodo,
      taxaPlat, taxaPlatPct, impSimples, impMeta,
      investimento, custoFixo, custoMensal,
      margemPct, margemCcPct, simplesPct, metaPct,
      qtdAprov, taxaOb, taxaUp, receitaOb, receitaUp,
      qtdBackend, valBackend, pctBackend,
      qtdPend: pendentes.qtd, pendVal: pendentes.valor,
      qtdCanc: canceladas.qtd, cancelVal: canceladas.valor,
      qtdExp: expiradas.qtd, expVal: expiradas.valor,
      qtdRecuperadas: num(d.recuperadas?.qtd),
      valRecuperadas: num(d.recuperadas?.valor),
    });

    const a = (anterior?.data ?? null) as any;
    const antReceita = num(a?.receita);
    const antQtd = num(a?.qtd_aprovadas);
    const antInv = segmento === "backend" ? 0 : num(a?.fiscal?.investimento_meta);
    setKpisAnt({
      fatBruto: num(a?.fat_bruto),
      qtdAprov: antQtd,
      ticketMedio: ticketMedio(antReceita, antQtd),
      roas: roas(antReceita, antInv),
      investimento: antInv,
      cpa: cpa(antInv, antQtd),
    });

    setLastUpdate(new Date());
    setLoading(false);
  }, [startDateStr, endDateStr, startISO, endISO, contaIds, empresaId, segmento]);

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
    return `${diasDoPeriodo(startDateStr, endDateStr)}d`;
  };

  /** Peso de um item sobre a receita. Ver {@link Linha} para a escolha da base. */
  const pctReceita = (valor?: number) => {
    const receita = kpis.receita || 0;
    if (!receita) return undefined;
    return ((valor || 0) / receita) * 100;
  };

  const abasDisponiveis = ABAS.filter(a => !(a.key === "trafego" && segmento === "backend"));
  const abaAtiva = abasDisponiveis.some(a => a.key === abaOp) ? abaOp : abasDisponiveis[0].key;

  return (
    /*
      `hideFilters`: conta e período saem da barra fixa e descem para dentro da
      página, na mesma linha do segmento e do Atualizar.

      Eles estavam longe do que governam. Lá em cima, "Todas as contas" e "Hoje"
      ficavam grudados na busca e no nome da tela — controles de navegação —,
      enquanto o segmento (Tráfego / Back-end / Misto), que recorta exatamente a
      mesma leitura, ficava aqui embaixo. Eram três filtros da mesma resposta
      espalhados por dois lugares, e quem olhava um número errado tinha que
      lembrar de conferir dois cantos da tela.

      A regra que vem junto, e que já custou caro aqui: `hideFilters` só pode
      ser usado por tela que NÃO lê `useFilters`, ou por tela que oferece o
      controle no corpo. Esconder o seletor deixando o filtro ativo cria o pior
      caso — a página filtra por algo que ninguém vê.
    */
    <DashboardLayout title="Visão Geral" hideTitle hideFilters>
      {/*
        O alarme do sync vem ANTES de tudo, inclusive do lembrete de conferência.

        Ele fica aqui, e não só no Meta Ads, porque é aqui que o estrago
        aparece: conta que não sincroniza deixa de subtrair mídia do lucro, e o
        Resumo mostra um número melhor do que a realidade. Erro que faz o
        resultado parecer BOM é o mais perigoso que existe — ninguém desconfia
        de lucro alto.
      */}
      <AlertaSyncMeta className="mb-4" />

      {/* Cobra a conferência contra a Payt. Fica no topo do Resumo porque é aqui que
          os números que ela confere são lidos. */}
      <LembreteConferencia />

      {/* ── O que a leitura recorta: segmento, conta, período ───────────── */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
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

        <div className="flex flex-wrap items-center gap-2">
          <GlobalFilters />
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex h-8 items-center gap-2 rounded-md border border-border bg-secondary px-3 text-xs font-medium transition-colors hover:border-primary/50 disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            {loading ? "Atualizando..." : lastUpdate ? `Atualizado ${format(lastUpdate, "HH:mm")}` : "Atualizar"}
          </button>
        </div>
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
                  {/*
                    `ComposedChart`, e não `AreaChart`.

                    O `AreaChart` desenha as áreas e IGNORA em silêncio os
                    outros tipos de série. A linha de lucro estava escrita ali
                    dentro desde sempre e nunca chegou ao SVG — descobri porque
                    fui conferir o desenho e não achei nenhum
                    `recharts-line-curve` na página.

                    Ou seja: a linha antiga não era só uma estimativa disfarçada
                    de medição, era uma estimativa que ninguém nunca viu.
                  */}
                  <ComposedChart data={serieDiaria} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
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
                        nome === "lucro" ? "Lucro operacional" : "Faturamento",
                      ]}
                    />
                    {/* Zero visível: sem a régua, um lucro negativo se lê como
                        "pouco lucro" em vez de prejuízo. */}
                    <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1} />
                    <Area
                      type="monotone"
                      dataKey="faturamento"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      fill="url(#gradFaturamento)"
                    />
                    <Line
                      type="monotone"
                      dataKey="lucro"
                      stroke="hsl(var(--success))"
                      strokeWidth={1.5}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Cascata: substitui os cards de Receita e Custos Diretos, que repetiam
                exatamente estes mesmos números uma seção acima. */}
            <div className="lg:col-span-2 rounded-lg border border-border bg-card p-5">
              <div className="mb-4 flex items-baseline justify-between">
                <h3 className="text-sm font-medium text-foreground">Do pago ao lucro</h3>
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  % da receita
                </span>
              </div>
              <div className="space-y-1.5 text-sm tabular-nums">
                <Linha
                  rotulo="Pago pelos clientes"
                  valor={formatCurrency(Math.max(0, kpis.fatBruto || 0))}
                  pct={pctReceita(kpis.fatBruto)}
                  forte
                />
                {(kpis.juros || 0) > 0 && (
                  <>
                    <Linha
                      rotulo="Juros de parcelamento"
                      valor={formatCurrency(kpis.juros)}
                      pct={pctReceita(kpis.juros)}
                      negativo
                    />
                    <div className="border-t border-border/60 pt-1.5">
                      <Linha
                        rotulo="Receita"
                        valor={formatCurrency(kpis.receita || 0)}
                        pct={pctReceita(kpis.receita)}
                        forte
                      />
                    </div>
                  </>
                )}
                <Linha
                  rotulo={`Taxa Payt (${(kpis.taxaPlatPct || 0).toFixed(2)}%)`}
                  valor={formatCurrency(kpis.taxaPlat || 0)}
                  pct={pctReceita(kpis.taxaPlat)}
                  negativo
                />
                {/* Reembolso saiu da cascata de propósito. A venda estornada perde o
                    status `aprovada` e some da receita no ato — descontá-la aqui
                    contaria a mesma perda duas vezes. O número continua visível na
                    aba Perdas, que é onde ele informa sem distorcer o resultado. */}
                <Linha
                  rotulo={`Simples (${formatPercent(kpis.simplesPct || 0)})`}
                  valor={formatCurrency(kpis.impSimples || 0)}
                  pct={pctReceita(kpis.impSimples)}
                  negativo
                />
                <Linha
                  rotulo={`Imposto Meta (${formatPercent(kpis.metaPct || 0)})`}
                  valor={formatCurrency(kpis.impMeta || 0)}
                  pct={pctReceita(kpis.impMeta)}
                  negativo
                />
                <Linha
                  rotulo="Investimento em ads"
                  valor={formatCurrency(kpis.investimento || 0)}
                  pct={pctReceita(kpis.investimento)}
                  negativo
                />
                <div className="border-t border-border pt-1.5">
                  <Linha
                    rotulo="Lucro operacional"
                    valor={formatCurrency(kpis.lucro || 0)}
                    pct={pctReceita(kpis.lucro)}
                    forte
                    cor={(kpis.lucro || 0) >= 0 ? "text-success" : "text-destructive"}
                  />
                </div>
                {(kpis.custoFixo || 0) > 0 && (
                  <>
                    <Linha
                      rotulo={`Custo fixo (${custoLabel()})`}
                      valor={formatCurrency(kpis.custoFixo)}
                      pct={pctReceita(kpis.custoFixo)}
                      negativo
                    />
                    <div className="border-t border-border pt-1.5">
                      <Linha
                        rotulo="Lucro c/ custo fixo"
                        valor={formatCurrency(kpis.lucroCC || 0)}
                        pct={pctReceita(kpis.lucroCC)}
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
                  /* Tom neutro: gastar mais não é bom nem ruim por si só — o que
                     julga é o ROAS ao lado. */
                  rodape={
                    kpis.investimento
                      ? <VarBadge atual={kpis.investimento} anterior={kpisAnt.investimento} tom="neutro" />
                      : undefined
                  }
                />
                {/* Dois ROAS porque são duas perguntas. O de cima conta o carrinho
                    inteiro e responde "o funil fecha?" — é o padrão em resposta direta.
                    O de baixo tira o upsell e responde "o anúncio se paga sozinho?",
                    que é o número de quem decide onde escalar mídia.

                    Order bump fica dentro dos dois: está no mesmo carrinho e é quase
                    três vezes maior que o upsell, então tirá-lo de um seria arbitrário. */}
                <Metrica
                  rotulo="ROAS"
                  valor={kpis.roas ? `${kpis.roas.toFixed(2)}x` : "—"}
                  cor={kpis.roas >= 3 ? "text-success" : kpis.roas >= 1 ? "text-warning" : undefined}
                  detalhe={
                    kpis.roas && kpis.roasSemUpsell
                      ? `${kpis.roasSemUpsell.toFixed(2)}x sem upsell`
                      : undefined
                  }
                  rodape={kpis.roas ? <VarBadge atual={kpis.roas} anterior={kpisAnt.roas} /> : undefined}
                />
                <Metrica
                  rotulo="CPA"
                  valor={kpis.cpa ? formatCurrency(kpis.cpa) : "—"}
                  detalhe="custo por venda aprovada"
                  /* Invertido: CPA subindo é piora, e verde diria o contrário. */
                  rodape={
                    kpis.cpa
                      ? <VarBadge atual={kpis.cpa} anterior={kpisAnt.cpa} tom="inverso" />
                      : undefined
                  }
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
                  {/* Duas colunas de percentual porque respondem a perguntas
                      diferentes: "% vendas" é quantas das vendas do período levaram o
                      item — mede o poder de conversão da oferta. "% fat." é quanto ele
                      pesa no faturamento — mede o quanto move o resultado. Um item pode
                      converter pouco e pesar muito, ou o contrário. */}
                  <Painel titulo="Conversão de order bumps">
                    <Tabela
                      colunas={["OB", "Tipo", "Conv.", "% vendas", "Receita", "% fat."]}
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
                          <td className="px-4 py-2 tabular-nums text-muted-foreground">{(Number(r.taxa_conversao_pct) || 0).toFixed(1)}%</td>
                          <td className="px-4 py-2 tabular-nums text-foreground">{formatCurrency(r.receita_total_ob || 0)}</td>
                          <td className="px-4 py-2 tabular-nums text-muted-foreground">
                            {(pctReceita(r.receita_total_ob) ?? 0).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    />
                  </Painel>
                  <Painel titulo="Conversão de upsells">
                    <Tabela
                      colunas={["Upsell", "Conv.", "% vendas", "Receita", "% fat."]}
                      vazio="Sem upsells no período"
                      linhas={upsellData.map((r, i) => (
                        <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-secondary/40">
                          <td className="px-4 py-2 text-foreground">{r.nome_upsell}</td>
                          <td className="px-4 py-2 tabular-nums text-foreground">{formatNumber(r.total_upsells || 0)}</td>
                          <td className="px-4 py-2 tabular-nums text-muted-foreground">{(Number(r.taxa_conversao_pct) || 0).toFixed(1)}%</td>
                          <td className="px-4 py-2 tabular-nums text-foreground">{formatCurrency(r.receita_total || 0)}</td>
                          <td className="px-4 py-2 tabular-nums text-muted-foreground">
                            {(pctReceita(r.receita_total) ?? 0).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    />
                  </Painel>
                </div>

                {/* O back-end deixa de ser um bloco só. A origem vem do `utm_source`
                    da Payt, que chega como procedência colada num identificador de
                    sessão e o banco devolve já limpa. Upsell aparece separado porque
                    acontece depois do checkout e nunca terá origem própria — somá-lo
                    ao "sem origem" fazia esse balaio ser 65% do back-end sem dizer nada. */}
                {origemData.length > 0 && (
                  <Painel titulo="Back-end por origem">
                    <Tabela
                      colunas={["Origem", "Vendas", "Receita", "% do back-end"]}
                      vazio="Sem vendas de back-end no período"
                      linhas={origemData.map((r, i) => {
                        const pct = (kpis.valBackend || 0) > 0
                          ? (r.receita / kpis.valBackend) * 100
                          : 0;
                        return (
                          <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-secondary/40">
                            <td className="px-4 py-2 text-foreground">{r.origem}</td>
                            <td className="px-4 py-2 tabular-nums text-foreground">{formatNumber(r.vendas)}</td>
                            <td className="px-4 py-2 tabular-nums text-foreground">{formatCurrency(r.receita)}</td>
                            <td className="px-4 py-2 tabular-nums text-muted-foreground">{pct.toFixed(1)}%</td>
                          </tr>
                        );
                      })}
                    />
                  </Painel>
                )}
              </div>
            )}

            {abaAtiva === "perdas" && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-lg border border-border bg-card p-4">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Não aprovadas
                  </span>
                  {(() => {
                    // O card mostra a tentativa que não virou dinheiro. O número
                    // grande é o que de fato ficou pelo caminho — o total menos o que
                    // a pessoa refez e pagou —, porque era isso que confundia: o
                    // bruto parecia receita perdida e um terço dele não era.
                    const total =
                      (kpis.pendVal || 0) + (kpis.cancelVal || 0) + (kpis.expVal || 0);
                    const qtdTotal =
                      (kpis.qtdPend || 0) + (kpis.qtdCanc || 0) + (kpis.qtdExp || 0);
                    const recuperado = kpis.valRecuperadas || 0;
                    const perdido = Math.max(total - recuperado, 0);
                    const pctDoFat = pctReceita(perdido);

                    const linhas: [string, number, number][] = [
                      ["Expiradas", kpis.qtdExp || 0, kpis.expVal || 0],
                      ["Canceladas", kpis.qtdCanc || 0, kpis.cancelVal || 0],
                      ["Pendentes", kpis.qtdPend || 0, kpis.pendVal || 0],
                    ];

                    return (
                      <>
                        <div className="mt-1.5 text-xl font-bold tabular-nums text-foreground">
                          {formatCurrency(perdido)}
                        </div>
                        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                          ficou pelo caminho
                          {pctDoFat !== undefined && ` · ${pctDoFat.toFixed(1)}% do faturamento`}
                        </p>

                        {recuperado > 0 && (
                          <p className="mt-2 rounded bg-success/10 px-2 py-1.5 text-xs leading-snug text-success">
                            {formatCurrency(recuperado)} de {formatCurrency(total)} viraram
                            venda depois — mesma pessoa, mesmo produto, em até 7 dias
                          </p>
                        )}

                        {/* Duas colunas, não quatro: o card divide a largura com outros
                            dois e sobram ~250px. Contagem e percentual descem para uma
                            segunda linha em corpo menor, o que também os hierarquiza
                            abaixo do valor, que é o que se lê primeiro. */}
                        <div className="mt-3 space-y-2 border-t border-border/60 pt-2.5">
                          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                            {formatNumber(qtdTotal)} tentativas · {formatCurrency(total)}
                          </div>
                          {linhas.map(([rot, qtd, val]) => (
                            <div key={rot} className="flex items-baseline justify-between gap-2 text-xs">
                              <div className="min-w-0">
                                <div className="text-muted-foreground">{rot}</div>
                                <div className="text-[10px] tabular-nums text-muted-foreground/60">
                                  {formatNumber(qtd)} · {qtdTotal > 0 ? ((qtd / qtdTotal) * 100).toFixed(0) : 0}%
                                </div>
                              </div>
                              <span className="shrink-0 tabular-nums text-muted-foreground">
                                {formatCurrency(val)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    );
                  })()}
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
                          {/* A etiqueta de categoria saiu daqui: era redundante em 99,2%
                              do volume ("Curso Saponaria Brasil · Saponaria", "Fábrica
                              das Velas de Lembrancinha · Velas"). Informava em 10 das
                              1.308 vendas do mês e cobrava espaço em todas as linhas.
                              O campo segue existindo e é usado no agrupamento por
                              categoria da página de Vendas, onde não há nome de produto
                              para tornar a informação óbvia. */}
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {formatNumber(r.vendas_aprovadas)} vendas · TM {formatCurrency(r.ticket_medio || 0)}
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
