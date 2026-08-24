import { useEffect, useMemo, useState, useCallback, Fragment } from 'react';
import { supabase } from '@/lib/supabase';
import { useFilters } from '@/contexts/FilterContext';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Link2, AlertCircle, ChevronDown, ChevronRight, Search, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Criativos Meta — a tela do editor.
 *
 * Junta três coisas que viviam separadas: o que o Meta cobrou e entregou, o que a Payt
 * vendeu, e a hipótese que o editor escreveu no card de Produção. Sem as três juntas, ou
 * se vê métrica sem saber o que estava sendo testado, ou se vê a hipótese sem saber se
 * deu certo.
 *
 * O que ela **não** faz, de propósito:
 *
 * - **Não ranqueia editores.** O editor não escolhe oferta, preço nem checkout;
 *   comparar Fulana com Beltrana por ROAS cobra de cada uma o que dependeu da oferta que
 *   pegou. O financeiro aparece por anúncio, que é onde julga o criativo.
 * - **Não deixa o editor marcar "validado".** Isso é decisão de sócio, em Criativos →
 *   Avaliação. Aqui só se lê.
 * - **Não esconde amostra pequena.** Hook de 60% em 300 impressões não é hipótese
 *   validada; a tela diz isso em vez de mostrar o número como se fosse conclusão.
 */

/**
 * Cinco estados porque são cinco problemas diferentes, cada um com uma saída própria.
 * Juntá-los em "sem dono" fazia a tela dizer 83 onde o número real de anúncios sem card
 * é 11 — e escondia a hipótese de seis que tinham card, só não tinham responsável.
 */
type Vinculo = 'confirmado' | 'sugerido' | 'por_data' | 'sem_responsavel' | 'sem_card' | 'fora_do_recorte';

/**
 * Onde o dono já está decidido — não há o que resolver e não entra no aviso.
 *
 * `por_data` estava de fora desta lista e caía como pendente: 38 anúncios **com editor**
 * eram anunciados como "sem editor identificado", cada um imprimindo um travessão sem
 * texto, porque `comoResolver` é vazio justamente por não haver nada a fazer.
 */
const resolvido = (v: Vinculo) =>
  v === 'confirmado' || v === 'sugerido' || v === 'por_data';

const VINCULO: Record<Vinculo, { curto: string; comoResolver: string }> = {
  confirmado:      { curto: '',                comoResolver: '' },
  sugerido:        { curto: '',                comoResolver: '' },
  por_data:        { curto: '',                comoResolver: '' },
  sem_responsavel: { curto: 'sem responsável', comoResolver: 'o card existe e não tem editor atribuído — isso se resolve no card, em Produção' },
  sem_card:        { curto: 'sem card',        comoResolver: 'nenhum card postado do tipo criativo tem este nome' },
  fora_do_recorte: { curto: 'card arquivado',  comoResolver: 'existe card com este nome, mas arquivado ou de outro tipo' },
};

interface Anuncio {
  ad_id: string; ad_nome: string; conta_id: string; conta: string;
  estreia: string;
  investimento: number; impressoes: number; cliques_link: number;
  video_3s: number; video_75pct: number; checkouts: number; visualizacoes: number;
  vendas: number; receita: number;
  /** A conversão que o próprio Meta credita ao anúncio. Nunca somada à da Payt. */
  vendas_meta: number; receita_meta: number;
  producao_id: string | null; editor_id: string | null; editor: string | null;
  projeto: string | null; avaliacao: string | null; status_veiculacao: string | null;
  tipo_teste: string | null; angulo_teste: string | null;
  nivel_consciencia: string | null; formato: string | null;
  vinculo: Vinculo; candidatos: number;
  conta_hook: number | null; conta_ctr: number | null; conta_conexao: number | null;
  conta_cpa: number | null; conta_roas: number | null;
  conta_cpa_meta: number | null; conta_roas_meta: number | null;
  /** Entrega média da conta no período — calculada aqui, razão dos totais. */
  conta_cpm: number | null; conta_cpc: number | null;
  /** Quanto das vendas da conta chega com anúncio identificado, no período. */
  conta_pct_atribuido: number;
}

/** PostgREST devolve `numeric` como string; somar isso concatena. */
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/**
 * Abaixo disso o número existe mas não conclui nada. Separados porque medem coisas
 * diferentes: mil impressões já dizem se o vídeo segura, três vendas não dizem se o
 * anúncio é lucrativo.
 */
const MIN_IMPRESSOES = 1000;
const MIN_VENDAS = 5;

/**
 * Abaixo disso, o financeiro por anúncio não é subestimado: é ficção.
 *
 * A conta "Saponaria" gastou R$ 10.968 num anúncio que aparece com ROAS 0,00x — não
 * porque o anúncio seja ruim, mas porque 1% das 735 vendas dela carregam identificação.
 * Zero em vermelho ao lado de onze mil reais parece conclusão e é ausência de dado.
 */
const MIN_ATRIBUICAO = 80;

/**
 * Metade dos anúncios do período gastou menos que isso.
 *
 * Não são anúncios ruins: são anúncios que mal rodaram. Misturados aos que receberam
 * orçamento de verdade, eles dobram a lista e escondem o que interessa. Ficam atrás de
 * um clique, com a contagem à vista — esconder sem dizer seria pior.
 */
const INVESTIMENTO_RELEVANTE = 50;

const razao = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);

