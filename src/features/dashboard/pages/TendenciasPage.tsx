import { useEffect, useState, useCallback, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useFilters } from "@/contexts/FilterContext";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import {
  TrendingUp, TrendingDown, Minus, AlertCircle, HelpCircle,
  Megaphone, ChevronDown, ChevronRight,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
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
 * resposta, não uma ausência dela. A série diária aparece ao lado de cada métrica
 * justamente para que "estável" seja uma coisa que se vê, e não uma afirmação a ser
 * aceita: os pontos do período atual caindo dentro da nuvem do anterior.
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
  /** Valor de cada dia, em ordem, cobrindo janela anterior + atual. */
  serie: number[] | null;
  /** Quantos pontos de `serie` pertencem à janela anterior. */
  serie_corte: number | null;
}

/**
 * Como cada métrica se comporta e o que significa subir.
 *
 * `bomSubir` diz se a alta é boa. Em CPA e investimento não é — pintar toda alta de
 * verde faria a cor mentir, que é o mesmo defeito de mostrar número truncado com cara
 * de número certo.
 */
type Formato = "moeda" | "numero" | "x" | "pct";

const METRICAS: Record<string, { formato: Formato; bomSubir: boolean | null; ajuda: string }> = {
  // Resultado
  ROAS:                    { formato: "x",      bomSubir: true,  ajuda: "Receita por real investido" },
  AOV:                     { formato: "moeda",  bomSubir: true,  ajuda: "Valor médio do pedido, sem contar upsell — é o que a conta traz na compra inicial" },
  Receita:                 { formato: "moeda",  bomSubir: true,  ajuda: "Média por dia, upsell incluído" },
  Vendas:                  { formato: "numero", bomSubir: true,  ajuda: "Pedidos por dia. Upsell do mesmo carrinho não conta como venda nova" },
  Investimento:            { formato: "moeda",  bomSubir: null,  ajuda: "Média por dia. Gastar mais não é bom nem ruim — quem julga é o ROAS" },
  CPA:                     { formato: "moeda",  bomSubir: false, ajuda: "Custo por pedido — o upsell não entra no divisor, senão a aquisição sairia mais barata do que é" },
  // Leilão
  CPM:                     { formato: "moeda",  bomSubir: false, ajuda: "Custo por mil impressões — o que o Meta cobra" },
  CPC:                     { formato: "moeda",  bomSubir: false, ajuda: "Custo por clique" },
  // Criativo
  CTR:                     { formato: "pct",    bomSubir: true,  ajuda: "Cliques por impressão" },
  "Hook (3s)":             { formato: "pct",    bomSubir: true,  ajuda: "Quem passa dos 3 segundos de vídeo" },
  // Funil
  "Conexão da página":     { formato: "pct",    bomSubir: true,  ajuda: "Cliques que viram visita — abaixo de 80% indica página lenta" },
  "Conversão do checkout": { formato: "pct",    bomSubir: true,  ajuda: "Checkouts iniciados que viram pedido" },
};

/**
 * Agrupadas por etapa, porque é assim que se lê um funil quando algo piora: o
 * resultado diz *que* piorou, e as etapas dizem *onde*. ROAS caindo com hook e CTR
 * caindo junto é criativo cansado; com a conversão do checkout caindo é outra coisa.
 */
