import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useFilters } from "@/contexts/FilterContext";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
} from "recharts";

const statusStyles: Record<string, string> = {
  aprovada: "bg-success/20 text-success border-success/30",
  pendente: "bg-warning/20 text-warning border-warning/30",
  cancelada: "bg-muted text-muted-foreground border-border",
  expirada: "bg-muted text-muted-foreground border-border",
  reembolsada: "bg-destructive/20 text-destructive border-destructive/30",
  reembolso_parcial: "bg-destructive/20 text-destructive border-destructive/30",
  chargeback: "bg-destructive/20 text-destructive border-destructive/30",
};

const COLORS = ["hsl(239,84%,67%)", "hsl(160,60%,45%)", "hsl(38,92%,50%)", "hsl(0,72%,51%)", "hsl(280,65%,60%)"];

/*
  O balão do gráfico.

  `itemStyle` é o que faltava: o `color` do `contentStyle` não alcança as
  linhas de valor — o recharts pinta cada uma com a cor da própria série. Num
  balão de fundo quase preto, isso deixava o número em roxo-escuro sobre preto,
  praticamente ilegível.

  Cores fixas e não tokens porque o balão é desenhado com estilo inline pelo
  recharts, fora do alcance das classes do Tailwind.
*/
const chartTooltip = {
  contentStyle: {
    backgroundColor: "hsl(0,0%,10%)",
    border: "1px solid hsl(0,0%,16%)",
    borderRadius: "8px",
    color: "#fff",
  },
  labelStyle: { color: "#aaa" },
  itemStyle: { color: "#fff" },
};

const paymentLabels: Record<string, string> = {
  pix: "Pix",
  cartao_credito: "Cartão de Crédito",
  boleto: "Boleto",
  desconhecido: "Desconhecido",
};

/*
  As formas dos dados desta tela.

  Estavam todas como `any` — 31 dos 204 erros de lint do projeto moravam neste
  arquivo. `any` aqui não era preguiça: o cliente do Supabase é criado sem os
  tipos do banco, então todo `select` volta solto e cada tela inventa o próprio
  jeito de lidar com isso.

  Enquanto o cliente não for tipado, o remendo honesto é este: declarar a forma
  ao lado de quem usa, copiada das colunas REAIS das views — conferidas no
  `information_schema`, não adivinhadas. Tipo inventado é pior que `any`,
  porque cala uma verificação em vez de só não fazê-la.

  Os números vêm do Postgres como `numeric`/`bigint`, e o supabase-js entrega
  `number`. Onde o código faz `Number(x || 0)` é porque nulo acontece — está
  marcado com `| null`.
*/

/** Uma venda, com o cliente embutido pelo `select`. */
type Venda = {
  id: string;
  pedido_id: string | null;
  data_venda: string;
  /*
    `produto` é a CATEGORIA (6 valores: velas, saponaria, cosmeticos...) e
    `produto_nome` é o produto mesmo (46 valores). A lista mostra o nome, com a
    categoria embaixo — dizer só "velas" na linha de uma venda não identifica o
    que a pessoa comprou.
  */
  produto: string | null;
  produto_nome: string | null;
  valor_total: number | null;
  status: string;
  meio_pagamento: string | null;
  utm_source: string | null;
  utm_placement: string | null;
  is_upsell: boolean | null;
  clientes: { nome: string | null; email: string | null; telefone: string | null } | null;
};

/** Linha de `venda_itens` — o que aparece no detalhe da venda. */
type ItemDaVenda = { id: string; nome: string | null; valor: number | null };

/** Um dia da série, com o rótulo que a tela acrescenta. */
type PontoTemporal = {
  data: string;
  vendas_aprovadas: number | null;
  vendas_pendentes: number | null;
  faturamento: number | null;
  dataLabel: string;
};

/** O que o gráfico de pizza por produto consome. */
type FatiaPorProduto = { name: string; value: number };

/** Por meio de pagamento, com taxa e ticket refeitos sobre os totais. */
type PorPagamento = {
  meio_pagamento: string;
  aprovadas: number;
  faturamento: number;
  total_tentativas: number;
  canceladas: number;
  expiradas: number;
  taxa_aprovacao_pct: string;
  ticket_medio: number;
};

/**
 * Por hora do dia, em horário de Brasília.
 *
 * A taxa voltou. Ela tinha saído porque recusa não trazia horário — e não
 * trazia por defeito nosso: a Payt sempre mandou `started_at` no payload, e a
 * normalização nunca olhou. Corrigido e feito o backfill, de junho em diante
 * nenhuma linha fica sem hora e a taxa por hora é fiel ao mês.
 *
 * Antes de maio não há payload para recuperar, então lá ela continua sem base
 * — e é por isso que a coluna só aparece quando o período está inteiro.
 */
type PorHora = {
  hora: number; vendas_aprovadas: number; vendas_pendentes: number;
  faturamento: number; base_taxa: number; taxa_aprovacao_pct: number;
};

/** Por dia da semana. */
type PorDiaDaSemana = {
  dia_semana: number;
  dia_nome: string;
  vendas_aprovadas: number;
  faturamento: number;
};

/** Por mês. */
type PorMes = { mes_ano: string; vendas_aprovadas: number; faturamento: number };

/*
  O que `fn_vendas_agregado` devolve, recorte por recorte.

  Sao as formas CRUAS, antes das contas da tela: a taxa de aprovacao e o ticket
  medio nao vem do banco de proposito -- somar taxa de produto com taxa de
  produto e tirar media daria peso igual a um produto com 3 vendas e a outro
  com 300. Eles se refazem aqui embaixo, sobre os totais.
*/
type BrutoTemporal   = { data: string; vendas_aprovadas: number; vendas_pendentes: number; faturamento: number };
type BrutoPagamento  = { meio_pagamento: string; total_tentativas: number; aprovadas: number;
                         canceladas: number; expiradas: number; faturamento: number };