const AVALIACAO_COR: Record<string, string> = {
  Validado: 'bg-success/15 text-success',
  Escalado: 'bg-primary/15 text-primary',
  'Não validado': 'bg-destructive/15 text-destructive',
  'Sem dados': 'bg-secondary text-muted-foreground',
};

type Coluna = 'nome' | 'investimento' | 'roas' | 'cpa' | 'cpm' | 'cpc' | 'hook' | 'ctr';

/**
 * Esta tela usa a **conversão do Meta**, não a venda da Payt.
 *
 * A régua da Payt depende da UTM chegar no checkout, e ela some justamente onde mais
 * importa: a conta "Saponaria" tem 736 vendas no mês com apenas 9 identificadas por
 * anúncio. Um editor comparando criativos ali veria zeros que não são desempenho, são
 * ausência de dado.
 *
 * O Meta credita a si a conversão sem depender de UTM, então cobre todos os anúncios da
 * mesma forma — que é o que um ranking exige. Em compensação ele conta a mais, porque
 * credita janela de visualização. Serve para **comparar anúncios entre si**, e não como
 * faturamento: o caixa continua sendo o Resumo, que usa a Payt.
 */
const vendasDe  = (a: Anuncio) => a.vendas_meta;
const roasDe = (a: Anuncio) => (a.investimento > 0 ? a.receita_meta / a.investimento : null);
const cpaDe  = (a: Anuncio) => (a.vendas_meta > 0 ? a.investimento / a.vendas_meta : null);
const refRoas = (a: Anuncio) => a.conta_roas_meta;
const refCpa  = (a: Anuncio) => a.conta_cpa_meta;
/**
 * CPM e CPC são preço de entrega, não desempenho de criativo — mas é neles que se vê
 * o leilão: CPM subindo com o mesmo criativo é público saturando, e CPC alto com CTR
 * bom é CPM caro, não anúncio ruim. Por isso os dois ficam ao lado do CTR.
 */
const cpmDe = (a: Anuncio) => (a.impressoes > 0 ? (a.investimento / a.impressoes) * 1000 : null);
const cpcDe = (a: Anuncio) => (a.cliques_link > 0 ? a.investimento / a.cliques_link : null);
const hookDe = (a: Anuncio) => razao(a.video_3s, a.impressoes);
const ctrDe  = (a: Anuncio) => razao(a.cliques_link, a.impressoes);
/**
 * Quantos dos que passaram de 3 segundos chegaram a 75% do vídeo.
 *
 * Pode passar de 100% quando o vídeo é curto demais: se ele tem menos de quatro
 * segundos, 75% acontece **antes** da marca de 3s, e o denominador fica menor que o
 * numerador. Não é retenção excepcional, é a métrica não se aplicando — e um desses
 * liderava o ranking. Nesses casos vale nulo, e a tela diz o motivo.
 */
const retencaoDe = (a: Anuncio) => {
  const r = razao(a.video_75pct, a.video_3s);
  return r !== null && r > 100 ? null : r;
};
const videoCurtoDemais = (a: Anuncio) => {
  const r = razao(a.video_75pct, a.video_3s);
  return r !== null && r > 100;
};

/** Valor com a referência da conta ao lado — sozinho ele não diz nada. */
function Valor({ v, ref_, formato, invertido, cinza, titulo }: {
  v: number | null; ref_: number | null;
  formato: 'pct' | 'moeda' | 'x'; invertido?: boolean; cinza?: boolean; titulo?: string;
}) {
  if (v === null) return <span className="text-muted-foreground/30">—</span>;

  const texto = formato === 'pct' ? `${v.toFixed(1)}%`
    : formato === 'x' ? `${v.toFixed(2)}x` : formatCurrency(v);

  if (cinza) return <span className="text-muted-foreground/40" title={titulo}>{texto}</span>;

  const acima = ref_ !== null && ref_ > 0 ? v > ref_ : null;
  const bom = acima === null ? null : invertido ? !acima : acima;
  const delta = ref_ !== null && ref_ > 0 ? ((v - ref_) / ref_) * 100 : null;

  return (
    <span className="whitespace-nowrap tabular-nums" title={ref_ ? `Conta no período: ${
      formato === 'pct' ? `${ref_.toFixed(1)}%` : formato === 'x' ? `${ref_.toFixed(2)}x` : formatCurrency(ref_)
    }` : undefined}>
      <span className={cn(bom === null ? 'text-foreground' : bom ? 'text-success' : 'text-destructive')}>
        {texto}
      </span>
      {delta !== null && Math.abs(delta) >= 1 && (
        <span className="ml-1 text-[10px] text-muted-foreground/50">
          {delta > 0 ? '+' : ''}{delta.toFixed(0)}%
        </span>
      )}
    </span>
  );
}

