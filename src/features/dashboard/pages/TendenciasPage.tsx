import { useEffect, useState, useCallback } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useFilters } from "@/contexts/FilterContext";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { TrendingUp, TrendingDown, Minus, AlertCircle, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Tendências por conta de anúncio.
 *
 * O ponto desta tela é o que ela **não** mostra. O ROAS diário destas contas oscila
 * entre 31% e 86% da própria média — a "Lembrancinha - TSL" vai de 0,53 a 3,43 em
 * torno de 1,69. Um painel que comparasse ontem com anteontem apontaria alta ou queda
 * todo dia e não significaria nada.
 *
 * Então a comparação é entre médias de janelas, e só vira "alta" ou "queda" o que
 * excede duas vezes o erro padrão da diferença. O resto é "estável" — que é uma
 * resposta, não uma ausência dela. A faixa de ruído aparece ao lado de cada variação
 * justamente para que "estável" seja verificável, e não uma afirmação a ser aceita.
 */

type Direcao = "alta" | "queda" | "estável" | "sem base";

interface Tendencia {
  conta_id: string;
  conta: string;
  produto: string | null;
  metrica: string;
  atual: number | null;
  anterior: number | null;
  variacao_pct: number | null;
  ruido_pct: number | null;
  direcao: Direcao;
  dias_atual: number;
  dias_anterior: number;
  /** Alvo da conta. Nulo quando não foi definido — a tela então não compara. */
  meta: number | null;
  /** `piso` quer ficar acima (ROAS), `teto` quer ficar abaixo (CPA). */
  meta_direcao: "piso" | "teto" | null;
}

/**
 * Como cada métrica se comporta e o que significa subir.
 *
 * `bom` diz se a alta é boa. Em CPA e investimento não é — pintar toda alta de verde
 * faria a cor mentir, que é o mesmo defeito de mostrar número truncado com cara de
 * número certo.
 */
type Formato = "moeda" | "numero" | "x" | "pct";

const METRICAS: Record<string, { formato: Formato; bomSubir: boolean | null; ajuda: string }> = {
  // Resultado
  ROAS:                    { formato: "x",      bomSubir: true,  ajuda: "Receita por real investido" },
  "Ticket médio":          { formato: "moeda",  bomSubir: true,  ajuda: "Receita por venda" },
  Receita:                 { formato: "moeda",  bomSubir: true,  ajuda: "Média por dia" },
  Vendas:                  { formato: "numero", bomSubir: true,  ajuda: "Média por dia" },
  Investimento:            { formato: "moeda",  bomSubir: null,  ajuda: "Gastar mais não é bom nem ruim — quem julga é o ROAS" },
  CPA:                     { formato: "moeda",  bomSubir: false, ajuda: "Custo por venda" },
  // Leilão
  CPM:                     { formato: "moeda",  bomSubir: false, ajuda: "Custo por mil impressões — o que o Meta cobra" },
  CPC:                     { formato: "moeda",  bomSubir: false, ajuda: "Custo por clique" },
  // Criativo
  CTR:                     { formato: "pct",    bomSubir: true,  ajuda: "Cliques por impressão" },
  "Hook (3s)":             { formato: "pct",    bomSubir: true,  ajuda: "Quem passa dos 3 segundos de vídeo" },
  // Funil
  "Conexão da página":     { formato: "pct",    bomSubir: true,  ajuda: "Cliques que viram visita — abaixo de 80% indica página lenta" },
  "Conversão do checkout": { formato: "pct",    bomSubir: true,  ajuda: "Checkouts iniciados que viram venda" },
};

/**
 * Agrupadas por etapa, porque é assim que se lê um funil quando algo piora: o
 * resultado diz *que* piorou, e as etapas dizem *onde*. ROAS caindo com hook e CTR
 * caindo junto é criativo cansado; com a conversão do checkout caindo é outra coisa.
 */
const GRUPOS: { titulo: string; metricas: string[] }[] = [
  { titulo: "Resultado", metricas: ["ROAS", "Ticket médio", "Receita", "Vendas", "Investimento", "CPA"] },
  { titulo: "Leilão",    metricas: ["CPM", "CPC"] },
  { titulo: "Criativo",  metricas: ["CTR", "Hook (3s)"] },
  { titulo: "Funil",     metricas: ["Conexão da página", "Conversão do checkout"] },
];

/**
 * Faixas de comparação. Cada uma devolve o período atual; a função no banco compara
 * com os mesmos dias imediatamente anteriores.
 */
type Faixa = {
  chave: string;
  rotulo: string;
  grupo: "periodo" | "hoje";
  periodo: (hoje: Date) => { ini: Date; fim: Date };
  /** Tamanho da janela de comparação. Ausente = espelha a janela atual. */
  diasBase?: number;
};

const dias = (n: number) => (hoje: Date) => ({
  ini: new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - n + 1),
  fim: hoje,
});

