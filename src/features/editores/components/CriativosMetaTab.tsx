import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useFilters } from '@/contexts/FilterContext';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Link2, AlertCircle, ChevronDown, ChevronRight, Search } from 'lucide-react';
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
 *   comparar Fulana com Beltrana por ROAS cobra de cada uma o que dependeu da oferta
 *   que pegou. A performance financeira aparece por anúncio, que é onde ela julga o
 *   criativo, e não numa tabela de pessoas.
 * - **Não deixa o editor marcar "validado".** Isso é decisão de sócio, e acontece em
 *   Criativos → Avaliação. Aqui só se lê.
 * - **Não esconde amostra pequena.** Hook de 60% em 300 impressões não é hipótese
 *   validada; a tela diz isso em vez de mostrar o número como se fosse conclusão.
 */

type Vinculo = 'confirmado' | 'sugerido' | 'ambiguo' | 'sem_card';

interface Anuncio {
  ad_id: string;
  ad_nome: string;
  conta_id: string;
  conta: string;
  investimento: number;
  impressoes: number;
  cliques_link: number;
  video_3s: number;
  video_75pct: number;
  checkouts: number;
  visualizacoes: number;
  vendas: number;
  receita: number;
  producao_id: string | null;
  editor_id: string | null;
  editor: string | null;
  projeto: string | null;
  avaliacao: string | null;
  status_veiculacao: string | null;
  tipo_teste: string | null;
  angulo_teste: string | null;
  nivel_consciencia: string | null;
  formato: string | null;
  vinculo: Vinculo;
  candidatos: number;
  conta_hook: number | null;
  conta_ctr: number | null;
  conta_conexao: number | null;
  conta_cpa: number | null;
  conta_roas: number | null;
  /** Quanto das vendas da conta chega com anúncio identificado, no período. */
  conta_pct_atribuido: number;
}

/** PostgREST devolve `numeric` como string; somar isso concatena. */
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/**
 * Abaixo disso o número existe mas não conclui nada.
 *
 * Separados porque medem coisas diferentes: mil impressões já dizem se o vídeo segura,
 * mas três vendas não dizem se o anúncio é lucrativo. É a mesma disciplina das
 * Tendências — mostrar o limite em vez de deixar o número parecer conclusão.
 */
const MIN_IMPRESSOES = 1000;
const MIN_VENDAS = 3;

/**
 * Abaixo disso, o financeiro por anúncio não é subestimado: é ficção.
 *
 * A conta "Saponaria" gastou R$ 10.968 num anúncio que aparece com ROAS 0,00x — não
 * porque o anúncio seja ruim, mas porque 1% das 735 vendas dela carregam identificação.
 * Zero em vermelho ao lado de onze mil reais é a pior forma de errar: parece conclusão,
 * é ausência de dado.
 */
const MIN_ATRIBUICAO = 80;

const razao = (num: number, den: number) => (den > 0 ? (num / den) * 100 : null);

const AVALIACAO_COR: Record<string, string> = {
  Validado: 'bg-success/15 text-success',
  Escalado: 'bg-primary/15 text-primary',
  'Não validado': 'bg-destructive/15 text-destructive',
  'Sem dados': 'bg-secondary text-muted-foreground',
};

const VINCULO_ROTULO: Record<Vinculo, string> = {
  confirmado: 'confirmado',
  sugerido: 'pelo nome',
  ambiguo: 'sem dono',
  sem_card: 'sem card',
};

type Ordem = 'investimento' | 'receita' | 'roas' | 'cpa' | 'hook' | 'ctr';