type BrutoHora       = { hora: number; vendas_aprovadas: number; vendas_pendentes: number;
                         base_taxa: number; faturamento: number };
type BrutoDiaSemana  = { dia_semana: number; dia_nome: string; vendas_aprovadas: number; faturamento: number };
type BrutoMes        = { mes_ano: string; vendas_aprovadas: number; faturamento: number };

/**
 * Os totais do período, para a linha de KPI.
 *
 * Vinham só números crus: ticket médio e taxa de aprovação se fazem aqui, a
 * mesma regra do resto do arquivo — razão de dia não soma com razão de dia.
 *
 * `upsell_*` vem em campo separado porque todo recorte desta tela exclui
 * upsell (senão a mesma pessoa entraria duas vezes), e isso apagava
 * R$ 14.954,85 de agosto sem uma palavra na tela.
 */
type ResumoVendas = {
  faturamento: number;
  aprovadas: number;
  tentativas: number;
  upsell_aprovadas: number;
  upsell_faturamento: number;
};

/** Uma linha da aba "Quando", já normalizada pelos quatro zooms. */
type LinhaQuando = {
  rotulo: string;
  vendas: number;
  faturamento: number;
  /** Só o zoom por hora tem taxa, e só quando o período inteiro tem horário. */
  taxa?: number;
};

/**
 * O resumo da SELEÇÃO da lista — o filtro de status e a busca já aplicados.
 *
 * É outra pergunta que a faixa do topo: lá é o período inteiro, aqui é
 * "e disto que estou vendo, quanto é?". Vem do banco porque a tela tem 50
 * linhas na mão e a seleção pode ter 2.449 — somar a página daria um número
 * que muda ao virar a página.
 *
 * `base_periodo` é o denominador do "% do período" e vem da mesma função, com
 * a mesma regra de quais vendas contam. O `resumo` dos agregados não serve:
 * ele exclui upsell e a lista não.
 */
type ResumoDaLista = { quantidade: number; valor: number; base_periodo: number };

/** O que `fn_vendas_lista` devolve. */
type BrutoLista = { total: number; resumo: ResumoDaLista; linhas: Venda[] };

const PAGE_SIZE = 50;

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-08" → "ago/26". Sem `new Date`, que na virada do fuso volta um mês. */
function rotuloDoMes(mesAno: string) {
  const [ano, mes] = (mesAno || "").split("-");
  const nome = MESES[Number(mes) - 1];
  return nome && ano ? `${nome}/${ano.slice(2)}` : mesAno;
}

const RESUMO_VAZIO: ResumoVendas = {
  faturamento: 0, aprovadas: 0, tentativas: 0, upsell_aprovadas: 0, upsell_faturamento: 0,
};

const RESUMO_LISTA_VAZIO: ResumoDaLista = { quantidade: 0, valor: 0, base_periodo: 0 };

