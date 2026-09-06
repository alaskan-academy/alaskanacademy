import { todasAsLinhas } from '@/lib/supabase';
import { paraYmd } from '@/lib/datas';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { supabase } from '@/lib/supabase';
import { useProjetosDaEmpresa } from '@/hooks/use-projetos-da-empresa';
import { formatNumber, formatPercent } from '@/lib/formatters';
import { fetchProjetos, fetchFunis } from '@/lib/dataCache';
import { MultiFilter } from '@/features/producao/components/MultiFilter';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CriativoDrawer } from '@/features/producao/components/CriativoDrawer';
import { useMetricasDoAd, LegendaFontes } from '@/features/criativos/metricasDoAd';
import { formatCurrency, formatNumber as fmtNum } from '@/lib/formatters';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import type { Perfil, Funil } from '@/features/producao/components/types';
import { aoClicarSemArrastar } from '@/lib/clique';

import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, LineChart, Line, Legend,
} from 'recharts';

// Constantes de módulo — não recriadas a cada render
const TIPO_LABEL: Record<string, string> = { criativo: 'Criativo', vsl: 'VSL', aula: 'Aula' };

const CHART_COLORS = {
  primary:   '#6366f1',
  validados: '#10b981',
  escalados: '#3b82f6',
  aprovados: '#a78bfa',
} as const;

interface PostadoRow {
  id: string;
  nome: string;
  tipo: string;
  formato: string | null;
  angulo_teste: string | null;
  nivel_consciencia: string | null;
  avaliacao: string | null;
  status_veiculacao: string | null;
  responsavel_id: string | null;
  projeto_id: string | null;
  funil_ids: string[];
  funil_video: string | null;
  responsavel: { id: string; nome: string } | null;
  projeto: { id: string; nome: string } | null;
  data_inicio: string | null;
  data_inicio_hist: string | null;
  data_ref: string | null;
}

type Preset = 'this' | 'last' | 'custom';