const soHoje = (h: Date) => ({ ini: h, fim: h });

const FAIXAS: Faixa[] = [
  // Período contra o período imediatamente anterior, do mesmo tamanho.
  { chave: "ontem", grupo: "periodo", rotulo: "Ontem", periodo: h => {
      const o = new Date(h.getFullYear(), h.getMonth(), h.getDate() - 1);
      return { ini: o, fim: o };
    } },
  { chave: "7d",  grupo: "periodo", rotulo: "7 dias",  periodo: dias(7) },
  { chave: "14d", grupo: "periodo", rotulo: "14 dias", periodo: dias(14) },
  { chave: "30d", grupo: "periodo", rotulo: "30 dias", periodo: dias(30) },
  { chave: "mes", grupo: "periodo", rotulo: "Este mês", periodo: h => ({
      ini: new Date(h.getFullYear(), h.getMonth(), 1), fim: h,
    }) },
  { chave: "mes-passado", grupo: "periodo", rotulo: "Mês passado", periodo: h => ({
      ini: new Date(h.getFullYear(), h.getMonth() - 1, 1),
      fim: new Date(h.getFullYear(), h.getMonth(), 0),
    }) },

  // Hoje contra uma média longa. Responde outra pergunta: não "esta semana piorou?",
  // mas "o dia de hoje está fora do que é normal nesta conta?".
  { chave: "hoje-7",  grupo: "hoje", rotulo: "vs 7 dias",  periodo: soHoje, diasBase: 7 },
  { chave: "hoje-30", grupo: "hoje", rotulo: "vs 30 dias", periodo: soHoje, diasBase: 30 },
];

/** 14 dias é o padrão: em 7 quase tudo cabe no ruído destas contas, e em 30 o sinal já envelheceu. */
const FAIXA_PADRAO = "14d";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Dias entre duas datas, inclusivo.
 *
 * Compara só a parte de data: `hoje` carrega a hora corrente, e subtrair uma
 * meia-noite dele deixava um resto de horas que o arredondamento virava um dia a mais
 * — a tela dizia "15 dias" numa janela de 14.
 */
const diasEntre = (a: Date, b: Date) => {
  const soData = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((soData(b) - soData(a)) / 86400000) + 1;
};

function formatar(valor: number | null, formato: string) {
  if (valor === null || valor === undefined) return "—";
  if (formato === "moeda") return formatCurrency(valor);
  if (formato === "x") return `${valor.toFixed(2)}x`;
  if (formato === "pct") return `${valor.toFixed(1)}%`;
  return formatNumber(Math.round(valor * 10) / 10);
}

/**
 * Situação contra a meta da conta, quando existe.
 *
 * É a segunda pergunta, independente da tendência: "está piorando?" e "está bom o
 * suficiente?" não são a mesma coisa. Uma conta pode estar em queda e ainda acima da
 * meta, ou estável e abaixo dela — e a decisão de mídia é diferente em cada caso.
 */
function Meta({ t, formato }: { t: Tendencia; formato: string }) {
  if (t.meta === null || t.meta === undefined || t.atual === null) return null;

  const bate = t.meta_direcao === "teto" ? t.atual <= t.meta : t.atual >= t.meta;
  const alvo = formato === "x" ? `${t.meta.toFixed(2)}x` : formatCurrency(t.meta);

  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
        bate ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
      )}
      title={t.meta_direcao === "teto" ? `Meta: no máximo ${alvo}` : `Meta: no mínimo ${alvo}`}
    >
      {bate ? "na meta" : "fora"} · {alvo}
    </span>
  );
}

