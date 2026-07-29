import { useState, useEffect, useCallback, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { ChevronLeft, ChevronRight, Plus, MousePointer2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import type { Criativo, ProducaoNivel, Funil, Perfil } from './types';
import { FASES_MAP, TIPO_COR, FASES } from './constants';
import { CriativoDrawer } from './CriativoDrawer';
import { CriativoFormModal } from './CriativoFormModal';

interface Props {
  nivel: ProducaoNivel;
  setorId: string | null;
  userId: string;
  somenteSetor?: boolean;
  fixedField?: 'responsavel_id' | 'copy_id' | 'gestor_id';
  fixedValue?: string;
  fasesVisiveis?: string[];
}

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function buildCalendarGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const last  = new Date(year, month + 1, 0);
  const days: Date[] = [];
  for (let i = 0; i < first.getDay(); i++) days.push(new Date(year, month, -first.getDay() + 1 + i));
  for (let d = 1; d <= last.getDate(); d++) days.push(new Date(year, month, d));
  const remaining = 42 - days.length;
  for (let i = 1; i <= remaining; i++) days.push(new Date(year, month + 1, i));
  return days;
}

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(ymd: string, delta: number): string {
  const d = new Date(ymd + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return toYMD(d);
}

function daysDiff(from: string, to: string): number {
  return Math.round(
    (new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()) / 86400000,
  );
}

const MAX_PER_DAY = 5;

type SpanEntry = {
  criativo: Criativo;
  startCol: number;
  endCol: number;
  isFirst: boolean;
  isLast: boolean;
  lane: number;
};

type PreviewMap = Record<string, { data_inicio?: string; data_prazo?: string }>;

function getSpanningForWeek(weekDays: Date[], spanning: Criativo[], previewMap: PreviewMap): SpanEntry[] {
  const weekStart = toYMD(weekDays[0]);
  const weekEnd   = toYMD(weekDays[6]);
  const raw: Omit<SpanEntry, 'lane'>[] = [];

  for (const c of spanning) {
    const pm     = previewMap[c.id] ?? {};
    const cStart = pm.data_inicio ?? c.data_inicio!;
    const cEnd   = pm.data_prazo  ?? c.data_prazo!;
    if (cEnd < weekStart || cStart > weekEnd) continue;

    const effStart = cStart >= weekStart ? cStart : weekStart;
    const effEnd   = cEnd   <= weekEnd   ? cEnd   : weekEnd;
    const sIdx = weekDays.findIndex(d => toYMD(d) === effStart);
    const eIdx = weekDays.findIndex(d => toYMD(d) === effEnd);

    raw.push({
      criativo: c,
      startCol: (sIdx >= 0 ? sIdx : 0) + 1,
      endCol:   (eIdx >= 0 ? eIdx : 6) + 2,
      isFirst:  cStart >= weekStart,
      isLast:   cEnd   <= weekEnd,
    });
  }

  raw.sort((a, b) => a.startCol - b.startCol || (b.endCol - b.startCol) - (a.endCol - a.startCol));

  const laneEnds: number[] = [];
  return raw.map(e => {
    let lane = laneEnds.findIndex(end => end <= e.startCol);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = e.endCol;
    return { ...e, lane };
  });
}

// ── DraggableCalCard ──────────────────────────────────────────────────────────

function DraggableCalCard({
  criativo, todayYMD, selectMode, isSelected, onOpen, onToggle, onResizeRight,
}: {
  criativo: Criativo;
  todayYMD: string;
  selectMode: boolean;
  isSelected: boolean;
  onOpen: () => void;
  onToggle: (activateSelect?: boolean) => void;
  onResizeRight: (targetYmd: string) => Promise<void>;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `cal-${criativo.id}`,
    data: { criativo },
  });

  const isPast  = (criativo.data_prazo ?? '') < todayYMD;
  const isLate  = isPast && criativo.fase !== 'postado' && criativo.fase !== 'aprovado';
  const tipoCor = isLate
    ? 'bg-red-500/20 text-red-300 border-red-500/30'
    : (TIPO_COR[criativo.tipo] ?? 'bg-primary/10 text-primary border-primary/20');

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleResizePointerUp = async (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    // Find which day cell is under the pointer
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const dayEl = el?.closest('[data-date]') as HTMLElement | null;
    if (!dayEl?.dataset.date) return;
    const targetYmd = dayEl.dataset.date;
    const originalYmd = criativo.data_prazo ?? criativo.data_inicio;
    if (targetYmd && originalYmd && targetYmd > originalYmd) {
      await onResizeRight(targetYmd);
    }
  };

  const editor  = criativo.responsavel?.nome ?? criativo.editor_nome_historico;
  const fase    = FASES_MAP[criativo.fase] ?? criativo.fase;
  const funil   = criativo.funil?.nome ?? criativo.funil_video ?? null;
  const projeto = criativo.projeto?.nome ?? null;

  return (
    <div
      ref={setNodeRef}
      data-criativo-id={criativo.id}
      style={transform ? { transform: CSS.Transform.toString(transform) } : undefined}
      {...attributes}
      {...listeners}
      className={cn(
        'relative group/card touch-none select-none',
        isDragging && 'opacity-40',
        isSelected && 'ring-1 ring-primary rounded',
      )}
    >
      <button
        onClick={(e) => {
          if (selectMode || e.shiftKey) onToggle(e.shiftKey);
          else onOpen();
        }}
        className={cn(
          'w-full text-left rounded px-1 pt-0.5 pb-1 border block transition-opacity hover:opacity-75',
          tipoCor,
        )}
      >
        {/* Nome */}
        <span className="font-medium text-[11px] leading-tight truncate block pr-1">{criativo.nome}</span>
        {/* Fase */}
        <span className="text-[10px] opacity-70 leading-tight truncate block">{fase}</span>
        {/* Funil + Projeto */}
        {(funil || projeto) && (
          <span className="text-[10px] opacity-60 leading-tight truncate block">
            {[funil, projeto].filter(Boolean).join(' · ')}
          </span>
        )}
        {/* Editor */}
        {editor && (
          <span className="text-[10px] opacity-55 leading-tight truncate block">{editor}</span>
        )}
      </button>
      {/* Right edge resize handle — visible on hover */}
      <div
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize opacity-0 group-hover/card:opacity-100 hover:bg-white/30 rounded-r touch-none z-10"
        onPointerDown={handleResizePointerDown}
        onPointerUp={handleResizePointerUp}
      />
    </div>
  );
}

// ── DroppableDay ──────────────────────────────────────────────────────────────

function DroppableDay({ ymd, disabled, children }: { ymd: string; disabled?: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${ymd}`, disabled });
  return (
    <div
      ref={setNodeRef}
      className={cn('flex flex-col gap-1 flex-1 min-w-0', isOver && !disabled && 'bg-primary/5 rounded')}
    >
      {children}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function CalendarioView({ nivel, setorId, userId, somenteSetor, fixedField, fixedValue, fasesVisiveis }: Props) {
  const { toast } = useToast();
  const now = new Date();

  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [criativos, setCriativos]     = useState<Criativo[]>([]);
  const [funis, setFunis]             = useState<Funil[]>([]);
  const [perfis, setPerfis]           = useState<Perfil[]>([]);
  const [loading, setLoading]         = useState(true);
  const [selectedId, setSelectedId]   = useState<string | null>(null);
  const [filtroProjeto, setFiltroProjeto] = useState('');
  const [filtroTipo, setFiltroTipo]       = useState('');
  const [filtroResp, setFiltroResp]       = useState('');
  const [filtroFase, setFiltroFase]       = useState('');
  const [projetos, setProjetos]           = useState<{ id: string; nome: string }[]>([]);
  const [popoverDay, setPopoverDay]   = useState<string | null>(null);
  const [createDate, setCreateDate]   = useState<string | null>(null);

  // DnD single-day
  const [activeId, setActiveId] = useState<string | null>(null);

  // Resize spanning bars
  const [previewMap, setPreviewMap] = useState<PreviewMap>({});
  const resizeRef      = useRef<{ criativoId: string; edge: 'left' | 'right' } | null>(null);
  const weekOverlayRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Select mode / rubber band
  const [selectMode, setSelectMode]   = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkFase, setBulkFase]       = useState('');
  const [bulkResp, setBulkResp]       = useState('');
  const rubberStartRef = useRef<{ x: number; y: number } | null>(null);
  const rubberElRef    = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // ── Data loading ─────────────────────────────────────────────────────────

  const loadAux = useCallback(async () => {
    const [{ data: fs }, { data: ps }, { data: pr }] = await Promise.all([
      supabase.from('funis').select('id,nome,produto,ativo').neq('ativo', false).order('nome'),
      supabase.from('perfis').select('id,nome,is_admin').eq('ativo', true).order('nome'),
      supabase.from('ofertas_editores').select('id,nome').eq('ativo', true).order('nome'),
    ]);
    setFunis(fs ?? []);
    setPerfis(ps ?? []);
    setProjetos(pr ?? []);
  }, []);

  const loadCriativos = useCallback(async () => {
    setLoading(true);
    const windowStart = new Date(year, month - 2, 1);
    const windowEnd   = new Date(year, month + 3, 0);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    let q = supabase
      .from('producoes')
      .select([
        '*',
        'funil:funis(id,nome,produto)',
        'projeto:ofertas_editores!projeto_id(id,nome)',
        'responsavel:perfis!responsavel_id(id,nome)',
        'copy:perfis!copy_id(id,nome)',
        'gestor:perfis!gestor_id(id,nome)',
      ].join(','))
      .or(`data_prazo.gte.${fmt(windowStart)},and(data_prazo.is.null,data_inicio.gte.${fmt(windowStart)})`)
      .or(`data_prazo.lte.${fmt(windowEnd)},and(data_prazo.is.null,data_inicio.lte.${fmt(windowEnd)})`)
      .order('data_inicio', { nullsFirst: false })
      .limit(2000);

    if (fixedField && fixedValue) {
      q = q.eq(fixedField, fixedValue);
    } else if (nivel === 'membro') {
      q = q.eq('responsavel_id', userId);
    } else if (somenteSetor && setorId) {
      const { data: sp } = await supabase.from('perfis').select('id').eq('setor_id', setorId);
      const ids = sp?.map(p => p.id) ?? [];
      if (ids.length) q = q.in('responsavel_id', ids);
    }

    if (fasesVisiveis?.length) q = q.in('fase', fasesVisiveis);
    if (filtroProjeto) q = q.eq('projeto_id', filtroProjeto);
    if (filtroTipo)    q = q.eq('tipo', filtroTipo);
    if (filtroFase)    q = q.eq('fase', filtroFase);
    if (filtroResp)    q = q.eq('responsavel_id', filtroResp);

    const { data } = await q;
    setCriativos(data ?? []);
    setLoading(false);
  }, [nivel, setorId, userId, somenteSetor, fixedField, fixedValue, fasesVisiveis, year, month, filtroProjeto, filtroTipo, filtroFase, filtroResp]);

  useEffect(() => { loadAux(); }, [loadAux]);
  useEffect(() => { loadCriativos(); }, [loadCriativos]);

  const prevMonth = () => { if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1); };

  // ── DnD: single-day cards ─────────────────────────────────────────────────

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setActiveId(e.active.id as string);
  }, []);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const criativoId = (active.id as string).replace('cal-', '');
    const targetYmd  = (over.id as string).replace('day-', '');
    const criativo   = criativos.find(c => c.id === criativoId);
    if (!criativo || !targetYmd || criativo.data_prazo === targetYmd) return;

    const oldPrazo = criativo.data_prazo ?? targetYmd;
    const delta    = daysDiff(oldPrazo, targetYmd);
    if (delta === 0) return;

    // Bulk move: drag a selected card → move all selected by the same delta
    if (selectMode && selectedIds.has(criativoId)) {
      const patches = criativos
        .filter(c => selectedIds.has(c.id) && c.data_prazo)
        .map(c => {
          const p: Record<string, string> = { data_prazo: addDays(c.data_prazo!, delta) };
          if (c.data_inicio) p.data_inicio = addDays(c.data_inicio, delta);
          return { id: c.id, patch: p };
        });

      setCriativos(prev => prev.map(c => {
        const p = patches.find(x => x.id === c.id);
        return p ? { ...c, ...p.patch } : c;
      }));
      await Promise.all(patches.map(({ id, patch }) =>
        supabase.from('producoes').update(patch).eq('id', id),
      ));
      return;
    }

    // Single card move
    const patch: Record<string, string> = { data_prazo: targetYmd };
    if (criativo.data_inicio) patch.data_inicio = addDays(criativo.data_inicio, delta);

    setCriativos(prev => prev.map(c => c.id === criativoId ? { ...c, ...patch } : c));
    const { error } = await supabase.from('producoes').update(patch).eq('id', criativoId);
    if (error) {
      toast({ title: 'Erro ao mover criativo', variant: 'destructive' });
      setCriativos(prev => prev.map(c =>
        c.id === criativoId ? { ...c, data_prazo: criativo.data_prazo, data_inicio: criativo.data_inicio } : c,
      ));
    }
  }, [criativos, selectMode, selectedIds, toast]);

  // ── Resize: spanning bars ─────────────────────────────────────────────────

  const saveResize = useCallback(async (
    criativo: Criativo,
    newInicio: string | undefined,
    newPrazo: string | undefined,
  ) => {
    const patch: Record<string, string> = {};
    if (newInicio !== undefined) patch.data_inicio = newInicio;
    if (newPrazo  !== undefined) patch.data_prazo  = newPrazo;
    if (!Object.keys(patch).length) return;

    const finalInicio = newInicio ?? criativo.data_inicio ?? '';
    const finalPrazo  = newPrazo  ?? criativo.data_prazo  ?? '';
    if (finalInicio && finalPrazo && finalInicio > finalPrazo) {
      toast({ title: 'Data de início deve ser anterior ao prazo', variant: 'destructive' });
      return;
    }

    setCriativos(prev => prev.map(c => c.id === criativo.id ? { ...c, ...patch } : c));
    const { error } = await supabase.from('producoes').update(patch).eq('id', criativo.id);
    if (error) {
      toast({ title: 'Erro ao salvar datas', variant: 'destructive' });
      setCriativos(prev => prev.map(c =>
        c.id === criativo.id ? { ...c, data_inicio: criativo.data_inicio, data_prazo: criativo.data_prazo } : c,
      ));
    }
  }, [toast]);

  // ── Rubber band ──────────────────────────────────────────────────────────

  const handleCalPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!selectMode) return;
    if ((e.target as Element).closest('[data-criativo-id]')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    rubberStartRef.current = { x: e.clientX, y: e.clientY };
    if (rubberElRef.current) {
      Object.assign(rubberElRef.current.style, {
        display: 'block', left: `${e.clientX}px`, top: `${e.clientY}px`, width: '0px', height: '0px',
      });
    }
  }, [selectMode]);

  const handleCalPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!rubberStartRef.current) return;
    const { x: sx, y: sy } = rubberStartRef.current;
    if (rubberElRef.current) {
      Object.assign(rubberElRef.current.style, {
        left: `${Math.min(sx, e.clientX)}px`,
        top:  `${Math.min(sy, e.clientY)}px`,
        width:  `${Math.abs(e.clientX - sx)}px`,
        height: `${Math.abs(e.clientY - sy)}px`,
      });
    }
  }, []);

  const handleCalPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!rubberStartRef.current) return;
    const { x: sx, y: sy } = rubberStartRef.current;
    rubberStartRef.current = null;
    if (rubberElRef.current) rubberElRef.current.style.display = 'none';

    const minX = Math.min(sx, e.clientX), maxX = Math.max(sx, e.clientX);
    const minY = Math.min(sy, e.clientY), maxY = Math.max(sy, e.clientY);
    if (maxX - minX < 4 && maxY - minY < 4) return;

    const next = new Set(selectedIds);
    document.querySelectorAll('[data-criativo-id]').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.left < maxX && r.right > minX && r.top < maxY && r.bottom > minY) {
        next.add((el as HTMLElement).dataset.criativoId!);
      }
    });
    setSelectedIds(next);
  }, [selectedIds]);

  // ── Bulk apply ────────────────────────────────────────────────────────────

  const applyBulk = useCallback(async () => {
    if (!bulkFase && !bulkResp) return;
    const ids = [...selectedIds];
    const patch: Record<string, string> = {};
    if (bulkFase) patch.fase = bulkFase;
    if (bulkResp) patch.responsavel_id = bulkResp;

    setCriativos(prev => prev.map(c => ids.includes(c.id) ? { ...c, ...patch } : c));
    const { error } = await supabase.from('producoes').update(patch).in('id', ids);
    if (error) {
      toast({ title: 'Erro ao aplicar alterações', variant: 'destructive' });
      loadCriativos();
    } else {
      toast({ title: `${ids.length} criativo${ids.length !== 1 ? 's' : ''} atualizado${ids.length !== 1 ? 's' : ''}` });
      setSelectedIds(new Set());
      setBulkFase('');
      setBulkResp('');
    }
  }, [selectedIds, bulkFase, bulkResp, toast, loadCriativos]);

  // ── Calendar data ─────────────────────────────────────────────────────────

  const days     = buildCalendarGrid(year, month);
  const todayYMD = toYMD(now);

  const spanning: Criativo[] = [];
  const byDate: Record<string, Criativo[]> = {};

  for (const c of criativos) {
    if (c.data_inicio && c.data_prazo && c.data_inicio < c.data_prazo) {
      spanning.push(c);
    } else {
      const key = c.data_prazo ?? c.data_inicio;
      if (key) (byDate[key] = byDate[key] ?? []).push(c);
    }
  }

  // Sort each day's cards alphabetically/numerically by name
  for (const key of Object.keys(byDate)) {
    byDate[key].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true, sensitivity: 'base' }));
  }

  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const activeCriativo = activeId
    ? criativos.find(c => c.id === activeId.replace('cal-', ''))
    : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      {/* Rubber band overlay — updated imperatively to avoid re-renders */}
      <div
        ref={rubberElRef}
        style={{ display: 'none', position: 'fixed', zIndex: 50 }}
        className="pointer-events-none border border-primary/50 bg-primary/10 rounded-sm"
      />

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={filtroProjeto || '_'} onValueChange={v => setFiltroProjeto(v === '_' ? '' : v)}>
          <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Todos os projetos" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_">Todos os projetos</SelectItem>
            {projetos.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filtroTipo || '_'} onValueChange={v => setFiltroTipo(v === '_' ? '' : v)}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_">Todos</SelectItem>
            <SelectItem value="criativo">Criativo</SelectItem>
            <SelectItem value="vsl">VSL</SelectItem>
            <SelectItem value="aula">Aula</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filtroFase || '_'} onValueChange={v => setFiltroFase(v === '_' ? '' : v)}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Fase" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_">Todas as fases</SelectItem>
            {FASES.map(f => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
          </SelectContent>
        </Select>

        {nivel !== 'membro' && (
          <Select value={filtroResp || '_'} onValueChange={v => setFiltroResp(v === '_' ? '' : v)}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Responsável" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_">Todos</SelectItem>
              {perfis.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        <div className="flex-1" />

        {/* Legend */}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-blue-500/20 border border-blue-500/30" />Criativo</div>
          <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-purple-500/20 border border-purple-500/30" />VSL</div>
          <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-green-500/20 border border-green-500/30" />Aula</div>
          <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-red-500/20 border border-red-500/30" />Atrasado</div>
          <div className="flex items-center gap-1.5 pl-2 border-l border-border/40">
            <div className="w-6 h-2 rounded-sm bg-blue-500/20 border border-blue-500/30" />Período
          </div>
        </div>

        {/* Select mode toggle */}
        <Button
          size="sm"
          variant={selectMode ? 'secondary' : 'outline'}
          className="h-8 gap-1.5"
          onClick={() => { setSelectMode(s => !s); setSelectedIds(new Set()); }}
        >
          <MousePointer2 className="h-3.5 w-3.5" />
          {selectMode ? 'Cancelar' : 'Selecionar'}
        </Button>

        <div className="flex items-center gap-1 border-l border-border/40 pl-2">
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[130px] text-center">{MESES[month]} {year}</span>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {(year !== now.getFullYear() || month !== now.getMonth()) && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs ml-1"
              onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth()); }}>
              Hoje
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="border border-border rounded-lg overflow-hidden animate-pulse">
          <div className="grid grid-cols-7 bg-muted/30 border-b border-border">
            {DIAS_SEMANA.map(d => (
              <div key={d} className="py-2 flex justify-center">
                <div className="h-2.5 w-6 bg-muted rounded" />
              </div>
            ))}
          </div>
          {[...Array(5)].map((_, ri) => (
            <div key={ri} className="grid grid-cols-7 divide-x divide-border border-b border-border last:border-b-0">
              {[...Array(7)].map((_, ci) => (
                <div key={ci} className="p-1.5 min-h-[90px]">
                  <div className="h-4 w-4 bg-muted rounded-full mb-2" />
                  {(ri * 7 + ci) % 3 === 0 && <div className="h-5 bg-muted/70 rounded mb-1" />}
                  {(ri * 7 + ci) % 5 === 0 && <div className="h-5 bg-muted/50 rounded" />}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div
            className="border border-border rounded-lg overflow-hidden"
            onPointerDown={handleCalPointerDown}
            onPointerMove={handleCalPointerMove}
            onPointerUp={handleCalPointerUp}
          >
            {/* Day-of-week header */}
            <div className="grid grid-cols-7 bg-muted/30 border-b border-border">
              {DIAS_SEMANA.map(d => (
                <div key={d} className="text-[10.5px] font-semibold text-muted-foreground text-center py-2 uppercase tracking-wide">
                  {d}
                </div>
              ))}
            </div>

            {/* Week rows */}
            <div className="divide-y divide-border">
              {weeks.map((weekDays, wIdx) => {
                const spanEntries = getSpanningForWeek(weekDays, spanning, previewMap);
                const laneCount   = spanEntries.length > 0
                  ? spanEntries.reduce((m, e) => Math.max(m, e.lane), 0) + 1
                  : 0;
                const LANE_H    = 22;
                const spanOffset = laneCount > 0 ? laneCount * LANE_H + 4 : 0;

                return (
                  <div key={wIdx} className="relative">
                    {/* Spanning bars overlay */}
                    {laneCount > 0 && (
                      <div
                        ref={el => { if (el) weekOverlayRefs.current.set(wIdx, el); else weekOverlayRefs.current.delete(wIdx); }}
                        className="absolute top-0.5 left-0 right-0 grid grid-cols-7 z-10"
                        style={{ gridTemplateRows: `repeat(${laneCount}, ${LANE_H}px)` }}
                      >
                        {spanEntries.map(e => {
                          const pm       = previewMap[e.criativo.id] ?? {};
                          const effPrazo  = pm.data_prazo  ?? e.criativo.data_prazo!;
                          const effInicio = pm.data_inicio ?? e.criativo.data_inicio!;
                          const isLate   = effPrazo < todayYMD
                            && e.criativo.fase !== 'postado'
                            && e.criativo.fase !== 'aprovado';
                          const tipoCor  = isLate
                            ? 'bg-red-500/20 text-red-300 border-red-500/30'
                            : (TIPO_COR[e.criativo.tipo] ?? 'bg-primary/10 text-primary border-primary/20');
                          const editorName = e.criativo.responsavel?.nome ?? e.criativo.editor_nome_historico;

                          const makeHandle = (edge: 'left' | 'right') => ({
                            onPointerDown: (evt: React.PointerEvent<HTMLDivElement>) => {
                              evt.stopPropagation();
                              evt.currentTarget.setPointerCapture(evt.pointerId);
                              resizeRef.current = { criativoId: e.criativo.id, edge };
                            },
                            onPointerMove: (evt: React.PointerEvent<HTMLDivElement>) => {
                              if (!evt.currentTarget.hasPointerCapture(evt.pointerId)) return;
                              const overlayEl = weekOverlayRefs.current.get(wIdx);
                              if (!overlayEl) return;
                              const rect   = overlayEl.getBoundingClientRect();
                              const colIdx = Math.max(0, Math.min(6, Math.floor((evt.clientX - rect.left) / (rect.width / 7))));
                              const newYmd = toYMD(weekDays[colIdx]);
                              setPreviewMap(prev => ({
                                ...prev,
                                [e.criativo.id]: edge === 'right'
                                  ? { ...prev[e.criativo.id], data_prazo:  newYmd }
                                  : { ...prev[e.criativo.id], data_inicio: newYmd },
                              }));
                            },
                            onPointerUp: async (evt: React.PointerEvent<HTMLDivElement>) => {
                              if (!evt.currentTarget.hasPointerCapture(evt.pointerId)) return;
                              evt.currentTarget.releasePointerCapture(evt.pointerId);
                              const cur = previewMap[e.criativo.id];
                              if (cur) {
                                await saveResize(
                                  e.criativo,
                                  edge === 'left'  ? cur.data_inicio : undefined,
                                  edge === 'right' ? cur.data_prazo  : undefined,
                                );
                              }
                              setPreviewMap(prev => { const n = { ...prev }; delete n[e.criativo.id]; return n; });
                              resizeRef.current = null;
                            },
                          });

                          return (
                            <div
                              key={`${e.criativo.id}-w${wIdx}`}
                              data-criativo-id={e.criativo.id}
                              className={cn(
                                'relative flex items-center text-[10.5px] border h-[18px] self-center overflow-visible',
                                tipoCor,
                                e.isFirst ? 'rounded-l-[3px] ml-0.5' : 'rounded-l-none border-l-0 ml-0',
                                e.isLast  ? 'rounded-r-[3px] mr-0.5' : 'rounded-r-none border-r-0 mr-0',
                              )}
                              style={{ gridColumn: `${e.startCol} / ${e.endCol}`, gridRow: `${e.lane + 1}` }}
                            >
                              {/* Left resize handle */}
                              {e.isFirst && (
                                <div
                                  className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-10 hover:bg-white/20 rounded-l-[3px] touch-none"
                                  {...makeHandle('left')}
                                />
                              )}

                              {/* Content */}
                              <button
                                onClick={() => setSelectedId(e.criativo.id)}
                                className="flex-1 flex items-center gap-1 px-1.5 overflow-hidden hover:opacity-75 h-full"
                                title={`${e.criativo.nome} · ${effInicio} → ${effPrazo}${editorName ? ` · ${editorName}` : ''}`}
                              >
                                {e.isFirst && (
                                  <span className="font-medium truncate leading-none">{e.criativo.nome}</span>
                                )}
                                {!e.isFirst && editorName && (
                                  <span className="opacity-60 truncate leading-none text-[9px]">{editorName}</span>
                                )}
                              </button>

                              {/* Right resize handle */}
                              {e.isLast && (
                                <div
                                  className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-10 hover:bg-white/20 rounded-r-[3px] touch-none"
                                  {...makeHandle('right')}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Day cells */}
                    <div className="grid grid-cols-7 divide-x divide-border">
                      {weekDays.map((day, dIdx) => {
                        const ymd            = toYMD(day);
                        const isCurrentMonth = day.getMonth() === month;
                        const isToday        = ymd === todayYMD;
                        const isPast         = ymd < todayYMD;
                        const items   = byDate[ymd] ?? [];
                        const visible = items.slice(0, MAX_PER_DAY);
                        const hidden  = items.length - MAX_PER_DAY;

                        return (
                          <div
                            key={dIdx}
                            data-date={ymd}
                            className={cn('p-1.5 flex flex-col group/day', !isCurrentMonth && 'bg-muted/10')}
                            style={{ minHeight: `${90 + spanOffset}px`, paddingTop: `${spanOffset + 6}px` }}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className={cn(
                                'text-[11px] font-semibold px-1 rounded-full w-5 h-5 flex items-center justify-center',
                                isToday
                                  ? 'bg-primary text-primary-foreground'
                                  : isPast
                                    ? 'text-muted-foreground/40'
                                    : isCurrentMonth
                                      ? 'text-foreground'
                                      : 'text-muted-foreground/30',
                              )}>
                                {day.getDate()}
                              </span>
                              {nivel !== 'membro' && isCurrentMonth && !selectMode && (
                                <button
                                  onClick={() => setCreateDate(ymd)}
                                  title="Novo criativo"
                                  className="opacity-0 group-hover/day:opacity-100 transition-opacity text-muted-foreground/50 hover:text-foreground h-4 w-4 flex items-center justify-center rounded hover:bg-accent"
                                >
                                  <Plus className="h-3 w-3" />
                                </button>
                              )}
                            </div>

                            <DroppableDay ymd={ymd}>
                              {visible.map(c => (
                                <DraggableCalCard
                                  key={c.id}
                                  criativo={c}
                                  todayYMD={todayYMD}
                                  selectMode={selectMode}
                                  isSelected={selectedIds.has(c.id)}
                                  onOpen={() => setSelectedId(c.id)}
                                  onToggle={(activateSelect) => {
                                    if (activateSelect) setSelectMode(true);
                                    setSelectedIds(prev => {
                                      const n = new Set(prev);
                                      n.has(c.id) ? n.delete(c.id) : n.add(c.id);
                                      return n;
                                    });
                                  }}
                                  onResizeRight={async (targetYmd) => {
                                    const original = c.data_prazo ?? c.data_inicio ?? ymd;
                                    await saveResize(c, original, targetYmd);
                                  }}
                                />
                              ))}
                            </DroppableDay>

                            {hidden > 0 && (
                              <Popover open={popoverDay === ymd} onOpenChange={open => setPopoverDay(open ? ymd : null)}>
                                <PopoverTrigger asChild>
                                  <button className="w-full text-center text-[10px] text-muted-foreground hover:text-foreground py-0.5 hover:bg-accent/50 rounded transition-colors mt-1">
                                    +{hidden} mais
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-64 p-0" side="right" align="start">
                                  <div className="px-3 py-2 border-b border-border">
                                    <p className="text-xs font-semibold capitalize">
                                      {day.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
                                    </p>
                                    <p className="text-[11px] text-muted-foreground">{items.length} criativos</p>
                                  </div>
                                  <div className="max-h-72 overflow-y-auto py-1">
                                    {items.map(c => {
                                      const cLate  = isPast && c.fase !== 'postado' && c.fase !== 'aprovado';
                                      const dotCls = cLate ? 'bg-red-400' :
                                        c.tipo === 'vsl' ? 'bg-purple-400' :
                                        c.tipo === 'aula' ? 'bg-green-400' : 'bg-blue-400';
                                      return (
                                        <button
                                          key={c.id}
                                          onClick={() => { setSelectedId(c.id); setPopoverDay(null); }}
                                          className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors flex items-start gap-2"
                                        >
                                          <span className={cn('w-1.5 h-1.5 rounded-full mt-[5px] shrink-0', dotCls)} />
                                          <div className="flex-1 min-w-0">
                                            <p className="text-xs font-medium truncate leading-tight">{c.nome}</p>
                                            <p className="text-[10px] text-muted-foreground truncate">
                                              {c.responsavel?.nome ?? c.editor_nome_historico ?? '—'} · {FASES_MAP[c.fase] ?? c.fase}
                                            </p>
                                          </div>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </PopoverContent>
                              </Popover>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <DragOverlay dropAnimation={null}>
            {activeCriativo && (
              <div className="w-40 rotate-1 shadow-xl opacity-95 pointer-events-none">
                <div className={cn(
                  'rounded px-1.5 py-0.5 text-[10.5px] border font-medium truncate',
                  TIPO_COR[activeCriativo.tipo] ?? 'bg-primary/10 text-primary border-primary/20',
                )}>
                  {activeCriativo.nome}
                </div>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {/* Bulk action bar */}
      {selectMode && selectedIds.size > 0 && (
        <div className="sticky bottom-4 z-40 flex items-center gap-2 bg-card border border-border rounded-lg shadow-lg px-4 py-2 mx-auto w-fit">
          <span className="text-sm font-medium">
            {selectedIds.size} selecionado{selectedIds.size !== 1 ? 's' : ''}
          </span>
          <div className="w-px h-4 bg-border mx-1" />
          <Select value={bulkFase || '_'} onValueChange={v => setBulkFase(v === '_' ? '' : v)}>
            <SelectTrigger className="h-7 w-36 text-xs"><SelectValue placeholder="Mudar fase" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_">Fase...</SelectItem>
              {FASES.map(f => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={bulkResp || '_'} onValueChange={v => setBulkResp(v === '_' ? '' : v)}>
            <SelectTrigger className="h-7 w-36 text-xs"><SelectValue placeholder="Responsável" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_">Responsável...</SelectItem>
              {perfis.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-7 text-xs" onClick={applyBulk} disabled={!bulkFase && !bulkResp}>
            Aplicar
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs"
            onClick={() => { setSelectedIds(new Set()); setBulkFase(''); setBulkResp(''); }}>
            Limpar
          </Button>
        </div>
      )}

      <CriativoFormModal
        open={createDate !== null}
        onClose={() => setCreateDate(null)}
        onCreated={() => { loadCriativos(); setCreateDate(null); }}
        userId={userId}
        funis={funis}
        perfis={perfis}
        defaultDate={createDate ?? undefined}
      />

      <CriativoDrawer
        criativoId={selectedId}
        onClose={() => setSelectedId(null)}
        onUpdate={loadCriativos}
        nivel={nivel}
        userId={userId}
        funis={funis}
        perfis={perfis}
      />
    </div>
  );
}
