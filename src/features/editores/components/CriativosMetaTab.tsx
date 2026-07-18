import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { ArrowUpDown, Trophy, Anchor, ShoppingCart, MousePointer, RefreshCw, Search, Settings2, ChevronUp, ChevronDown, Eye, EyeOff, Check, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { ImportarPaytModal } from './ImportarPaytModal';

// ─── tipos ────────────────────────────────────────────────────────────────────
type Preset  = 'yesterday' | '7d' | '28d' | 'custom';
type SortKey =
  | 'investimento' | 'roas' | 'vendas'
  | 'hook_rate' | 'body_rate'
  | 'taxa_conv' | 'ctr_pct' | 'cpc' | 'cpm';

// ─── formatadores ─────────────────────────────────────────────────────────────
const brl  = (v: number) => 'R$ ' + v.toFixed(2);
const pct  = (v: number) => v.toFixed(2) + '%';
const num  = (v: number) => v.toLocaleString('pt-BR');
const xval = (v: number) => v.toFixed(2) + 'x';

// color: good ≥ good, ok ≥ ok, else red. rev=true inverte (menor é melhor)
function clr(v: number, good: number, ok: number, rev = false) {
  if (rev) return v <= good ? 'text-emerald-400' : v <= ok ? 'text-amber-400' : 'text-red-400';
  return v >= good ? 'text-emerald-400' : v >= ok ? 'text-amber-400' : 'text-red-400';
}

// ─── datas (fuso de São Paulo) ────────────────────────────────────────────────
const TZ = 'America/Sao_Paulo';
const brDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ }); // → YYYY-MM-DD
const today  = () => brDate(new Date());
const ago    = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return brDate(d);
};

// ─── ranking card ─────────────────────────────────────────────────────────────
type RankingDef = {
  title: string;
  icon: React.ReactNode;
  key: SortKey;
  fmt: (v: number) => string;
  colorFn?: (v: number) => string;
  subtitle?: string;
};

const MIN_SPEND = 100;
const MIN_VENDAS = 3;
const qualifica = (r: any) =>
  Number(r.investimento ?? 0) >= MIN_SPEND || Number(r.vendas ?? 0) > MIN_VENDAS;

// Selects the best Notion entry when multiple ads share the same name across projects.
// Prefers the entry whose projeto_nome matches the account's produto_payt.
function pickBest(
  entries: Array<{ editor_nome: string | null; projeto_nome: string | null }> | undefined,
  produto: string,
) {
  if (!entries || entries.length === 0) return null;
  if (entries.length === 1) return entries[0];
  const prod = produto.toLowerCase();
  return entries.find(e =>
    e.projeto_nome && (
      e.projeto_nome.toLowerCase().includes(prod) ||
      prod.includes(e.projeto_nome.toLowerCase())
    ),
  ) ?? entries[0];
}

