import { todasAsLinhas } from '@/lib/supabase';
import { paraYmd } from '@/lib/datas';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { supabase } from '@/lib/supabase';
import { formatNumber, formatPercent } from '@/lib/formatters';
import { fetchProjetos, fetchFunis } from '@/lib/dataCache';
import { MultiFilter } from '@/features/producao/components/MultiFilter';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CriativoDrawer } from '@/features/producao/components/CriativoDrawer';
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

function BreakdownTable({
  title,
  rows,
  scrollable,
}: {
  title: string;
  rows: { label: string; testados: number; validados: number; escalados: number; aprovados: number }[];
  scrollable?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h4 className="text-sm font-medium">{title}</h4>
      </div>
      <div className={cn('overflow-x-auto', scrollable && 'overflow-y-auto max-h-72')}>
        <table className="w-full text-sm">
          <thead className={cn(scrollable && 'sticky top-0 bg-card z-10')}>
            <tr className="border-b border-border text-[11px] text-muted-foreground uppercase">
              <th className="text-left px-3 py-2">{title.replace('Por ', '')}</th>
              <th className="text-right px-3 py-2">Testados</th>
              <th className="text-right px-3 py-2">Validados</th>
              <th className="text-right px-3 py-2">Escalados</th>
              <th className="text-right px-3 py-2">Val.+Esc.</th>
              <th className="text-right px-3 py-2">Taxa valid.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const taxa = r.testados > 0 ? (r.aprovados / r.testados) * 100 : 0;
              return (
                <tr key={r.label} className="border-b border-border/40 last:border-0">
                  <td className="px-3 py-2 font-medium truncate max-w-[160px]">{r.label}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.testados}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.validados}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.escalados}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{r.aprovados}</td>
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

  const load = useCallback(async () => {
    setLoading(true);

    const SEL = 'id,nome,tipo,formato,angulo_teste,nivel_consciencia,avaliacao,status_veiculacao,data_inicio,responsavel_id,projeto_id,funil_ids,funil_video,responsavel:perfis!responsavel_id(id,nome),projeto:ofertas_editores!projeto_id(id,nome)';

    // Eram duas páginas fixas de mil, e há 2.916 cards postados: 916 ficavam
    // fora de todos os gráficos e de todas as taxas desta tela.
    const [postados, { data: pf }, pj, { data: opF }, fs] = await Promise.all([
      todasAsLinhas<PostadoRow>((de, ate) =>
        supabase.from('producoes').select(SEL).eq('fase', 'postado').order('nome').range(de, ate)),
      supabase.from('perfis')
        .select('id,nome,is_admin,cargo_id,setor_id,cargo:cargos(id,nome),setor:setores(id,nome),ativo')
        .eq('ativo', true).order('nome'),
      fetchProjetos(),
      supabase.from('criativo_campos_opcoes').select('valor').eq('campo', 'formato').order('ordem'),
      fetchFunis(),
    ]);

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
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => rows.filter(r => {
    const dp = r.data_ref;
    if (!dp || dp < startStr || dp > endStr) return false;
    if (filtroEditor.length  && !filtroEditor.includes(r.responsavel_id ?? ''))  return false;
    if (filtroProjeto.length && !filtroProjeto.includes(r.projeto_id ?? ''))     return false;
    if (filtroTipo.length    && !filtroTipo.includes(r.tipo))                    return false;
    if (filtroFormato.length && !filtroFormato.includes(r.formato ?? ''))        return false;
    if (filtroFunil.length   && !filtroFunil.includes(r.funil_video ?? '')) return false;
    return true;
  }), [rows, startStr, endStr, filtroEditor, filtroProjeto, filtroTipo, filtroFormato, filtroFunil]);

  // Escalados = todos os ads atualmente em "Escalado", sem filtro de data de postagem
  const filteredSemData = useMemo(() => rows.filter(r => {
    if (filtroEditor.length  && !filtroEditor.includes(r.responsavel_id ?? ''))  return false;
    if (filtroProjeto.length && !filtroProjeto.includes(r.projeto_id ?? ''))     return false;
    if (filtroTipo.length    && !filtroTipo.includes(r.tipo))                    return false;
    if (filtroFormato.length && !filtroFormato.includes(r.formato ?? ''))        return false;
    if (filtroFunil.length   && !filtroFunil.includes(r.funil_video ?? ''))      return false;
    return true;
  }), [rows, filtroEditor, filtroProjeto, filtroTipo, filtroFormato, filtroFunil]);

  const totals = useMemo(() => {
    const testados  = filtered.length;
    const validados = filtered.filter(isValidado).length;
    const escalados = filteredSemData.filter(isEscalado).length;
    const aprovados = filtered.filter(isAprovado).length;
    const naoValid  = filtered.filter(r => r.avaliacao === 'Não validado').length;
    const taxaValid = testados > 0 ? (validados / testados) * 100 : 0;
    const taxaEscal = filteredSemData.length > 0 ? (escalados / filteredSemData.length) * 100 : 0;
    const taxaAprov = testados > 0 ? (aprovados / testados) * 100 : 0;
    return { testados, validados, escalados, aprovados, naoValid, taxaValid, taxaEscal, taxaAprov };
  }, [filtered, filteredSemData]);

  const porTipo       = useMemo(() => buildBreakdown(filtered, 'tipo', v => TIPO_LABEL[v ?? ''] ?? v ?? '—'), [filtered]);
  const porFormato    = useMemo(() => buildBreakdown(filtered, 'formato', v => v ?? '— sem formato —'), [filtered]);
  const porAngulo     = useMemo(() => {
    const rows = buildBreakdown(filtered, 'angulo_teste', v => v ?? '— sem ângulo —');
    return rows.sort((a, b) => {
      const ta = a.testados > 0 ? a.validados / a.testados : 0;
      const tb = b.testados > 0 ? b.validados / b.testados : 0;
      return tb - ta;
    });
  }, [filtered]);
  const porNivelConsc = useMemo(() => buildBreakdown(filtered, 'nivel_consciencia', v => v ?? '— sem nível —'), [filtered]);
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

  const escaladosLista = useMemo(() =>
    filteredSemData.filter(isEscalado).sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? '')),
  [filteredSemData]);

  const opFunilVideo = useMemo(() =>
    [...new Set(rows.map(r => r.funil_video).filter((v): v is string => Boolean(v)))].sort(),
  [rows]);

  const porFunil = useMemo(() => {
    const map: Record<string, { label: string; testados: number; validados: number; escalados: number; aprovados: number }> = {};
    for (const r of filtered) {
      const fv = r.funil_video;
      if (!fv) continue;
      if (!map[fv]) map[fv] = { label: fv, testados: 0, validados: 0, escalados: 0, aprovados: 0 };
      map[fv].testados++;
      if (isValidado(r)) map[fv].validados++;
      if (isEscalado(r)) map[fv].escalados++;
      if (isAprovado(r)) map[fv].aprovados++;
    }
    return Object.values(map).sort((a, b) => b.testados - a.testados);
  }, [filtered]);

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

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'ADs testados',        value: totals.testados,  sub: null,                                                                                 color: '' },
          { label: 'Validados',           value: totals.validados, sub: formatPercent(totals.taxaValid),                                                      color: 'text-emerald-500' },
          { label: 'Escalados',           value: totals.escalados, sub: formatPercent(totals.taxaEscal),                                                      color: 'text-blue-400' },
          { label: 'Val. + Esc.',         value: totals.aprovados, sub: formatPercent(totals.taxaAprov),                                                      color: 'text-violet-400' },
          { label: 'Não validados',       value: totals.naoValid,  sub: totals.testados > 0 ? formatPercent((totals.naoValid / totals.testados) * 100) : null, color: 'text-red-500' },
          { label: 'Taxa de validação',   value: null,             sub: formatPercent(totals.taxaAprov),                                                      color: 'text-primary' },
        ].map(card => (
          <div key={card.label} className="bg-card border border-border rounded-lg p-4">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{card.label}</p>
            {card.value !== null ? (
              <>
                <p className={cn('text-2xl font-semibold mt-1 tabular-nums', card.color)}>
                  {loading ? '—' : formatNumber(card.value)}
                </p>
                {card.sub && !loading && (
                  <p className="text-xs text-muted-foreground mt-0.5">{card.sub}</p>
                )}
              </>
            ) : (
              <p className={cn('text-2xl font-semibold mt-1', card.color)}>
                {loading ? '—' : card.sub}
              </p>
            )}
          </div>
        ))}
      </div>

      {!loading && (
        <>
          {/* Breakdowns — 2 colunas balanceadas por altura estimada */}
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Esquerda: funil + ângulo + nível (~710px c/ editor) */}
            <div className="flex-1 flex flex-col gap-4 min-w-0">
              {porFunil.length > 0 && <BreakdownTable title="Por funil de vendas" rows={porFunil} />}
              <BreakdownTable title="Por ângulo" rows={porAngulo.filter(r => r.label !== '— sem ângulo —' || porAngulo.length === 1)} scrollable />
              <BreakdownTable title="Por nível de consciência" rows={porNivelConsc.filter(r => r.label !== '— sem nível —' || porNivelConsc.length === 1)} />
            </div>
            {/* Direita: tipo + formato + editor + gráfico (~720px c/ editor) */}
            <div className="flex-1 flex flex-col gap-4 min-w-0">
              <BreakdownTable title="Por tipo" rows={porTipo} />
              <BreakdownTable title="Por formato" rows={porFormato} />
              {porEditor.length > 0 && <BreakdownTable title="Por editor" rows={porEditor} />}
              {porEditor.length > 0 && (
                <div className="bg-card border border-border rounded-lg p-4">
                  <h4 className="text-sm font-medium mb-3">Taxa de validação por editor</h4>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={porEditor.map(r => ({ ...r, taxa: r.testados > 0 ? (r.validados / r.testados) * 100 : 0 }))}>
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
              <span className="text-xs text-muted-foreground">{escaladosLista.length} ads</span>
            </div>
            {escaladosLista.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">Nenhum AD escalado no período selecionado.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-[11px] text-muted-foreground uppercase">
                      <th className="text-left px-3 py-2">Nome</th>
                      <th className="text-left px-3 py-2">Tipo</th>
                      <th className="text-left px-3 py-2">Formato</th>
                      <th className="text-left px-3 py-2">Ângulo</th>
                      <th className="text-left px-3 py-2">Editor</th>
                      <th className="text-left px-3 py-2">Projeto</th>
                      <th className="text-left px-3 py-2">Avaliação</th>
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
                        <td className="px-3 py-2 text-muted-foreground max-w-[120px] truncate">{r.angulo_teste ?? '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.responsavel?.nome ?? '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.projeto?.nome ?? '—'}</td>
                        <td className="px-3 py-2">
                          {r.avaliacao ? (
                            <span className={cn(
                              'px-1.5 py-0.5 rounded text-[11px] font-medium',
                              r.avaliacao === 'Validado'     ? 'bg-emerald-500/10 text-emerald-500'
                              : r.avaliacao === 'Não validado' ? 'bg-red-500/10 text-red-500'
                              : 'bg-muted/50 text-muted-foreground',
                            )}>
                              {r.avaliacao}
                            </span>
                          ) : '—'}
                        </td>
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