const GRUPOS: { titulo: string; metricas: string[] }[] = [
  { titulo: "Resultado", metricas: ["ROAS", "AOV", "Receita", "Vendas", "Investimento", "CPA"] },
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

const curto = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;

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

/** Cor da variação: cinza quando estável ou quando subir não é bom nem ruim. */
function corDaDirecao(t: Tendencia) {
  const bomSubir = METRICAS[t.metrica]?.bomSubir;
  if (t.direcao === "estável" || t.direcao === "sem base" || bomSubir === null) return "neutro";
  return ((t.variacao_pct ?? 0) >= 0) === bomSubir ? "bom" : "ruim";
}

/**
 * A série diária, com a divisa entre as duas janelas.
 *
 * Os tracejados horizontais são as duas médias comparadas — exatamente o que a
 * variação ao lado mede. A nuvem de pontos em volta deles é o motivo de a tela exigir
 * que a diferença passe do ruído antes de chamá-la de tendência.
 *
 * Deliberadamente **não** desenha a faixa de ruído: ela é a precisão da diferença
 * entre médias, não a dispersão dos dias. Uma faixa dessas em volta da linha diária
 * pareceria certa e estaria medindo outra coisa — os dias cairiam fora dela o tempo
 * todo sem que isso significasse nada.
 */
function Serie({ t, largura = 68, altura = 22 }: { t: Tendencia; largura?: number; altura?: number }) {
  const s = t.serie;
  if (!s || s.length < 3) return <div style={{ width: largura, height: altura }} />;

  const corte = Math.min(Math.max(t.serie_corte ?? 0, 0), s.length);
  const min = Math.min(...s);
  const max = Math.max(...s);
  const amplitude = max - min || Math.abs(max) || 1;
  const px = (i: number) => (s.length === 1 ? largura / 2 : (i / (s.length - 1)) * largura);
  const py = (v: number) => altura - 2 - ((v - min) / amplitude) * (altura - 4);

  const pontos = (ini: number, fim: number) =>
    s.slice(ini, fim).map((v, k) => `${px(ini + k).toFixed(1)},${py(v).toFixed(1)}`).join(" ");

  const tom = corDaDirecao(t);
  const cor = tom === "bom" ? "text-success" : tom === "ruim" ? "text-destructive" : "text-muted-foreground";

  // A linha atual começa no último ponto da anterior, senão o gráfico abre um buraco
  // na divisa exatamente onde a leitura precisa de continuidade.
  const iniAtual = corte > 0 ? corte - 1 : 0;

  const nivel = (valor: number | null, de: number, ate: number, classe: string, opacidade: number) =>
    valor === null || valor === undefined || ate <= de ? null : (
      <line
        x1={px(de)} x2={px(ate)} y1={py(valor)} y2={py(valor)}
        className={classe} stroke="currentColor" strokeOpacity={opacidade}
        strokeWidth={1} strokeDasharray="2 2"
      />
    );

  // Tudo pinta com `currentColor` a partir de uma classe `text-*`, e não com
  // `stroke-*`: as variantes de opacidade de `stroke` não existem no CSS gerado deste
  // projeto e saíam como `stroke: none` — linha invisível, sem erro nenhum.
  return (
    <svg width={largura} height={altura} className={cn("shrink-0 overflow-hidden", cor)} aria-hidden="true">
      {nivel(t.anterior, 0, Math.max(corte - 1, 0), "text-muted-foreground", 0.5)}
      {nivel(t.atual, iniAtual, s.length - 1, cor, 0.6)}
      {corte > 0 && corte < s.length && (
        <line
          x1={px(corte - 0.5)} x2={px(corte - 0.5)} y1={0} y2={altura}
          className="text-muted-foreground" stroke="currentColor" strokeOpacity={0.3} strokeWidth={1}
        />
      )}
      {corte > 1 && (
        <polyline
          points={pontos(0, corte)} fill="none" strokeWidth={1.25}
          className="text-muted-foreground" stroke="currentColor" strokeOpacity={0.45}
          strokeLinejoin="round" strokeLinecap="round"
        />
      )}
      <polyline
        points={pontos(iniAtual, s.length)} fill="none" strokeWidth={1.5}
        stroke="currentColor" strokeLinejoin="round" strokeLinecap="round"
      />
      <circle cx={px(s.length - 1)} cy={py(s[s.length - 1])} r={1.75} fill="currentColor" />
    </svg>
  );
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
        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
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
    return (
      <span
        className="text-[10px] leading-tight text-muted-foreground/60"
        title="Dias com gasto de menos para comparar"
      >
        sem base
      </span>
    );
  }

  const tom = corDaDirecao(t);
  const estavel = t.direcao === "estável";
  const subiu = (t.variacao_pct ?? 0) >= 0;
  const cor = tom === "bom" ? "text-success" : tom === "ruim" ? "text-destructive" : "text-muted-foreground";
  const Icone = estavel ? Minus : subiu ? TrendingUp : TrendingDown;

  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className={cn("flex items-center gap-1 text-sm font-medium tabular-nums", cor)}>
        <Icone className="h-3.5 w-3.5 shrink-0" />
        {t.variacao_pct === null ? "—" : `${t.variacao_pct > 0 ? "+" : ""}${t.variacao_pct.toFixed(1)}%`}
      </span>
      {t.ruido_pct !== null && (
        <span className="text-[10px] leading-none tabular-nums text-muted-foreground/60">
          ruído ±{t.ruido_pct.toFixed(0)}%
        </span>
      )}
    </div>
  );
}