/** Métrica com a referência da conta ao lado — sozinha ela não diz nada. */
function Metrica({ valor, refConta, formato, invertido, semAmostra }: {
  valor: number | null; refConta: number | null;
  formato: 'pct' | 'moeda' | 'x'; invertido?: boolean; semAmostra?: boolean;
}) {
  if (valor === null) return <span className="text-muted-foreground/40">—</span>;

  const texto = formato === 'pct' ? `${valor.toFixed(1)}%`
    : formato === 'x' ? `${valor.toFixed(2)}x`
    : formatCurrency(valor);

  if (semAmostra) {
    return (
      <span className="text-muted-foreground/50" title="Amostra pequena demais para concluir">
        {texto}
      </span>
    );
  }

  const acima = refConta !== null && refConta > 0 ? valor > refConta : null;
  const bom = acima === null ? null : invertido ? !acima : acima;
  const delta = refConta !== null && refConta > 0
    ? ((valor - refConta) / refConta) * 100
    : null;

  return (
    <span className="inline-flex items-baseline gap-1.5 tabular-nums">
      <span className={cn('font-medium', bom === null ? 'text-foreground' : bom ? 'text-success' : 'text-destructive')}>
        {texto}
      </span>
      {delta !== null && Math.abs(delta) >= 1 && (
        <span className="text-[10px] text-muted-foreground/60" title={`Conta no período: ${
          formato === 'pct' ? `${refConta!.toFixed(1)}%` : formato === 'x' ? `${refConta!.toFixed(2)}x` : formatCurrency(refConta!)
        }`}>
          {delta > 0 ? '+' : ''}{delta.toFixed(0)}%
        </span>
      )}
    </span>
  );
}