/** Variação com a faixa de ruído ao lado, para "estável" ser verificável. */
function Variacao({ t }: { t: Tendencia }) {
  if (t.direcao === "sem base") {
    return <span className="text-xs text-muted-foreground/60">sem base de comparação</span>;
  }

  const bomSubir = METRICAS[t.metrica]?.bomSubir;
  const subiu = (t.variacao_pct ?? 0) >= 0;
  const estavel = t.direcao === "estável";

  const cor = estavel || bomSubir === null
    ? "text-muted-foreground"
    : subiu === bomSubir
      ? "text-success"
      : "text-destructive";

  const Icone = estavel ? Minus : subiu ? TrendingUp : TrendingDown;

  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className={cn("flex items-center gap-1 text-sm font-medium tabular-nums", cor)}>
        <Icone className="h-3.5 w-3.5" />
        {t.variacao_pct === null ? "—" : `${t.variacao_pct > 0 ? "+" : ""}${t.variacao_pct.toFixed(1)}%`}
      </span>
      {t.ruido_pct !== null && (
        <span className="text-[10px] tabular-nums text-muted-foreground/60">
          ruído ±{t.ruido_pct.toFixed(0)}%
        </span>
      )}
    </div>
  );
}

export default function TendenciasPage() {
  const { contaId } = useFilters();
  const [faixa, setFaixa] = useState(FAIXA_PADRAO);
  const [dados, setDados] = useState<Tendencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  /** Vendas de tráfego do período que nenhuma conta reivindica. Ver {@link avisoSemConta}. */
  const [semConta, setSemConta] = useState({ vendas: 0, total: 0 });

  const escolhida = FAIXAS.find(f => f.chave === faixa) ?? FAIXAS[2];
  const periodo = escolhida.periodo(new Date());
  const qtdDias = diasEntre(periodo.ini, periodo.fim);

  const carregar = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("fn_tendencias", {
      p_ini: iso(periodo.ini),
      p_fim: iso(periodo.fim),
      p_dias_ant: escolhida.diasBase ?? null,
    });
    if (error) {
      console.error("fn_tendencias:", error.message);
      setErro(error.message);
      setDados([]);
    } else {
      setErro(null);
      setDados((data as Tendencia[]) ?? []);
    }
    /**
     * Venda de tráfego que nenhuma conta reivindica.
     *
     * Toda métrica desta página é por conta, e uma venda sem `ad_account_id` não entra
     * em nenhuma. Quando um checkout perde a UTM, o gasto da conta continua inteiro mas
     * parte das vendas dela some — o CPA estoura e a conversão despenca sem que nada
     * tenha piorado de fato. Foi o que aconteceu com a "Saponaria" em 21/08: 22 vendas
     * no "Desconto de Aula", só 4 com `ad_id`.
     */
    const janela = [iso(periodo.ini), iso(periodo.fim)];
    const [semCta, totalTrafego] = await Promise.all([
      supabase.from("vendas").select("id", { count: "exact", head: true })
        .eq("status", "aprovada").is("ad_account_id", null).is("trafego_pago", true)
        .gte("data_venda", `${janela[0]}T00:00:00-03:00`)
        .lte("data_venda", `${janela[1]}T23:59:59.999-03:00`),
      supabase.from("vendas").select("id", { count: "exact", head: true })
        .eq("status", "aprovada").or("trafego_pago.is.true,ad_id_meta.not.is.null")
        .gte("data_venda", `${janela[0]}T00:00:00-03:00`)
        .lte("data_venda", `${janela[1]}T23:59:59.999-03:00`),
    ]);
    setSemConta({ vendas: semCta.count ?? 0, total: totalTrafego.count ?? 0 });

    setLoading(false);
    // A dependência é a faixa, não o objeto de período — ele é recriado a cada render
    // e reexecutaria o efeito em laço.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faixa]);

  useEffect(() => { carregar(); }, [carregar]);

  const visiveis = contaId ? dados.filter(d => d.conta_id === contaId) : dados;

  /**
   * Só contas que gastaram na janela atual, ordenadas por escala.
   *
   * Conta parada não tem tendência a mostrar — ela aparecia com "sem base de
   * comparação" e ocupava espaço sem dizer nada. E a ordem é o investimento médio
   * do dia, decrescente: quem está recebendo mais dinheiro é quem exige decisão
   * primeiro, não quem vem antes no alfabeto.
   */
  const contas = [...new Map(
    visiveis.map(d => [d.conta_id, { id: d.conta_id, nome: d.conta, produto: d.produto }]),
  ).values()]
    .map(c => ({
      ...c,
      gasto: visiveis.find(d => d.conta_id === c.id && d.metrica === "Investimento")?.atual ?? 0,
    }))
    .filter(c => c.gasto > 0)
    .sort((a, b) => b.gasto - a.gasto);

  const movimentos = visiveis.filter(d => d.direcao === "alta" || d.direcao === "queda");

  return (
    <DashboardLayout title="Tendências" hideFilters>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1">
            {FAIXAS.filter(f => f.grupo === "periodo").map(f => (
              <button
                key={f.chave}
                onClick={() => setFaixa(f.chave)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  faixa === f.chave
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                {f.rotulo}
              </button>
            ))}
          </div>

          {/* Separado porque é outra pergunta: aqui a base é uma média longa, não o
              período anterior de mesmo tamanho. */}
          <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1">
            <span className="px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Hoje
            </span>
            {FAIXAS.filter(f => f.grupo === "hoje").map(f => (
              <button
                key={f.chave}
                onClick={() => setFaixa(f.chave)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  faixa === f.chave
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                {f.rotulo}
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          {escolhida.diasBase
            ? `Compara hoje com a média dos ${escolhida.diasBase} dias anteriores`
            : qtdDias === 1
              ? "Compara ontem com anteontem"
              : `Compara ${qtdDias} dias com os ${qtdDias} anteriores`}
        </p>
      </div>

      {/* Sem este aviso a comparação com hoje é uma armadilha: um dia pela metade
          contra dias inteiros derruba receita, vendas e ROAS por construção, e a tela
          apontaria catástrofe todo dia de manhã. */}
      {escolhida.diasBase && (
        <div className="mb-3 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="text-xs leading-relaxed text-amber-200/90">
            Hoje ainda não terminou. Receita, vendas e ROAS aparecem menores do que
            fecharão, porque um dia parcial está sendo comparado com dias inteiros —
            o quanto menor depende da hora. As métricas de eficiência{" "}
            <span className="text-amber-100">CPM, CPC, CTR, hook e conexão da página</span>{" "}
            são razões e não sofrem com isso: são as confiáveis para julgar o dia em curso.
          </p>
        </div>
      )}

      {/* Sem este aviso, um checkout com UTM quebrada faz toda conta parecer pior do
          que é: o gasto dela continua inteiro e parte das vendas some. */}
      {semConta.vendas > 0 && semConta.total > 0 && (
        <div className="mb-3 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="text-xs leading-relaxed text-amber-200/90">
            <span className="text-amber-100">
              {semConta.vendas} de {semConta.total} vendas de tráfego
            </span>{" "}
            neste período não têm conta identificada — vieram de checkout sem UTM. Elas
            não entram em nenhuma conta abaixo, então <span className="text-amber-100">
            CPA, ROAS e as conversões estão subestimados</span>: o gasto da conta aparece
            inteiro e parte das vendas dela, não.
          </p>
        </div>
      )}

      {/* A explicação fica na tela, não num tooltip: sem ela, "estável" parece o
          painel não ter achado nada, quando é o contrário — ele achou que a variação
          cabe dentro da oscilação normal da conta. */}
      <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-border bg-card px-3.5 py-2.5">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          O ROAS diário destas contas oscila entre 31% e 86% da própria média, então
          comparar dias soltos desenharia ruído com cara de tendência. Aqui a variação
          só vira <span className="text-foreground">alta</span> ou{" "}
          <span className="text-foreground">queda</span> quando passa da faixa de ruído
          mostrada ao lado dela. Abaixo disso é <span className="text-foreground">estável</span> —
          e isso é uma resposta.
        </p>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center text-muted-foreground">Carregando...</div>
      ) : erro ? (
        <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
          <AlertCircle className="h-6 w-6 text-destructive" />
          <div>
            <p className="font-medium text-foreground">Não foi possível carregar as tendências</p>
            <p className="mt-1 text-xs text-muted-foreground">{erro}</p>
          </div>
          <button onClick={carregar} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary">
            Tentar de novo
          </button>
        </div>
      ) : contas.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-center text-muted-foreground">
          Nenhuma conta com gasto nas duas janelas
        </div>
      ) : (
        <>
          {/* O que de fato saiu do ruído, junto, para não obrigar a varrer os cards */}
          <div className="mb-5 rounded-lg border border-border bg-card p-4">
            <h3 className="mb-2.5 text-sm font-medium text-foreground">
              {movimentos.length === 0
                ? "Nenhum movimento fora da faixa de ruído"
                : `${movimentos.length} movimento${movimentos.length > 1 ? "s" : ""} fora da faixa de ruído`}
            </h3>
            {movimentos.length === 0 ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                Tudo que mudou nesta janela cabe dentro da oscilação normal das contas.
                {qtdDias <= 7
                  ? " Janelas curtas quase nunca acusam nada: um dia ou uma semana têm ruído demais. Tente 14 ou 30 dias."
                  : " Janelas maiores enxergam movimentos mais lentos — vale tentar 30 dias ou o mês passado."}
              </p>
            ) : (
              /* Agrupado por conta, na mesma ordem de escala dos cards abaixo. Numa
                 lista corrida, métricas da mesma conta ficavam espalhadas e a leitura
                 obrigava a recompor mentalmente qual conta tem qual problema — que é
                 justamente a pergunta que se faz aqui. */
              <div className="space-y-3">
                {contas
                  .filter(c => movimentos.some(m => m.conta_id === c.id))
                  .map(c => {
                    const doConta = movimentos
                      .filter(m => m.conta_id === c.id)
                      .sort((a, b) => Math.abs(b.variacao_pct ?? 0) - Math.abs(a.variacao_pct ?? 0));
                    return (
                      <div key={c.id}>
                        <div className="mb-1.5 flex items-baseline gap-2">
                          <span className="text-xs font-medium text-foreground">{c.nome}</span>
                          <span className="text-[10px] text-muted-foreground/60">
                            {doConta.length} movimento{doConta.length > 1 ? "s" : ""}
                          </span>
                        </div>
                        <div className="space-y-1.5 border-l border-border/60 pl-3">
                          {doConta.map((m, i) => (
                            <div key={i} className="flex items-baseline justify-between gap-3 text-sm">
                              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                                {m.metrica}
                              </span>
                              <span className="shrink-0 tabular-nums text-muted-foreground">
                                {formatar(m.anterior, METRICAS[m.metrica]?.formato ?? "numero")} →{" "}
                                {formatar(m.atual, METRICAS[m.metrica]?.formato ?? "numero")}
                              </span>
                              <div className="w-24 shrink-0 text-right">
                                <Variacao t={m} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {contas.map(c => {
              const doConta = visiveis.filter(d => d.conta_id === c.id);
              return (
                <div key={c.id} className="rounded-lg border border-border bg-card p-4">
                  <div className="mb-3 flex items-baseline justify-between gap-2">
                    <h3 className="truncate text-sm font-medium text-foreground">{c.nome}</h3>
                    {c.produto && (
                      <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">
                        {c.produto}
                      </span>
                    )}
                  </div>
                  <div className="space-y-3">
                    {GRUPOS.map(g => {
                      const linhas = g.metricas
                        .map(nome => ({ nome, t: doConta.find(d => d.metrica === nome) }))
                        .filter(l => l.t);
                      if (linhas.length === 0) return null;
                      return (
                        <div key={g.titulo}>
                          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
                            {g.titulo}
                          </div>
                          <div className="space-y-2">
                            {linhas.map(({ nome, t }) => {
                              const cfg = METRICAS[nome];
                              return (
                                <div key={nome} className="flex items-baseline justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-sm text-foreground">{nome}</span>
                                      <Meta t={t!} formato={cfg.formato} />
                                    </div>
                                    <div className="text-[10px] leading-snug text-muted-foreground/60">
                                      {cfg.ajuda}
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 items-baseline gap-3">
                                    <span className="tabular-nums text-sm text-muted-foreground">
                                      {formatar(t!.anterior, cfg.formato)} → {formatar(t!.atual, cfg.formato)}
                                    </span>
                                    <div className="w-20 text-right">
                                      <Variacao t={t!} />
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {doConta[0] && doConta[0].dias_atual < qtdDias && (
                    <p className="mt-3 border-t border-border/60 pt-2 text-[10px] text-muted-foreground/60">
                      {doConta[0].dias_atual} de {qtdDias} dias com gasto na janela atual — dia
                      sem investimento fica de fora, porque conta parada não é conta piorando
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