/**
 * Uma linha de métrica: nome, série, os dois valores, a variação.
 *
 * A explicação da métrica saiu para o `title` e para a legenda do painel de ajuda.
 * Repetida embaixo de doze métricas em quinze cards, ela somava cento e oitenta
 * linhas de texto idêntico e dobrava a altura de cada card.
 */
function Linha({ t, nome, amplo }: { t: Tendencia; nome: string; amplo?: boolean }) {
  const cfg = METRICAS[nome];
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span
          className="truncate text-sm text-foreground decoration-dotted underline-offset-4 hover:underline"
          title={cfg?.ajuda}
        >
          {nome}
        </span>
        <Meta t={t} formato={cfg?.formato ?? "numero"} />
      </div>
      <Serie t={t} largura={amplo ? 190 : 68} altura={amplo ? 30 : 22} />
      <div className="shrink-0 text-right text-sm tabular-nums">
        <span className="text-muted-foreground/60">{formatar(t.anterior, cfg?.formato ?? "numero")}</span>
        <span className="mx-1 text-muted-foreground/40">→</span>
        <span className="font-medium text-foreground">{formatar(t.atual, cfg?.formato ?? "numero")}</span>
      </div>
      <div className="w-[68px] shrink-0 text-right">
        <Variacao t={t} />
      </div>
    </div>
  );
}

interface ContaResumo { id: string; nome: string; produto: string | null; gasto: number }

/**
 * Card de uma conta.
 *
 * Os grupos de diagnóstico (Leilão, Criativo, Funil) começam fechados quando não têm
 * nada a dizer. Doze métricas abertas em quinze cards viram parede de números, e a
 * pergunta que se faz aqui é "o que mudou", não "quanto deu tudo". Um grupo com
 * movimento fora do ruído abre sozinho — esconder justamente o que saiu do ruído
 * seria trocar ruído visual por informação perdida.
 */