/** Etapa do funil do criativo, com o número absoluto embaixo da taxa. */
function Etapa({ rotulo, taxa, absoluto, fraco }: {
  rotulo: string; taxa: number | null; absoluto: string; fraco?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/50">{rotulo}</div>
      <div className={cn('text-sm tabular-nums', fraco ? 'text-muted-foreground/50' : 'text-foreground')}>
        {taxa === null ? '—' : `${taxa.toFixed(1)}%`}
      </div>
      <div className="text-[10px] tabular-nums text-muted-foreground/50">{absoluto}</div>
    </div>
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
  const [editorFiltro, setEditorFiltro] = useState<string>('todos');
  const [soPendentes, setSoPendentes] = useState(false);
  const [ordem, setOrdem] = useState<Ordem>('investimento');
  const [aberto, setAberto] = useState<string | null>(null);
  const [vincular, setVincular] = useState<Anuncio | null>(null);

  const carregar = useCallback(async () => {
    if (!startDateStr || !endDateStr) return;
    setLoading(true);
    const { data, error } = await supabase.rpc('fn_criativos_meta', {
      p_ini: startDateStr, p_fim: endDateStr, p_conta: contaId,
    });
    if (error) {
      console.error('fn_criativos_meta:', error.message);
      setErro(error.message);
      setDados([]);
    } else {
      setErro(null);
      setDados(((data ?? []) as Anuncio[]).map(a => ({
        ...a,
        investimento: n(a.investimento), impressoes: n(a.impressoes),
        cliques_link: n(a.cliques_link), video_3s: n(a.video_3s),
        video_75pct: n(a.video_75pct), checkouts: n(a.checkouts),
        visualizacoes: n(a.visualizacoes), vendas: n(a.vendas), receita: n(a.receita),
        conta_hook: a.conta_hook === null ? null : n(a.conta_hook),
        conta_ctr: a.conta_ctr === null ? null : n(a.conta_ctr),
        conta_conexao: a.conta_conexao === null ? null : n(a.conta_conexao),
        conta_cpa: a.conta_cpa === null ? null : n(a.conta_cpa),
        conta_roas: a.conta_roas === null ? null : n(a.conta_roas),
        conta_pct_atribuido: n(a.conta_pct_atribuido),
      })));
    }
    setLoading(false);
  }, [startDateStr, endDateStr, contaId]);

  useEffect(() => { carregar(); }, [carregar]);

  const editores = useMemo(() => {
    const m = new Map<string, string>();
    dados.forEach(a => { if (a.editor_id && a.editor) m.set(a.editor_id, a.editor); });
    return [...m.entries()].sort((x, y) => x[1].localeCompare(y[1]));
  }, [dados]);

  const pendentes = dados.filter(a => a.vinculo === 'ambiguo' || a.vinculo === 'sem_card');

  /** Contas cujas vendas em maioria não dizem de qual anúncio vieram. */
  const contasCegas = useMemo(() => {
    const m = new Map<string, number>();
    dados.forEach(a => {
      if (a.conta_pct_atribuido < MIN_ATRIBUICAO) m.set(a.conta, a.conta_pct_atribuido);
    });
    return [...m.entries()].map(([nome, pct]) => ({ nome, pct }));
  }, [dados]);

  const visiveis = useMemo(() => {
    let l = dados;
    if (soMeus && user) l = l.filter(a => a.editor_id === user.id);
    if (editorFiltro !== 'todos') l = l.filter(a => a.editor_id === editorFiltro);
    if (soPendentes) l = l.filter(a => a.vinculo === 'ambiguo' || a.vinculo === 'sem_card');
    if (busca.trim()) {
      const b = busca.trim().toLowerCase();
      l = l.filter(a => a.ad_nome?.toLowerCase().includes(b) || a.editor?.toLowerCase().includes(b));
    }
    const chave = (a: Anuncio) => {
      switch (ordem) {
        case 'receita': return a.receita;
        case 'roas': return a.investimento > 0 ? a.receita / a.investimento : -1;
        case 'cpa': return a.vendas > 0 ? -(a.investimento / a.vendas) : -Infinity;
        case 'hook': return razao(a.video_3s, a.impressoes) ?? -1;
        case 'ctr': return razao(a.cliques_link, a.impressoes) ?? -1;
        default: return a.investimento;
      }
    };
    return [...l].sort((a, b) => chave(b) - chave(a));
  }, [dados, soMeus, user, editorFiltro, soPendentes, busca, ordem]);

  const totais = useMemo(() => visiveis.reduce(
    (acc, a) => ({
      investimento: acc.investimento + a.investimento,
      receita: acc.receita + a.receita,
      vendas: acc.vendas + a.vendas,
    }), { investimento: 0, receita: 0, vendas: 0 },
  ), [visiveis]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Criativos Meta</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          O que cada anúncio entregou, ao lado da hipótese que o card de Produção registrou.
          Vendas contam a compra principal e os order bumps — upsell é receita do funil, não
          do criativo. As taxas são comparadas com a média da própria conta no período.
        </p>
      </div>

      {/* Anúncio sem dono não é detalhe: é editor sem crédito pelo trabalho dele. Fica
          no topo, com o caminho para resolver, em vez de escondido num filtro. */}
      {pendentes.length > 0 && !loading && (
        <div className="flex flex-wrap items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-amber-200/90">
            <span className="text-amber-100">
              {pendentes.length} anúncio{pendentes.length > 1 ? 's' : ''} sem dono definido
            </span>{' '}
            — {formatCurrency(pendentes.reduce((s, a) => s + a.investimento, 0))} investidos e{' '}
            {pendentes.reduce((s, a) => s + a.vendas, 0)} vendas que não estão creditadas a
            ninguém. O nome do card bate com produções de editores diferentes, ou não existe
            card postado com esse nome.
          </p>
          <Button size="sm" variant="outline" className="h-7 shrink-0 text-xs"
                  onClick={() => setSoPendentes(v => !v)}>
            {soPendentes ? 'Ver todos' : 'Resolver'}
          </Button>
        </div>
      )}

      {contasCegas.length > 0 && !loading && (
        <div className="flex flex-wrap items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-amber-200/90">
            <span className="text-amber-100">
              Receita, ROAS e CPA não são confiáveis em{' '}
              {contasCegas.map(c => c.nome).join(', ')}
            </span>{' '}
            — só {contasCegas.map(c => `${c.pct.toFixed(0)}%`).join(' e ')} das vendas dessas
            contas chegam com anúncio identificado. Os números aparecem em cinza nesses
            anúncios: não são desempenho ruim, é venda que existe e não sabemos de qual
            criativo veio. Hook, CTR e retenção seguem válidos, porque não dependem da venda.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={e => setBusca(e.target.value)}
                 placeholder="Buscar anúncio ou editor" className="h-8 w-56 pl-8 text-xs" />
        </div>

        {/* Opcional, e desligado por padrão: o editor também vem aqui para ver o que
            os outros fizeram e se inspirar. */}
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

        <select value={ordem} onChange={e => setOrdem(e.target.value as Ordem)}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs">
          <option value="investimento">Ordenar por investimento</option>
          <option value="receita">Receita</option>
          <option value="roas">ROAS</option>
          <option value="cpa">CPA (menor primeiro)</option>
          <option value="hook">Hook</option>
          <option value="ctr">CTR</option>
        </select>

        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {visiveis.length} anúncios · {formatCurrency(totais.investimento)} investidos ·{' '}
          {formatCurrency(totais.receita)} · {formatNumber(totais.vendas)} vendas
        </span>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="h-14 animate-pulse rounded-lg border border-border bg-card" />
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
        <div className="space-y-1.5">
          {visiveis.map(a => (
            <LinhaAnuncio
              key={a.ad_id}
              a={a}
              expandido={aberto === a.ad_id}
              onToggle={() => setAberto(aberto === a.ad_id ? null : a.ad_id)}
              onVincular={() => setVincular(a)}
              ehMeu={!!user && a.editor_id === user.id}
            />
          ))}
        </div>
      )}

      {vincular && (
        <ModalVinculo
          anuncio={vincular}
          podeEditar={!!perfil?.is_admin}
          onFechar={() => setVincular(null)}
          onSalvo={() => { setVincular(null); carregar(); }}
        />
      )}
    </div>
  );
}

function LinhaAnuncio({ a, expandido, onToggle, onVincular, ehMeu }: {
  a: Anuncio; expandido: boolean; onToggle: () => void; onVincular: () => void; ehMeu: boolean;
}) {
  const hook = razao(a.video_3s, a.impressoes);
  const ctr = razao(a.cliques_link, a.impressoes);
  const conexao = razao(a.visualizacoes, a.cliques_link);
  const retencao = razao(a.video_75pct, a.video_3s);
  const convCheckout = razao(a.vendas, a.checkouts);
  const roas = a.investimento > 0 ? a.receita / a.investimento : null;
  const cpa = a.vendas > 0 ? a.investimento / a.vendas : null;

  const poucaImpressao = a.impressoes < MIN_IMPRESSOES;
  const poucaVenda = a.vendas < MIN_VENDAS;
  // Não é amostra pequena: é a conta inteira que não sabe de onde vieram as vendas.
  const financeiroCego = a.conta_pct_atribuido < MIN_ATRIBUICAO;
  const semDono = a.vinculo === 'ambiguo' || a.vinculo === 'sem_card';

  return (
    <div className={cn('rounded-lg border bg-card', semDono ? 'border-amber-500/25' : 'border-border')}>
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left">
        {expandido ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                   : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{a.ad_nome || a.ad_id}</span>
            {ehMeu && <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">meu</span>}
            {a.avaliacao && (
              <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
                AVALIACAO_COR[a.avaliacao] ?? 'bg-secondary text-muted-foreground')}>
                {a.avaliacao}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground">
            <span>{a.conta}</span>
            <span className="text-muted-foreground/30">·</span>
            {a.editor ? <span>{a.editor}</span>
                      : <span className="text-amber-400">{VINCULO_ROTULO[a.vinculo]}</span>}
            {a.vinculo === 'sugerido' && (
              <span className="text-muted-foreground/50" title="Vínculo deduzido do nome do card, não confirmado">
                · pelo nome
              </span>
            )}
          </div>
        </div>

        {/* Quatro colunas, não cinco: o hook já aparece no detalhe, e a quinta espremia
            o nome do anúncio até "AD 0...". Nome truncado num painel cujo assunto é o
            anúncio é o pior lugar para economizar espaço. */}
        <div className="hidden shrink-0 gap-4 text-right text-xs sm:flex">
          <div className="w-[76px]">
            <div className="text-[10px] text-muted-foreground/50">Investido</div>
            <div className="tabular-nums text-foreground">{formatCurrency(a.investimento)}</div>
          </div>
          <div className="w-[76px]">
            <div className="text-[10px] text-muted-foreground/50">Receita</div>
            <div className={cn('tabular-nums', financeiroCego ? 'text-muted-foreground/40' : 'text-foreground')}
                 title={financeiroCego ? 'A conta não identifica de qual anúncio vêm as vendas' : undefined}>
              {formatCurrency(a.receita)}
            </div>
          </div>
          <div className="w-16">
            <div className="text-[10px] text-muted-foreground/50">ROAS</div>
            <Metrica valor={roas} refConta={a.conta_roas} formato="x" semAmostra={poucaVenda || financeiroCego} />
          </div>
          <div className="w-[76px]">
            <div className="text-[10px] text-muted-foreground/50">CPA</div>
            <Metrica valor={cpa} refConta={a.conta_cpa} formato="moeda" invertido semAmostra={poucaVenda || financeiroCego} />
          </div>
        </div>
      </button>

      {expandido && (
        <div className="space-y-3 border-t border-border/60 px-3.5 py-3">
          {/* A hipótese primeiro: o número só significa alguma coisa contra o que se
              queria testar. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
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
                {a.producao_id ? 'o card não registrou hipótese' : 'sem card de Produção'}
              </span>
            )}
            {a.projeto && <span className="text-muted-foreground">· {a.projeto}</span>}
            {a.status_veiculacao && <span className="text-muted-foreground">· {a.status_veiculacao}</span>}
          </div>

          {/* O funil do criativo, na ordem em que a pessoa atravessa. Onde ele cai é
              onde o criativo perdeu. */}
          <div className="grid grid-cols-3 gap-4 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2.5 sm:grid-cols-6">
            <Etapa rotulo="Impressões" taxa={null} absoluto={formatNumber(a.impressoes)} />
            <Etapa rotulo="Hook 3s" taxa={hook} absoluto={formatNumber(a.video_3s)} fraco={poucaImpressao} />
            <Etapa rotulo="Retenção 75%" taxa={retencao} absoluto={formatNumber(a.video_75pct)} fraco={poucaImpressao} />
            <Etapa rotulo="CTR" taxa={ctr} absoluto={formatNumber(a.cliques_link)} fraco={poucaImpressao} />
            <Etapa rotulo="Conexão" taxa={conexao} absoluto={formatNumber(a.visualizacoes)} fraco={poucaImpressao} />
            <Etapa rotulo="Checkout → venda" taxa={convCheckout} absoluto={`${formatNumber(a.vendas)} vendas`} fraco={poucaVenda} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <span className="text-muted-foreground">
                CTR <Metrica valor={ctr} refConta={a.conta_ctr} formato="pct" semAmostra={poucaImpressao} />
              </span>
              <span className="text-muted-foreground">
                Conexão <Metrica valor={conexao} refConta={a.conta_conexao} formato="pct" semAmostra={poucaImpressao} />
              </span>
              {financeiroCego ? (
                <span className="text-[11px] text-amber-400/80">
                  só {a.conta_pct_atribuido.toFixed(0)}% das vendas desta conta dizem de qual
                  anúncio vieram — receita, ROAS e CPA aqui não são desempenho, são falta de dado
                </span>
              ) : (poucaImpressao || poucaVenda) && (
                <span className="text-[11px] text-amber-400/80">
                  {poucaImpressao && `menos de ${formatNumber(MIN_IMPRESSOES)} impressões`}
                  {poucaImpressao && poucaVenda && ' e '}
                  {poucaVenda && `menos de ${MIN_VENDAS} vendas`}
                  {' '}— não dá para concluir
                </span>
              )}
            </div>

            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={onVincular}>
              <Link2 className="h-3 w-3" />
              {a.vinculo === 'confirmado' ? 'Trocar card' : 'Definir card'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

interface Card {
  id: string; nome: string; criado_em: string;
  responsavel: { nome: string } | null;
  avaliacao: string | null; status_veiculacao: string | null;
}

/**
 * Confirma qual card de Produção é este anúncio.
 *
 * Grava `producoes.ad_id_meta`. Depois de confirmado, o vínculo para de depender do
 * nome — que é o ponto: em 18% dos anúncios o mesmo nome existe em cards de editores
 * diferentes, e escolher "o mais recente" sempre devolveria alguém sem nunca acusar
 * erro.
 */
function ModalVinculo({ anuncio, podeEditar, onFechar, onSalvo }: {
  anuncio: Anuncio; podeEditar: boolean; onFechar: () => void; onSalvo: () => void;
}) {
  const [cards, setCards] = useState<Card[]>([]);
  const [buscando, setBuscando] = useState(true);
  const [termo, setTermo] = useState(anuncio.ad_nome ?? '');
  const [salvando, setSalvando] = useState(false);

  const procurar = useCallback(async (t: string) => {
    setBuscando(true);
    const { data } = await supabase
      .from('producoes')
      .select('id, nome, criado_em, avaliacao, status_veiculacao, responsavel:perfis!producoes_responsavel_id_fkey(nome)')
      .eq('fase', 'postado').eq('tipo', 'criativo')
      .ilike('nome', `%${t.trim()}%`)
      .order('criado_em', { ascending: false })
      .limit(25);
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
    toast({ title: 'Card vinculado ao anúncio' });
    onSalvo();
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onFechar(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">Qual card é este anúncio?</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
            <div className="text-sm font-medium text-foreground">{anuncio.ad_nome}</div>
            <div className="text-[11px] text-muted-foreground">
              {anuncio.conta} · {formatCurrency(anuncio.investimento)} investidos ·{' '}
              {anuncio.vendas} vendas
              {anuncio.vinculo === 'ambiguo' &&
                ` · ${anuncio.candidatos} editores diferentes têm card com este nome`}
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