function startOfMonth(offset = 0): Date {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfMonth(offset = 0): Date {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset + 1);
  d.setDate(0);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Era `d.toISOString().slice(0, 10)`, e recebia datas com
 * `setHours(23, 59, 59)`. No Brasil isso é 02:59 UTC do dia seguinte: o fim do
 * mês virava o dia 1º do mês seguinte, e a janela inteira escorregava um dia.
 * `paraYmd` lê os componentes locais e não se importa com a hora.
 */
const toYMD = paraYmd;

// Pure functions — definidas fora do componente para evitar recriação
const isEscalado  = (r: PostadoRow) => r.avaliacao === 'Escalado';
const isValidado  = (r: PostadoRow) => r.avaliacao === 'Validado';
const isAprovado  = (r: PostadoRow) => r.avaliacao === 'Validado' || r.avaliacao === 'Escalado';

/*
  Os dois estados que não apareciam em lugar nenhum.

  A linha de KPIs somava validado + escalado + não validado e parava aí. Nos
  180 ADs de agosto isso deixava 66 de fora — 37% do mês invisível, e
  invisível justo do lado errado: card sem avaliação é trabalho aguardando
  julgamento, e card sem dados é AD que rodou e não gerou o suficiente para se
  concluir nada. São coisas diferentes e nenhuma das duas é "não validado".

  Sem elas na tela, a taxa de validação parecia calculada sobre o que foi
  avaliado quando na verdade o denominador inclui quem nunca foi.
*/
const semAvaliacao = (r: PostadoRow) => !r.avaliacao;
const semDados     = (r: PostadoRow) => r.avaliacao === 'Sem dados';

/**
 * O mesmo funil escrito de três jeitos.
 *
 * `funil_video` é texto livre com os funis separados por vírgula, e o campo
 * acumulou três grafias da MESMA combinação — medido em 31/08/2026 sobre os
 * cards postados:
 *
 *     "TSL, VSL"   309
 *     "TSL,VSL"     10
 *     "VSL,TSL"      5
 *
 * A tabela mostrava as três como linhas separadas, e 324 cards viravam três
 * amostras pequenas em vez de uma. Uma delas dizia 11,11% de validação sobre 9
 * cards, o que não é taxa — é um card.
 *
 * Normalizar é separar, tirar espaço e ORDENAR: sem a ordenação, "TSL,VSL" e
 * "VSL,TSL" continuariam sendo chaves diferentes.
 *
 * Isto conserta a LEITURA. A escrita continua livre, então a próxima grafia
 * nova também vai cair aqui — o conserto de raiz é o campo virar uma escolha
 * em vez de texto, e isso é decisão de quem cadastra.
 */
function normalizarFunil(v: string | null | undefined): string | null {
  if (!v) return null;
  const partes = v.split(",").map(x => x.trim().toUpperCase()).filter(Boolean);
  if (partes.length === 0) return null;
  return [...new Set(partes)].sort().join(", ");
}

/**
 * Quanto tempo o AD ficou no ar: da primeira impressão até a última.
 *
 * Vem de `fn_vida_util_ads()`, e não de uma subtração aqui, porque duas coisas
 * estragam o número e as duas moram no banco:
 *
 *   `aberta`   — o AD ainda está ACTIVE na Meta. A última impressão dele é
 *                ontem porque ele está vivo, não porque parou. Somá-lo à média
 *                responderia "quanto durou até agora", que é outra pergunta.
 *
 *   `truncada` — a primeira impressão cai em 01/05/2026, o primeiro dia que
 *                `metricas_meta` tem. O AD provavelmente começou antes e a vida
 *                aparece menor do que foi.
 *
 * Medido em 31/08/2026 sobre 403 cards: 39 abertos, 12 truncados. Nos que
 * sobram, a mediana é 6 dias e o maior viveu 104.
 */
interface Vida {
  producao_id: string;
  dias: number | null;
  aberta: boolean;
  truncada: boolean;
}

function rotuloDaVida(v?: Vida): string {
  if (!v || v.dias == null) return '—';
  /* O sinal fica ANTES do número, não num rodapé: quem lê a linha precisa saber
     que aqueles 40 dias ainda estão correndo antes de compará-los com 6. */
  const marca = v.aberta ? '≥ ' : v.truncada ? '> ' : '';
  return `${marca}${v.dias} ${v.dias === 1 ? 'dia' : 'dias'}`;
}

/**
 * Ordenação por coluna da tabela de ADs escalados.
 *
 * `numerica` decide só o PRIMEIRO clique: em texto o esperado é A→Z, em
 * dinheiro é o maior primeiro — ninguém abre a tabela de verba querendo ver
 * quem gastou menos.
 */
type ColEscalados = 'nome' | 'tipo' | 'formato' | 'angulo' | 'editor' | 'projeto'
                  | 'vida' | 'verba' | 'roas' | 'vendas';

type Ordem = { col: ColEscalados; desc: boolean };

const COLUNAS_ESCALADOS: { col: ColEscalados; rotulo: string; numerica: boolean }[] = [
  { col: 'nome',    rotulo: 'Nome',    numerica: false },
  { col: 'tipo',    rotulo: 'Tipo',    numerica: false },
  { col: 'formato', rotulo: 'Formato', numerica: false },
  { col: 'angulo',  rotulo: 'Ângulo',  numerica: false },
  { col: 'editor',  rotulo: 'Editor',  numerica: false },
  { col: 'projeto', rotulo: 'Projeto', numerica: false },
  { col: 'vida',    rotulo: 'Vida',    numerica: true  },
  { col: 'verba',   rotulo: 'Verba',   numerica: true  },
  { col: 'roas',    rotulo: 'ROAS',    numerica: true  },
  { col: 'vendas',  rotulo: 'Vendas',  numerica: true  },
];

/**
 * Compara duas chaves com a ausência SEMPRE por último, nos dois sentidos.
 *
 * O travessão da tabela quer dizer "não sei" — AD sem anúncio vinculado —, e
 * não "zero". Se o nulo virasse zero, inverter a ordem traria doze linhas
 * vazias para o topo e empurraria para fora justamente o que se foi olhar.
 */
function compararChaves(a: string | number | null, b: string | number | null, desc: boolean): number {
  if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1;
  const c = typeof a === 'string' ? a.localeCompare(String(b), 'pt-BR') : a - Number(b);
  return desc ? -c : c;
}

function ThOrdenavel({ col, rotulo, numerica, ordem, setOrdem }: {
  col: ColEscalados; rotulo: string; numerica: boolean;
  ordem: Ordem; setOrdem: (o: Ordem) => void;
}) {
  const ativa = ordem.col === col;
  return (
    <th
      className={cn('px-3 py-2', numerica ? 'text-right' : 'text-left')}
      aria-sort={ativa ? (ordem.desc ? 'descending' : 'ascending') : 'none'}
    >
      <button
        type="button"
        onClick={() => setOrdem(ativa ? { col, desc: !ordem.desc } : { col, desc: numerica })}
        className={cn(
          'group inline-flex items-center gap-1 uppercase transition-colors hover:text-foreground',
          numerica && 'flex-row-reverse',
          ativa && 'text-foreground',
        )}
      >
        {rotulo}
        {/* A seta ocupa lugar mesmo apagada: sem isso o cabeçalho pula de
            largura a cada clique e a tabela inteira treme. */}
        <span className={cn('text-[9px] leading-none', !ativa && 'opacity-0 group-hover:opacity-40')}>
          {ativa && ordem.desc ? '▼' : '▲'}
        </span>
      </button>
    </th>
  );
}

function buildBreakdown(
  rows: PostadoRow[],
  key: keyof PostadoRow,
  labelFn?: (val: string | null) => string,
): { label: string; testados: number; validados: number; escalados: number; aprovados: number }[] {
  const map: Record<string, { label: string; testados: number; validados: number; escalados: number; aprovados: number }> = {};
  for (const r of rows) {
    const k = (r[key] as string | null) ?? '__vazio__';
    const label = labelFn ? labelFn(r[key] as string | null) : (r[key] as string | null) ?? '— sem info —';
    if (!map[k]) map[k] = { label, testados: 0, validados: 0, escalados: 0, aprovados: 0 };
    map[k].testados++;
    if (isValidado(r)) map[k].validados++;
    if (isEscalado(r)) map[k].escalados++;
    if (isAprovado(r)) map[k].aprovados++;
  }
  return Object.values(map).sort((a, b) => b.testados - a.testados);
}

type LinhaBreakdown = { label: string; testados: number; validados: number; escalados: number; aprovados: number };

/**
 * Ordena pela MESMA taxa que a tabela mostra.
 *
 * A coluna "Taxa valid." é `aprovados / testados` — validado MAIS escalado. O
 * "Por ângulo" ordenava por `validados / testados`, e o resultado era uma lista
 * que parecia desordenada: "Vender na shopee" com 40% aparecia abaixo de três
 * ângulos com 20%, porque o escalado dele não contava na ordenação e contava na
 * exibição.
 *
 * Ordenar por um número e mostrar outro é o tipo de defeito que ninguém reporta
 * como bug — reporta como "a tela está estranha".
 *
 * O desempate é por amostra: entre duas taxas iguais, a de mais cards primeiro.
 * Sem ele, 1 de 1 (100%) empataria com 8 de 8 e a ordem seria sorteio.
 */
/**
 * A taxa que a tela chama de "validação", num lugar só.
 *
 * Ela vive em três desenhos — a coluna "Taxa" das tabelas, a ordenação e o
 * gráfico por editor — e já divergiu nos três. Enquanto cada um fizesse a
 * própria conta, "corrigir" significava lembrar dos outros dois.
 *
 * `aprovados` é validado MAIS escalado: escalar é o desfecho melhor, e deixá-lo
 * de fora fazia a taxa punir justamente o AD que deu mais certo.
 */
export function taxaDeValidacao(r: { testados: number; aprovados: number }): number {
  return r.testados > 0 ? (r.aprovados / r.testados) * 100 : 0;
}

function porTaxaValidacao(a: LinhaBreakdown, b: LinhaBreakdown) {
  return taxaDeValidacao(b) - taxaDeValidacao(a) || b.testados - a.testados;
}

/**
 * Do nível 1 para o 4, e não do mais numeroso para o menos.
 *
 * Nível de consciência é uma ESCALA: 1 é quem não sabe que tem o problema, 4 é
 * quem já conhece o produto. Ordenar por volume embaralha a escala e tira a
 * única leitura que ela oferece — onde o funil ganha e onde perde ao subir.
 *
 * O campo aceita combinação ("Nível 2…,Nível 3…"), então a ordem sai do PRIMEIRO
 * número, que põe a combinação junto do nível onde ela começa. Sem número
 * reconhecido vai para o fim: "— sem nível —" não é degrau da escala.
 */
function grauDoNivel(label: string): number {
  const m = label.match(/N[íi]vel\s*(\d)/i);
  return m ? Number(m[1]) : 99;
}

function porNivelDeConsciencia(a: LinhaBreakdown, b: LinhaBreakdown) {
  return grauDoNivel(a.label) - grauDoNivel(b.label) || a.label.localeCompare(b.label, "pt-BR");
}

/**
 * As tabelas de recorte — por ângulo, por formato, por editor.
 *
 * ── O que estava errado (31/08/2026) ──────────────────────────────────────
 *
 * SCROLL DENTRO DE SCROLL. "Por ângulo" tinha `max-h-72 overflow-y-auto`, e
 * com 20 ângulos a tabela rolava por dentro enquanto a página rolava por
 * fora. Quem passava o mouse em cima rolava a tabela sem querer, o cabeçalho
 * saía de vista e deixava uma faixa vazia no topo do cartão — o "espaço
 * sobrando" era isso. Agora corta em `LIMITE` linhas com um botão para ver o
 * resto: a página tem uma barra de rolagem só, que é a dela.
 *
 * SEIS COLUNAS NUMA COLUNA ESTREITA. A tabela vive num painel de ~500px e
 * pedia ~560px, então rolava para o lado e escondia justamente a taxa, que é
 * a coluna que se olha. Saiu "Val.+Esc.", que era `validados + escalados` —
 * aritmética das duas células ao lado, e a taxa já a expressa em percentual.
 *
 * RÓTULOS CORTADOS QUE VIRAVAM O MESMO TEXTO. `truncate max-w-[160px]` fazia
 * "Nível 2: Consciente do Problema" e "Nível 2: Consciente da Solução"
 * aparecerem os dois como "Nível 2: Conscient…" — duas linhas diferentes,
 * indistinguíveis. Agora quebra em duas linhas em vez de cortar.
 *
 * CABEÇALHO DA PRIMEIRA COLUNA TIRADO DO TÍTULO. `title.replace("Por ", "")`
 * dava "funil de vendas" e "nível de consciência" — minúsculo e comprido, que
 * era o que mais empurrava a largura. Agora vem por `coluna`, explícito.
 */

/** Quantas linhas antes do "ver todas". Oito cabe sem rolagem em qualquer
 *  cartão desta tela, e é mais do que se compara de uma vez. */
const LIMITE = 8;

function BreakdownTable({
  title,
  coluna,
  rows,
}: {
  title: string;
  /** O que a primeira coluna lista — "Ângulo", "Editor". Curto: é ele que
   *  decide a largura da tabela inteira. */
  coluna: string;
  rows: LinhaBreakdown[];
}) {
  const [verTodas, setVerTodas] = useState(false);
  if (rows.length === 0) return null;
  const visiveis = verTodas ? rows : rows.slice(0, LIMITE);
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h4 className="text-sm font-medium">{title}</h4>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] text-muted-foreground uppercase">
              <th className="text-left px-3 py-2">{coluna}</th>
              <th className="text-right px-3 py-2">Testados</th>
              <th className="text-right px-3 py-2">Validados</th>
              <th className="text-right px-3 py-2">Escalados</th>
              <th className="text-right px-3 py-2">Taxa</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((r) => {
              const taxa = taxaDeValidacao(r);
              return (
                <tr key={r.label} className="border-b border-border/40 last:border-0">
                  {/*
                    Duas linhas: nem uma, nem quantas vierem.

                    Cortar numa linha só fazia "Nível 2: Consciente do Problema"
                    e "Nível 2: Consciente da Solução" virarem a mesma
                    reticência — a tabela mentia. Mas deixar quebrar à vontade
                    levou a linha a 60px+ e esticou a coluna 437px além da
                    vizinha, abrindo um vazio ao lado.

                    Duas linhas distinguem os rótulos E mantêm a linha baixa. O
                    `title` guarda o texto inteiro para o caso que não couber.
                  */}
                  <td className="px-3 py-2 font-medium" title={r.label}>
                    <span className="line-clamp-2">{r.label}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.testados}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.validados}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.escalados}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={cn(
                      'px-1.5 py-0.5 rounded text-[11px] font-medium',
                      taxa >= 20 ? 'bg-emerald-500/10 text-emerald-500'
                      : taxa >= 10 ? 'bg-amber-500/10 text-amber-500'
                      : 'bg-red-500/10 text-red-500',
                    )}>
                      {formatPercent(taxa)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length > LIMITE && (
        <button
          onClick={() => setVerTodas(v => !v)}
          className="w-full border-t border-border px-3 py-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
        >
          {verTodas
            ? `Mostrar só ${LIMITE}`
            : `Ver todas as ${rows.length} · ${rows.length - LIMITE} ocultas`}
        </button>
      )}
    </div>
  );
}