function CartaoConta({ conta, linhas, qtdDias, unica }: {
  conta: ContaResumo; linhas: Tendencia[]; qtdDias: number; unica: boolean;
}) {
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const achar = (nome: string) => linhas.find(d => d.metrica === nome);

  const receita = achar("Receita")?.atual ?? null;
  const vendas = achar("Vendas")?.atual ?? null;
  const roas = achar("ROAS");
  const diasComGasto = linhas[0]?.dias_atual ?? 0;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border/60 pb-2.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <h3 className="truncate text-sm font-medium text-foreground">{conta.nome}</h3>
          {conta.produto && (
            <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">
              {conta.produto}
            </span>
          )}
        </div>
        {/* A escala da conta antes das métricas: qual decisão é a cara, e o que a
            conta devolveu. Sem isso, uma de R$ 90/dia e outra de R$ 2.000/dia têm o
            mesmo peso visual e a leitura começa pelo alfabeto. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs tabular-nums text-muted-foreground">
          <span title="Investido no período">{formatCurrency((conta.gasto || 0) * diasComGasto)}</span>
          {receita !== null && (
            <>
              <span className="text-muted-foreground/30">·</span>
              <span title="Receita atribuída no período">{formatCurrency(receita * diasComGasto)}</span>
            </>
          )}
          {vendas !== null && (
            <>
              <span className="text-muted-foreground/30">·</span>
              <span title="Vendas atribuídas no período">
                {formatNumber(Math.round(vendas * diasComGasto))} vendas
              </span>
            </>
          )}
          {roas?.atual != null && (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 font-medium",
                roas.meta != null
                  ? roas.atual >= roas.meta
                    ? "bg-success/15 text-success"
                    : "bg-destructive/15 text-destructive"
                  : "bg-secondary text-foreground",
              )}
              title="ROAS da janela atual"
            >
              {roas.atual.toFixed(2)}x
            </span>
          )}
        </div>
      </div>

      {/* Conta única fica em uma coluna só, e a largura que sobra vai para o gráfico.
          Duas colunas caberiam, mas a 295px cada uma o nome da métrica era truncado
          para "RO..." — e trocar o nome da métrica por mais densidade é trocar o que
          se lê pelo que se rola. */}
      <div>
        {GRUPOS.map(g => {
          const doGrupo = g.metricas
            .map(nome => ({ nome, t: achar(nome) }))
            .filter((l): l is { nome: string; t: Tendencia } => !!l.t);
          if (doGrupo.length === 0) return null;

          const emMovimento = doGrupo.filter(
            l => l.t.direcao === "alta" || l.t.direcao === "queda",
          ).length;
          const padrao = unica || g.titulo === "Resultado" || emMovimento > 0;
          const aberto = manual[g.titulo] ?? padrao;

          return (
            <div key={g.titulo} className="mb-3 last:mb-0">
              <button
                onClick={() => setManual(m => ({ ...m, [g.titulo]: !aberto }))}
                className="mb-1.5 flex w-full items-center gap-1 text-[10px] font-medium text-muted-foreground/50 transition-colors hover:text-muted-foreground"
              >
                {aberto ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {/* O `uppercase` fica só no título: aplicado no botão inteiro, ele
                    engolia o resumo do grupo, e `normal-case` não existe no CSS
                    gerado deste projeto para desfazer. */}
                <span className="uppercase tracking-wider">{g.titulo}</span>
                {!aberto && (
                  <span className="ml-1">
                    {emMovimento > 0
                      ? `· ${emMovimento} em movimento`
                      : `· ${doGrupo.length} estáveis`}
                  </span>
                )}
              </button>
              {aberto && (
                <div className="space-y-2">
                  {doGrupo.map(({ nome, t }) => <Linha key={nome} t={t} nome={nome} amplo={unica} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {diasComGasto > 0 && diasComGasto < qtdDias && (
        <p className="mt-3 border-t border-border/60 pt-2 text-[10px] text-muted-foreground/60">
          {diasComGasto} de {qtdDias} dias com gasto na janela atual — dia sem
          investimento fica de fora, porque conta parada não é conta piorando
        </p>
      )}
    </div>
  );
}

/** Carregando com a forma do que vai aparecer, em vez de uma palavra no vazio. */
function Esqueleto() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="animate-pulse rounded-lg border border-border bg-card p-4">
          <div className="mb-3 h-4 w-40 rounded bg-secondary" />
          <div className="space-y-2.5">
            {[0, 1, 2, 3, 4, 5].map(k => (
              <div key={k} className="flex items-center gap-3">
                <div className="h-3 flex-1 rounded bg-secondary/70" />
                <div className="h-3 w-16 rounded bg-secondary/70" />
                <div className="h-3 w-12 rounded bg-secondary/70" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TendenciasPage() {
  const { contaId, setContaId } = useFilters();
  const [faixa, setFaixa] = useState(FAIXA_PADRAO);
  const [dados, setDados] = useState<Tendencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [comoFunciona, setComoFunciona] = useState(false);
  const [contaAberta, setContaAberta] = useState(false);
  /** Vendas de tráfego do período que nenhuma conta reivindica. */
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

  /**
   * Contas que gastaram na janela, ordenadas por escala.
   *
   * Vem de `dados` e não do recorte, senão escolher uma conta esvaziaria a própria
   * lista do seletor e deixaria a usuária sem caminho de volta. Conta parada fica de
   * fora: ela aparecia com "sem base de comparação" e ocupava espaço sem dizer nada.
   * A ordem é o investimento médio do dia, decrescente — quem está recebendo mais
   * dinheiro é quem exige decisão primeiro, não quem vem antes no alfabeto.
   */
  const contas = useMemo<ContaResumo[]>(() => (
    [...new Map(
      dados.map(d => [d.conta_id, { id: d.conta_id, nome: d.conta, produto: d.produto }]),
    ).values()]
      .map(c => ({
        ...c,
        gasto: dados.find(d => d.conta_id === c.id && d.metrica === "Investimento")?.atual ?? 0,
      }))
      .filter(c => c.gasto > 0)
      .sort((a, b) => b.gasto - a.gasto)
  ), [dados]);

  const contaEscolhida = contas.find(c => c.id === contaId) ?? null;
  const visiveis = contaId ? dados.filter(d => d.conta_id === contaId) : dados;
  const cards = contaId ? contas.filter(c => c.id === contaId) : contas;
  const movimentos = visiveis.filter(d => d.direcao === "alta" || d.direcao === "queda");
  const gastoTotal = contas.reduce((s, c) => s + c.gasto, 0);

  /** A conta veio selecionada de outra tela e não gastou nesta janela. */
  const contaForaDaJanela = !!contaId && !contaEscolhida && !loading && dados.length > 0;
  const nomeForaDaJanela = dados.find(d => d.conta_id === contaId)?.conta;

  return (
    <DashboardLayout title="Tendências" hideFilters>
      {/* Uma linha só de controles: o recorte por conta, a janela, e a frase que diz
          exatamente o que está sendo comparado com o quê. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* O filtro de conta é da página, não do cabeçalho: a lista sai da mesma
            janela dos cards, então nunca oferece uma conta que a tela não mostra — e o
            recorte deixa de ser invisível quando chega selecionado de outra tela. */}
        <Popover open={contaAberta} onOpenChange={setContaAberta}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn("h-9 gap-1.5 text-xs font-medium", contaId && "border-primary/50 text-primary")}
            >
              <Megaphone className="h-3.5 w-3.5" />
              <span className="max-w-[180px] truncate">
                {contaEscolhida ? contaEscolhida.nome : contaId ? "Conta sem gasto" : "Todas as contas"}
              </span>
              <ChevronDown className="h-3 w-3 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <div className="flex min-w-[280px] flex-col py-1">
              <button
                onClick={() => { setContaId(null); setContaAberta(false); }}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
                  contaId === null && "bg-accent font-semibold text-accent-foreground",
                )}
              >
                <span className="flex-1">Todas as contas</span>
                <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                  {formatCurrency(gastoTotal)}/dia
                </span>
              </button>

              <div className="my-1 border-t border-border" />
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                Com gasto na janela
              </p>

              {contas.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">Nenhuma conta gastou nesta janela</p>
              ) : contas.map(c => (
                <button
                  key={c.id}
                  onClick={() => { setContaId(c.id); setContaAberta(false); }}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
                    contaId === c.id && "bg-accent font-semibold text-accent-foreground",
                  )}
                >
                  <span className="flex-1 truncate">{c.nome}</span>
                  {/* O gasto ao lado do nome dá a escala sem precisar entrar na conta. */}
                  <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                    {formatCurrency(c.gasto)}/dia
                  </span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

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

        <p className="ml-auto text-xs text-muted-foreground">
          {escolhida.diasBase
            ? `${curto(periodo.fim)} contra a média dos ${escolhida.diasBase} dias anteriores`
            : qtdDias === 1
              ? `${curto(periodo.ini)} contra o dia anterior`
              : `${curto(periodo.ini)}–${curto(periodo.fim)} contra os ${qtdDias} dias anteriores`}
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

      {/* A regra fica numa linha, sempre visível; o porquê e as definições ficam a um
          clique. Antes o parágrafo inteiro ocupava a dobra em toda visita, junto com
          dois avisos amarelos — a tela abria com três blocos de texto antes do
          primeiro número. */}
      <div className="mb-5 rounded-lg border border-border bg-card">
        <button
          onClick={() => setComoFunciona(v => !v)}
          className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left"
        >
          <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="flex-1 text-xs leading-relaxed text-muted-foreground">
            A variação só vira <span className="text-foreground">alta</span> ou{" "}
            <span className="text-foreground">queda</span> quando passa da faixa de ruído
            mostrada ao lado dela. Abaixo disso é{" "}
            <span className="text-foreground">estável</span> — e isso é uma resposta.
          </p>
          <span className="shrink-0 text-xs text-muted-foreground/70">
            {comoFunciona ? "menos" : "como isso é calculado"}
          </span>
        </button>

        {comoFunciona && (
          <div className="space-y-3 border-t border-border/60 px-3.5 py-3 sm:pl-[42px]">
            <p className="text-xs leading-relaxed text-muted-foreground">
              O ROAS diário destas contas oscila entre 31% e 86% da própria média — a
              "Lembrancinha - TSL" vai de 0,53 a 3,43 em torno de 1,69. Comparar dias
              soltos desenharia ruído com cara de tendência. Por isso a comparação é
              entre as médias das duas janelas, e a diferença precisa passar de duas
              vezes o erro padrão dela para ser chamada de tendência.
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Cada métrica é a razão dos totais da janela, nunca a média das razões
              diárias: um dia de R$ 30 e um de R$ 3.000 não podem pesar igual. No
              gráfico de cada linha, a parte clara é a janela anterior e a escura é a
              atual; os tracejados horizontais são as duas médias que estão sendo
              comparadas.
            </p>
            <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
              {Object.entries(METRICAS).map(([nome, cfg]) => (
                <div key={nome} className="flex gap-2 text-[11px]">
                  <span className="w-36 shrink-0 text-foreground">{nome}</span>
                  <span className="text-muted-foreground/70">{cfg.ajuda}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <Esqueleto />
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
      ) : contaForaDaJanela ? (
        /* Recorte herdado de outra tela. Limpar sozinho seria mais rápido e menos
           honesto: a usuária escolheu esta conta em algum lugar e merece saber por que
           ela não está aqui. */
        <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
          <Megaphone className="h-6 w-6 text-muted-foreground" />
          <div>
            <p className="font-medium text-foreground">
              {nomeForaDaJanela ?? "A conta selecionada"} não teve gasto nesta janela
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Sem investimento não há tendência a medir. Escolha outra janela ou volte para todas as contas.
            </p>
          </div>
          <button
            onClick={() => setContaId(null)}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary"
          >
            Ver todas as contas
          </button>
        </div>
      ) : cards.length === 0 ? (
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
              {contaEscolhida && (
                <span className="ml-1.5 font-normal text-muted-foreground">em {contaEscolhida.nome}</span>
              )}
            </h3>
            {movimentos.length === 0 ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                Tudo que mudou nesta janela cabe dentro da oscilação normal
                {contaEscolhida ? " desta conta" : " das contas"}.
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
                {cards
                  .filter(c => movimentos.some(m => m.conta_id === c.id))
                  .map(c => {
                    const doConta = movimentos
                      .filter(m => m.conta_id === c.id)
                      .sort((a, b) => Math.abs(b.variacao_pct ?? 0) - Math.abs(a.variacao_pct ?? 0));
                    return (
                      <div key={c.id}>
                        {!contaEscolhida && (
                          <div className="mb-1.5 flex items-baseline gap-2">
                            <button
                              onClick={() => setContaId(c.id)}
                              className="text-xs font-medium text-foreground transition-colors hover:text-primary"
                              title="Ver só esta conta"
                            >
                              {c.nome}
                            </button>
                            <span className="text-[10px] text-muted-foreground/60">
                              {doConta.length} movimento{doConta.length > 1 ? "s" : ""}
                            </span>
                          </div>
                        )}
                        <div className="space-y-2 border-l border-border/60 pl-3">
                          {doConta.map((m, i) => (
                            <Linha key={i} t={m} nome={m.metrica} amplo={!!contaEscolhida} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          <div className={cn("grid grid-cols-1 gap-4", !contaEscolhida && "lg:grid-cols-2")}>
            {cards.map(c => (
              <CartaoConta
                key={c.id}
                conta={c}
                linhas={visiveis.filter(d => d.conta_id === c.id)}
                qtdDias={qtdDias}
                unica={!!contaEscolhida}
              />
            ))}
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