function Cabecalho({ col, rotulo, atual, dir, onSort, alinhar }: {
  col: Coluna; rotulo: string; atual: Coluna; dir: 'asc' | 'desc';
  onSort: (c: Coluna) => void; alinhar?: 'right';
}) {
  const ativo = atual === col;
  return (
    <th className={cn('px-3 py-2 font-medium', alinhar === 'right' ? 'text-right' : 'text-left')}>
      <button onClick={() => onSort(col)}
              className={cn('inline-flex items-center gap-1 transition-colors hover:text-foreground',
                ativo ? 'text-foreground' : 'text-muted-foreground')}>
        {rotulo}
        {ativo && (dir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </th>
  );
}

export function CriativosMetaTab() {
  const { startDateStr, endDateStr, contaId } = useFilters();
  const { user, perfil } = useAuth();

  const [dados, setDados] = useState<Anuncio[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [busca, setBusca] = useState('');
  const [soMeus, setSoMeus] = useState(false);
  const [editorFiltro, setEditorFiltro] = useState('todos');
  const [soPendentes, setSoPendentes] = useState(false);
  const [verPoucoInvestimento, setVerPoucoInvestimento] = useState(false);
  const [agrupar, setAgrupar] = useState(false);
  const [col, setCol] = useState<Coluna>('investimento');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [aberto, setAberto] = useState<string | null>(null);
  const [vincular, setVincular] = useState<Anuncio | null>(null);
  const [gruposFechados, setGruposFechados] = useState<Record<string, boolean>>({});

  const carregar = useCallback(async () => {
    if (!startDateStr || !endDateStr) return;
    setLoading(true);
    const { data, error } = await supabase.rpc('fn_criativos_meta', {
      p_ini: startDateStr, p_fim: endDateStr, p_conta: contaId,
    });
    if (error) {
      console.error('fn_criativos_meta:', error.message);
      setErro(error.message); setDados([]);
    } else {
      setErro(null);
      const lista = ((data ?? []) as Anuncio[]).map(a => ({
        ...a,
        investimento: num(a.investimento), impressoes: num(a.impressoes),
        cliques_link: num(a.cliques_link), video_3s: num(a.video_3s),
        video_75pct: num(a.video_75pct), checkouts: num(a.checkouts),
        visualizacoes: num(a.visualizacoes), vendas: num(a.vendas), receita: num(a.receita),
        conta_hook: a.conta_hook === null ? null : num(a.conta_hook),
        conta_ctr: a.conta_ctr === null ? null : num(a.conta_ctr),
        conta_conexao: a.conta_conexao === null ? null : num(a.conta_conexao),
        conta_cpa: a.conta_cpa === null ? null : num(a.conta_cpa),
        conta_roas: a.conta_roas === null ? null : num(a.conta_roas),
        vendas_meta: num(a.vendas_meta), receita_meta: num(a.receita_meta),
        conta_cpa_meta: a.conta_cpa_meta === null ? null : num(a.conta_cpa_meta),
        conta_roas_meta: a.conta_roas_meta === null ? null : num(a.conta_roas_meta),
        conta_pct_atribuido: num(a.conta_pct_atribuido),
      }));

      /**
       * CPM e CPC da conta: razão dos totais, nunca média das razões.
       *
       * Somar o CPM de cada anúncio e dividir pela quantidade daria a um anúncio de mil
       * impressões o mesmo peso de um de um milhão — a referência sairia errada
       * justamente onde está o dinheiro.
       */
      const porConta = new Map<string, { inv: number; imp: number; cli: number }>();
      lista.forEach(a => {
        const t = porConta.get(a.conta_id) ?? { inv: 0, imp: 0, cli: 0 };
        t.inv += a.investimento; t.imp += a.impressoes; t.cli += a.cliques_link;
        porConta.set(a.conta_id, t);
      });

      setDados(lista.map(a => {
        const t = porConta.get(a.conta_id);
        return {
          ...a,
          conta_cpm: t && t.imp > 0 ? (t.inv / t.imp) * 1000 : null,
          conta_cpc: t && t.cli > 0 ? t.inv / t.cli : null,
        };
      }));
    }
    setLoading(false);
  }, [startDateStr, endDateStr, contaId]);

  useEffect(() => { carregar(); }, [carregar]);

  const ordenar = (c: Coluna) => {
    if (c === col) setDir(d => (d === 'desc' ? 'asc' : 'desc'));
    else { setCol(c); setDir(c === 'nome' ? 'asc' : 'desc'); }
  };

  const editores = useMemo(() => {
    const m = new Map<string, string>();
    dados.forEach(a => { if (a.editor_id && a.editor) m.set(a.editor_id, a.editor); });
    return [...m.entries()].sort((x, y) => x[1].localeCompare(y[1]));
  }, [dados]);

  /** Agrupado por problema: cada um se resolve de um jeito diferente. */
  const pendentes = useMemo(() => {
    const g: Record<string, Anuncio[]> = {};
    dados.forEach(a => {
      if (resolvido(a.vinculo)) return;
      (g[a.vinculo] ??= []).push(a);
    });
    return g;
  }, [dados]);
  const totalPendentes = Object.values(pendentes).reduce((s, l) => s + l.length, 0);

  /**
   * Quanto o Meta infla, medido onde dá para medir.
   *
   * Comparado só nas contas cuja atribuição por UTM é confiável — nas outras a Payt está
   * cega e a diferença não diria nada sobre o Meta. Nas contas boas ele conta a mais
   * porque credita janela de visualização: quem viu o anúncio e comprou depois por outro
   * caminho entra como conversão dele.
   */
  /** Só para dizer o tamanho da diferença no rodapé. */
  const inflacaoMeta = useMemo(() => {
    const bons = dados.filter(a => a.conta_pct_atribuido >= MIN_ATRIBUICAO);
    const payt = bons.reduce((s, a) => s + a.receita, 0);
    const meta = bons.reduce((s, a) => s + a.receita_meta, 0);
    return payt > 0 ? meta / payt : null;
  }, [dados]);

  const escondidos = useMemo(
    () => dados.filter(a => a.investimento < INVESTIMENTO_RELEVANTE).length, [dados]);

  const visiveis = useMemo(() => {
    let l = dados;
    if (!verPoucoInvestimento) l = l.filter(a => a.investimento >= INVESTIMENTO_RELEVANTE);
    if (soMeus && user) l = l.filter(a => a.editor_id === user.id);
    if (editorFiltro !== 'todos') l = l.filter(a => a.editor_id === editorFiltro);
    if (soPendentes) l = l.filter(a => !resolvido(a.vinculo));
    if (busca.trim()) {
      const b = busca.trim().toLowerCase();
      l = l.filter(a => a.ad_nome?.toLowerCase().includes(b)
                     || a.editor?.toLowerCase().includes(b)
                     || a.conta?.toLowerCase().includes(b));
    }
    const chave = (a: Anuncio): number | string => {
      switch (col) {
        case 'nome': return a.ad_nome ?? '';
        case 'cpm': return cpmDe(a) ?? Number.MAX_SAFE_INTEGER;
        case 'cpc': return cpcDe(a) ?? Number.MAX_SAFE_INTEGER;
        case 'roas': return roasDe(a) ?? -1;
        case 'cpa': return cpaDe(a) ?? Number.MAX_SAFE_INTEGER;
        case 'hook': return hookDe(a) ?? -1;
        case 'ctr': return ctrDe(a) ?? -1;
        default: return a.investimento;
      }
    };
    const sinal = dir === 'desc' ? -1 : 1;
    return [...l].sort((a, b) => {
      const x = chave(a), y = chave(b);
      if (typeof x === 'string' || typeof y === 'string') {
        return String(x).localeCompare(String(y)) * sinal;
      }
      return (x - y) * sinal;
    });
  }, [dados, verPoucoInvestimento, soMeus, user, editorFiltro, soPendentes, busca, col, dir]);

  /** Lista plana ou em blocos por editor, na mesma ordenação escolhida. */
  const blocos = useMemo(() => {
    if (!agrupar) return [{ chave: '', titulo: '', itens: visiveis }];
    const m = new Map<string, Anuncio[]>();
    visiveis.forEach(a => {
      const k = a.editor ?? 'Sem dono definido';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(a);
    });
    return [...m.entries()]
      .map(([titulo, itens]) => ({ chave: titulo, titulo, itens }))
      .sort((x, y) => y.itens.reduce((s, a) => s + a.investimento, 0)
                    - x.itens.reduce((s, a) => s + a.investimento, 0));
  }, [visiveis, agrupar]);

  /**
   * Rankings sobre o que está filtrado, não sobre a base inteira: se a pessoa filtrou
   * uma conta ou um editor, o "melhor" tem que ser o melhor daquele recorte.
   */
  const rankings = useMemo(() => {
    const topo = (
      elegivel: (a: Anuncio) => boolean,
      valor: (a: Anuncio) => number | null,
      maiorMelhor = true,
    ) => visiveis
      .filter(a => elegivel(a) && valor(a) !== null)
      .sort((x, y) => (maiorMelhor ? 1 : -1) * ((valor(y) as number) - (valor(x) as number)))
      .slice(0, 5)
      .map(a => ({ nome: a.ad_nome || a.ad_id, editor: a.editor,
                   projeto: a.projeto, valor: valor(a) as number }));

    const comVenda = (a: Anuncio) => vendasDe(a) >= MIN_VENDAS;
    const comImpressao = (a: Anuncio) => a.impressoes >= MIN_IMPRESSOES;

    return [
      { titulo: 'Maior ROAS',      itens: topo(comVenda, a => roasDe(a)),      formato: 'x'     as const, ajuda: `mín. ${MIN_VENDAS} vendas` },
      { titulo: 'Menor CPA',       itens: topo(comVenda, a => cpaDe(a), false), formato: 'moeda' as const, ajuda: `mín. ${MIN_VENDAS} vendas` },
      { titulo: 'Mais vendas',     itens: topo(comVenda, a => vendasDe(a)),    formato: 'inteiro' as const, ajuda: 'conversões no período' },
      { titulo: 'Melhor hook 3s',  itens: topo(comImpressao, hookDe),                 formato: 'pct'   as const, ajuda: `mín. ${formatNumber(MIN_IMPRESSOES)} impressões` },
      { titulo: 'Melhor CTR',      itens: topo(comImpressao, ctrDe),                  formato: 'pct'   as const, ajuda: `mín. ${formatNumber(MIN_IMPRESSOES)} impressões` },
      { titulo: 'Melhor retenção', itens: topo(comImpressao, retencaoDe),             formato: 'pct'   as const, ajuda: 'assistiram 75% do vídeo' },
    ];
  }, [visiveis]);

  const totais = visiveis.reduce((acc, a) => ({
    investimento: acc.investimento + a.investimento,
    vendas: acc.vendas + vendasDe(a),
  }), { investimento: 0, vendas: 0 });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Criativos Meta</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Cada anúncio com a hipótese que o card registrou. Vendas são as conversões que o
          Meta credita ao anúncio, e cada taxa é comparada com a média da conta no período.
        </p>
      </div>

      {totalPendentes > 0 && !loading && (
        <div className="flex flex-wrap items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xs text-amber-100">
              {totalPendentes} anúncio{totalPendentes > 1 ? 's' : ''} sem editor identificado
            </p>
            {(Object.entries(pendentes) as [Vinculo, Anuncio[]][])
              .sort((a, b) => b[1].length - a[1].length)
              .map(([v, lista]) => (
                <p key={v} className="text-[11px] leading-relaxed text-amber-200/80">
                  <span className="tabular-nums text-amber-100">{lista.length}</span>{' '}
                  ({formatCurrency(lista.reduce((s, a) => s + a.investimento, 0))}) —{' '}
                  {VINCULO[v].comoResolver}
                </p>
              ))}
          </div>
          <Button size="sm" variant="outline" className="h-7 shrink-0 text-xs"
                  onClick={() => setSoPendentes(v => !v)}>
            {soPendentes ? 'Ver todos' : 'Ver só esses'}
          </Button>
        </div>
      )}

            {!loading && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Vendas aqui são as conversões que o <span className="text-foreground">Meta</span>{' '}
          credita ao anúncio — cobrem todos os anúncios igualmente, inclusive onde a UTM
          falhou, mas contam a mais porque incluem quem viu e comprou depois por outro
          caminho{inflacaoMeta && inflacaoMeta > 1.05 ? `: cerca de ${inflacaoMeta.toFixed(1)}× o que a Payt registra` : ''}.
          Servem para comparar anúncios entre si, não como faturamento — o caixa está no Resumo.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={e => setBusca(e.target.value)}
                 placeholder="Buscar anúncio, editor ou conta" className="h-8 w-60 pl-8 text-xs" />
        </div>

        {user && (
          <button onClick={() => setSoMeus(v => !v)}
                  className={cn('rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                    soMeus ? 'border-primary/50 bg-primary/10 text-primary'
                           : 'border-border text-muted-foreground hover:bg-secondary')}>
            Meus anúncios
          </button>
        )}

        <select value={editorFiltro} onChange={e => setEditorFiltro(e.target.value)}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs">
          <option value="todos">Todos os editores</option>
          {editores.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
        </select>

        <button onClick={() => setAgrupar(v => !v)}
                className={cn('rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                  agrupar ? 'border-primary/50 bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:bg-secondary')}>
          Agrupar por editor
        </button>

        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {visiveis.length} anúncios · {formatCurrency(totais.investimento)} ·{' '}
          {formatNumber(totais.vendas)} vendas
        </span>
      </div>

      {!loading && !erro && visiveis.length > 0 && (
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {rankings.map(r => (
            <MiniRank key={r.titulo} titulo={r.titulo} itens={r.itens}
                      formato={r.formato} ajuda={r.ajuda} />
          ))}
        </div>
      )}

      {loading ? (
        <div className="space-y-1">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-11 animate-pulse rounded border border-border bg-card" />
          ))}
        </div>
      ) : erro ? (
        <div className="flex h-48 flex-col items-center justify-center gap-3 text-center">
          <AlertCircle className="h-6 w-6 text-destructive" />
          <p className="text-sm text-muted-foreground">{erro}</p>
          <Button size="sm" variant="outline" className="text-xs" onClick={carregar}>Tentar de novo</Button>
        </div>
      ) : visiveis.length === 0 ? (
        <div className="flex h-48 items-center justify-center text-center text-sm text-muted-foreground">
          Nenhum anúncio com esses filtros no período selecionado.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-secondary/30 text-xs">
              <tr>
                <th className="w-6" />
                <Cabecalho col="nome"         rotulo="Anúncio"   atual={col} dir={dir} onSort={ordenar} />
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Editor</th>
                <Cabecalho col="investimento" rotulo="Investido" atual={col} dir={dir} onSort={ordenar} alinhar="right" />
                <Cabecalho col="roas"         rotulo="ROAS"      atual={col} dir={dir} onSort={ordenar} alinhar="right" />
                <Cabecalho col="cpa"          rotulo="CPA"       atual={col} dir={dir} onSort={ordenar} alinhar="right" />
                <Cabecalho col="cpm"          rotulo="CPM"       atual={col} dir={dir} onSort={ordenar} alinhar="right" />
                <Cabecalho col="cpc"          rotulo="CPC"       atual={col} dir={dir} onSort={ordenar} alinhar="right" />
                <Cabecalho col="hook"         rotulo="Hook"      atual={col} dir={dir} onSort={ordenar} alinhar="right" />
                <Cabecalho col="ctr"          rotulo="CTR"       atual={col} dir={dir} onSort={ordenar} alinhar="right" />
              </tr>
            </thead>
            <tbody>
              {blocos.map(bloco => (
                <Fragment key={bloco.chave || 'todos'}>
                  {agrupar && (
                    <tr className="border-b border-border/60 bg-secondary/20">
                      <td colSpan={10} className="px-3 py-1.5">
                        <button onClick={() => setGruposFechados(g => ({ ...g, [bloco.chave]: !g[bloco.chave] }))}
                                className="flex w-full items-center gap-1.5 text-xs">
                          {gruposFechados[bloco.chave] ? <ChevronRight className="h-3 w-3" />
                                                       : <ChevronDown className="h-3 w-3" />}
                          <span className="font-medium text-foreground">{bloco.titulo}</span>
                          <span className="tabular-nums text-muted-foreground">
                            · {bloco.itens.length} anúncios ·{' '}
                            {formatCurrency(bloco.itens.reduce((s, a) => s + a.investimento, 0))} investidos ·{' '}
                            {formatNumber(bloco.itens.reduce((s, a) => s + vendasDe(a), 0))} vendas
                          </span>
                        </button>
                      </td>
                    </tr>
                  )}
                  {!gruposFechados[bloco.chave] && bloco.itens.map(a => (
                    <LinhaAnuncio
                      key={a.ad_id} a={a}
                      expandido={aberto === a.ad_id}
                      onToggle={() => setAberto(aberto === a.ad_id ? null : a.ad_id)}
                      onVincular={() => setVincular(a)}
                      ehMeu={!!user && a.editor_id === user.id}
                    />
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Esconder metade da lista sem dizer seria pior do que a poluição que ela causa. */}
      {escondidos > 0 && !loading && (
        <button onClick={() => setVerPoucoInvestimento(v => !v)}
                className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
          {verPoucoInvestimento
            ? `Esconder os ${escondidos} anúncios com menos de ${formatCurrency(INVESTIMENTO_RELEVANTE)} investidos`
            : `Mostrar ${escondidos} anúncios que investiram menos de ${formatCurrency(INVESTIMENTO_RELEVANTE)}`}
        </button>
      )}

      {vincular && (
        <ModalVinculo anuncio={vincular} podeEditar={!!perfil?.is_admin}
                      onFechar={() => setVincular(null)}
                      onSalvo={() => { setVincular(null); carregar(); }} />
      )}
    </div>
  );
}


/**
 * Ranking curto de uma métrica.
 *
 * Existe porque a tabela grande responde "como está cada anúncio" e não responde "quais
 * são os melhores" — para isso a pessoa teria que reordenar seis vezes e memorizar o
 * topo de cada uma. Cinco linhas por métrica cabem numa olhada.
 *
 * Só entra anúncio com amostra suficiente: um hook de 80% em duzentas impressões
 * lideraria todos os rankings e não significaria nada.
 */
function MiniRank({ titulo, itens, formato, ajuda }: {
  titulo: string;
  itens: { nome: string; editor: string | null; projeto: string | null; valor: number }[];
  formato: 'pct' | 'moeda' | 'x' | 'inteiro';
  ajuda: string;
}) {
  const fmt = (v: number) => formato === 'pct' ? `${v.toFixed(1)}%`
    : formato === 'x' ? `${v.toFixed(2)}x`
    : formato === 'inteiro' ? formatNumber(v) : formatCurrency(v);

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{titulo}</span>
        <span className="text-[10px] text-muted-foreground/60" title={ajuda}>{ajuda}</span>
      </div>
      {itens.length === 0 ? (
        <p className="py-3 text-center text-[11px] text-muted-foreground/60">
          Nenhum anúncio com amostra suficiente
        </p>
      ) : (
        <div className="space-y-1.5">
          {itens.map((i, k) => (
            <div key={i.nome + k} className="flex items-start gap-2 text-xs">
              <span className="w-3 shrink-0 tabular-nums text-muted-foreground/40">{k + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-foreground" title={i.nome}>{i.nome}</div>
                {(i.projeto || i.editor) && (
                  <div className="truncate text-[10px] text-muted-foreground/60">
                    {[i.projeto, i.editor].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
              <span className="shrink-0 tabular-nums font-medium text-foreground">{fmt(i.valor)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LinhaAnuncio({ a, expandido, onToggle, onVincular, ehMeu }: {
  a: Anuncio; expandido: boolean; onToggle: () => void; onVincular: () => void; ehMeu: boolean;
}) {
  const hook = hookDe(a), ctr = ctrDe(a);
  const conexao = razao(a.visualizacoes, a.cliques_link);
  const retencao = retencaoDe(a);
  const vendas = vendasDe(a);
  const convCheckout = razao(vendas, a.checkouts);
  const roas = roasDe(a), cpa = cpaDe(a);
  const cpm = cpmDe(a), cpc = cpcDe(a);

  const poucaImpressao = a.impressoes < MIN_IMPRESSOES;
  const poucaVenda = vendas < MIN_VENDAS;
  // A conta não sabe de onde vieram as vendas — mas isso só cega a régua da Payt; a
  // conversão do Meta não depende da UTM.
  // A conversão do Meta não depende da UTM, então nenhuma conta fica cega aqui.
  const cego = false;
  const semCard = !a.producao_id;

  return (
    <>
      <tr onClick={onToggle}
          className={cn('cursor-pointer border-b border-border/40 hover:bg-secondary/30',
            expandido && 'bg-secondary/30')}>
        <td className="pl-3 text-muted-foreground">
          {expandido ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </td>
        <td className="max-w-[260px] px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-foreground" title={a.ad_nome}>{a.ad_nome || a.ad_id}</span>
            {ehMeu && <span className="shrink-0 rounded bg-primary/15 px-1 py-0.5 text-[9px] text-primary">meu</span>}
            {a.avaliacao && (
              <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px]',
                AVALIACAO_COR[a.avaliacao] ?? 'bg-secondary text-muted-foreground')}>
                {a.avaliacao}
              </span>
            )}
          </div>
          <div className="truncate text-[10px] text-muted-foreground/60">
            {a.conta}
            {a.projeto && <span className="text-muted-foreground/45"> · {a.projeto}</span>}
          </div>
        </td>
        <td className="max-w-[130px] px-3 py-2">
          {a.editor
            ? <span className="truncate text-xs text-muted-foreground">{a.editor}</span>
            : <span className="text-xs text-amber-400" title={VINCULO[a.vinculo].comoResolver}>
                {VINCULO[a.vinculo].curto}
              </span>}
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-foreground">{formatCurrency(a.investimento)}</td>
        <td className="px-3 py-2 text-right">
          <Valor v={roas} ref_={refRoas(a)} formato="x" cinza={cego || poucaVenda}
                 titulo={cego ? 'A conta não identifica de qual anúncio vêm as vendas'
                              : 'Poucas vendas para concluir'} />
        </td>
        <td className="px-3 py-2 text-right">
          <Valor v={cpa} ref_={refCpa(a)} formato="moeda" invertido cinza={cego || poucaVenda}
                 titulo={cego ? 'A conta não identifica de qual anúncio vêm as vendas'
                              : 'Poucas vendas para concluir'} />
        </td>
        <td className="px-3 py-2 text-right">
          <Valor v={cpm} ref_={a.conta_cpm} formato="moeda" invertido cinza={poucaImpressao}
                 titulo="Poucas impressões para concluir" />
        </td>
        <td className="px-3 py-2 text-right">
          <Valor v={cpc} ref_={a.conta_cpc} formato="moeda" invertido cinza={poucaImpressao}
                 titulo="Poucas impressões para concluir" />
        </td>
        <td className="px-3 py-2 text-right">
          <Valor v={hook} ref_={a.conta_hook} formato="pct" cinza={poucaImpressao}
                 titulo="Poucas impressões para concluir" />
        </td>
        <td className="px-3 py-2 text-right">
          <Valor v={ctr} ref_={a.conta_ctr} formato="pct" cinza={poucaImpressao}
                 titulo="Poucas impressões para concluir" />
        </td>
      </tr>

      {expandido && (
        <tr className="border-b border-border/40 bg-secondary/10">
          <td />
          <td colSpan={9} className="space-y-3 px-3 pb-3 pt-1">
            {/* A hipótese primeiro: o número só significa alguma coisa contra o que se
                queria testar. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50">Hipótese</span>
              {a.angulo_teste || a.tipo_teste || a.nivel_consciencia || a.formato ? (
                <>
                  {a.tipo_teste && <span className="text-foreground">teste: {a.tipo_teste}</span>}
                  {a.angulo_teste && <span className="text-foreground">ângulo: {a.angulo_teste}</span>}
                  {a.nivel_consciencia && <span className="text-foreground">consciência: {a.nivel_consciencia}</span>}
                  {a.formato && <span className="text-muted-foreground">{a.formato}</span>}
                </>
              ) : (
                <span className="text-muted-foreground/60">
                  {semCard
                    ? VINCULO[a.vinculo].comoResolver || 'sem card ligado a este anúncio'
                    : 'o card existe mas não registrou hipótese'}
                </span>
              )}
              {a.projeto && <span className="text-muted-foreground">· {a.projeto}</span>}
              {a.status_veiculacao && <span className="text-muted-foreground">· {a.status_veiculacao}</span>}
            </div>

            {/* O funil do criativo, na ordem em que a pessoa atravessa. Onde ele cai é
                onde o criativo perdeu. */}
            <div className="grid grid-cols-3 gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2.5 sm:grid-cols-6">
              <Etapa rotulo="Impressões" valor={formatNumber(a.impressoes)} />
              <Etapa rotulo="Hook 3s" valor={hook === null ? '—' : `${hook.toFixed(1)}%`}
                     sob={formatNumber(a.video_3s)} fraco={poucaImpressao} />
              <Etapa rotulo="Retenção 75%"
                     valor={retencao === null
                       ? (videoCurtoDemais(a) ? 'n/a' : '—')
                       : `${retencao.toFixed(1)}%`}
                     sob={videoCurtoDemais(a) ? 'vídeo curto demais' : formatNumber(a.video_75pct)}
                     fraco={poucaImpressao || videoCurtoDemais(a)} />
              <Etapa rotulo="CTR" valor={ctr === null ? '—' : `${ctr.toFixed(1)}%`}
                     sob={formatNumber(a.cliques_link)} fraco={poucaImpressao} />
              <Etapa rotulo="Conexão" valor={conexao === null ? '—' : `${conexao.toFixed(1)}%`}
                     sob={formatNumber(a.visualizacoes)} fraco={poucaImpressao} />
              <Etapa rotulo="Checkout → venda" valor={convCheckout === null ? '—' : `${convCheckout.toFixed(1)}%`}
                     sob={`${formatNumber(vendas)} conversões`}
                     fraco={poucaVenda || cego} />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              {cego ? (
                <span className="text-[11px] text-amber-400/80">
                  só {a.conta_pct_atribuido.toFixed(0)}% das vendas desta conta dizem de qual anúncio
                  vieram — receita, ROAS e CPA aqui não são desempenho, são falta de dado
                </span>
              ) : (poucaImpressao || poucaVenda) ? (
                <span className="text-[11px] text-amber-400/80">
                  {poucaImpressao && `menos de ${formatNumber(MIN_IMPRESSOES)} impressões`}
                  {poucaImpressao && poucaVenda && ' e '}
                  {poucaVenda && `menos de ${MIN_VENDAS} vendas`}
                  {' '}— não dá para concluir
                </span>
              ) : <span />}

              <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
                      onClick={e => { e.stopPropagation(); onVincular(); }}>
                <Link2 className="h-3 w-3" />
                {semCard ? 'Ligar a um card de Produção' : 'Trocar o card de Produção'}
              </Button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** Etapa do funil. Impressões não tem taxa — mostra o número, não um travessão. */
function Etapa({ rotulo, valor, sob, fraco }: {
  rotulo: string; valor: string; sob?: string; fraco?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/50">{rotulo}</div>
      <div className={cn('text-sm tabular-nums', fraco ? 'text-muted-foreground/50' : 'text-foreground')}>
        {valor}
      </div>
      {sob && <div className="text-[10px] tabular-nums text-muted-foreground/50">{sob}</div>}
    </div>
  );
}

interface Card {
  id: string; nome: string; criado_em: string;
  responsavel: { nome: string } | null;
  avaliacao: string | null; status_veiculacao: string | null;
}

/**
 * Diz qual card de Produção é este anúncio.
 *
 * Grava `producoes.ad_id_meta`. Depois de confirmado, o vínculo para de depender do
 * nome — que é o ponto: em 18% dos anúncios o mesmo nome existe em cards de editores
 * diferentes, e escolher "o mais recente" sempre devolveria alguém sem nunca acusar erro.
 */
function ModalVinculo({ anuncio, podeEditar, onFechar, onSalvo }: {
  anuncio: Anuncio; podeEditar: boolean; onFechar: () => void; onSalvo: () => void;
}) {
  const [cards, setCards] = useState<Card[]>([]);
  const [buscando, setBuscando] = useState(true);
  const [termo, setTermo] = useState(anuncio.ad_nome ?? '');
  const [salvando, setSalvando] = useState(false);
  const [erroBusca, setErroBusca] = useState<string | null>(null);

  const procurar = useCallback(async (t: string) => {
    setBuscando(true);
    /**
     * O vínculo com `perfis` vai pelo nome da **coluna**, como no resto do projeto.
     *
     * Estava pelo nome da constraint, `producoes_responsavel_id_fkey`, que não existe: a
     * tabela foi renomeada de `criativos` para `producoes` e as chaves ficaram com o nome
     * antigo (`criativos_responsavel_id_fkey`). O PostgREST recusava a consulta inteira,
     * então a busca de card nunca devolveu nada — para nenhum anúncio, desde sempre.
     */
    const { data, error } = await supabase
      .from('producoes')
      .select('id, nome, criado_em, avaliacao, status_veiculacao, responsavel:perfis!responsavel_id(nome)')
      .eq('fase', 'postado').eq('tipo', 'criativo')
      .ilike('nome', `%${t.trim()}%`)
      .order('criado_em', { ascending: false })
      .limit(25);
    // E o erro era descartado, então a falha aparecia como "nenhum card com esse nome":
    // uma resposta confiante e errada sobre uma consulta que nem chegou a rodar.
    setErroBusca(error ? error.message : null);
    setCards((data ?? []) as unknown as Card[]);
    setBuscando(false);
  }, []);

  // Busca uma vez ao abrir, com o nome do anúncio. Depois quem dispara é a pessoa:
  // refazer a cada tecla transformaria digitar num bombardeio de consultas.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { procurar(termo); }, []);

  const salvar = async (cardId: string) => {
    setSalvando(true);
    // Um anúncio pertence a um card só: solta o vínculo anterior antes de criar o novo,
    // senão o índice único recusa e o clique vira erro sem explicação.
    await supabase.from('producoes').update({ ad_id_meta: null }).eq('ad_id_meta', anuncio.ad_id);
    const { data, error } = await supabase
      .from('producoes').update({ ad_id_meta: anuncio.ad_id }).eq('id', cardId).select('id');
    setSalvando(false);

    if (error || !data?.length) {
      toast({
        title: 'Não salvou',
        description: error?.message ?? 'Nenhuma linha alterada — provável falta de permissão.',
        variant: 'destructive',
      });
      return;
    }
    toast({ title: 'Anúncio ligado ao card' });
    onSalvo();
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onFechar(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">De qual card de Produção é este anúncio?</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            O card guarda quem editou e qual era a hipótese. Ligar o anúncio a ele é o que faz
            esta tela saber de quem é o trabalho — o nome sozinho não basta, porque cards de
            editores diferentes usam o mesmo nome.
          </p>

          <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
            <div className="text-sm font-medium text-foreground">{anuncio.ad_nome}</div>
            <div className="text-[11px] text-muted-foreground">
              {anuncio.conta} · {formatCurrency(anuncio.investimento)} investidos ·{' '}
              {anuncio.vendas_meta} conversões
              {anuncio.candidatos > 1 &&
                ` · ${anuncio.candidatos} editores têm card com este nome; o escolhido foi o mais próximo da estreia`}
            </div>
          </div>

          {!podeEditar && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200/90">
              Só administrador define o dono do anúncio. Você pode conferir os candidatos abaixo.
            </p>
          )}

          <div className="flex gap-2">
            <Input value={termo} onChange={e => setTermo(e.target.value)}
                   onKeyDown={e => { if (e.key === 'Enter') procurar(termo); }}
                   placeholder="Buscar card pelo nome" className="h-8 text-xs" />
            <Button size="sm" variant="outline" className="h-8 text-xs"
                    onClick={() => procurar(termo)} disabled={buscando}>
              {buscando ? 'Buscando...' : 'Buscar'}
            </Button>
          </div>

          <div className="max-h-80 space-y-1 overflow-y-auto">
            {buscando ? (
              <p className="py-6 text-center text-xs text-muted-foreground">Buscando...</p>
            ) : erroBusca ? (
              <p className="py-6 text-center text-xs text-destructive">
                A busca falhou — {erroBusca}
              </p>
            ) : cards.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Nenhum card postado do tipo criativo com esse nome.
              </p>
            ) : cards.map(c => (
              <div key={c.id} className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-foreground">{c.nome}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {c.responsavel?.nome ?? 'sem responsável'}
                    {c.avaliacao && ` · ${c.avaliacao}`}
                    {c.status_veiculacao && ` · ${c.status_veiculacao}`}
                    {' · '}{new Date(c.criado_em).toLocaleDateString('pt-BR')}
                  </div>
                </div>
                <Button size="sm" variant="outline" className="h-7 shrink-0 text-xs"
                        disabled={!podeEditar || salvando} onClick={() => salvar(c.id)}>
                  {anuncio.producao_id === c.id ? 'Atual' : 'É este'}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