export default function SalesPage() {
  const { startDateStr, endDateStr, startISO, endISO, contaIds } = useFilters();
  const [salesData, setSalesData] = useState<Venda[]>([]);
  const [salesTotal, setSalesTotal] = useState(0);
  const [salesPage, setSalesPage] = useState(0);
  const [temporal, setTemporal] = useState<PontoTemporal[]>([]);
  const [byProduct, setByProduct] = useState<FatiaPorProduto[]>([]);
  const [paymentData, setPaymentData] = useState<PorPagamento[]>([]);
  const [hourlyData, setHourlyData] = useState<PorHora[]>([]);
  const [weekData, setWeekData] = useState<PorDiaDaSemana[]>([]);
  const [monthData, setMonthData] = useState<PorMes[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSales, setLoadingSales] = useState(false);
  const [selectedSale, setSelectedSale] = useState<Venda | null>(null);
  const [saleItems, setSaleItems] = useState<ItemDaVenda[]>([]);
  const [statusFilter, setStatusFilter] = useState("todos");
  const [resumo, setResumo] = useState<ResumoVendas>(RESUMO_VAZIO);
  const [resumoLista, setResumoLista] = useState<ResumoDaLista>(RESUMO_LISTA_VAZIO);
  /*
    Os status possíveis, vindos do enum `status_venda` pelo banco.

    A lista estava escrita aqui dentro com 5 valores e o enum tem 7:
    `chargeback` (12 vendas) e `reembolso_parcial` não tinham botão, e essas
    vendas eram inalcançáveis pela tela. Lista fixa no código que envelhece em
    silêncio é a armadilha 3 da CLAUDE.md; a correção é derivar do banco.
  */
  const [statusPossiveis, setStatusPossiveis] = useState<string[]>([]);
  /*
    A busca da lista, e a versão adiada que de fato vai ao banco.

    Sem adiar, cada tecla viraria uma consulta. 350ms é o tempo entre teclas de
    quem digita corrido — o suficiente para uma palavra inteira virar uma
    chamada só.
  */
  const [busca, setBusca] = useState("");
  const [buscaAdiada, setBuscaAdiada] = useState("");
  const [zoom, setZoom] = useState<"hora" | "semana" | "dia" | "mes">("dia");
  /*
    Vendas aprovadas sem hora registrada.

    Não é ruído: são 4.288 no histórico, todas da carga inicial, que só trouxe
    a data. O recorte por hora tem que deixá-las de fora — senão metade do
    histórico empilha na meia-noite e inventa um pico que nunca existiu —, mas
    a tela precisa dizer que deixou.
  */
  const [semRelogio, setSemRelogio] = useState(0);
  /*
    Linhas do período sem hora, de QUALQUER status.

    Decide se a taxa de aprovação por hora pode aparecer. Zero, aparece;
    qualquer coisa acima, some — taxa parcialmente cega é o tipo de número que
    parece certo e não é.
  */
  const [semRelogioTotal, setSemRelogioTotal] = useState(0);

  // Reset page when filters change
  useEffect(() => { setSalesPage(0); }, [startDateStr, endDateStr, contaIds, statusFilter]);

  // A busca só vai ao banco quando a digitação para.
  useEffect(() => {
    const id = setTimeout(() => setBuscaAdiada(busca.trim()), 350);
    return () => clearTimeout(id);
  }, [busca]);

  useEffect(() => { setSalesPage(0); }, [buscaAdiada]);

  /*
    A lista de vendas, agora com busca — e vinda do banco inteira.

    Não havia como procurar uma venda: 50 por página, 48 páginas só em agosto,
    e a única ordem era a data. Achar um pedido pelo código, pelo nome ou pelo
    e-mail era rolar até topar com ele.

    A busca precisa cruzar `vendas` e `clientes` (nome e e-mail moram lá), e o
    PostgREST não faz OR entre a tabela e a embutida numa consulta só. Daria
    para buscar os `cliente_id` antes e mandar a lista — e aí o corte de 1.000
    linhas do PostgREST voltaria a agir em silêncio, que é justamente o defeito
    que esta revisão passou desfazendo. Então a filtragem, a contagem e a
    paginação ficam em `fn_vendas_lista`.
  */
  useEffect(() => {
    const loadSales = async () => {
      setLoadingSales(true);
      const { data, error } = await supabase.rpc("fn_vendas_lista", {
        p_inicio: startISO || null,
        p_fim: endISO || null,
        p_contas: contaIds,
        p_status: statusFilter,
        p_busca: buscaAdiada || null,
        p_pagina: salesPage,
        p_tamanho: PAGE_SIZE,
      });
      if (error) console.error("fn_vendas_lista:", error.message);
      const r = (data ?? {}) as Partial<BrutoLista>;
      setSalesData(r.linhas ?? []);
      setSalesTotal(Number(r.total ?? 0));
      setResumoLista({ ...RESUMO_LISTA_VAZIO, ...(r.resumo ?? {}) });
      setLoadingSales(false);
    };
    loadSales();
  }, [salesPage, startDateStr, endDateStr, contaIds, statusFilter, buscaAdiada, startISO, endISO]);


  useEffect(() => {
    const loadSales = async () => {
      setLoadingSales(true);
      const endDateEnd = endISO;
      const from = salesPage * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;

      let q = supabase
        .from("vendas")
        .select("*, clientes(nome, email, telefone)", { count: "exact" })
        .not("pedido_id", "like", "TEST%")
        .not("pedido_id", "like", "LC-%")
        .order("data_venda", { ascending: false })
        .range(from, to);
      if (startISO && endDateEnd) q = q.gte("data_venda", startISO).lte("data_venda", endDateEnd);
      if (contaIds.length) q = q.in("ad_account_id", contaIds);
      if (statusFilter !== "todos") q = q.eq("status", statusFilter);

      const { data, count } = await q;
      setSalesData(data ?? []);
      setSalesTotal(count ?? 0);
      setLoadingSales(false);
    };
    loadSales();
  }, [salesPage, startDateStr, endDateStr, contaIds, statusFilter]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      /*
        Uma chamada, e o filtro de período valendo para as seis abas.

        Quatro delas ignoravam o período — e não por descuido de quem escreveu
        a página: `vw_vendas_por_pagamento`, `_por_horario`, `_por_dia_semana`
        e `_por_mes` não TÊM coluna de data, agregam o histórico inteiro. Com
        "Hoje" selecionado (1 venda), a aba de horário mostrava 4.410 vendas e
        a de pagamento, 9.105. Sem nenhum sinal na tela.

        A aba de produtos tinha o outro defeito da casa: lia linhas cruas de
        `vendas` — 2.462 em agosto — e o PostgREST corta em 1.000.

        E as views discordavam entre si sobre o que é uma venda: três excluíam
        `LC-%` e duas não; quatro descontavam upsell pela heurística aposentada
        (`upsell_de`, 69 linhas) em vez do campo atual (`is_upsell`, 403). Eram
        358 upsells contados como venda normal aqui e em nenhuma outra tela.

        Agora a regra está escrita uma vez, dentro de `fn_vendas_agregado`.
      */
      const { data: agg, error } = await supabase.rpc("fn_vendas_agregado", {
        p_inicio: startISO || null,
        p_fim: endISO || null,
        p_contas: contaIds,
      });
      if (error) console.error("fn_vendas_agregado:", error.message);

      /*
        `unknown` e não `any`: cada recorte é lido logo abaixo com o tipo que
        a tela já declara, e o `unknown` obriga essa passagem a ser explícita.
        Com `any`, um campo renomeado no SQL viraria uma aba vazia em silêncio.
      */
      const dados = (agg ?? {}) as Record<string, unknown>;
      /** Cada recorte vem como lista; `lista` faz a leitura explicita uma vez. */
      const lista = <T,>(chave: string) => (dados[chave] ?? []) as T[];

      const rT   = { data: lista<BrutoTemporal>("temporal") };
      const rPay = { data: lista<BrutoPagamento>("por_pagamento") };
      const rH   = { data: lista<BrutoHora>("por_hora") };
      const rW   = { data: lista<BrutoDiaSemana>("por_dia_semana") };
      const rM   = { data: lista<BrutoMes>("por_mes") };
      setSemRelogio(Number(dados.horas_sem_relogio ?? 0));
      setSemRelogioTotal(Number(dados.sem_relogio_total ?? 0));
      setResumo({ ...RESUMO_VAZIO, ...((dados.resumo ?? {}) as Partial<ResumoVendas>) });
      setStatusPossiveis((dados.status_possiveis ?? []) as string[]);
      setByProduct(lista<FatiaPorProduto>("por_produto"));

      setTemporal(
        (rT.data ?? []).map((r): PontoTemporal => ({
          ...r,
          dataLabel: String(new Date(r.data + "T00:00:00").getDate()).padStart(2, "0"),
        })),
      );

      const payMap: Record<string, Omit<PorPagamento, 'taxa_aprovacao_pct' | 'ticket_medio'>> = {};
      (rPay.data ?? []).forEach((r) => {
        const k = r.meio_pagamento;
        if (!payMap[k])
          payMap[k] = {
            meio_pagamento: k,
            aprovadas: 0,
            faturamento: 0,
            total_tentativas: 0,
            canceladas: 0,
            expiradas: 0,
          };
        payMap[k].aprovadas += Number(r.aprovadas || 0);
        payMap[k].faturamento += Number(r.faturamento || 0);
        payMap[k].total_tentativas += Number(r.total_tentativas || 0);
        payMap[k].canceladas += Number(r.canceladas || 0);
        payMap[k].expiradas += Number(r.expiradas || 0);
      });
      // A taxa ja era recalculada aqui; o ticket medio nao vinha junto e a coluna
      // mostrava R$ 0,00 para todos os meios. Os dois saem dos totais somados.
      setPaymentData(
        Object.values(payMap).map((r): PorPagamento => ({
          ...r,
          taxa_aprovacao_pct: r.total_tentativas > 0 ? ((r.aprovadas / r.total_tentativas) * 100).toFixed(1) : "0.0",
          ticket_medio: r.aprovadas > 0 ? r.faturamento / r.aprovadas : 0,
        })),
      );

      // A view devolve uma linha por produto (e agora por conta), entao 24 horas viram
      setHourlyData(
        (rH.data ?? []).map((r): PorHora => {
          const base = Number(r.base_taxa || 0);
          const aprovadas = Number(r.vendas_aprovadas || 0);
          return {
            hora: Number(r.hora ?? 0),
            vendas_aprovadas: aprovadas,
            vendas_pendentes: Number(r.vendas_pendentes || 0),
            faturamento: Number(r.faturamento || 0),
            base_taxa: base,
            // A taxa sai dos totais da hora, e nao de media de taxas.
            taxa_aprovacao_pct: base > 0 ? Number(((aprovadas / base) * 100).toFixed(2)) : 0,
          };
        }),
      );

      const weekOrder = [1, 2, 3, 4, 5, 6, 0];
      const weekMap: Record<number, PorDiaDaSemana> = {};
      (rW.data ?? []).forEach((r) => {
        const d = r.dia_semana;
        if (!weekMap[d]) weekMap[d] = { dia_semana: d, dia_nome: r.dia_nome, vendas_aprovadas: 0, faturamento: 0 };
        weekMap[d].vendas_aprovadas += Number(r.vendas_aprovadas || 0);
        weekMap[d].faturamento += Number(r.faturamento || 0);
      });
      setWeekData(
        weekOrder.map(
          (d) =>
            weekMap[d] || {
              dia_semana: d,
              dia_nome: ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][d],
              vendas_aprovadas: 0,
              faturamento: 0,
            },
        ),
      );

      const monthMap: Record<string, PorMes> = {};
      (rM.data ?? []).forEach((r) => {
        const k = r.mes_ano;
        if (!monthMap[k]) monthMap[k] = { mes_ano: k, vendas_aprovadas: 0, faturamento: 0 };
        monthMap[k].vendas_aprovadas += Number(r.vendas_aprovadas || 0);
        monthMap[k].faturamento += Number(r.faturamento || 0);
      });
      setMonthData(Object.values(monthMap).sort((a, b) => a.mes_ano.localeCompare(b.mes_ano)));

      setLoading(false);
    };
    load();
  }, [startDateStr, endDateStr, contaIds, startISO, endISO]);

  const openDetail = async (sale: Venda) => {
    setSelectedSale(sale);
    const { data: items } = await supabase.from("venda_itens").select("*").eq("venda_id", sale.id);
    setSaleItems(items || []);
  };

  /*
    Os status vêm do enum `status_venda`, pelo banco.

    A lista estava escrita aqui com 5 valores, e o enum tem 7: `chargeback`
    (12 vendas) e `reembolso_parcial` não tinham botão, então essas vendas
    eram inalcançáveis pela tela.
  */
  const statuses = ["todos", ...statusPossiveis];
  const displayId = (sale: Venda) => (sale.pedido_id?.startsWith("LC-") ? "Carrinho Abandonado" : sale.pedido_id);
  const taxaBadge = (t: number) => (t > 70 ? "text-success" : t >= 50 ? "text-warning" : "text-destructive");

  /*
    A base do "% das vendas" é a soma da própria tabela, e não `resumo.aprovadas`.

    Os dois dão o mesmo número hoje (1.244 + 529 = 1.773), mas somando as
    linhas a coluna fecha em 100% por construção — se um dia um meio de
    pagamento ficar de fora de um dos dois lados, o percentual não passa a
    mentir em silêncio.
  */
  const aprovadasNoPeriodo = paymentData.reduce((s, r) => s + (r.aprovadas || 0), 0);

  // Ticket e taxa saem dos totais do período, não de média de médias.
  const ticketMedio = resumo.aprovadas > 0 ? resumo.faturamento / resumo.aprovadas : 0;
  const taxaPeriodo = resumo.tentativas > 0 ? (resumo.aprovadas / resumo.tentativas) * 100 : 0;

  /*
    "Quando" é uma aba só, com quatro zooms.

    Eram quatro abas irmãs — Horário, Dia da Sem., Por Data, Por Mês — que
    fazem a MESMA pergunta em granularidades diferentes: mesmo dado, mesmo
    eixo, mesmas colunas. Quatro abas para um assunto empurravam Produto e
    Pagamento para a ponta e faziam a tela parecer um cardápio de recortes em
    vez de uma resposta.

    As barras mostram faturamento nos quatro zooms — é o que torna os quatro
    comparáveis, e a contagem de vendas continua na tabela ao lado.
  */
  const zooms = [
    { valor: "hora",   rotulo: "Hora" },
    { valor: "semana", rotulo: "Dia da semana" },
    { valor: "dia",    rotulo: "Dia" },
    { valor: "mes",    rotulo: "Mês" },
  ] as const;

  const linhasQuando: LinhaQuando[] =
    zoom === "hora"
      ? hourlyData.map((r) => ({
          rotulo: `${r.hora}h`,
          vendas: r.vendas_aprovadas || 0,
          faturamento: r.faturamento || 0,
          taxa: semRelogioTotal === 0 ? r.taxa_aprovacao_pct : undefined,
        }))
      : zoom === "semana"
        ? weekData.map((r) => ({
            rotulo: r.dia_nome,
            vendas: r.vendas_aprovadas || 0,
            faturamento: r.faturamento || 0,
          }))
        : zoom === "dia"
          ? temporal.map((r) => ({
              rotulo: r.dataLabel,
              vendas: Number(r.vendas_aprovadas || 0),
              faturamento: Number(r.faturamento || 0),
            }))
          : monthData.map((r) => ({
              // "2026-08" é como o banco agrupa; "ago/26" é como se lê.
              rotulo: rotuloDoMes(r.mes_ano),
              vendas: r.vendas_aprovadas || 0,
              faturamento: r.faturamento || 0,
            }));

  // O pico é pelo faturamento, que é o que a barra desenha.
  const pico = linhasQuando.reduce<LinhaQuando | undefined>(
    (maior, r) => (maior && maior.faturamento >= r.faturamento ? maior : r),
    undefined,
  );
  const mostraTaxa = zoom === "hora" && semRelogioTotal === 0;
  /*
    O eixo em milhares só quando há milhares.

    Com "Hoje" selecionado o maior valor era R$ 104, e a régua fixa em "k"
    escrevia "R$0k" nas cinco marcas — um eixo inteiro dizendo zero ao lado de
    uma barra cheia.
  */
  const maiorFaturamento = linhasQuando.reduce((m, r) => Math.max(m, r.faturamento), 0);
  const rotuloEixo = (v: number) =>
    maiorFaturamento >= 10000
      ? `R$${(v / 1000).toFixed(0)}k`
      : maiorFaturamento >= 1000
        ? `R$${(v / 1000).toFixed(1)}k`
        : `R$${v.toFixed(0)}`;

  const abas = [
    { value: "quando", label: "Quando" },
    { value: "produto", label: "Produto" },
    { value: "pagamento", label: "Pagamento" },
  ];

  return (
    <DashboardLayout title="Vendas" hideTitle>
      {/*
        A linha de KPI, que não existia.

        Era a única tela de dados do projeto sem número no topo: para saber
        quanto vendeu no mês era preciso ler barras. O Resumo, o Meta Ads e o
        Financeiro todos abrem assim.
      */}
      {/*
        Uma faixa só, e não cinco cartões soltos.

        Com cinco cartões numa grade de dois em dois sobrava um cartão sozinho
        na última linha e um buraco do lado dele. Numa faixa única, o que sobra
        é espaço DENTRO do bloco, e não um cartão perdido — e os cinco números
        se leem como um conjunto, que é o que eles são.

        As divisórias são o fundo aparecendo pelo `gap-px`: assim elas se
        acertam sozinhas em qualquer número de colunas, sem borda que sobra na
        ponta. A célula vazia no fim existe para o buraco não virar um bloco da
        cor da borda; em `lg` os cinco cabem numa linha e ela some.
      */}
      <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 lg:grid-cols-5">
        <Kpi rotulo="Faturamento" valor={loading ? "—" : formatCurrency(resumo.faturamento)} />
        <Kpi rotulo="Vendas aprovadas" valor={loading ? "—" : formatNumber(resumo.aprovadas)} />
        <Kpi rotulo="Ticket médio" valor={loading ? "—" : formatCurrency(ticketMedio)} />
        <Kpi
          rotulo="Taxa de aprovação"
          valor={loading ? "—" : formatPercent(taxaPeriodo)}
          cor={loading ? undefined : taxaBadge(taxaPeriodo)}
          nota={loading ? undefined : `${formatNumber(resumo.tentativas)} tentativas`}
        />
        {/*
          Os upsells em separado, e dizendo que estão de fora.

          Todo recorte desta tela usa só vendas normais — e está certo, senão a
          mesma pessoa entraria duas vezes. Só que em agosto isso é
          R$ 14.954,85, 8,4% da receita, que a página omitia sem uma palavra.
        */}
        <Kpi
          rotulo="Upsells"
          valor={loading ? "—" : formatCurrency(resumo.upsell_faturamento)}
          nota={
            loading
              ? undefined
              : `${formatNumber(resumo.upsell_aprovadas)} vendas · fora dos gráficos`
          }
        />
        <div className="bg-card lg:hidden" />
      </div>

      <Tabs defaultValue="quando" className="space-y-4">
        <TabsList className="bg-secondary border border-border flex-wrap h-auto gap-1 p-1">
          {abas.map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs"
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── Quando ──────────────────────────────────────── */}
        <TabsContent value="quando">
          <div className="bg-card border border-border rounded-lg p-5 mb-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-medium text-muted-foreground">
                Faturamento por {zooms.find((z) => z.valor === zoom)?.rotulo.toLowerCase()}
                {pico && <span className="ml-2 text-primary">| Pico: {pico.rotulo}</span>}
              </h3>
              <div className="flex items-center gap-1 rounded-lg bg-secondary p-1">
                {zooms.map((z) => (
                  <button
                    key={z.valor}
                    onClick={() => setZoom(z.valor)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      zoom === z.valor
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {z.rotulo}
                  </button>
                ))}
              </div>
            </div>
            {/*
              O que ficou de fora, dito na tela.

              Venda sem hora registrada é descartada do zoom por hora — se não
              fosse, metade do histórico empilharia na meia-noite e o gráfico
              anunciaria um pico que nunca existiu. Mas descartar em silêncio é
              o defeito que esta revisão vem caçando: o número precisa aparecer.
            */}
            {zoom === "hora" && semRelogio > 0 && (
              <p className="mb-3 text-xs text-muted-foreground">
                {formatNumber(semRelogio)} venda(s) do período não entram aqui: vieram sem hora
                registrada, da carga inicial.
              </p>
            )}
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={linhasQuando}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,16%)" />
                <XAxis dataKey="rotulo" stroke="#555" tick={{ fontSize: 10 }} />
                <YAxis
                  stroke="#555"
                  tick={{ fontSize: 10 }}
                  tickFormatter={rotuloEixo}
                />
                <Tooltip
                  {...chartTooltip}
                  formatter={(v: number | string) => [formatCurrency(Number(v)), "Faturamento"]}
                />
                <Bar dataKey="faturamento" radius={[4, 4, 0, 0]}>
                  {linhasQuando.map((r, i) => (
                    <Cell
                      key={i}
                      fill={pico && r.rotulo === pico.rotulo ? "hsl(38,92%,50%)" : "hsl(239,84%,67%)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {/*
            A "Taxa aprov." só aparece no zoom por hora, e só com o período
            inteiro. Ela chegou a sair da tela: recusa não trazia horário, então
            a base ficava só com aprovadas e a taxa dava 96% a 100% em toda
            hora, sempre, contra 73%-75% reais do mês.

            A causa era nossa, não da Payt — o payload sempre trouxe
            `started_at` e a normalização nunca olhou. Corrigido e feito o
            backfill, de junho em diante nenhuma linha fica sem hora. Antes de
            maio não há payload para recuperar, e ali a taxa voltaria a mentir:
            por isso a coluna some inteira se qualquer linha do período estiver
            sem hora. Meia-taxa é pior que taxa nenhuma.
          */}
          <TableCard
            headers={
              mostraTaxa
                ? ["Período", "Vendas", "Faturamento", "Ticket médio", "Taxa aprov."]
                : ["Período", "Vendas", "Faturamento", "Ticket médio"]
            }
          >
            {linhasQuando.map((r, i) => (
              <tr
                key={i}
                className={cn(
                  "border-b border-border/50 hover:bg-secondary/50",
                  pico && r.rotulo === pico.rotulo && "bg-warning/10",
                )}
              >
                <td className="px-4 py-2 font-medium text-foreground">{r.rotulo}</td>
                <td className="px-4 py-2 tabular-nums text-foreground">{formatNumber(r.vendas)}</td>
                <td className="px-4 py-2 tabular-nums text-foreground">{formatCurrency(r.faturamento)}</td>
                <td className="px-4 py-2 tabular-nums text-foreground">
                  {r.vendas > 0 ? formatCurrency(r.faturamento / r.vendas) : "-"}
                </td>
                {mostraTaxa && (
                  <td className="px-4 py-2 tabular-nums text-foreground">{formatPercent(r.taxa || 0)}</td>
                )}
              </tr>
            ))}
            {linhasQuando.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  {loading ? "Carregando..." : "Sem vendas no período"}
                </td>
              </tr>
            )}
          </TableCard>
        </TabsContent>

        {/* ── Produto ──────────────────────────────────────── */}
        <TabsContent value="produto">
          <div className="bg-card border border-border rounded-lg p-5">
            {/*
              Rótulo dentro da pizza: não.

              Com sete fatias e três delas abaixo de 1%, os rótulos se
              empilhavam uns em cima dos outros ao lado do gráfico. A legenda ao
              lado já diz nome, valor e percentual, e ela cabe: a pizza vira só
              a proporção.
            */}
            <h3 className="text-sm font-medium text-muted-foreground mb-4">Faturamento por Produto</h3>
            {byProduct.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {loading ? "Carregando..." : "Sem vendas no período"}
              </p>
            ) : (
              <div className="flex flex-col lg:flex-row items-center gap-6">
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={byProduct} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={110}>
                      {byProduct.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      {...chartTooltip}
                      formatter={(v: number | string) => [formatCurrency(Number(v)), "Faturamento"]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2 w-full max-w-xs">
                  {byProduct.map((r, i) => {
                    const total = byProduct.reduce((s, x) => s + x.value, 0);
                    const pct = total > 0 ? (r.value / total) * 100 : 0;
                    return (
                      <div key={i} className="flex items-baseline justify-between gap-3">
                        <div className="flex min-w-0 items-baseline gap-2">
                          <span
                            className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: COLORS[i % COLORS.length] }}
                          />
                          {/* Sem `capitalize`: os nomes vêm da Payt já escritos como
                              a pessoa cadastrou, e a classe transformava
                              "Curso Saponaria Brasil" em algo que ninguém escreveu. */}
                          <span className="truncate text-sm text-foreground" title={r.name}>
                            {r.name}
                          </span>
                        </div>
                        <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">
                          {formatCurrency(r.value)}
                          <span className="ml-2 text-xs text-muted-foreground">{pct.toFixed(1)}%</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Pagamento ────────────────────────────────────── */}
        <TabsContent value="pagamento">
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {/*
                      Cinco colunas.

                      "Tentativas", "Aprovadas" e "Não aprovadas" saíram: eram
                      três contagens para sustentar um número que a coluna
                      "Taxa Aprov." já dá pronto. Elas não se perderam — estão
                      no `title` da taxa, que é onde alguém vai procurá-las se
                      duvidar do percentual.

                      No lugar entrou "% das vendas": de cada 100 compras do
                      período, quantas saíram por aquele meio.
                    */}
                    {[
                      "Meio",
                      "% das vendas",
                      "Faturamento",
                      "Taxa Aprov.",
                      "Ticket Médio",
                    ].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paymentData.map((r, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-secondary/50">
                      <td className="px-4 py-3 font-medium text-foreground">
                        {paymentLabels[r.meio_pagamento] || r.meio_pagamento}
                      </td>
                      <td
                        className="px-4 py-3 tabular-nums text-foreground"
                        title={`${formatNumber(r.aprovadas || 0)} de ${formatNumber(aprovadasNoPeriodo)} compras`}
                      >
                        {formatPercent(
                          aprovadasNoPeriodo > 0 ? ((r.aprovadas || 0) / aprovadasNoPeriodo) * 100 : 0,
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium tabular-nums text-foreground">
                        {formatCurrency(r.faturamento || 0)}
                      </td>
                      {/* As contagens que saíram da tabela vivem aqui: é a base da taxa. */}
                      <td
                        className={cn("px-4 py-3 font-medium tabular-nums", taxaBadge(Number(r.taxa_aprovacao_pct)))}
                        title={
                          `${formatNumber(r.aprovadas || 0)} aprovadas de ${formatNumber(r.total_tentativas || 0)} tentativas · ` +
                          `${r.canceladas || 0} cancelada(s), ${r.expiradas || 0} expirada(s)`
                        }
                      >
                        {Number(r.taxa_aprovacao_pct).toFixed(1)}%
                      </td>
                      <td className="px-4 py-3 tabular-nums text-foreground">{formatCurrency(r.ticket_medio || 0)}</td>
                    </tr>
                  ))}
                  {paymentData.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        {loading ? "Carregando..." : "Sem vendas no período"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/*
        A lista de vendas, fora das abas.

        Ela morava dentro da aba "Por Data", embaixo do gráfico de faturamento
        diário — a única aba que fazia duas coisas, e por isso a que parecia
        bagunçada. As abas são recortes de um mesmo número; a lista é outra
        tarefa: achar uma venda. Agora ela fica embaixo de todas, valendo para
        qualquer aba aberta.
      */}
      <div className="mt-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Sem a contagem repetida aqui: ela é o primeiro número da faixa
              logo abaixo dos filtros. */}
          <h3 className="text-sm font-medium text-foreground">Vendas do período</h3>
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por pedido, cliente, e-mail ou produto"
            className="h-9 w-full max-w-sm bg-secondary text-sm"
          />
        </div>

        <div className="flex w-fit flex-wrap items-center gap-1 rounded-lg bg-secondary p-1">
          {statuses.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                statusFilter === s
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s.replace("_", " ")}
            </button>
          ))}
        </div>

        {/*
          Os números da SELEÇÃO, logo abaixo do filtro que os produziu.

          A faixa do topo fala do período; esta fala do que está filtrado agora
          — e é o que dá sentido a filtrar. "Expirada" sozinho é uma contagem;
          "446 vendas, R$ 47.678,44, 18,2% do período" é o dinheiro que ficou
          na mesa.

          Vem do banco junto com a lista: somar as 50 linhas da página daria um
          número que muda ao virar a página.
        */}
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">
            Vendas{" "}
            <b className="ml-1 font-semibold tabular-nums text-foreground">
              {formatNumber(resumoLista.quantidade)}
            </b>
            {resumoLista.base_periodo > 0 && resumoLista.quantidade !== resumoLista.base_periodo && (
              <span className="ml-2 text-xs">
                {" "}
                {formatPercent((resumoLista.quantidade / resumoLista.base_periodo) * 100)} do período
              </span>
            )}
          </span>
          <span className="text-muted-foreground">
            Valor{" "}
            <b className="ml-1 font-semibold tabular-nums text-foreground">
              {formatCurrency(resumoLista.valor)}
            </b>
          </span>
          <span className="text-muted-foreground">
            Ticket médio{" "}
            <b className="ml-1 font-semibold tabular-nums text-foreground">
              {formatCurrency(resumoLista.quantidade > 0 ? resumoLista.valor / resumoLista.quantidade : 0)}
            </b>
          </span>
          {/*
            O aviso de que esta faixa e a do topo não têm a mesma base.

            A do topo exclui upsell — senão a mesma pessoa entra duas vezes nos
            gráficos. A lista não exclui, porque quem procura um pedido quer
            achar o pedido. Sem esta linha, "1.836 aprovadas" aqui e "1.773" lá
            em cima seriam dois números certos parecendo um erro.
          */}
          {statusFilter === "aprovada" && !buscaAdiada && resumo.upsell_aprovadas > 0 && (
            <span className="text-xs text-muted-foreground">
              inclui {formatNumber(resumo.upsell_aprovadas)} upsell(s), que os gráficos deixam de fora
            </span>
          )}
        </div>

        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {loadingSales ? (
            <div className="p-8 text-center text-muted-foreground">Carregando...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {["Pedido", "Data", "Cliente", "Produto", "Status", "Total", "Pagamento", "UTM Source"].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {salesData.map((sale) => (
                    <tr
                      key={sale.id}
                      onClick={() => openDetail(sale)}
                      className="border-b border-border/50 hover:bg-secondary/50 cursor-pointer"
                    >
                      {/*
                        A coluna "Tipo" virou uma marca ao lado do pedido.

                        Ela dizia "Normal" em 96% das linhas — uma coluna
                        inteira de largura para repetir a mesma palavra e
                        destacar as 4% que importam. Etiqueta que quase nunca
                        muda não informa: informa a exceção.
                      */}
                      <td className="px-4 py-3 font-mono text-xs text-foreground whitespace-nowrap">
                        {displayId(sale)}
                        {sale.is_upsell && (
                          <span className="ml-2 rounded-full border border-yellow-500/30 bg-yellow-500/20 px-1.5 py-0.5 font-sans text-[10px] font-medium text-yellow-400">
                            upsell
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-foreground whitespace-nowrap">
                        {sale.data_venda ? format(new Date(sale.data_venda), "dd/MM/yy HH:mm") : "-"}
                      </td>
                      <td className="px-4 py-3 text-foreground">{sale.clientes?.nome || "-"}</td>
                      {/*
                        Largura travada e nome cortado: há produto com 46
                        caracteres ("Workshop Primeira Venda em 7 dias +
                        Comunidade 2.0") e sem o corte ele quebra em três linhas
                        e estica a linha inteira. O nome cheio fica no `title`
                        e no detalhe da venda.
                      */}
                      <td className="px-4 py-3 max-w-[220px]">
                        <div className="truncate text-foreground" title={sale.produto_nome?.trim() || undefined}>
                          {sale.produto_nome?.trim() || sale.produto || "-"}
                        </div>
                        {sale.produto_nome?.trim() && sale.produto && (
                          <div className="text-xs capitalize text-muted-foreground">{sale.produto}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap",
                            statusStyles[sale.status] || "bg-secondary text-muted-foreground border-border",
                          )}
                        >
                          {sale.status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium tabular-nums text-foreground">
                        {formatCurrency(sale.valor_total || 0)}
                      </td>
                      <td className="px-4 py-3 text-foreground capitalize">
                        {sale.meio_pagamento?.replace("_", " ") || "-"}
                      </td>
                      <td className="px-4 py-3 text-xs text-foreground">{sale.utm_source || "-"}</td>
                    </tr>
                  ))}
                  {salesData.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                        {buscaAdiada
                          ? `Nenhuma venda para "${buscaAdiada}" neste período.`
                          : "Nenhuma venda"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {salesTotal > PAGE_SIZE && (
          <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
            <span>
              {salesPage * PAGE_SIZE + 1}–{Math.min((salesPage + 1) * PAGE_SIZE, salesTotal)} de{" "}
              {salesTotal.toLocaleString("pt-BR")}
            </span>
            <div className="flex gap-1">
              <button
                disabled={salesPage === 0}
                onClick={() => setSalesPage((p) => p - 1)}
                className="px-3 py-1 rounded border border-border disabled:opacity-40 hover:bg-accent transition-colors"
              >
                ← Anterior
              </button>
              <button
                disabled={(salesPage + 1) * PAGE_SIZE >= salesTotal}
                onClick={() => setSalesPage((p) => p + 1)}
                className="px-3 py-1 rounded border border-border disabled:opacity-40 hover:bg-accent transition-colors"
              >
                Próxima →
              </button>
            </div>
          </div>
        )}
      </div>


      {/* Modal detalhe */}
      <Dialog open={!!selectedSale} onOpenChange={() => setSelectedSale(null)}>
        <DialogContent className="max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Detalhes da Venda</DialogTitle>
          </DialogHeader>
          {selectedSale && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Pedido:</span>{" "}
                  <span className="text-foreground ml-1">{displayId(selectedSale)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Tipo:</span>
                  {selectedSale.is_upsell ? (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                      Upsell
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-muted-foreground border border-border">
                      Normal
                    </span>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <span
                    className={cn(
                      "ml-1 px-2 py-0.5 rounded-full text-xs font-medium border",
                      statusStyles[selectedSale.status],
                    )}
                  >
                    {selectedSale.status}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Produto:</span>{" "}
                  <span className="text-foreground ml-1">
                    {selectedSale.produto_nome?.trim() || selectedSale.produto || "-"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Total:</span>{" "}
                  <span className="text-foreground ml-1 font-medium">
                    {formatCurrency(selectedSale.valor_total || 0)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Cliente:</span>{" "}
                  <span className="text-foreground ml-1">{selectedSale.clientes?.nome}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Email:</span>{" "}
                  <span className="text-foreground ml-1">{selectedSale.clientes?.email}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Pagamento:</span>{" "}
                  <span className="text-foreground ml-1 capitalize">
                    {selectedSale.meio_pagamento?.replace("_", " ") || "-"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Placement:</span>{" "}
                  <span className="text-foreground ml-1">{selectedSale.utm_placement || "-"}</span>
                </div>
              </div>
              {saleItems.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">Order Bumps</h4>
                  <div className="space-y-2">
                    {saleItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex justify-between items-center bg-secondary rounded-md px-3 py-2 text-sm"
                      >
                        <span className="text-foreground">{item.nome}</span>
                        <span className="text-foreground font-medium">{formatCurrency(item.valor || 0)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

/** Um número do topo: rótulo pequeno, valor grande, nota opcional embaixo. */
function Kpi({ rotulo, valor, nota, cor }: { rotulo: string; valor: string; nota?: string; cor?: string }) {
  return (
    <div className="flex flex-col justify-start bg-card px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className={cn("mt-1 text-lg font-semibold tabular-nums text-foreground", cor)}>{valor}</p>
      {/* Altura reservada mesmo sem nota: sem isso os cinco valores ficavam em
          linhas de base diferentes conforme o cartão tivesse ou não legenda. */}
      <p className="mt-0.5 min-h-[1rem] text-[11px] leading-4 text-muted-foreground">{nota ?? ""}</p>
    </div>
  );
}

function TableCard({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border overflow-hidden rounded-lg">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {headers.map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}
