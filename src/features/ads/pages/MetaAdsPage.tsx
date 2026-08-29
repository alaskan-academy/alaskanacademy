import { useEffect, useMemo, useState } from "react";
import {
  SITUACAO, ORDEM_SITUACAO, situacaoDe, chaveEstado, type EstadoDoObjeto,
} from "@/features/ads/situacao";
import { AlertaSyncMeta } from "@/features/ads/AlertaSyncMeta";
import { CriativoDrawer } from "@/features/producao/components/CriativoDrawer";
import type { ProducaoNivel } from "@/features/producao/components/types";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useFilters } from "@/contexts/FilterContext";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { ConciliacaoMeta } from "@/features/ads/components/ConciliacaoMeta";
import type { LinhaCalculada, LinhaMetricaMeta } from "@/features/ads/metricas";
import { FunilDaLinha } from "@/features/ads/components/FunilDaLinha";
import { ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

type Nivel = "campanha" | "adset" | "ad";

/*
  As colunas, com a leitura do Meta e a da Payt lado a lado.

  A ordem agrupa por FONTE, e não por métrica: os quatro números do Meta
  juntos, depois os quatro da Payt. Intercalar ("vendas Meta, vendas Payt,
  receita Meta, receita Payt") pareceria uma comparação célula a célula, quando
  o que se lê é um bloco contra o outro.

  E a diferença entre os dois blocos é o ponto. No "AD 002 H01 V01" de agosto:
  o Meta reivindica 14 vendas e R$ 1.573,81; a Payt registrou 12 e R$ 1.307,05.
  Não são dois ROAS do mesmo anúncio — é um anúncio cuja atribuição está
  inflada, e isso só aparece com os dois na mesma linha.
*/
const COLS = [
  { key: "nome", label: "Nome", fixed: true },
  { key: "investimento", label: "Gastos", money: true },

  { key: "faturamento_atribuido", label: "Faturamento (Meta)", money: true, fonte: "meta" },
  { key: "resultado", label: "Retorno (Meta)", money: true, fonte: "meta" },
  { key: "margem", label: "Margem % (Meta)", pct: true, fonte: "meta" },
  { key: "roas", label: "ROAS (Meta)", suffix: "x", fonte: "meta" },
  { key: "compras_meta", label: "Vendas (Meta)", num: true, fonte: "meta" },
  { key: "cpa", label: "CPA (Meta)", money: true, fonte: "meta" },

  { key: "receita_payt", label: "Faturamento (Payt)", money: true, fonte: "payt" },
  { key: "resultado_payt", label: "Retorno (Payt)", money: true, fonte: "payt" },
  { key: "margem_payt", label: "Margem % (Payt)", pct: true, fonte: "payt" },
  { key: "roas_payt", label: "ROAS (Payt)", suffix: "x", fonte: "payt" },
  { key: "vendas_payt", label: "Vendas (Payt)", num: true, fonte: "payt" },
  { key: "cpa_payt", label: "CPA (Payt)", money: true, fonte: "payt" },
  { key: "taxa_video_3s", label: "V3s/Imp %", pct: true },
  { key: "taxa_video_75pct", label: "V75%/Inic %", pct: true },
  { key: "taxa_compras_video75", label: "Comp/V75% %", pct: true },
  { key: "ctr", label: "CTR %", pct: true },
  { key: "cpc", label: "CPC", money: true },
  { key: "cpm", label: "CPM", money: true },
  { key: "initiate_checkout", label: "ICs", num: true },
  { key: "taxa_ic", label: "Taxa IC %", pct: true },
  { key: "custo_por_ic", label: "Custo/IC", money: true },
  { key: "taxa_conv_checkout", label: "Conv. Checkout %", pct: true },
  { key: "taxa_conexao", label: "Taxa Conexão %", pct: true },
  { key: "custo_por_vis_pagina", label: "Custo/VisPag", money: true },
  { key: "taxa_vendas_vis_pagina", label: "Vend/VisPag %", pct: true },
  { key: "visualizacoes_pagina", label: "Vis. Pág.", num: true },
  // Os dois cliques, com nome que diz qual é qual. O do link é o que alimenta
  // CTR e CPC; o total fica porque ele é o engajamento do criativo, e a
  // distância entre os dois diz quanto do público parou para curtir em vez de
  // ir para a página.
  { key: "cliques_link", label: "Cliques (link)", num: true },
  { key: "cliques", label: "Cliques (total)", num: true },
  { key: "impressoes", label: "Impressões", num: true },
];

/*
  As contagens cruas de uma linha, com o que não é número zerado.

  Só isto se SOMA. Tudo o mais na tabela é razão, e razão não se soma: CPM de
  cinco campanhas somado não é o CPM das cinco juntas.
*/
function contagens(linha: Partial<LinhaCalculada>) {
  return {
    impressoes: Number(linha.impressoes || 0),
    cliques: Number(linha.cliques || 0),
    cliques_link: Number(linha.cliques_link || 0),
    investimento: Number(linha.investimento || 0),
    compras_meta: Number(linha.compras_meta || 0),
    faturamento_atribuido: Number(linha.faturamento_atribuido || 0),
    initiate_checkout: Number(linha.initiate_checkout || 0),
    visualizacoes_pagina: Number(linha.visualizacoes_pagina || 0),
    video_plays: Number(linha.video_plays || 0),
    video_3s: Number(linha.video_3s || 0),
    video_75pct: Number(linha.video_75pct || 0),
    vendas_payt: Number(linha.vendas_payt || 0),
    receita_payt: Number(linha.receita_payt || 0),
  };
}

/*
  As razões, calculadas a partir das contagens.

  Esta função existe para ter UMA cópia da fórmula servindo a dois lugares: a
  linha de cada campanha e a linha de TOTAL do rodapé. Se o total repetisse as
  contas, seria a primeira armadilha da CLAUDE.md — duas versões da mesma
  regra, esperando divergir na primeira que alguém ajustar.

  E é o que garante que o rodapé mostre o CPM do conjunto todo, e não a soma
  dos CPMs; o mesmo cuidado que a tela de Vendas e a de UTM já tomam.
*/
function comRazoes(linha: Partial<LinhaCalculada> & { nome: string | null }): LinhaCalculada {
  const r = { ...linha, ...contagens(linha) };
  const inv = r.investimento;
  const fat = r.faturamento_atribuido;
  const luc = fat - inv;
  return {
    ...r,
    resultado: luc,
    margem: fat > 0 ? (luc / fat) * 100 : 0,
    roas: inv > 0 ? fat / inv : 0,
    cpa: r.compras_meta > 0 ? inv / r.compras_meta : 0,
    /*
      CTR e CPC pelo clique no LINK, e não pelo clique total.

      O Meta devolve os dois: `clicks` conta curtida, comentário, ver perfil e
      expandir texto; `inline_link_clicks` conta quem foi para a página. No
      "AD 002 H01 V01" de agosto isso é 567 contra 416 — CTR 3,54% contra
      2,60%, CPC R$ 1,53 contra R$ 2,09.

      O total inflava o CTR em 36% e barateava o CPC em 27%, e é o CPC que
      decide se o anúncio está caro. As telas de Criativos e de Análises já
      usavam o clique no link: o dashboard tinha dois CTRs com o mesmo nome.
    */
    ctr: r.impressoes > 0 ? (r.cliques_link / r.impressoes) * 100 : 0,
    cpm: r.impressoes > 0 ? (inv / r.impressoes) * 1000 : 0,
    cpc: r.cliques_link > 0 ? inv / r.cliques_link : 0,
    taxa_video_3s: r.impressoes > 0 ? (r.video_3s / r.impressoes) * 100 : 0,
    taxa_video_75pct: r.video_plays > 0 ? (r.video_75pct / r.video_plays) * 100 : 0,
    taxa_compras_video75: r.video_75pct > 0 ? (r.compras_meta / r.video_75pct) * 100 : 0,
    taxa_ic: r.visualizacoes_pagina > 0 ? (r.initiate_checkout / r.visualizacoes_pagina) * 100 : 0,
    custo_por_ic: r.initiate_checkout > 0 ? inv / r.initiate_checkout : 0,
    taxa_conv_checkout: r.initiate_checkout > 0 ? (r.compras_meta / r.initiate_checkout) * 100 : 0,
    // Conexão é visita de página sobre clique no LINK: quantos dos que
    // clicaram para ir chegaram. Clique em curtida nunca ia chegar.
    taxa_conexao: r.cliques_link > 0 ? (r.visualizacoes_pagina / r.cliques_link) * 100 : 0,
    custo_por_vis_pagina: r.visualizacoes_pagina > 0 ? inv / r.visualizacoes_pagina : 0,
    taxa_vendas_vis_pagina: r.visualizacoes_pagina > 0 ? (r.compras_meta / r.visualizacoes_pagina) * 100 : 0,

    /*
      As mesmas contas, com a venda REGISTRADA no lugar da reivindicada.

      Elas existem separadas em vez de um botão que troca a fonte porque a
      pergunta que essas colunas respondem é justamente a DIFERENÇA: um anúncio
      com ROAS 1,81 pelo Meta e 1,51 pela Payt não é um anúncio com dois ROAS,
      é um anúncio cuja atribuição está inflada em 20% -- e isso só se vê com
      os dois na mesma linha.
    */
    resultado_payt: r.receita_payt - inv,
    margem_payt: r.receita_payt > 0 ? ((r.receita_payt - inv) / r.receita_payt) * 100 : 0,
    roas_payt: inv > 0 ? r.receita_payt / inv : 0,
    cpa_payt: r.vendas_payt > 0 ? inv / r.vendas_payt : 0,
  };
}

/** Soma as contagens das linhas e refaz as razões sobre o total. */
function totalDe(rows: LinhaCalculada[]): LinhaCalculada {
  const soma = rows.reduce((acc, linha) => {
    const c = contagens(linha);
    (Object.keys(c) as (keyof typeof c)[]).forEach(k => { acc[k] = (acc[k] ?? 0) + c[k]; });
    return acc;
  }, {} as Record<string, number>);
  return comRazoes({ ...soma, nome: 'Total' });
}

/*
  A tinta que separa os dois blocos.

  Doze colunas seguidas com "(Meta)" e "(Payt)" no rótulo são doze leituras de
  texto para descobrir onde um bloco acaba e o outro começa. A faixa de fundo
  resolve isso antes da leitura — e é por isso que ela é de AGRUPAMENTO, não de
  estado: em 7% de opacidade não diz "bom" nem "ruim", diz "de onde veio".

  As cores saem de tokens (`--fonte-meta`, `--fonte-payt`) e não de hex aqui
  dentro, que é a regra da IDV na CLAUDE.md.
*/
const TINTA: Record<string, string> = {
  meta: "bg-[hsl(var(--fonte-meta)/0.07)]",
  payt: "bg-[hsl(var(--fonte-payt)/0.07)]",
};

/** "3 campanhas", "1 conjunto" — o que o total está somando. */
function rotuloNivel(nivel: Nivel, n: number) {
  if (nivel === 'campanha') return n === 1 ? 'campanha' : 'campanhas';
  if (nivel === 'adset') return n === 1 ? 'conjunto' : 'conjuntos';
  return n === 1 ? 'anúncio' : 'anúncios';
}

function fmtCell(row: LinhaCalculada, col: (typeof COLS)[number]) {
  const v = Number(row[col.key] ?? 0);
  // `formatCurrency`, e nao `R$ ${v.toFixed(2)}`: a tabela mostrava
  // "R$ 43915.63" com ponto decimal e sem separador de milhar, enquanto o
  // cartao de conciliacao logo abaixo, na mesma tela, mostrava
  // "R$ 43.915,63". O CLAUDE.md pede os formatadores justamente para isso.
  if (col.money) return formatCurrency(v);
  if (col.pct) return `${v.toFixed(2)}%`;
  if (col.suffix) return `${v.toFixed(2)}${col.suffix}`;
  if (col.num) return formatNumber(v);
  return row[col.key] ?? "-";
}

/**
 * A coluna que não rola junto.
 *
 * A tabela tem 24 colunas e nasceu para ser rolada de lado. Sem prender o
 * nome, no meio da rolagem sobra uma fileira de números sem dono — e a
 * pergunta que a tela existe para responder é "qual anúncio é esse".
 *
 * Precisa de fundo próprio: célula `sticky` sem fundo deixa o resto da linha
 * passar por baixo. `group-hover` porque o realce da linha é do `<tr>`, e a
 * célula presa não o herdaria.
 */
const COL_FIXA = "sticky z-10 bg-card group-hover:bg-secondary";

/**
 * O ponto que diz se aquela linha está no ar.
 *
 * Um ponto, e não um selo com texto: ele divide a coluna do nome com o chevron
 * e com o próprio nome, que já vive truncado em `max-w-48`. O rótulo inteiro
 * fica no `title`, junto com a explicação do que aquilo significa.
 *
 * Sem estado NÃO vira ponto cinza: vira um anel vazio, com título dizendo o
 * porquê. Um cinza no meio de outros cinzas ("parado", "sem dado") faria
 * "não sei" parecer "está desligado", e são coisas diferentes.
 */
function PontoDeSituacao({ estado }: { estado?: EstadoDoObjeto }) {
  if (!estado) {
    return (
      <span
        title="Sem estado: a Meta não deixou ler a configuração desta conta."
        className="h-1.5 w-1.5 shrink-0 rounded-full border border-muted-foreground/30"
      />
    );
  }

  const s = situacaoDe(estado.situacao)!;
  const detalhe = [
    s.rotulo + " — " + s.explica,
    estado.effective_status ? "Meta: " + estado.effective_status : null,
    estado.dias_sem_entregar != null && estado.dias_sem_entregar > 1
      ? "sem entregar há " + estado.dias_sem_entregar + " dias"
      : null,
  ].filter(Boolean).join(" · ");

  return <span title={detalhe} className={cn("h-1.5 w-1.5 shrink-0 rounded-full", s.ponto)} />;
}

/**
 * O sumário de situações, que também é o filtro.
 *
 * Segunda armadilha do CLAUDE.md: cadastrar sem medir. Guardar o estado de 486
 * objetos e não mostrar a contagem em lugar nenhum seria criar o dado e nunca
 * mais voltar nele.
 */
function LinhaDeSituacoes({ contagem, semEstado, filtro, onFiltrar }: {
  contagem: Map<string, number>;
  semEstado: number;
  filtro: string | null;
  onFiltrar: (s: string) => void;
}) {
  const presentes = ORDEM_SITUACAO.filter(s => (contagem.get(s) ?? 0) > 0);
  if (presentes.length === 0 && semEstado === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {presentes.map(s => {
        const cfg = SITUACAO[s];
        const ativo = filtro === s;
        return (
          <button
            key={s}
            type="button"
            onClick={() => onFiltrar(s)}
            title={cfg.explica}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors",
              cfg.selo,
              ativo ? "ring-1 ring-inset ring-current" : "opacity-80 hover:opacity-100",
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", cfg.ponto)} />
            {cfg.rotulo}
            <span className="font-semibold tabular-nums">{contagem.get(s)}</span>
          </button>
        );
      })}

      {/*
        Quantos a Meta não deixou ler.

        Aparece porque a alternativa é a tabela mostrar linhas sem ponto e
        ninguém saber por quê. Hoje são objetos de duas contas cujo token
        perdeu a permissão de leitura.
      */}
      {semEstado > 0 && (
        <span
          title="A Meta não deixou ler a configuração destas contas. Conceder ads_read ao usuário do sistema no Business Manager resolve."
          className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground"
        >
          <span className="h-1.5 w-1.5 rounded-full border border-muted-foreground/40" />
          Sem estado
          <span className="font-semibold tabular-nums">{semEstado}</span>
        </span>
      )}

      {filtro && (
        <button
          type="button"
          onClick={() => onFiltrar(filtro)}
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          limpar
        </button>
      )}
    </div>
  );
}
function roasColor(v: number) {
  return v >= 3 ? "text-green-400" : v >= 1 ? "text-yellow-400" : "text-red-400";
}
function margemColor(v: number) {
  return v >= 30 ? "text-green-400" : v >= 15 ? "text-yellow-400" : "text-red-400";
}

export default function MetaAdsPage() {
  const { startDateStr, endDateStr, contaIds } = useFilters();
  const [allRows, setAllRows] = useState<LinhaMetricaMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState("investimento");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  // Checkboxes: IDs selecionados por nível pai (para filtrar filhos)
  const [selectedCamp, setSelectedCamp] = useState<Set<string>>(new Set());
  const [selectedAdset, setSelectedAdset] = useState<Set<string>>(new Set());
  /*
    Qual linha está com o funil aberto.

    Uma de cada vez, e não um conjunto: o funil é uma leitura de foco — "por
    onde some a gente desta campanha" —, e três abertos ao mesmo tempo viram
    rolagem em vez de comparação. Quem quer comparar tem a tabela inteira,
    que é para isso que ela existe.
  */
  const [funilAberto, setFunilAberto] = useState<string | null>(null);

  /*
    A aba passa a ser controlada, e a busca é uma só.

    Ela vale para o nível ABERTO — procurar campanha na aba de campanhas,
    conjunto na de conjuntos, anúncio na de anúncios. Três caixas, uma por
    aba, seriam três estados para a mesma intenção, e a pessoa acabaria
    digitando na de cima e olhando a de baixo.

    Trocar de aba limpa a busca: o termo que acha uma campanha quase nunca
    acha um anúncio, e uma tabela vazia sem motivo visível é pior do que
    recomeçar a digitar.
  */
  const [aba, setAba] = useState<'campanhas' | 'conjuntos' | 'anuncios'>('campanhas');
  const [busca, setBusca] = useState('');

  /*
    O que a Meta diz sobre cada objeto: ligado, pausado, reprovado.

    Vem de `vw_meta_status`, e não de `fn_metricas_meta_agregado`, porque são
    duas naturezas diferentes: métrica é histórico por dia e responde ao filtro
    de período; estado é AGORA e não tem data. Juntar os dois na mesma consulta
    faria o estado parecer que muda quando se troca o mês.
  */
  const [estados, setEstados] = useState<Map<string, EstadoDoObjeto>>(new Map());
  const [filtroSituacao, setFiltroSituacao] = useState<string | null>(null);

  /*
    O card de Produção de cada anúncio.

    O vínculo já existia em `producao_ads` (`ad_id` → `producao_id`), montado
    pelo módulo de Criativos, e cobre 339 dos 346 anúncios com gasto nos últimos
    30 dias — 98% da verba. O que faltava era usá-lo aqui: quem olha o
    desempenho de um AD nesta tela e quer ver o criativo tinha que decorar o
    número, ir para Produção e procurar.
  */
  const { perfil, user } = useAuth();
  const nivelProducao: ProducaoNivel = perfil?.is_admin ? 'socio'
    : perfil?.cargo?.pode_aprovar ? 'head' : 'membro';
  const [cardDeAd, setCardDeAd] = useState<Map<string, string>>(new Map());
  const [cardAberto, setCardAberto] = useState<string | null>(null);

  /*
    A soma acontece no banco, e não aqui.

    A tela pedia a view inteira — uma linha por dia e por nível — e somava no
    JavaScript. O PostgREST corta em 1.000 linhas por padrão e não avisa:
    devolve 200 com mil linhas. Agosto tem 3.285.

    O que isso mostrava, medido com "Este mês":

      na tela    6 campanhas   R$  25.082,09
      no banco  16 campanhas   R$ 102.541,16

    Um quarto do gasto, dez campanhas sumidas, sem erro nenhum. E o cartão de
    conciliação logo abaixo, na MESMA tela, já mostrava R$ 102.541,16.

    `fn_metricas_meta_agregado` devolve uma linha só de jsonb, com os níveis já
    somados — e uma linha não tem teto para cortar.
  */
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("fn_metricas_meta_agregado", {
        p_inicio: startDateStr || null,
        p_fim: endDateStr || null,
        p_contas: contaIds,
      });
      // Erro tem que aparecer como erro: tela com zeros e "não consegui ler"
      // são coisas diferentes, e confundi-las é como este defeito durou tanto.
      if (error) {
        console.error("fn_metricas_meta_agregado:", error.message);
        setErro(error.message);
        setAllRows([]);
      } else {
        setErro(null);
        setAllRows((data as LinhaMetricaMeta[]) ?? []);
      }
      setLoading(false);
    };
    load();
  }, [startDateStr, endDateStr, contaIds]);

  /*
    O vínculo anúncio → card não depende de período nem de conta: é cadastro.

    Paginado pelo mesmo motivo do estado — são 669 vínculos hoje, abaixo do teto
    de 1.000 do PostgREST, e é exatamente esse teto que já escondeu um quarto do
    gasto desta tela uma vez.
  */
  useEffect(() => {
    void (async () => {
      const PAGINA = 1000;
      const pares: [string, string][] = [];
      for (let de = 0; ; de += PAGINA) {
        const { data, error } = await supabase
          .from('producao_ads')
          .select('ad_id,producao_id')
          .range(de, de + PAGINA - 1);
        if (error) { console.error('producao_ads:', error.message); break; }
        const lote = (data ?? []) as { ad_id: string; producao_id: string }[];
        pares.push(...lote.map(l => [l.ad_id, l.producao_id] as [string, string]));
        if (lote.length < PAGINA) break;
      }
      setCardDeAd(new Map(pares));
    })();
  }, []);

  /*
    O estado não depende do período: carrega uma vez, e recarrega só quando a
    conta muda.

    Em páginas de 1.000 porque é exatamente esse o teto que o PostgREST aplica
    calado — o mesmo defeito que já escondeu um quarto do gasto desta tela. Com
    486 objetos hoje uma página bastaria; o laço existe para o dia em que não
    bastar, que chegaria sem aviso.
  */
  useEffect(() => {
    const carregarEstado = async () => {
      const PAGINA = 1000;
      const todos: EstadoDoObjeto[] = [];
      for (let de = 0; ; de += PAGINA) {
        let q = supabase
          .from('vw_meta_status')
          .select('nivel,objeto_id,situacao,status,effective_status,dias_sem_entregar')
          .range(de, de + PAGINA - 1);
        if (contaIds && contaIds.length > 0) q = q.in('ad_account_id', contaIds);
        const { data, error } = await q;
        if (error) { console.error('vw_meta_status:', error.message); break; }
        const lote = (data ?? []) as EstadoDoObjeto[];
        todos.push(...lote);
        if (lote.length < PAGINA) break;
      }
      setEstados(new Map(todos.map(e => [chaveEstado(e.nivel, e.objeto_id), e])));
    };
    void carregarEstado();
  }, [contaIds]);

  /*
    Filtra o nível e calcula as razões — a soma já veio pronta.

    As razões ficam aqui, e não no SQL, apesar de a view também as calcular:
    razão de um dia não se soma. CPM de 28 dias somados não é o CPM do mês.
    Quem agrega tem que recalcular depois, e por isso a conta mora num lugar
    só, aplicada sobre os totais.
  */
  const aggregate = (nivel: Nivel, parentIds?: Set<string>) => {
    const filtered = allRows.filter((r) => {
      if (r.nivel !== nivel) return false;
      if (parentIds && parentIds.size > 0 && r.parent_id) {
        return parentIds.has(r.parent_id);
      }
      return true;
    });

    return filtered
      .map(comRazoes)
      .sort((a, b) => {
        const va = Number(a[sortCol as keyof LinhaCalculada]) || 0;
        const vb = Number(b[sortCol as keyof LinhaCalculada]) || 0;
        return sortDir === "desc" ? vb - va : va - vb;
      });
  };

  const handleSort = (key: string) => {
    if (sortCol === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortCol(key);
      setSortDir("desc");
    }
  };

  const toggleCamp = (id: string) =>
    setSelectedCamp((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  const toggleAdset = (id: string) =>
    setSelectedAdset((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  /*
    A busca filtra por nome, sem acento e sem caso.

    `normalizar` e não `toLowerCase` puro: "Saponária" e "saponaria" são a
    mesma campanha para quem procura, e exigir o acento certo num campo de
    busca é o tipo de exigência que faz a pessoa concluir que não achou.
  */
  const normalizar = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  const filtrarPorNome = (rows: LinhaCalculada[]) => {
    const termo = normalizar(busca.trim());
    if (!termo) return rows;
    return rows.filter(r => normalizar(String(r.nome ?? '')).includes(termo));
  };

  const estadoDaLinha = (r: LinhaCalculada) =>
    r.nivel && r.nivel_id ? estados.get(chaveEstado(r.nivel, r.nivel_id)) : undefined;

  /*
    O filtro por situação vem DEPOIS da busca, e a contagem é feita antes dele.

    Se a contagem contasse o resultado já filtrado, clicar em "Rodando" faria os
    outros selos irem a zero — e a linha de selos, que existe para comparar as
    situações entre si, viraria uma tautologia.
  */
  const filtrarPorSituacao = (rows: LinhaCalculada[]) =>
    filtroSituacao === null ? rows
      : rows.filter(r => estadoDaLinha(r)?.situacao === filtroSituacao);

  const campBase  = filtrarPorNome(aggregate("campanha"));
  const adsetBase = filtrarPorNome(aggregate("adset", selectedCamp.size > 0 ? selectedCamp : undefined));
  const adBase    = filtrarPorNome(aggregate("ad", selectedAdset.size > 0 ? selectedAdset : undefined));

  const baseDaAba = aba === 'campanhas' ? campBase : aba === 'conjuntos' ? adsetBase : adBase;

  const contagemSituacao = useMemo(() => {
    const c = new Map<string, number>();
    let semEstado = 0;
    for (const r of baseDaAba) {
      const e = estadoDaLinha(r);
      if (!e) { semEstado++; continue; }
      c.set(e.situacao, (c.get(e.situacao) ?? 0) + 1);
    }
    return { c, semEstado };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseDaAba, estados]);

  const campRows  = filtrarPorSituacao(campBase);
  const adsetRows = filtrarPorSituacao(adsetBase);
  const adRows    = filtrarPorSituacao(adBase);

  const renderTable = (
    rows: LinhaCalculada[],
    nivel: Nivel,
    showCheck?: boolean,
    onCheck?: (id: string) => void,
    checked?: Set<string>,
  ) =>
    loading ? (
      <div className="p-8 text-center text-muted-foreground animate-pulse">Carregando...</div>
    ) : erro ? (
      <div className="p-8 text-center">
        <p className="text-sm font-medium text-foreground">Não foi possível carregar as métricas</p>
        <p className="mt-1 text-xs text-muted-foreground">{erro}</p>
      </div>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {showCheck && <th className={cn("px-3 py-3 w-8", COL_FIXA, "left-0")} />}
              {COLS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => !c.fixed && handleSort(c.key)}
                  className={cn(
                    "px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase whitespace-nowrap",
                    !c.fixed && "cursor-pointer hover:text-foreground select-none",
                    c.fonte && TINTA[c.fonte],
                    sortCol === c.key && "text-primary",
                    // O nome acompanha a rolagem lateral: são 24 colunas, e sem
                    // ele a linha vira uma fileira de números sem dono.
                    c.key === "nome" && cn(COL_FIXA, "border-r border-border", showCheck ? "left-8" : "left-0"),
                  )}
                >
                  {c.label}
                  {sortCol === c.key ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((r, i) => [
              <tr key={i} className="group border-b border-border/50 hover:bg-secondary/50">
                {showCheck && onCheck && (
                  <td className={cn("px-3 py-2", COL_FIXA, "left-0")}>
                    <input
                      type="checkbox"
                      checked={checked?.has(r.nivel_id) || false}
                      onChange={() => onCheck(r.nivel_id)}
                      className="accent-primary cursor-pointer"
                    />
                  </td>
                )}
                {COLS.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-3 py-2 whitespace-nowrap",
                      c.fonte && TINTA[c.fonte],
                      c.key === "nome" && cn(
                        "text-foreground font-medium max-w-48 truncate",
                        COL_FIXA, "border-r border-border", showCheck ? "left-8" : "left-0",
                      ),
                      // As duas leituras de ROAS e margem ganham a mesma
                      // semaforo: 1,8x pelo Meta e 1,5x pela Payt precisam ser
                      // lidos na mesma escala para a diferenca saltar.
                      (c.key === "roas" || c.key === "roas_payt") && roasColor(Number(r[c.key as keyof typeof r])),
                      (c.key === "margem" || c.key === "margem_payt") && margemColor(Number(r[c.key as keyof typeof r])),
                      (c.key === "resultado" || c.key === "resultado_payt") &&
                        (Number(r[c.key as keyof typeof r]) >= 0 ? "text-success" : "text-destructive"),
                      !["nome", "roas", "roas_payt", "margem", "margem_payt", "resultado", "resultado_payt"]
                        .includes(c.key) && "text-foreground",
                    )}
                  >
                    {c.key === "nome" ? (
                      /*
                        O funil abre na própria linha.

                        Ele vinha de uma página inteira que, tirando este
                        desenho, repetia as colunas daqui. Um funil não precisa
                        de tela: precisa da linha a que se refere — e aqui não
                        há o passo de escolher a campanha de novo, do outro
                        lado do menu.
                      */
                      /*
                        Dois alvos na mesma célula, porque são duas perguntas.

                        O chevron abre o FUNIL daquela linha (impressão → clique
                        → compra). O nome abre o CARD DE PRODUÇÃO do anúncio —
                        o criativo, quem escreveu, quem editou, em que fase está.

                        Antes a célula inteira era um botão só, do funil. Quem
                        via um AD gastando mal e queria ver a peça tinha que
                        decorar o número e procurar em Produção.

                        Só no nível de anúncio: campanha e conjunto não têm card,
                        e ali o nome continua abrindo o funil, como sempre.
                      */
                      <div className="flex w-full items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setFunilAberto(a => (a === r.nivel_id ? null : r.nivel_id))}
                          title="Ver o funil desta linha"
                          className="shrink-0 hover:text-primary"
                        >
                          <ChevronRight
                            className={cn(
                              "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
                              funilAberto === r.nivel_id && "rotate-90 text-primary",
                            )}
                          />
                        </button>

                        {/*
                          O ponto vive AQUI, na coluna do nome, e não numa coluna
                          própria: são 24 colunas e só esta acompanha a rolagem —
                          uma coluna de status seria a 25ª, fora da tela em todo
                          monitor que não seja ultrawide.

                          O texto inteiro fica no `title`, porque o ponto diz que
                          há algo e não o quê.
                        */}
                        <PontoDeSituacao estado={estadoDaLinha(r)} />

                        {nivel === 'ad' && cardDeAd.get(r.nivel_id) ? (
                          <button
                            type="button"
                            onClick={() => setCardAberto(cardDeAd.get(r.nivel_id)!)}
                            title={`${r.nome ?? ''} — abrir o card em Produção`}
                            className="truncate text-left underline-offset-2 transition-colors hover:text-primary hover:underline"
                          >
                            {r.nome}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setFunilAberto(a => (a === r.nivel_id ? null : r.nivel_id))}
                            title={r.nome ?? undefined}
                            className="truncate text-left hover:text-primary"
                          >
                            {r.nome}
                          </button>
                        )}
                      </div>
                    ) : (
                      fmtCell(r, c)
                    )}
                  </td>
                ))}
              </tr>,
              funilAberto === r.nivel_id && (
                <tr key={`${i}-funil`} className="border-b border-border/50 bg-muted/20">
                  {/*
                    O funil fica preso à esquerda, como o nome.

                    A célula ocupa a largura da tabela inteira — 2.437px — e
                    sem isto as barras e os números iam parar fora da tela
                    assim que alguém rolasse de lado. `max-w` para o desenho
                    não esticar até o fim numa tela larga: barra de dois metros
                    não compara melhor que barra de meio.
                  */}
                  <td colSpan={COLS.length + (showCheck ? 1 : 0)} className="p-0">
                    <div className="sticky left-0 max-w-[34rem]">
                    <FunilDaLinha
                      impressoes={Number(r.impressoes || 0)}
                      cliques={Number(r.cliques || 0)}
                      visualizacoes_pagina={Number(r.visualizacoes_pagina || 0)}
                      initiate_checkout={Number(r.initiate_checkout || 0)}
                      compras_meta={Number(r.compras_meta || 0)}
                    />
                    </div>
                  </td>
                </tr>
              ),
            ])}
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLS.length + (showCheck ? 1 : 0)} className="px-4 py-8 text-center text-muted-foreground">
                  {showCheck && checked?.size === 0
                    ? "Selecione campanhas na aba anterior para filtrar"
                    : busca.trim()
                      ? `Nada com "${busca.trim()}" neste período.`
                      : "Sem dados"}
                </td>
              </tr>
            )}
          </tbody>

          {/*
            O total do que está na tela.

            Em `tfoot` e não como última linha do `tbody`: assim ele não entra
            na ordenação nem some quando alguém ordena por outra coluna.

            As razões do rodapé são refeitas sobre os totais por `comRazoes`, a
            MESMA função que calcula as das linhas — somar as margens das sete
            campanhas daria um número sem significado nenhum.

            Ele acompanha a busca de propósito: filtrou por "TESTE", o total é
            dos TESTE. É o que responde "quanto gastei nisso que estou olhando".
          */}
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border bg-secondary/60 font-semibold">
                {showCheck && <th className={cn("px-3 py-3 w-8", COL_FIXA, "left-0", "bg-secondary")} />}
                {COLS.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-3 py-3 whitespace-nowrap text-foreground",
                      c.fonte && TINTA[c.fonte],
                      c.key === "nome" &&
                        cn(COL_FIXA, "border-r border-border bg-secondary", showCheck ? "left-8" : "left-0"),
                    )}
                  >
                    {c.key === "nome"
                      ? `Total · ${rows.length} ${rotuloNivel(nivel, rows.length)}`
                      : fmtCell(totalDe(rows), c)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    );

  return (
    <DashboardLayout title="Meta Ads" hideTitle>
      {/*
        Conta que parou de sincronizar aparece aqui como tarja, e não só como
        ponto cinza na tabela: a tabela mostra o que foi lido, e o que não foi
        lido não tem linha para carregar aviso nenhum. Sem esta tarja, uma conta
        inteira pode sumir sem deixar rastro na tela — foi o que aconteceu.
      */}
      <AlertaSyncMeta className="mb-4" />

      <Tabs
        value={aba}
        onValueChange={(v) => { setAba(v as typeof aba); setBusca(''); }}
      >
        {/* A busca fica na MESMA linha das abas: ela pertence ao nivel aberto,
            e separada delas pareceria um filtro global. */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
        <TabsList className="bg-secondary border border-border">
          <TabsTrigger
            value="campanhas"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            Campanhas
          </TabsTrigger>
          <TabsTrigger
            value="conjuntos"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            Conjuntos
          </TabsTrigger>
          <TabsTrigger
            value="anuncios"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            Anúncios
          </TabsTrigger>
        </TabsList>

        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={
              aba === 'campanhas' ? 'Buscar campanha...'
                : aba === 'conjuntos' ? 'Buscar conjunto...'
                  : 'Buscar anúncio...'
            }
            className="h-9 pl-8 text-sm"
          />
        </div>
        </div>

        {/*
          A linha de situações: a resposta para "o que está ligado?".

          Ela fica acima da tabela e não dentro dela porque é um SUMÁRIO — as
          24 colunas de número respondem "quanto rendeu", e nenhuma respondia
          "está no ar". Cada selo filtra a tabela ao ser clicado.

          A ordem é por quanto pede ação, não por quantidade: o que alguém
          ligou e não está rodando vem antes do que roda, e o que foi desligado
          de propósito vem por último.
        */}
        <LinhaDeSituacoes
          contagem={contagemSituacao.c}
          semEstado={contagemSituacao.semEstado}
          filtro={filtroSituacao}
          onFiltrar={s => setFiltroSituacao(f => (f === s ? null : s))}
        />

        <TabsContent value="campanhas">
          {selectedCamp.size > 0 && (
            <div className="mb-3 flex items-center gap-2 text-xs text-primary">
              <span>{selectedCamp.size} campanha(s) selecionada(s) — conjuntos e anúncios filtrados</span>
              <button
                onClick={() => {
                  setSelectedCamp(new Set());
                  setSelectedAdset(new Set());
                }}
                className="underline hover:no-underline"
              >
                Limpar
              </button>
            </div>
          )}
          {/*
            De onde vem cada número, dito na tela.

            "Lucro" aqui era faturamento atribuído menos gasto — e "Lucro" no
            Resumo é depois da taxa da Payt, do Simples e do imposto de mídia.
            A mesma palavra com duas contas em duas telas é a primeira
            armadilha do CLAUDE.md aplicada ao vocabulário: ninguém percebe que
            divergiu, porque as duas parecem certas.

            Virou "Retorno", e o que é atribuição do Meta passou a dizer que é:
            em agosto o Meta atribui R$ 182.499,40 enquanto a Payt registrou
            R$ 178.200,72 — duas fontes, dois números, e a coluna não dizia de
            qual estava falando.
          */}
          <p className="text-xs text-muted-foreground mb-2">
            Marque campanhas para filtrar conjuntos e anúncios nas abas seguintes.
            <span className="block mt-1">
              As colunas <b>(Meta)</b> são o que o pixel reivindica; as <b>(Payt)</b> são a venda
              registrada, casada pelo id do anúncio. O Meta costuma contar a mais, porque credita
              janela de visualização — a diferença entre as duas é a inflação da atribuição.
            </span>
            <span className="block mt-1">
              Retorno = faturamento − gasto nos dois casos; não desconta taxa, Simples nem imposto
              de mídia — o lucro da empresa está no Resumo. A receita da Payt é sem juros de
              parcelamento, que não são mérito do anúncio.
            </span>
            <span className="block mt-1">
              CTR e CPC contam clique no <b>link</b>, como o Gerenciador — a coluna "Cliques
              (total)" inclui curtida, comentário e ver perfil.
            </span>
          </p>
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {renderTable(campRows, "campanha", true, toggleCamp, selectedCamp)}
          </div>
        </TabsContent>

        <TabsContent value="conjuntos">
          {selectedCamp.size > 0 && (
            <div className="mb-3 text-xs text-primary">
              Mostrando conjuntos de {selectedCamp.size} campanha(s) selecionada(s)
              {selectedAdset.size > 0 && <span> · {selectedAdset.size} conjunto(s) marcado(s)</span>}
            </div>
          )}
          <p className="text-xs text-muted-foreground mb-2">Marque conjuntos para filtrar anúncios na aba seguinte.</p>
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {renderTable(adsetRows, "adset", true, toggleAdset, selectedAdset)}
          </div>
        </TabsContent>

        <TabsContent value="anuncios">
          {selectedAdset.size > 0 && (
            <div className="mb-3 text-xs text-primary">
              Mostrando anúncios de {selectedAdset.size} conjunto(s) selecionado(s)
            </div>
          )}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {renderTable(adRows, "ad", false)}
          </div>
        </TabsContent>
      </Tabs>

      {/* O que a Meta reporta de campanha contra o que ela debitou da conta.
          Mora aqui, e nao no Financeiro: la a regra e trabalhar so com
          movimentacao bancaria, e este bloco existe justamente para comparar o
          banco com uma fonte de fora. A leitura tambem e desta tela — quem olha
          ROAS precisa saber que a cobranca vem ~14% acima do investimento
          reportado. */}
      <div className="mt-6">
        <ConciliacaoMeta meses={6} />
      </div>

      {/*
        O card abre SOBRE o Meta Ads, como na Esteira e em Criativos Meta: sair
        da tela para ver o criativo e ter que voltar, refazendo periodo e
        filtros, e o que faz ninguem conferir.

        funis e perfis vazios porque fora da Producao nao ha de onde tira-los, e
        o drawer so os usa no seletor de funil e nas mencoes.
      */}
      <CriativoDrawer
        criativoId={cardAberto}
        onClose={() => setCardAberto(null)}
        onUpdate={() => { /* metrica nao muda ao editar o card */ }}
        nivel={nivelProducao}
        userId={user?.id ?? ''}
        funis={[]}
        perfis={[]}
      />
    </DashboardLayout>
  );
}