export function DesempenhoAdsView() {
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const [rows, setRows]           = useState<PostadoRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [perfis, setPerfis]       = useState<Perfil[]>([]);
  const [projetos, setProjetos]   = useState<{ id: string; nome: string }[]>([]);
  const [funis, setFunis]         = useState<Funil[]>([]);
  const [opFormato, setOpFormato] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [preset, setPreset]       = useState<Preset>('this');
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [calOpen, setCalOpen]     = useState(false);

  const [filtroEditor, setFiltroEditor]   = useState<string[]>([]);
  const [filtroProjeto, setFiltroProjeto] = useState<string[]>([]);
  const [filtroTipo, setFiltroTipo]       = useState<string[]>([]);
  const [filtroFormato, setFiltroFormato] = useState<string[]>([]);
  const [filtroFunil, setFiltroFunil]     = useState<string[]>([]);

  const { startStr, endStr } = useMemo(() => {
    if (preset === 'this')  return { startStr: toYMD(startOfMonth(0)),  endStr: toYMD(endOfMonth(0)) };
    if (preset === 'last')  return { startStr: toYMD(startOfMonth(-1)), endStr: toYMD(endOfMonth(-1)) };
    const s = dateRange?.from ? toYMD(dateRange.from) : toYMD(startOfMonth(-2));
    const e = dateRange?.to   ? toYMD(dateRange.to)   : toYMD(endOfMonth(0));
    return { startStr: s, endStr: e };
  }, [preset, dateRange]);

  /*
    O número de cada AD, no MESMO período que a tela já mostra.

    Aqui, ao contrário da Avaliação, o recorte importa: esta tela responde
    "quantos ADs validei neste mês", e um retorno acumulado da vida inteira ao
    lado de uma contagem mensal seria comparar coisas diferentes na mesma linha.
  */
  const { metricas } = useMetricasDoAd(startStr, endStr);

  const [vidas, setVidas] = useState<Record<string, Vida>>({});
  /* Começa por nome crescente, que era a ordem fixa de antes: quem já usava a
     tela não vê nada mudar até clicar. */
  const [ordem, setOrdem] = useState<Ordem>({ col: 'nome', desc: false });

  const projetosDaEmpresa = useProjetosDaEmpresa();

  const load = useCallback(async () => {
    /* undefined = ainda nao sei de quem sao os projetos. */
    if (projetosDaEmpresa === undefined) return;
    setLoading(true);

    const SEL = 'id,nome,tipo,formato,angulo_teste,nivel_consciencia,avaliacao,status_veiculacao,data_inicio,responsavel_id,projeto_id,funil_ids,funil_video,responsavel:perfis!responsavel_id(id,nome),projeto:ofertas_editores!projeto_id(id,nome)';

    // Eram duas páginas fixas de mil, e há 2.916 cards postados: 916 ficavam
    // fora de todos os gráficos e de todas as taxas desta tela.
    const [postados, { data: pf }, pj, { data: opF }, fs, vd] = await Promise.all([
      todasAsLinhas<PostadoRow>((de, ate) =>
        {
          let q = supabase.from('producoes').select(SEL).eq('fase', 'postado').order('nome').range(de, ate);
          if (projetosDaEmpresa) q = q.in('projeto_id', projetosDaEmpresa);
          return q;
        }),
      supabase.from('perfis')
        .select('id,nome,is_admin,cargo_id,setor_id,cargo:cargos(id,nome),setor:setores(id,nome),ativo')
        .eq('ativo', true).order('nome'),
      fetchProjetos(),
      supabase.from('criativo_campos_opcoes').select('valor').eq('campo', 'formato').order('ordem'),
      fetchFunis(),
      /* Vida útil não respeita o período do filtro: ela é uma propriedade do AD
         ao longo de toda a série, e recortá-la pelo mês daria a fatia do mês em
         vez do tempo que ele viveu. */
      supabase.rpc('fn_vida_util_ads'),
    ]);

    setVidas(Object.fromEntries(((vd.data ?? []) as Vida[]).map(v => [v.producao_id, v])));
    setPerfis((pf ?? []) as Perfil[]);
    setProjetos(pj);
    setFunis(fs as Funil[]);
    if (opF?.length) setOpFormato(opF.map(d => d.valor as string));

    const crs = postados.linhas;
    if (!crs.length) { setRows([]); setLoading(false); return; }

    // Historico em chunks de 300 IDs para evitar URL muito longa
    const ids = crs.map(c => c.id);
    const CHUNK = 300;
    const histResults = await Promise.all(
      Array.from({ length: Math.ceil(ids.length / CHUNK) }, (_, i) =>
        supabase.from('criativo_historico')
          .select('criativo_id,criado_em')
          .in('criativo_id', ids.slice(i * CHUNK, (i + 1) * CHUNK))
          .eq('campo_alterado', 'fase')
          .eq('valor_novo', 'postado')
          .order('criado_em', { ascending: true }),
      )
    );
    const hist = histResults.flatMap(r => r.data ?? []);

    const postMap: Record<string, string> = {};
    for (const h of hist) {
      if (!postMap[h.criativo_id]) postMap[h.criativo_id] = h.criado_em.slice(0, 10);
    }

    setRows(crs.map(c => {
      const data_inicio_hist = postMap[c.id] ?? null;
      const raw = c as unknown as PostadoRow;
      return {
        ...raw,
        data_inicio_hist,
        data_ref: data_inicio_hist ?? raw.data_inicio ?? null,
      };
    }));
    setLoading(false);
  }, [projetosDaEmpresa]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => rows.filter(r => {
    const dp = r.data_ref;
    if (!dp || dp < startStr || dp > endStr) return false;
    if (filtroEditor.length  && !filtroEditor.includes(r.responsavel_id ?? ''))  return false;
    if (filtroProjeto.length && !filtroProjeto.includes(r.projeto_id ?? ''))     return false;
    if (filtroTipo.length    && !filtroTipo.includes(r.tipo))                    return false;
    if (filtroFormato.length && !filtroFormato.includes(r.formato ?? ''))        return false;
    if (filtroFunil.length   && !filtroFunil.includes(normalizarFunil(r.funil_video) ?? '')) return false;
    return true;
  }), [rows, startStr, endStr, filtroEditor, filtroProjeto, filtroTipo, filtroFormato, filtroFunil]);

  // Escalados = todos os ads atualmente em "Escalado", sem filtro de data de postagem
  const filteredSemData = useMemo(() => rows.filter(r => {
    if (filtroEditor.length  && !filtroEditor.includes(r.responsavel_id ?? ''))  return false;
    if (filtroProjeto.length && !filtroProjeto.includes(r.projeto_id ?? ''))     return false;
    if (filtroTipo.length    && !filtroTipo.includes(r.tipo))                    return false;
    if (filtroFormato.length && !filtroFormato.includes(r.formato ?? ''))        return false;
    if (filtroFunil.length   && !filtroFunil.includes(normalizarFunil(r.funil_video) ?? '')) return false;
    return true;
  }), [rows, filtroEditor, filtroProjeto, filtroTipo, filtroFormato, filtroFunil]);

  const totals = useMemo(() => {
    const testados  = filtered.length;
    const validados = filtered.filter(isValidado).length;
    /*
      Escalados conta no MESMO recorte dos outros, e isso mudou em 31/08/2026.

      Antes ele saía de `filteredSemData` — todo o histórico — enquanto os
      vizinhos saíam do mês. Nenhum número estava errado sozinho, mas a linha
      não fechava (14 validados + 12 escalados contra 20 de "Val.+Esc.") e o
      percentual embaixo era 12 sobre 2.906, parecendo taxa do mês.

      Quem quiser o acumulado troca o período — que é para isso que ele serve.
    */
    const escalados = filtered.filter(isEscalado).length;
    const aprovados = filtered.filter(isAprovado).length;
    const naoValid  = filtered.filter(r => r.avaliacao === 'Não validado').length;
    const pendentes = filtered.filter(semAvaliacao).length;
    const semDado   = filtered.filter(semDados).length;
    const taxaValid = testados > 0 ? (validados / testados) * 100 : 0;
    const taxaEscal = testados > 0 ? (escalados / testados) * 100 : 0;
    /* A MESMA funcao do grafico e das tabelas: a taxa da tela grande nao
       pode discordar da taxa de cada recorte. */
    const taxaAprov = taxaDeValidacao({ testados, aprovados });
    return { testados, validados, escalados, aprovados, naoValid, pendentes, semDado, taxaValid, taxaEscal, taxaAprov };
  }, [filtered]);

  const porTipo       = useMemo(() => buildBreakdown(filtered, 'tipo', v => TIPO_LABEL[v ?? ''] ?? v ?? '—'), [filtered]);
  const porFormato    = useMemo(() =>
    buildBreakdown(filtered, 'formato', v => v ?? '— sem formato —').sort(porTaxaValidacao),
  [filtered]);
  const porAngulo     = useMemo(() =>
    buildBreakdown(filtered, 'angulo_teste', v => v ?? '— sem ângulo —').sort(porTaxaValidacao),
  [filtered]);

  const porNivelConsc = useMemo(() =>
    buildBreakdown(filtered, 'nivel_consciencia', v => v ?? '— sem nível —').sort(porNivelDeConsciencia),
  [filtered]);
  const porEditor     = useMemo(() => {
    const map: Record<string, { label: string; testados: number; validados: number; escalados: number; aprovados: number }> = {};
    for (const r of filtered) {
      const k = r.responsavel_id ?? '__sem__';
      const label = r.responsavel?.nome ?? '— sem editor —';
      if (!map[k]) map[k] = { label, testados: 0, validados: 0, escalados: 0, aprovados: 0 };
      map[k].testados++;
      if (isValidado(r)) map[k].validados++;
      if (isEscalado(r)) map[k].escalados++;
      if (isAprovado(r)) map[k].aprovados++;
    }
    return Object.values(map).sort((a, b) => b.testados - a.testados);
  }, [filtered]);

  const evolucao = useMemo(() => {
    const map: Record<string, { mes: string; testados: number; validados: number; escalados: number; aprovados: number }> = {};
    for (const r of filtered) {
      const mes = (r.data_ref ?? '').slice(0, 7);
      if (!mes) continue;
      if (!map[mes]) map[mes] = { mes, testados: 0, validados: 0, escalados: 0, aprovados: 0 };
      map[mes].testados++;
      if (isValidado(r)) map[mes].validados++;
      if (isEscalado(r)) map[mes].escalados++;
      if (isAprovado(r)) map[mes].aprovados++;
    }
    return Object.values(map).sort((a, b) => a.mes.localeCompare(b.mes));
  }, [filtered]);

  const escaladosLista = useMemo(() => {
    /* A chave sai daqui, e não de uma função solta, porque `vidas` e
       `metricas` chegam por hooks: uma função de módulo precisaria recebê-los
       como parâmetro e o tipo viria junto, sem nada em troca.

       Ordena pelo NÚMERO, nunca pelo que está escrito na célula: "≥ 40 dias"
       antes de "6 dias" é o que sai de ordenar o rótulo. */
    const chave = (r: PostadoRow): string | number | null => {
      const m = metricas.get(r.id);
      switch (ordem.col) {
        case 'nome':    return r.nome ?? null;
        case 'tipo':    return TIPO_LABEL[r.tipo] ?? r.tipo ?? null;
        case 'formato': return r.formato ?? null;
        case 'angulo':  return r.angulo_teste ?? null;
        case 'editor':  return r.responsavel?.nome ?? null;
        case 'projeto': return r.projeto?.nome ?? null;
        case 'vida':    return vidas[r.id]?.dias ?? null;
        case 'verba':   return m?.investimento ?? null;
        case 'roas':    return m?.roas ?? null;
        /* Sem métrica é nulo; COM métrica, vendas ausente é zero de verdade —
           é o mesmo que a célula mostra. */
        case 'vendas':  return m ? (m.vendas ?? 0) : null;
      }
    };
    return filteredSemData.filter(isEscalado).sort((a, b) => {
      const c = compararChaves(chave(a), chave(b), ordem.desc);
      // Desempate pelo nome: sem ele, duas linhas de mesma verba trocariam de
      // lugar a cada re-render e a tabela pareceria instável.
      return c !== 0 ? c : (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR');
    });
  }, [filteredSemData, ordem, vidas, metricas]);

  /* Normalizado aqui também, senão a lista de filtro ofereceria "TSL,VSL" e
     "TSL, VSL" como se fossem escolhas diferentes — e escolher uma esconderia
     os cards da outra. */
  const opFunilVideo = useMemo(() =>
    [...new Set(rows.map(r => normalizarFunil(r.funil_video)).filter((v): v is string => Boolean(v)))].sort(),
  [rows]);

  const porFunil = useMemo(() => {
    const map: Record<string, { label: string; testados: number; validados: number; escalados: number; aprovados: number }> = {};
    for (const r of filtered) {
      const fv = normalizarFunil(r.funil_video);
      if (!fv) continue;
      if (!map[fv]) map[fv] = { label: fv, testados: 0, validados: 0, escalados: 0, aprovados: 0 };
      map[fv].testados++;
      if (isValidado(r)) map[fv].validados++;
      if (isEscalado(r)) map[fv].escalados++;
      if (isAprovado(r)) map[fv].aprovados++;
    }
    return Object.values(map).sort((a, b) => b.testados - a.testados);
  }, [filtered]);

  /*
    A vida útil IGNORA o filtro de datas, e isso não é descuido.

    A primeira versão usava o mesmo recorte do resto da tela e produzia uma
    mentira aritmética: sobre os ADs postados em agosto, o mais longevo tinha
    25 dias — porque um AD postado em agosto não TEM COMO ter vivido mais que
    31. Media-se o tamanho da janela, não a vida do anúncio. Sobre todos os
    cards, o maior viveu 104 dias.

    A regra que separa os dois casos: contagem de eventos aceita período
    ("quantos escalamos em agosto"); DURAÇÃO não, porque a janela corta a
    medida pelas duas pontas. Por isso este painel usa `filteredSemData` —
    editor, projeto, tipo, formato e funil valem; a data, não. E o título diz
    isso, senão vira o mesmo engano com outra roupa.

    Só entram os ENCERRADOS: quem ainda está ACTIVE na Meta tem a última
    impressão ontem porque está vivo, e quem começou em 01/05/2026 tem a vida
    cortada pelo começo da série. Os dois viram contagem no rodapé em vez de
    sumirem — é pouco para descartar em silêncio e demais para misturar.
  */
  const vidaUtil = useMemo(() => {
    const dias: number[] = [];
    let abertos = 0, truncados = 0, semDado = 0;

    for (const r of filteredSemData) {
      const v = vidas[r.id];
      if (!v || v.dias == null) { semDado++; continue; }
      if (v.aberta)   { abertos++;   continue; }
      if (v.truncada) { truncados++; continue; }
      dias.push(v.dias);
    }

    dias.sort((a, b) => a - b);
    const meio = dias.length ? dias[Math.floor(dias.length / 2)] : null;
    const media = dias.length ? dias.reduce((s2, d) => s2 + d, 0) / dias.length : null;

    /* Faixas, e não um histograma: a pergunta que se faz aqui é "a maioria dura
       menos de uma semana?", e cinco linhas respondem isso melhor que barras. */
    const faixas = [
      { label: '1 a 3 dias',    de: 1,  ate: 3   },
      { label: '4 a 7 dias',    de: 4,  ate: 7   },
      { label: '8 a 14 dias',   de: 8,  ate: 14  },
      { label: '15 a 30 dias',  de: 15, ate: 30  },
      { label: '31 a 60 dias',  de: 31, ate: 60  },
      { label: 'mais de 60',    de: 61, ate: 1e9 },
    ].map(f => ({
      label: f.label,
      qtd: dias.filter(d => d >= f.de && d <= f.ate).length,
    }));

    return { encerrados: dias.length, meio, media, maior: dias.at(-1) ?? null, faixas, abertos, truncados, semDado };
  }, [filteredSemData, vidas]);

  const rangeLabel = useMemo(() => {
    if (!dateRange?.from) return 'Selecionar período';
    const from = format(dateRange.from, 'dd/MM/yy', { locale: ptBR });
    const to   = dateRange.to ? format(dateRange.to, 'dd/MM/yy', { locale: ptBR }) : '…';
    return `${from} → ${to}`;
  }, [dateRange]);

  const tooltipStyle = { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 };

  return (
    <div className="space-y-4">

      {/* Filtros */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">

        {/* Linha 1: Período */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-md border border-border overflow-hidden">
            {(['last', 'this', 'custom'] as Preset[]).map((p, i) => (
              <button
                key={p}
                onClick={() => { setPreset(p); if (p !== 'custom') setCalOpen(false); }}
                className={cn(
                  'h-8 px-3 text-xs transition-colors whitespace-nowrap',
                  i > 0 && 'border-l border-border',
                  preset === p
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                )}
              >
                {p === 'last' ? 'Mês passado' : p === 'this' ? 'Este mês' : 'Personalizado'}
              </button>
            ))}
          </div>

          {preset === 'custom' && (
            <Popover open={calOpen} onOpenChange={setCalOpen}>
              <PopoverTrigger asChild>
                <button className={cn(
                  'h-8 px-3 rounded-md border text-xs flex items-center gap-1.5 transition-colors',
                  dateRange?.from
                    ? 'border-primary text-foreground bg-primary/5'
                    : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/50',
                )}>
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {rangeLabel}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  selected={dateRange}
                  onSelect={r => { setDateRange(r); if (r?.from && r?.to) setCalOpen(false); }}
                  numberOfMonths={2}
                  locale={ptBR}
                />
              </PopoverContent>
            </Popover>
          )}
        </div>

        {/* Linha 2: Filtros de atributo */}
        <div className="flex items-center gap-2 flex-wrap">
          <MultiFilter label="Todos editores" options={perfis.map(p => ({ id: p.id, nome: p.nome }))} value={filtroEditor} onChange={setFiltroEditor} width="w-44" />
          <MultiFilter label="Todos projetos" options={projetos} value={filtroProjeto} onChange={setFiltroProjeto} width="w-44" />
          <MultiFilter
            label="Todos tipos"
            options={[{ id: 'criativo', nome: 'Criativo' }, { id: 'vsl', nome: 'VSL' }, { id: 'aula', nome: 'Aula' }]}
            value={filtroTipo}
            onChange={setFiltroTipo}
            width="w-36"
          />
          {opFormato.length > 0 && (
            <MultiFilter
              label="Todos formatos"
              options={opFormato.map(f => ({ id: f, nome: f }))}
              value={filtroFormato}
              onChange={setFiltroFormato}
              width="w-36"
            />
          )}
          {opFunilVideo.length > 0 && (
            <MultiFilter
              label="Todos os funis"
              options={opFunilVideo.map(f => ({ id: f, nome: f }))}
              value={filtroFunil}
              onChange={setFiltroFunil}
              width="w-44"
            />
          )}
        </div>
      </div>

      {/*
        Os números, na ordem em que a pergunta se faz.

        ── O que estava errado (31/08/2026) ─────────────────────────────────

        DOIS CARTÕES COM O MESMO NÚMERO. "Val. + Esc." mostrava
        `formatPercent(taxaAprov)` embaixo, e "Taxa de validação" mostrava
        `formatPercent(taxaAprov)` como valor. Os dois liam 10,58% — o mesmo
        percentual, dois nomes, um ao lado do outro. E o segundo era o único
        cartão sem contagem, então tinha outra altura que os sete vizinhos.

        SEM ORDEM. Total, ganho, ganho, subtotal, perda, pendente, sem dado e
        taxa, nessa sequência — misturando o universo, as partes e o resumo.

        ── A ordem agora ────────────────────────────────────────────────────

        Primeiro o UNIVERSO e a RESPOSTA: quantos foram testados, e quantos
        deram certo. Depois a decomposição, que soma exatamente o universo:

          validados + escalados + não validados + pendentes + sem dados
            14      +     6     +      94       +    45     +    30    = 189

        Os cinco são exclusivos entre si (`avaliacao` é um valor só), então a
        soma fechar não é coincidência — é a definição. Separar em duas faixas
        deixa isso visível em vez de deixar o leitor descobrir.
      */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'ADs testados', value: totals.testados,  sub: 'no período e nos filtros', color: '' },
          { label: 'Val. + Esc.',  value: totals.aprovados, sub: formatPercent(totals.taxaAprov) + ' de validação', color: 'text-violet-400' },
        ].map(card => (
          <div key={card.label} className="bg-card border border-border rounded-lg p-4">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{card.label}</p>
            <p className={cn('text-3xl font-semibold mt-1 tabular-nums', card.color)}>
              {loading ? '—' : formatNumber(card.value)}
            </p>
            {!loading && <p className="text-xs text-muted-foreground mt-0.5">{card.sub}</p>}
          </div>
        ))}
      </div>

      {/* A decomposição: os cinco desfechos possíveis, que somam o total acima. */}
      {/* Cinco cartões: `sm:grid-cols-3` deixava 3 + 2 e um buraco no fim da
          segunda fileira. Cinco só fecha em fileiras de 1 ou de 5 — no monitor
          é uma fileira; abaixo de 768px empilha em duas colunas, onde a sobra
          da última é o que se espera de uma grade estreita. */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Validados',     value: totals.validados, sub: formatPercent(totals.taxaValid),  color: 'text-emerald-500' },
          { label: 'Escalados',     value: totals.escalados, sub: formatPercent(totals.taxaEscal),  color: 'text-blue-400' },
          { label: 'Não validados', value: totals.naoValid,  sub: totals.testados > 0 ? formatPercent((totals.naoValid / totals.testados) * 100) : null, color: 'text-red-500' },
          { label: 'Pendentes',     value: totals.pendentes, sub: totals.testados > 0 ? formatPercent((totals.pendentes / totals.testados) * 100) : null, color: 'text-amber-500' },
          { label: 'Sem dados',     value: totals.semDado,   sub: totals.testados > 0 ? formatPercent((totals.semDado / totals.testados) * 100) : null,   color: 'text-muted-foreground' },
        ].map(card => (
          <div key={card.label} className="bg-card border border-border rounded-lg p-4">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{card.label}</p>
            {/* O `card.value !== null ? ... : ...` que existia aqui era só para
                o cartão "Taxa de validação", que não tinha contagem — e que saiu
                por repetir o percentual do vizinho. Todos têm número agora. */}
            <p className={cn('text-2xl font-semibold mt-1 tabular-nums', card.color)}>
              {loading ? '—' : formatNumber(card.value)}
            </p>
            {card.sub && !loading && (
              <p className="text-xs text-muted-foreground mt-0.5">{card.sub}</p>
            )}
          </div>
        ))}
      </div>

      {!loading && (
        <>
          {/*
            As duas colunas deixaram de ser repartidas à mão.

            Eram duas `<div flex-1>` com os cartões distribuídos por alguém, e
            um comentário estimando "~710px" de um lado e "~720px" do outro. A
            estimativa envelheceu na primeira vez que um cartão mudou de
            tamanho: medido em 31/08/2026, 1.363px contra 926px — 437px de
            preto ao lado da coluna mais alta. Era esse o buraco.

            `columns-2` deixa o navegador distribuir: os cartões fluem e as duas
            colunas terminam juntas, seja qual for a altura de cada um.
            `break-inside-avoid` impede que um cartão seja partido no meio.

            Some junto a decisão de QUAL cartão fica de que lado — mais uma
            coisa que alguém teria de manter em dia sem ganhar nada com isso.
          */}
          <div className="lg:columns-2 lg:gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
              {porFunil.length > 0 && <BreakdownTable title="Por funil de vendas" coluna="Funil" rows={porFunil} />}

              {/* Quanto tempo o criativo ficou no ar */}
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <h4 className="text-sm font-medium">Vida útil do AD</h4>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Da primeira impressão até parar de ter impressões · <strong>todo o histórico</strong>,
                    fora do filtro de datas — a janela cortaria a vida dos ADs recentes
                  </p>
                </div>

                {vidaUtil.encerrados === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                    Nenhum AD com vida encerrada no recorte.
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-3 border-b border-border">
                      {[
                        { rotulo: 'Mediana', valor: `${vidaUtil.meio} d` },
                        { rotulo: 'Média',   valor: `${vidaUtil.media!.toFixed(1)} d` },
                        { rotulo: 'Maior',   valor: `${vidaUtil.maior} d` },
                      ].map(x => (
                        <div key={x.rotulo} className="px-4 py-3">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{x.rotulo}</p>
                          <p className="mt-0.5 text-xl font-semibold tabular-nums">{x.valor}</p>
                        </div>
                      ))}
                    </div>

                    <table className="w-full text-sm">
                      <tbody>
                        {vidaUtil.faixas.map(f => (
                          <tr key={f.label} className="border-b border-border/40 last:border-0">
                            <td className="px-4 py-1.5 text-muted-foreground">{f.label}</td>
                            <td className="px-4 py-1.5 text-right tabular-nums w-16">{f.qtd}</td>
                            <td className="px-4 py-1.5 text-right tabular-nums w-20 text-muted-foreground">
                              {formatPercent((f.qtd / vidaUtil.encerrados) * 100)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* O que ficou de fora, e por quê. Sem esta linha, a mediana
                        parece calculada sobre todos os ADs do recorte. */}
                    <p className="px-4 py-2.5 text-[11px] leading-snug text-muted-foreground border-t border-border">
                      Sobre {vidaUtil.encerrados} AD(s) encerrado(s).
                      {vidaUtil.abertos > 0   && ` ${vidaUtil.abertos} ainda no ar (a vida deles não terminou).`}
                      {vidaUtil.truncados > 0 && ` ${vidaUtil.truncados} começaram antes de 01/05/2026, quando a série começa.`}
                      {vidaUtil.semDado > 0   && ` ${vidaUtil.semDado} sem anúncio vinculado.`}
                    </p>
                  </>
                )}
              </div>
              <BreakdownTable title="Por ângulo" coluna="Ângulo" rows={porAngulo.filter(r => r.label !== '— sem ângulo —' || porAngulo.length === 1)} />
              <BreakdownTable title="Por nível de consciência" coluna="Nível" rows={porNivelConsc.filter(r => r.label !== '— sem nível —' || porNivelConsc.length === 1)} />

              <BreakdownTable title="Por tipo" coluna="Tipo" rows={porTipo} />
              <BreakdownTable title="Por formato" coluna="Formato" rows={porFormato} />
              {porEditor.length > 0 && <BreakdownTable title="Por editor" coluna="Editor" rows={porEditor} />}
          {/*
            O gráfico saiu e voltou no mesmo dia — mas com a conta certa.

            Ele desenhava `validados / testados` sob o título "Taxa de
            validação", enquanto a coluna "Taxa" da tabela logo acima usa
            `aprovados / testados` — validado MAIS escalado. Medido na tela:

                              tabela     gráfico
              Jaqueline       11,54%      8,65%
              Jessica         10,13%      6,33%

            Dois números com o mesmo nome, um embaixo do outro. É a primeira
            armadilha do CLAUDE.md, e foi a segunda vez que ela apareceu neste
            arquivo no mesmo dia — de manhã o "Por ângulo" ordenava por uma
            taxa e mostrava outra.

            Agora o gráfico chama `taxaDeValidacao`, a MESMA função que a
            tabela usa. Não é economia de linha: é a única forma de os dois não
            voltarem a divergir, porque não há mais duas contas para divergir.
          */}
              {porEditor.length > 0 && (
                <div className="bg-card border border-border rounded-lg p-4">
                  <h4 className="text-sm font-medium mb-3">Taxa de validação por editor</h4>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={porEditor.map(r => ({ ...r, taxa: taxaDeValidacao(r) }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="label" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
                      <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} unit="%" />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => formatPercent(Number(v))} />
                      <Bar dataKey="taxa" name="Taxa valid." fill={CHART_COLORS.primary} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
          </div>

          {/* Evolução mensal */}
          {evolucao.length > 0 && (
            <div className="bg-card border border-border rounded-lg p-4">
              <h4 className="text-sm font-medium mb-3">Evolução mensal</h4>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={evolucao}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="mes" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                  <YAxis yAxisId="left"  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} unit="%" />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="testados"  name="Testados"   stroke={CHART_COLORS.primary}   strokeWidth={2} dot={{ r: 3 }} />
                  <Line yAxisId="left" type="monotone" dataKey="validados" name="Validados"  stroke={CHART_COLORS.validados}  strokeWidth={2} dot={{ r: 3 }} />
                  <Line yAxisId="left" type="monotone" dataKey="escalados" name="Escalados"  stroke={CHART_COLORS.escalados}  strokeWidth={2} dot={{ r: 3 }} />
                  <Line yAxisId="left" type="monotone" dataKey="aprovados" name="Val.+Esc."  stroke={CHART_COLORS.aprovados}  strokeWidth={2} dot={{ r: 3 }} strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ADs escalados no período */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h4 className="text-sm font-medium">ADs escalados no período <span className="text-muted-foreground font-normal">(avaliação Escalado)</span></h4>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <LegendaFontes />
                {escaladosLista.length} ads
              </span>
            </div>
            {escaladosLista.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">Nenhum AD escalado no período selecionado.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-[11px] text-muted-foreground uppercase">
                      {COLUNAS_ESCALADOS.slice(0, 6).map(c => (
                        <ThOrdenavel key={c.col} {...c} ordem={ordem} setOrdem={setOrdem} />
                      ))}
                      {/*
                        A coluna "Avaliação" saiu em 31/08/2026.

                        `escaladosLista` é `filter(isEscalado)`, então TODA linha
                        tinha o mesmo selo: "Escalado". Medido na tela — 12
                        linhas, um valor distinto. Era o título da tabela
                        repetido doze vezes, ocupando a largura que faltava ao
                        Ângulo, que por sua vez truncava em 120px e transformava
                        "A melhor forma - sabonete cacho de uva" em reticências.

                        Coluna que nunca varia não informa: ela só empurra as
                        que informam para fora.
                      */}
                      {/*
                        O dinheiro do AD escalado.

                        A tabela listava nome, tipo, formato, ângulo, editor e
                        projeto — tudo sobre a PEÇA e nada sobre o resultado.
                        "Escalei 12 ADs" sem a verba e o retorno de cada um não
                        diz se escalar foi acerto.

                        Três colunas, não as oito da Avaliação: numa tabela de
                        sete colunas, hook e CPM empurrariam o nome para fora da
                        tela. Quem quiser o resto abre o card.
                      */}
                      {/* Quanto tempo ficou no ar. `≥` quer dizer que ainda
                          esta rodando; `>` que a serie comeca depois do AD. */}
                      {COLUNAS_ESCALADOS.slice(6).map(c => (
                        <ThOrdenavel key={c.col} {...c} ordem={ordem} setOrdem={setOrdem} />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {escaladosLista.map(r => (
                      <tr key={r.id} className="border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-2 font-medium max-w-[180px]">
                          <button
                            onClick={aoClicarSemArrastar(() => setSelectedId(r.id))}
                            className="truncate text-left hover:text-primary hover:underline w-full"
                          >
                            {r.nome}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{TIPO_LABEL[r.tipo] ?? r.tipo}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.formato ?? '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground" title={r.angulo_teste ?? undefined}>{r.angulo_teste ?? '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.responsavel?.nome ?? '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.projeto?.nome ?? '—'}</td>

                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground whitespace-nowrap">
                          {rotuloDaVida(vidas[r.id])}
                        </td>

                        {(() => {
                          const m = metricas.get(r.id);
                          /* Sem anúncio vinculado é travessão, não zero: "não
                             sei" e "não vendeu" são coisas diferentes, e zerar
                             o que falta é como uma média vira mentira. */
                          if (!m) return (
                            <>
                              <td className="px-3 py-2 text-right text-muted-foreground/40">—</td>
                              <td className="px-3 py-2 text-right text-muted-foreground/40">—</td>
                              <td className="px-3 py-2 text-right text-muted-foreground/40">—</td>
                            </>
                          );
                          return (
                            <>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {m.investimento == null ? '—' : formatCurrency(m.investimento)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                                <span className="text-[hsl(var(--fonte-payt))]">
                                  {m.roas == null ? '—' : `${fmtNum(m.roas)}x`}
                                </span>
                                <span className="text-muted-foreground/40"> / </span>
                                <span className="text-[hsl(var(--fonte-meta))]">
                                  {m.roas_meta == null ? '—' : `${fmtNum(m.roas_meta)}x`}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                                <span className="text-[hsl(var(--fonte-payt))]">{m.vendas ?? 0}</span>
                                <span className="text-muted-foreground/40"> / </span>
                                <span className="text-[hsl(var(--fonte-meta))]">{m.vendas_meta ?? 0}</span>
                              </td>
                            </>
                          );
                        })()}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {loading && (
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm gap-2">
          <span className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          Carregando...
        </div>
      )}

      <CriativoDrawer
        criativoId={selectedId}
        onClose={() => setSelectedId(null)}
        onUpdate={load}
        nivel="socio"
        userId={userId}
        funis={funis}
        perfis={perfis}
      />
    </div>
  );
}