function RankingCard({ def, rows }: { def: RankingDef; rows: any[] }) {
  const top = [...rows]
    .filter(r => qualifica(r) && Number(r[def.key] ?? 0) > 0)
    .sort((a, b) => Number(b[def.key] ?? 0) - Number(a[def.key] ?? 0))
    .slice(0, 5);

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <span className="text-primary">{def.icon}</span>
        <div>
          <h4 className="text-sm font-semibold">{def.title}</h4>
          {def.subtitle && <p className="text-xs text-muted-foreground">{def.subtitle}</p>}
        </div>
      </div>
      <div className="divide-y divide-border/50">
        {top.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">Sem dados</div>
        )}
        {top.map((r, i) => (
          <div key={String(r.ad_id) + i} className="px-4 py-2.5 flex items-center gap-3">
            <span className={cn(
              'text-xs font-bold w-5 text-center',
              i === 0 && 'text-amber-400',
              i === 1 && 'text-slate-400',
              i === 2 && 'text-orange-600',
              i > 2    && 'text-muted-foreground',
            )}>
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate" title={r.ad_nome}>{r.ad_nome}</div>
              {(r.projeto_notion || r.produto_payt) && (
                <div className="text-xs text-muted-foreground truncate">{r.projeto_notion || r.produto_payt}</div>
              )}
              {/* editor_notion oculto temporariamente */}
            </div>
            <span className={cn(
              'text-sm font-semibold tabular-nums',
              def.colorFn ? def.colorFn(Number(r[def.key])) : 'text-foreground',
            )}>
              {def.fmt(Number(r[def.key] ?? 0))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConsistencyCard({ defs, rows }: { defs: RankingDef[]; rows: any[] }) {
  // conta quantas vezes cada ad aparece no top 5 de cada ranking
  const counts = new Map<string, { ad_nome: string; produto_payt: string; editor_notion: string | null; projeto_notion: string | null; count: number; cats: string[] }>();
  for (const def of defs) {
    const top = [...rows]
      .filter(r => qualifica(r) && Number(r[def.key] ?? 0) > 0)
      .sort((a, b) => Number(b[def.key] ?? 0) - Number(a[def.key] ?? 0))
      .slice(0, 5);
    for (const r of top) {
      const id = String(r.ad_id ?? r.ad_nome);
      const cur = counts.get(id) ?? { ad_nome: r.ad_nome, produto_payt: r.produto_payt ?? '', editor_notion: r.editor_notion ?? null, projeto_notion: r.projeto_notion ?? null, count: 0, cats: [] };
      cur.count++;
      cur.cats.push(def.title);
      counts.set(id, cur);
    }
  }

  const top = [...counts.values()]
    .filter(e => e.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <span className="text-primary"><Trophy className="h-4 w-4" /></span>
        <div>
          <h4 className="text-sm font-semibold">Mais consistente</h4>
          <p className="text-xs text-muted-foreground">Aparece em mais de um ranking</p>
        </div>
      </div>
      <div className="divide-y divide-border/50">
        {top.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">Nenhum ad no top de 2+ métricas</div>
        )}
        {top.map((e, i) => (
          <div key={e.ad_nome + i} className="px-4 py-2.5 flex items-start gap-3">
            <span className={cn(
              'text-xs font-bold w-5 text-center mt-0.5',
              i === 0 && 'text-amber-400',
              i === 1 && 'text-slate-400',
              i === 2 && 'text-orange-600',
              i > 2    && 'text-muted-foreground',
            )}>
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate" title={e.ad_nome}>{e.ad_nome}</p>
              {(e.projeto_notion || e.produto_payt) && (
                <p className="text-xs text-muted-foreground truncate">{e.projeto_notion || e.produto_payt}</p>
              )}
              {/* editor_notion oculto temporariamente */}
              <p className="text-xs text-muted-foreground/50 truncate">{e.cats.join(' · ')}</p>
            </div>
            <span className="text-sm font-semibold text-emerald-400 tabular-nums">{e.count}x</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── colunas ──────────────────────────────────────────────────────────────────
type ColKey = SortKey | 'ad_nome' | 'conta_nome' | 'campanha_nome';

type ColDef = {
  key: ColKey;
  label: string;
  // métricas têm fmt + colorFn; colunas de texto têm type:'text'
  type?: 'text';
  fmt?: (v: number) => string;
  colorFn?: (v: number) => string;
};

// métricas (ordenáveis)
const COLS: ColDef[] = [
  { key: 'investimento', label: 'Invest.',  fmt: brl },
  { key: 'roas',         label: 'ROAS',     fmt: xval, colorFn: v => clr(v, 3, 1) },
  { key: 'vendas',       label: 'Vendas',   fmt: num },
  { key: 'hook_rate',    label: 'Hook%',    fmt: pct,  colorFn: v => clr(v, 25, 10) },
  { key: 'body_rate',    label: 'Body%',    fmt: pct,  colorFn: v => clr(v, 50, 25) },
  { key: 'taxa_conv',    label: 'Conv%',    fmt: pct,  colorFn: v => clr(v, 3, 1) },
  { key: 'ctr_pct',      label: 'CTR',      fmt: pct,  colorFn: v => clr(v, 2, 0.5) },
  { key: 'cpc',          label: 'CPC',      fmt: brl },
  { key: 'cpm',          label: 'CPM',      fmt: brl },
];

// todas as colunas (incluindo texto)
const ALL_COLS: ColDef[] = [
  { key: 'ad_nome',      label: 'Criativo',  type: 'text' },
  { key: 'conta_nome',   label: 'CA',        type: 'text' },
  { key: 'campanha_nome',label: 'Campanha',  type: 'text' },
  ...COLS,
];

const ALL_COL_KEYS = ALL_COLS.map(c => c.key);
const colMap = Object.fromEntries(ALL_COLS.map(c => [c.key, c])) as Record<ColKey, ColDef>;

// ─── componente principal ─────────────────────────────────────────────────────
export function CriativosMetaTab() {
  const [rows, setRows]         = useState<any[]>([]);
  const [paytByAdId, setPaytByAdId] = useState<Record<string, { vendas: number; valor: number }>>({});
  const [paytByKey,  setPaytByKey]  = useState<Record<string, { vendas: number; valor: number }>>({});
  const [accountMap, setAccountMap] = useState<Record<string, { nome: string; produto_payt: string | null }>>({});
  const [loading, setLoading]   = useState(true);
  const [preset, setPreset]     = useState<Preset>('28d');
  const [customStart, setCustomStart] = useState(ago(28));
  const [customEnd,   setCustomEnd]   = useState(today());
  const [sortKey, setSortKey]   = useState<SortKey>('investimento');
  const [sortDir, setSortDir]   = useState<'desc' | 'asc'>('desc');
  const [search, setSearch]     = useState('');
  const [filterContas, setFilterContas]     = useState<Set<string>>(new Set());
  const [showContaPanel, setShowContaPanel] = useState(false);
  const contaPanelRef = useRef<HTMLDivElement>(null);
  const [filterCampanha, setFilterCampanha] = useState('');
  const [colOrder, setColOrder]   = useState<ColKey[]>(ALL_COL_KEYS);
  const [colHidden, setColHidden] = useState<Set<ColKey>>(new Set());
  const [showColPanel, setShowColPanel] = useState(false);
  const [notionMap, setNotionMap] = useState<Record<string, Array<{ editor_nome: string | null; projeto_nome: string | null }>>>({});
  const [syncing, setSyncing] = useState(false);

  const { startStr, endStr } = useMemo(() => {
    if (preset === 'yesterday') return { startStr: ago(1), endStr: ago(1) };
    if (preset === '7d')        return { startStr: ago(7),  endStr: today() };
    if (preset === '28d')       return { startStr: ago(28), endStr: today() };
    return { startStr: customStart, endStr: customEnd };
  }, [preset, customStart, customEnd]);

  const load = async () => {
    setLoading(true);
    const [metaRes, paytRes, contasRes] = await Promise.all([
      supabase
        .from('metricas_meta')
        .select(`
          data, ad_id, ad_nome, ad_account_id, campanha_id, campanha_nome, adset_id,
          investimento, impressoes, cliques_link,
          ctr, cpm, cpc,
          video_plays, video_3s, video_75pct,
          compras_meta, faturamento_atribuido
        `)
        .eq('nivel', 'ad')
        .not('ad_nome', 'is', null)
        .gte('data', startStr)
        .lte('data', endStr)
        .limit(50000),
      supabase
        .from('vendas_payt')
        .select('utm_content, utm_ad_id, utm_campaign, utm_medium, valor, produto')
        .eq('status', 'paid')
        .or('tipo_venda.is.null,tipo_venda.neq.Upsell')
        .gte('data', startStr)
        .lte('data', endStr)
        .not('utm_content', 'is', null),
      supabase
        .from('ad_accounts')
        .select('id, nome, produto_payt')
        .eq('ativo', true),
    ]);

    // mapa de contas: id → { nome, produto_payt }
    const am: Record<string, { nome: string; produto_payt: string | null }> = {};
    for (const c of contasRes.data || []) {
      am[c.id] = { nome: c.nome, produto_payt: c.produto_payt };
    }

    // Dois mapas de atribuição:
    // pmById: keyed por ad_id do Meta (extraído do utm_content) — matching exato
    // pmByKey: keyed por "utm_content|campanha_id|adset_id" — fallback para vendas sem utm_ad_id
    const pmById:  Record<string, { vendas: number; valor: number }> = {};
    const pmByKey: Record<string, { vendas: number; valor: number }> = {};

    for (const v of paytRes.data || []) {
      const adId  = (v.utm_ad_id as string | null) || null;
      const prod  = (v.produto   as string | null) || '';
      const valor = Number(v.valor || 0);

      if (adId) {
        // chave: ad_id + produto — garante que só contamos vendas do produto correto por conta
        const key = adId + '|' + prod;
        if (!pmById[key]) pmById[key] = { vendas: 0, valor: 0 };
        pmById[key].vendas += 1;
        pmById[key].valor  += valor;
      } else {
        // fallback: match por nome+campanha+adset
        const utmCamp   = (v.utm_campaign as string | null) || '';
        const utmMedium = (v.utm_medium   as string | null) || '';
        const campId  = utmCamp.includes('|')   ? utmCamp.split('|').slice(-1)[0].trim()   : '';
        const adsetId = utmMedium.includes('|') ? utmMedium.split('|').slice(-1)[0].trim() : '';
        const key = (v.utm_content as string) + '|' + campId + '|' + adsetId;
        if (!pmByKey[key]) pmByKey[key] = { vendas: 0, valor: 0 };
        pmByKey[key].vendas += 1;
        pmByKey[key].valor  += valor;
      }
    }

    setRows(metaRes.data || []);
    setPaytByAdId(pmById);
    setPaytByKey(pmByKey);
    setAccountMap(am);

    // Carrega mapa do Notion (nome → editor/projeto)
    const { data: notionRows } = await supabase
      .from('notion_criativos')
      .select('nome, editor_nome, projeto_nome');
    const nm: Record<string, Array<{ editor_nome: string | null; projeto_nome: string | null }>> = {};
    for (const r of notionRows || []) {
      const k = String(r.nome).trim().toLowerCase();
      if (!nm[k]) nm[k] = [];
      nm[k].push({ editor_nome: r.editor_nome, projeto_nome: r.projeto_nome });
    }
    setNotionMap(nm);

    setLoading(false);
  };

  const syncNotion = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-notion-criativos');
      if (error || data?.error) {
        toast({ title: 'Erro ao sincronizar Notion', description: data?.error || String(error), variant: 'destructive' });
      } else {
        toast({ title: `Notion sincronizado — ${data.synced} criativos` });
        // Recarrega mapa
        const { data: notionRows } = await supabase.from('notion_criativos').select('nome, editor_nome, projeto_nome');
        const nm: Record<string, Array<{ editor_nome: string | null; projeto_nome: string | null }>> = {};
        for (const r of notionRows || []) {
          const k = String(r.nome).trim().toLowerCase();
          if (!nm[k]) nm[k] = [];
          nm[k].push({ editor_nome: r.editor_nome, projeto_nome: r.projeto_nome });
        }
        setNotionMap(nm);
      }
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => { load(); }, [startStr, endStr]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!showContaPanel) return;
    const handler = (e: MouseEvent) => {
      if (contaPanelRef.current && !contaPanelRef.current.contains(e.target as Node)) {
        setShowContaPanel(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showContaPanel]);

  // Agrega por anúncio (soma todos os dias do período)
  const ads = useMemo(() => {
    const map: Record<string, any> = {};

    rows.forEach(r => {
      const k = (r.ad_id || r.ad_nome || 'sem-id') + '|' + (r.ad_account_id || '');
      if (!map[k]) {
        map[k] = {
          ad_id: r.ad_id, ad_nome: r.ad_nome,
          ad_account_id: r.ad_account_id, campanha_nome: r.campanha_nome,
          investimento: 0, impressoes: 0, cliques_link: 0,
          video_plays: 0, video_3s: 0, video_75pct: 0,
          compras_meta: 0, faturamento_atribuido: 0,
          // fallback para quando Windsor só envia CTR/CPM/CPC agregados (trial)
          _ctr_sum: 0, _cpm_sum: 0, _cpc_sum: 0, _dias: 0,
          // conjunto de chaves Payt para este anúncio (campanha+adset+nome)
          _payt_keys: new Set<string>(),
        };
      }
      const m = map[k];
      m.investimento          += Number(r.investimento          || 0);
      m.impressoes            += Number(r.impressoes            || 0);
      m.cliques_link          += Number(r.cliques_link          || 0);
      m.video_plays           += Number(r.video_plays           || 0);
      m.video_3s              += Number(r.video_3s              || 0);
      m.video_75pct           += Number(r.video_75pct           || 0);
      m.compras_meta          += Number(r.compras_meta          || 0);
      m.faturamento_atribuido += Number(r.faturamento_atribuido || 0);
      // Windsor envia CTR/CPM/CPC como decimais por dia — acumula para fallback
      if (r.ctr) { m._ctr_sum += Number(r.ctr); m._dias += 1; }
      if (r.cpm) m._cpm_sum += Number(r.cpm);
      if (r.cpc) m._cpc_sum += Number(r.cpc);
      // chave de atribuição Payt: ad_nome|campanha_id|adset_id
      if (r.ad_nome && r.campanha_id && r.adset_id) {
        m._payt_keys.add(`${r.ad_nome}|${r.campanha_id}|${r.adset_id}`);
      }
    });

    return Object.values(map).map((m: any) => {
      const inv = m.investimento;

      // CTR com cliques únicos (unique link clicks) — mais preciso que total de cliques
      const ctr_pct = m.impressoes > 0
        ? (m.cliques_link / m.impressoes) * 100
        : m._dias > 0 ? (m._ctr_sum / m._dias) * 100 : 0;

      // CPC e CPM com clique único
      const cpm = m.impressoes > 0 ? (inv / m.impressoes) * 1000
                : m._dias > 0 ? m._cpm_sum / m._dias : 0;
      const cpc = m.cliques_link > 0 ? inv / m.cliques_link
                : m._dias > 0 ? m._cpc_sum / m._dias : 0;

      // Criativo (vídeo)
      const hook_rate = m.impressoes > 0 ? (m.video_3s    / m.impressoes) * 100 : 0;
      const body_rate = m.video_3s   > 0 ? (m.video_75pct / m.video_3s)   * 100 : 0;

      // Atribuição Payt — prioridade:
      // 1. Por ad_id (exato) — disponível após reimportação dos CSVs
      // 2. Por nome+campanha_id+adset_id (fallback para dados antigos)
      // 3. Meta compras_meta (fallback final)
      let paytVendas = 0, paytFaturamento = 0, foundPayt = false;

      // Tentativa 1: match por ad_id + produto da conta (exato e por produto)
      const conta = accountMap[m.ad_account_id];
      const byId = m.ad_id ? paytByAdId[m.ad_id + '|' + (conta?.produto_payt || '')] : null;
      if (byId) {
        paytVendas      = byId.vendas;
        paytFaturamento = byId.valor;
        foundPayt = true;
      } else {
        // Tentativa 2: match por nome+campanha+adset (soma todas as combinações)
        for (const key of m._payt_keys as Set<string>) {
          const entry = paytByKey[key];
          if (entry) {
            paytVendas      += entry.vendas;
            paytFaturamento += entry.valor;
            foundPayt = true;
          }
        }
      }

      const vendas      = foundPayt ? paytVendas      : 0;
      const faturamento = foundPayt ? paytFaturamento : 0;

      // Conversão: vendas reais / cliques únicos
      const taxa_conv = m.cliques_link > 0 ? (vendas / m.cliques_link) * 100 : 0;

      // ROAS com faturamento real da Payt (ou atribuído do Meta)
      const roas = inv > 0 ? faturamento / inv : 0;

      // Lookup Notion: exact → fallback without suffix (- cópia, - VSL, etc.)
      const produtoPayt = conta?.produto_payt ?? '';
      const adNomeLower = String(m.ad_nome || '').trim().toLowerCase();
      const produtoLower = produtoPayt.toLowerCase();
      const notionInfo = pickBest(notionMap[adNomeLower], produtoLower) ?? (() => {
        const base = adNomeLower.replace(/\s*[-–—]\s*(c[oó]pia|vsl|copy)\s*(\d*)$/i, '').trim();
        return base !== adNomeLower ? pickBest(notionMap[base], produtoLower) : null;
      })();

      // Only show project when it matches produto_payt (prevents inactive projects)
      const projetoNotion = notionInfo?.projeto_nome ?? null;
      const projetoBate = projetoNotion && produtoPayt
        ? projetoNotion.toLowerCase().includes(produtoLower) ||
          produtoLower.includes(projetoNotion.toLowerCase())
        : false;

      return {
        ...m,
        conta_nome: conta?.nome ?? '—',
        produto_payt: produtoPayt,
        editor_notion: notionInfo?.editor_nome ?? null,
        projeto_notion: projetoBate ? projetoNotion : null,
        ctr_pct, cpm, cpc,
        hook_rate, body_rate,
        taxa_conv, roas,
        vendas,
        faturamento,
        fonte_vendas: foundPayt ? (byId ? 'payt-id' : 'payt-key') : 'meta',
      };
    });
  }, [rows, paytByAdId, paytByKey, accountMap, notionMap]);

  const sorted = useMemo(() =>
    [...ads].sort((a, b) => {
      const va = Number(a[sortKey] ?? 0);
      const vb = Number(b[sortKey] ?? 0);
      return sortDir === 'desc' ? vb - va : va - vb;
    }),
  [ads, sortKey, sortDir]);

  const contasUnicas   = useMemo(() => [...new Set(ads.map(r => r.conta_nome).filter(Boolean))].sort(), [ads]);
  const campanhasUnicas = useMemo(() => [...new Set(ads.map(r => r.campanha_nome).filter(Boolean))].sort(), [ads]);

  // Para os rankings: aplica filtros de conta e campanha (mas não a pesquisa de texto)
  const adsParaRanking = useMemo(() => {
    let result = ads.filter(r => Number(r.investimento) > 0);
    if (filterContas.size > 0) result = result.filter(r => filterContas.has(r.conta_nome));
    if (filterCampanha)        result = result.filter(r => r.campanha_nome === filterCampanha);
    return result;
  }, [ads, filterContas, filterCampanha]);

  const filtered = useMemo(() => {
    let result = sorted.filter(r => Number(r.investimento) > 0);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(r => (r.ad_nome ?? '').toLowerCase().includes(q));
    }
    if (filterContas.size > 0) result = result.filter(r => filterContas.has(r.conta_nome));
    if (filterCampanha)        result = result.filter(r => r.campanha_nome === filterCampanha);
    return result;
  }, [sorted, search, filterContas, filterCampanha]);

  // Linha de resumo: somas e médias ponderadas de todos os anúncios filtrados
  const summary = useMemo(() => {
    let inv = 0, vendas = 0, fat = 0;
    let impressoes = 0, cliques = 0, v3s = 0, v75 = 0;
    for (const r of filtered) {
      inv        += Number(r.investimento  || 0);
      vendas     += Number(r.vendas        || 0);
      fat        += Number(r.faturamento   || 0);
      impressoes += Number(r.impressoes    || 0);
      cliques    += Number(r.cliques_link  || 0);
      v3s        += Number(r.video_3s      || 0);
      v75        += Number(r.video_75pct   || 0);
    }
    return {
      investimento: inv,
      vendas,
      roas:      inv > 0        ? fat / inv                    : 0,
      hook_rate: impressoes > 0 ? (v3s / impressoes) * 100     : 0,
      body_rate: v3s > 0        ? (v75 / v3s) * 100            : 0,
      taxa_conv: cliques > 0    ? (vendas / cliques) * 100     : 0,
      ctr_pct:   impressoes > 0 ? (cliques / impressoes) * 100 : 0,
      cpc:       cliques > 0    ? inv / cliques                : 0,
      cpm:       impressoes > 0 ? (inv / impressoes) * 1000    : 0,
    };
  }, [filtered]);

  const handleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(k); setSortDir('desc'); }
  };

  const moveCol = (key: ColKey, dir: -1 | 1) => {
    setColOrder(prev => {
      const i = prev.indexOf(key);
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const toggleCol = (key: ColKey) => {
    setColHidden(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const visibleCols = colOrder
    .map(k => colMap[k])
    .filter(c => c && !colHidden.has(c.key));

  const thCls = (k: SortKey) => cn(
    'px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase whitespace-nowrap',
    'cursor-pointer select-none hover:text-foreground',
    sortKey === k && 'text-primary',
  );

  const RANKINGS: RankingDef[] = [
    {
      title: 'Melhor ROAS',      icon: <Trophy className="h-4 w-4" />,
      key: 'roas',               fmt: xval,  colorFn: v => clr(v, 3, 1),
      subtitle: 'Faturamento / investimento',
    },
    {
      title: 'Melhor Hook Rate', icon: <Anchor className="h-4 w-4" />,
      key: 'hook_rate',          fmt: pct,   colorFn: v => clr(v, 25, 10),
      subtitle: 'Primeiros 3s / impressões',
    },
    {
      title: 'Mais vendas',      icon: <ShoppingCart className="h-4 w-4" />,
      key: 'vendas',             fmt: num,
      subtitle: 'Compras atribuídas',
    },
    {
      title: 'Melhor CTR',       icon: <MousePointer className="h-4 w-4" />,
      key: 'ctr_pct',            fmt: pct,   colorFn: v => clr(v, 2, 0.5),
      subtitle: 'Cliques / impressões',
    },
    {
      title: 'Maior conversão',  icon: <RefreshCw className="h-4 w-4" />,
      key: 'taxa_conv',          fmt: pct,   colorFn: v => clr(v, 3, 1),
      subtitle: 'Compras / cliques',
    },
  ];

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <div className="bg-card border border-border rounded-lg p-4 flex items-end gap-3 flex-wrap">
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={syncNotion} disabled={syncing}>
            <RotateCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} />
            {syncing ? 'Sincronizando...' : 'Sincronizar Notion'}
          </Button>
          <ImportarPaytModal onImported={load} />
        </div>
        <div className="w-full border-t border-border/50 mt-1 mb-0" />
        <div>
          <Label className="text-xs">Período</Label>
          <Select value={preset} onValueChange={(v: Preset) => setPreset(v)}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="yesterday">Ontem</SelectItem>
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
              <SelectItem value="28d">Últimos 28 dias</SelectItem>
              <SelectItem value="custom">Personalizado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {preset === 'custom' && (
          <>
            <div>
              <Label className="text-xs">De</Label>
              <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="w-[150px]" />
            </div>
            <div>
              <Label className="text-xs">Até</Label>
              <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="w-[150px]" />
            </div>
          </>
        )}
        <div className="relative" ref={contaPanelRef}>
          <Label className="text-xs">Conta (CA)</Label>
          <button
            onClick={() => setShowContaPanel(v => !v)}
            className={cn(
              'flex items-center justify-between gap-2 w-[220px] mt-1 px-3 py-2 rounded-md border text-sm transition-colors',
              showContaPanel || filterContas.size > 0
                ? 'border-primary text-foreground bg-primary/10'
                : 'border-border text-muted-foreground bg-secondary hover:text-foreground',
            )}
          >
            <span className="truncate">
              {filterContas.size === 0
                ? 'Todas as CAs'
                : filterContas.size === 1
                  ? [...filterContas][0]
                  : `${filterContas.size} CAs selecionadas`}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          </button>
          {showContaPanel && (
            <div className="absolute left-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-lg w-[280px] py-1 max-h-64 overflow-y-auto">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-border mb-1">
                <span className="text-xs font-medium text-muted-foreground">Contas de anúncio</span>
                {filterContas.size > 0 && (
                  <button
                    onClick={() => setFilterContas(new Set())}
                    className="text-xs text-primary hover:underline"
                  >
                    Limpar
                  </button>
                )}
              </div>
              {contasUnicas.map(c => {
                const checked = filterContas.has(c);
                return (
                  <label
                    key={c}
                    className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-secondary/60 cursor-pointer"
                    onClick={() => {
                      setFilterContas(prev => {
                        const next = new Set(prev);
                        next.has(c) ? next.delete(c) : next.add(c);
                        return next;
                      });
                    }}
                  >
                    <span className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                      checked ? 'bg-primary border-primary' : 'border-border',
                    )}>
                      {checked && <Check className="h-3 w-3 text-primary-foreground" />}
                    </span>
                    <span className="text-xs text-foreground truncate">{c}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
        <div>
          <Label className="text-xs">Campanha</Label>
          <Select value={filterCampanha || '__all__'} onValueChange={v => setFilterCampanha(v === '__all__' ? '' : v)}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Todas as campanhas" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todas as campanhas</SelectItem>
              {campanhasUnicas.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {loading && <span className="text-xs text-muted-foreground animate-pulse">Carregando...</span>}
      </div>

      {/* Rankings */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {RANKINGS.map(def => (
          <RankingCard key={def.key} def={def} rows={adsParaRanking} />
        ))}
        <ConsistencyCard defs={RANKINGS} rows={adsParaRanking} />
      </div>

      {/* Tabela completa */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-3 flex-wrap">
          <h4 className="text-sm font-semibold shrink-0">Todos os criativos</h4>
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Pesquisar anúncio..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          <div className="flex items-center gap-3 ml-auto">
            {Object.keys(paytByAdId).length > 0 && (
              <span className="text-xs bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded-full">
                vendas via Payt
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {filtered.length} anúncios
            </span>
            <div className="relative">
              <button
                onClick={() => setShowColPanel(v => !v)}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border transition-colors',
                  showColPanel
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30',
                )}
              >
                <Settings2 className="h-3.5 w-3.5" />
                Colunas
              </button>

              {showColPanel && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-lg w-56 py-1">
                  <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground border-b border-border mb-1">
                    Ordem e visibilidade
                  </p>
                  {colOrder.map((key, idx) => {
                    const col = colMap[key];
                    const hidden = colHidden.has(key);
                    return (
                      <div key={key} className={cn(
                        'flex items-center gap-1 px-2 py-1 hover:bg-secondary/50',
                        hidden && 'opacity-40',
                      )}>
                        <button onClick={() => moveCol(key, -1)} disabled={idx === 0} className="p-0.5 hover:text-foreground text-muted-foreground disabled:opacity-20">
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => moveCol(key, 1)} disabled={idx === colOrder.length - 1} className="p-0.5 hover:text-foreground text-muted-foreground disabled:opacity-20">
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                        <span className="flex-1 text-xs text-foreground">{col.label}</span>
                        <button onClick={() => toggleCol(key)} className="p-0.5 text-muted-foreground hover:text-foreground">
                          {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase w-8">#</th>
                {visibleCols.map(c => {
                  const isSortable = !c.type;
                  return isSortable ? (
                    <th key={c.key} className={thCls(c.key as SortKey)} onClick={() => handleSort(c.key as SortKey)}>
                      <span className="flex items-center gap-1">{c.label} <ArrowUpDown className="h-3 w-3" /></span>
                    </th>
                  ) : (
                    <th key={c.key} className="px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                      {c.label}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={String(r.ad_id) + i} className="border-b border-border/50 hover:bg-secondary/40">
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{i + 1}</td>
                  {visibleCols.map(c => {
                    if (c.type === 'text') {
                      const val = r[c.key] ?? '—';
                      return (
                        <td key={c.key} className={cn(
                          'px-3 py-2.5 truncate',
                          c.key === 'ad_nome' ? 'font-medium max-w-52' : 'text-xs text-muted-foreground max-w-40',
                        )} title={val}>{val}</td>
                      );
                    }
                    const v = Number(r[c.key] ?? 0);
                    const hasData = v > 0;
                    return (
                      <td key={c.key} className={cn(
                        'px-3 py-2.5 tabular-nums whitespace-nowrap',
                        hasData && c.colorFn ? c.colorFn(v) : hasData ? 'text-foreground' : 'text-muted-foreground',
                      )}>
                        {hasData ? c.fmt!(v) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {filtered.length === 0 && !loading && (
                <tr>
                  <td colSpan={visibleCols.length + 1} className="px-3 py-8 text-center text-muted-foreground">
                    Sem dados no período selecionado
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={visibleCols.length + 1} className="px-3 py-8 text-center text-muted-foreground animate-pulse">
                    Carregando...
                  </td>
                </tr>
              )}
            </tbody>
            {filtered.length > 0 && !loading && (
              <tfoot>
                <tr className="border-t-2 border-border bg-secondary/50 font-semibold">
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">Σ</td>
                  {visibleCols.map(c => {
                    if (c.type === 'text') {
                      return (
                        <td key={c.key} className="px-3 py-2.5 text-xs text-muted-foreground">
                          {c.key === 'ad_nome' ? `${filtered.length} anúncios` : ''}
                        </td>
                      );
                    }
                    const v = Number((summary as any)[c.key] ?? 0);
                    return (
                      <td key={c.key} className={cn(
                        'px-3 py-2.5 tabular-nums whitespace-nowrap text-sm',
                        v > 0 && c.colorFn ? c.colorFn(v) : 'text-foreground',
                      )}>
                        {v > 0 ? c.fmt!(v) : '—'}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
