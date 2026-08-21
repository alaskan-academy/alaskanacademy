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
  RefreshCcw,
  Clock,
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
import { inicioDiaBRT, fimDiaBRT, diaBRT } from "@/lib/periodo";

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

  const fetchData = useCallback(async () => {
    setLoading(true);
    // data_venda é timestamptz: comparar com data solta faria o Postgres ler em UTC
    // e puxar as 21h–23h59 BRT do dia anterior para dentro do período.
    const inicio = startISO;
    const fim = endISO;

    // Segmenta por presença de ad_id_meta. Não usamos utm_source porque ele chega
    // corrompido da Payt (valores como "FBjLj6a5696504d5dca326db9199b"), enquanto o
    // ad_id sobrevive intacto.
    const porSegmento = (q: any, prefixo = "") => {
      const col = `${prefixo}ad_id_meta`;
      if (segmento === "trafego") return q.not(col, "is", null);
      if (segmento === "backend") return q.is(col, null);
      return q;
    };

    // Faturamento
    let q1 = supabase.from("vw_faturamento_liquido").select("*");
    if (startDateStr && endDateStr) q1 = q1.gte("data", startDateStr).lte("data", endDateStr);
    if (funilId) q1 = q1.eq("funil_id", funilId);

    // OBs (via venda_itens com join para filtrar por data)
    let q2 = supabase
      .from("venda_itens")
      .select("code_payt,tipo,nome,valor,converteu,venda_id,vendas!inner(data_venda,produto,status,ad_id_meta)")
      .eq("converteu", true)
      .eq("vendas.status", "aprovada");
    q2 = porSegmento(q2, "vendas.");
    if (inicio && fim) q2 = q2.gte("vendas.data_venda", inicio).lte("vendas.data_venda", fim);
    if (funilId) q2 = q2.eq("vendas.funil_id", funilId);

    // Upsells (são vendas separadas com is_upsell = true)
    // + buscar nomes reais de upsells da tabela ofertas para filtrar
    let qUp = supabase
      .from("vendas")
      .select("id,pedido_id,produto,produto_nome,valor_total,valor_oferta_principal,data_venda")
      .eq("status", "aprovada")
      .eq("is_upsell", true)
      .not("pedido_id", "like", "TEST%")
      .not("pedido_id", "like", "LC-%");
    qUp = porSegmento(qUp);
    if (inicio && fim) qUp = qUp.gte("data_venda", inicio).lte("data_venda", fim);
    if (funilId) qUp = qUp.eq("funil_id", funilId);

    // Vendas aprovadas (para contagem e ticket)
    let q4 = supabase
      .from("vendas")
      .select("valor_total,valor_sem_juros,juros_parcelamento,valor_oferta_principal,produto,produto_nome,data_venda,ad_id_meta,taxa_plataforma_valor,is_upsell,link_titulo")
      .eq("status", "aprovada")
      .not("pedido_id", "like", "TEST%")
      .not("pedido_id", "like", "LC-%");
    q4 = porSegmento(q4);
    if (inicio && fim) q4 = q4.gte("data_venda", inicio).lte("data_venda", fim);
    if (funilId) q4 = q4.eq("funil_id", funilId);

    // Vendas pendentes + canceladas + expiradas (TODOS os não aprovados)
    let q5 = supabase
      .from("vendas")
      .select("valor_total,status")
      .in("status", ["pendente", "cancelada", "expirada"])
      .not("pedido_id", "like", "TEST%")
      .not("pedido_id", "like", "LC-%");
    q5 = porSegmento(q5);
    if (inicio && fim) q5 = q5.gte("data_venda", inicio).lte("data_venda", fim);
    if (funilId) q5 = q5.eq("funil_id", funilId);

    // Reembolsos e chargebacks. Antes vinham de `vw_reembolsos`, que agrega a tabela
    // inteira sem recorte de data — os cards mostravam o total histórico ao lado de
    // "Não aprovadas", que respeita o período. Agora saem de `vendas`, no mesmo filtro.
    let q6 = supabase
      .from("vendas")
      .select("valor_total,valor_reembolsado,status")
      .in("status", ["reembolsada", "chargeback"])
      .not("pedido_id", "like", "TEST%")
      .not("pedido_id", "like", "LC-%");
    q6 = porSegmento(q6);
    if (inicio && fim) q6 = q6.gte("data_venda", inicio).lte("data_venda", fim);
    if (funilId) q6 = q6.eq("funil_id", funilId);

    // Produtos — será calculado a partir de vendasRows (q4)

    // Vendas back-end = sem ad_id do Meta. Antes usava `utm_source is null`, o que
    // classificava errado: o utm_source chega corrompido e nem sempre nulo.
    let q8 = supabase
      .from("vendas")
      .select("valor_total,produto")
      .eq("status", "aprovada")
      .is("ad_id_meta", null)
      .not("pedido_id", "like", "TEST%")
      .not("pedido_id", "like", "LC-%");
    if (inicio && fim) q8 = q8.gte("data_venda", inicio).lte("data_venda", fim);
    if (funilId) q8 = q8.eq("funil_id", funilId);

    // Período anterior
    const ant = periodoAnt(startDateStr, endDateStr);
    let qA1 = supabase.from("vw_faturamento_liquido").select("faturamento_bruto,investimento_meta");
    if (ant.start && ant.end) qA1 = qA1.gte("data", ant.start).lte("data", ant.end);
    if (funilId) qA1 = qA1.eq("funil_id", funilId);

    let qA2 = supabase
      .from("vendas")
      .select("id")
      .eq("status", "aprovada")
      .not("pedido_id", "like", "TEST%")
      .not("pedido_id", "like", "LC-%");
    if (ant.start && ant.end) qA2 = qA2.gte("data_venda", inicioDiaBRT(ant.start)).lte("data_venda", fimDiaBRT(ant.end));
    if (funilId) qA2 = qA2.eq("funil_id", funilId);

    const [r1, r2, rUp, r4, r5, r6, r8, rA1, rA2] = await Promise.all([q1, q2, qUp, q4, q5, q6, q8, qA1, qA2]);

    const fatRows = r1.data || [];
    const vendasRows = r4.data || [];

    // O faturamento vem de `vendas` (e não da view) porque a view agrega por dia/produto
    // e não sabe distinguir tráfego de back-end. Calculando das vendas, Misto fecha
    // exatamente como Tráfego + Back-end.
    // `fatBruto` é o que o cliente pagou. Os juros de parcelamento saem antes do resto:
    // quem paga é o cliente e quem recebe é a adquirente — nunca foi dinheiro da casa.
    // Contá-los como receita inflaria ticket médio, margem e ROAS de uma vez só.
    const fatBruto = vendasRows.reduce((s: number, r: any) => s + Number(r.valor_total || 0), 0);
    const juros = vendasRows.reduce((s: number, r: any) => s + Number(r.juros_parcelamento || 0), 0);
    const receita = vendasRows.reduce(
      (s: number, r: any) => s + Number(r.valor_sem_juros ?? r.valor_total ?? 0), 0);

    // Custos e impostos só existem no total; são rateados pela participação do segmento
    // no faturamento. O investimento em ads é a exceção: pertence 100% ao tráfego pago.
    const fatTotalPeriodo = fatRows.reduce((s: number, r: any) => s + Number(r.faturamento_bruto || 0), 0);
    const share = fatTotalPeriodo > 0 ? Math.min(fatBruto / fatTotalPeriodo, 1) : (fatBruto > 0 ? 1 : 0);

    // Taxa vem das próprias vendas, não da view: a view agrupa pelo dia em UTC e
    // divergiria do faturamento, que já respeita o limite do dia em BRT.
    const taxaPlat = vendasRows.reduce((s: number, r: any) => s + Number(r.taxa_plataforma_valor || 0), 0);
    // Percentual sobre a receita, não sobre o pago: senão o juro de parcelamento
    // faria a taxa parecer maior do que a Payt cobra.
    const taxaPlatPct = receita > 0 ? (taxaPlat / receita) * 100 : 0;
    const reembolsosV = fatRows.reduce((s: number, r: any) => s + Number(r.reembolsos || 0), 0) * share;
    const impSimples = fatRows.reduce((s: number, r: any) => s + Number(r.imposto_simples || 0), 0) * share;
    const impMeta = fatRows.reduce((s: number, r: any) => s + Number(r.imposto_meta_ads || 0), 0) * share;
    const investimentoTotal = fatRows.reduce((s: number, r: any) => s + Number(r.investimento_meta || 0), 0);
    const investimento = segmento === "backend" ? 0 : investimentoTotal;
    const simplesPct = fatRows.length > 0 ? Number(fatRows[0].simples_pct || 0) : 0;
    const metaPct = fatRows.length > 0 ? Number(fatRows[0].meta_pct || 0) : 0;
    const custoMensal = fatRows.length > 0 ? Number(fatRows[0].custo_fixo || 0) : 0;
    const custoFixo = custoFixoProp(custoMensal, startDateStr, endDateStr) * share;
    // Tudo a partir de `receita` (sem juros), não do pago pelo cliente.
    const fatLiquido = receita - taxaPlat - impSimples;
    const lucro = receita - taxaPlat - reembolsosV - impSimples - impMeta - investimento;
    const lucroCC = lucro - custoFixo;
    const margemPct = receita > 0 ? (lucro / receita) * 100 : 0;
    const margemCcPct = receita > 0 ? (lucroCC / receita) * 100 : 0;
    const roas = investimento > 0 ? receita / investimento : 0;
    // Vendas aprovadas = apenas produtos principais (valor_oferta_principal > 0)
    const vendasPrincipal = vendasRows.filter((r: any) => Number(r.valor_oferta_principal || 0) > 0);
    const qtdAprov = vendasPrincipal.length;
    const ticketMedio = qtdAprov > 0 ? receita / qtdAprov : 0;

    // Pendentes/canceladas/expiradas
    const naoAprov = r5.data || [];
    const pendentes = naoAprov.filter((r: any) => r.status === "pendente");
    const canceladas = naoAprov.filter((r: any) => r.status === "cancelada");
    const expiradas = naoAprov.filter((r: any) => r.status === "expirada");
    const pendVal = pendentes.reduce((s: number, r: any) => s + Number(r.valor_total || 0), 0);
    const cancelVal = canceladas.reduce((s: number, r: any) => s + Number(r.valor_total || 0), 0);
    const expVal = expiradas.reduce((s: number, r: any) => s + Number(r.valor_total || 0), 0);

    // OBs: todos os venda_itens convertidos (já filtrados por data/produto/aprovada)
    const allItems = r2.data || [];
    const obMap = new Map<string, { nome_ob: string; tipo_ob: string; total_convertidos: number; receita_total_ob: number; vendas_com_ob: Set<string> }>();
    for (const item of allItems) {
      const ex = obMap.get(item.code_payt) || { nome_ob: item.nome, tipo_ob: item.tipo, total_convertidos: 0, receita_total_ob: 0, vendas_com_ob: new Set<string>() };
      ex.total_convertidos += 1;
      ex.receita_total_ob += Number(item.valor || 0);
      ex.vendas_com_ob.add(item.venda_id);
      obMap.set(item.code_payt, ex);
    }
    const obsRows = [...obMap.values()].map(o => ({
      ...o,
      vendas_com_ob: o.vendas_com_ob.size,
      taxa_conversao_pct: qtdAprov > 0 ? (o.vendas_com_ob.size / qtdAprov) * 100 : 0,
    })).sort((a, b) => b.taxa_conversao_pct - a.taxa_conversao_pct);
    const receitaOb = obsRows.reduce((s, r) => s + r.receita_total_ob, 0);
    const allObVendas = new Set(allItems.map((i: any) => i.venda_id)).size;
    const taxaOb = qtdAprov > 0 ? (allObVendas / qtdAprov) * 100 : 0;
    setObsData(obsRows);

    // Upsell é resolvido no banco (`is_upsell`): compra seguinte do mesmo cliente em
    // até 30 min, de produto diferente. Antes a tela cruzava ainda com os nomes
    // cadastrados em `ofertas` como tipo='upsell' — e como o upsell muda a cada funil
    // e a cada teste, esse cadastro nunca acompanha e a lista aparecia sempre vazia.
    const upVendas = rUp.data || [];
    const upGrouped = new Map<string, { nome_upsell: string; total_upsells: number; receita_total: number }>();
    for (const v of upVendas) {
      const nome = v.produto_nome || `Upsell ${v.produto ?? ""}`.trim();
      const key = nome;
      const ex = upGrouped.get(key) || { nome_upsell: nome, total_upsells: 0, receita_total: 0 };
      ex.total_upsells += 1;
      ex.receita_total += Number(v.valor_total || 0);
      upGrouped.set(key, ex);
    }
    const upsRows = [...upGrouped.values()].sort((a, b) => b.total_upsells - a.total_upsells);
    const receitaUp = upsRows.reduce((s, r) => s + r.receita_total, 0);
    const taxaUp = qtdAprov > 0 ? (upVendas.length / qtdAprov) * 100 : 0;
    setUpsellData(upsRows.map(u => ({ ...u, taxa_conversao_pct: qtdAprov > 0 ? (u.total_upsells / qtdAprov) * 100 : 0 })));

    // Vendas backend (sem tráfego pago)
    const backendRows = r8.data || [];
    const qtdBackend = backendRows.length;
    const valBackend = backendRows.reduce((s: number, r: any) => s + Number(r.valor_total || 0), 0);
    const pctBackend = qtdAprov > 0 ? (qtdBackend / qtdAprov) * 100 : 0;

    // Percentuais sobre a base do período: aprovadas + as próprias perdas.
    const perdas = r6.data || [];
    const reembolsadas = perdas.filter((r: any) => r.status === "reembolsada");
    const chargebacks = perdas.filter((r: any) => r.status === "chargeback");
    const valReemb = reembolsadas.reduce((s: number, r: any) => s + Number(r.valor_reembolsado ?? r.valor_total ?? 0), 0);
    const valCb = chargebacks.reduce((s: number, r: any) => s + Number(r.valor_total || 0), 0);
    const baseReemb = qtdAprov + reembolsadas.length;
    const baseCb = qtdAprov + reembolsadas.length + chargebacks.length;
    setRemData({
      qtd_reembolsos: reembolsadas.length,
      valor_reembolsos: valReemb,
      pct_reembolsos: baseReemb > 0 ? (reembolsadas.length / baseReemb) * 100 : 0,
      qtd_chargeback: chargebacks.length,
      valor_chargeback: valCb,
      pct_chargeback: baseCb > 0 ? (chargebacks.length / baseCb) * 100 : 0,
    });
    // Compute prodData from vendasRows (already filtered by date/product)
    // Agrupa pelo nome real vindo da Payt. `produto` é o enum de categoria — só
    // 6 valores — e não distingue "Curso Saponaria Brasil" de "Arte Floral em Sabonetes".
    const prodMap = new Map<string, { produto: string; categoria: string; vendas_aprovadas: number; faturamento_principal: number; faturamento_total: number }>();
    // Upsell fica de fora: tem painel próprio em Monetização, e listá-lo aqui
    // contava a mesma venda duas vezes.
    for (const v of vendasPrincipal.filter((r: any) => !r.is_upsell)) {
      const p = v.produto_nome || v.produto || "Sem produto";
      const existing = prodMap.get(p) || { produto: p, categoria: v.produto || "", vendas_aprovadas: 0, faturamento_principal: 0, faturamento_total: 0 };
      existing.vendas_aprovadas += 1;
      existing.faturamento_principal += Number(v.valor_oferta_principal || 0);
      // sem juros, para o TM refletir o preco e nao o custo do parcelamento
      existing.faturamento_total += Number(v.valor_sem_juros ?? v.valor_total ?? 0);
      prodMap.set(p, existing);
    }
    const computedProdData = [...prodMap.values()].map(p => ({
      ...p,
      ticket_medio: p.vendas_aprovadas > 0 ? p.faturamento_total / p.vendas_aprovadas : 0,
    }));
    setProdData(computedProdData.sort((a, b) => b.vendas_aprovadas - a.vendas_aprovadas));

    // Série diária para o gráfico. O dia é calculado em BRT — a Payt entrega paid_at
    // em horário de Brasília e ~5% das vendas caem entre 21h e 23h59, que em UTC
    // seriam contadas no dia seguinte.
    const diaMap = new Map<string, { dia: string; faturamento: number; vendas: number }>();
    for (const v of vendasPrincipal) {
      if (!v.data_venda) continue;
      const dia = diaBRT(v.data_venda);
      const ex = diaMap.get(dia) || { dia, faturamento: 0, vendas: 0 };
      ex.faturamento += Number(v.valor_sem_juros ?? v.valor_total ?? 0);
      ex.vendas += 1;
      diaMap.set(dia, ex);
    }
    const investimentoDia = investimento > 0 && diaMap.size > 0 ? investimento / diaMap.size : 0;
    setSerieDiaria(
      [...diaMap.values()]
        .sort((a, b) => a.dia.localeCompare(b.dia))
        .map(d => ({
          ...d,
          rotulo: format(parseISO(d.dia), "dd/MM"),
          investimento: investimentoDia,
          lucro: d.faturamento * (fatBruto > 0 ? lucro / fatBruto : 0),
        })),
    );

    // Receita por link de checkout, com quanto de cada um chega rastreado.
    // Serve para achar o link que precisa de UTM: hoje 41,5% da receita vem de links
    // com 0% de atribuição e cai inteira em "back-end" sem ser back-end de verdade.
    const linkMap = new Map<string, { link: string; vendas: number; rastreadas: number; valor: number }>();
    for (const v of vendasPrincipal) {
      const nome = v.link_titulo || "(sem link identificado)";
      const ex = linkMap.get(nome) || { link: nome, vendas: 0, rastreadas: 0, valor: 0 };
      ex.vendas += 1;
      if (v.ad_id_meta) ex.rastreadas += 1;
      ex.valor += Number(v.valor_sem_juros ?? v.valor_total ?? 0);
      linkMap.set(nome, ex);
    }
    setLinkData(
      [...linkMap.values()]
        .map(l => ({ ...l, pct_rastreado: l.vendas > 0 ? (l.rastreadas / l.vendas) * 100 : 0 }))
        .sort((a, b) => b.valor - a.valor),
    );

    const cpa = investimento > 0 && qtdAprov > 0 ? investimento / qtdAprov : 0;

    setKpis({
      cpa,
      juros,
      receita,
      fatBruto,
      fatLiquido,
      lucro,
      lucroCC,
      taxaPlat,
      taxaPlatPct,
      reembolsosV,
      impSimples,
      impMeta,
      investimento,
      custoFixo,
      custoMensal,
      margemPct,
      margemCcPct,
      roas,
      simplesPct,
      metaPct,
      qtdAprov,
      ticketMedio,
      taxaOb,
      taxaUp,
      receitaOb,
      receitaUp,
      qtdBackend,
      valBackend,
      pctBackend,
      qtdPend: pendentes.length,
      pendVal,
      qtdCanc: canceladas.length,
      cancelVal,
      qtdExp: expiradas.length,
      expVal,
    });

    // Período anterior
    const antFat = (rA1.data || []).reduce((s: number, r: any) => s + Number(r.faturamento_bruto || 0), 0);
    const antInv = (rA1.data || []).reduce((s: number, r: any) => s + Number(r.investimento_meta || 0), 0);
    const antQtd = (rA2.data || []).length;
    setKpisAnt({
      fatBruto: antFat,
      qtdAprov: antQtd,
      ticketMedio: antQtd > 0 ? antFat / antQtd : 0,
      roas: antInv > 0 ? antFat / antInv : 0,
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

              {/* A margem operacional diz se o funil se paga; esta diz se a empresa se
                  paga. Mostrar só a primeira dava a entender que o dia foi bem melhor
                  do que foi — hoje são 23,6% contra 9,3%. */}
              {(kpis.custoFixo || 0) > 0 && (
                <div className="mt-3 border-t border-border/60 pt-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs text-muted-foreground">Depois do custo fixo</span>
                    <span
                      className={cn(
                        "text-lg font-bold tabular-nums",
                        (kpis.lucroCC || 0) >= 0 ? "text-success" : "text-destructive",
                      )}
                    >
                      {formatCurrency(kpis.lucroCC || 0)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span className={cn("rounded bg-secondary px-2 py-0.5 font-semibold", margemCcCor)}>
                      margem {formatPercent(kpis.margemCcPct || 0)}
                    </span>
                    <span className="text-muted-foreground">
                      inclui {formatCurrency(kpis.custoFixo || 0)} de custo fixo
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
