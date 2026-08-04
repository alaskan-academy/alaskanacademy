import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { ChevronLeft, ChevronRight, Plus, Copy, Trash2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import type { RotinaCard } from './RotinaCardModal';

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const COR_MAP: Record<string, string> = {
  blue:    'bg-blue-500/20 border-blue-500/50 text-blue-300',
  violet:  'bg-violet-500/20 border-violet-500/50 text-violet-300',
  emerald: 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300',
  amber:   'bg-amber-500/20 border-amber-500/50 text-amber-300',
  rose:    'bg-rose-500/20 border-rose-500/50 text-rose-300',
  cyan:    'bg-cyan-500/20 border-cyan-500/50 text-cyan-300',
};
const COR_DOT: Record<string, string> = {
  blue: 'bg-blue-500', violet: 'bg-violet-500', emerald: 'bg-emerald-500',
  amber: 'bg-amber-500', rose: 'bg-rose-500', cyan: 'bg-cyan-500',
};

const CARD_H = 32;
const CARD_GAP = 2;
const EVENTS_PAD = 3;

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function buildGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const last  = new Date(year, month + 1, 0);
  const days: Date[] = [];
  for (let i = 0; i < first.getDay(); i++) days.push(new Date(year, month, -first.getDay() + 1 + i));
  for (let d = 1; d <= last.getDate(); d++) days.push(new Date(year, month, d));
  const rem = 42 - days.length;
  for (let i = 1; i <= rem; i++) days.push(new Date(year, month + 1, i));
  return days;
}

function expandRecorrencia(card: RotinaCard, rangeStart: string, rangeEnd: string): RotinaCard[] {
  if (!card.recorrencia_tipo || card.recorrencia_tipo === 'none') return [];
  const durDays = Math.round(
    (new Date(card.data_fim + 'T00:00:00').getTime() - new Date(card.data_inicio + 'T00:00:00').getTime()) / 86400000
  );
  const instances: RotinaCard[] = [];
  const recFim = card.recorrencia_fim ?? rangeEnd;
  let cur = new Date(card.data_inicio + 'T00:00:00');
  cur.setDate(cur.getDate() + 1);
  while (toYMD(cur) <= recFim && toYMD(cur) <= rangeEnd) {
    let include = false;
    if (card.recorrencia_tipo === 'diario') include = true;
    else if (card.recorrencia_tipo === 'semanal') include = (card.recorrencia_dias_semana ?? []).includes(cur.getDay());
    else if (card.recorrencia_tipo === 'mensal') include = cur.getDate() === new Date(card.data_inicio + 'T00:00:00').getDate();
    if (include) {
      const d = new Date(cur); const endD = new Date(cur);
      endD.setDate(endD.getDate() + durDays);
      if (toYMD(d) >= rangeStart) {
        instances.push({ ...card, id: `${card.id}__${toYMD(d)}`, data_inicio: toYMD(d), data_fim: toYMD(endD), recorrencia_pai_id: card.id });
      }
    }
    if (card.recorrencia_tipo === 'diario' || card.recorrencia_tipo === 'semanal') cur.setDate(cur.getDate() + 1);
    else cur.setMonth(cur.getMonth() + 1);
  }
  return instances;
}

// Plain text for card preview (first line only)
function extractNotePreview(notas: unknown): string {
  if (!notas || typeof notas !== 'object') return '';
  const root = notas as { content?: unknown[] };
  if (!Array.isArray(root.content)) return '';
  function nodeText(n: unknown): string {
    if (!n || typeof n !== 'object') return '';
    const node = n as { text?: string; content?: unknown[] };
    if (typeof node.text === 'string') return node.text;
    if (Array.isArray(node.content)) return node.content.map(nodeText).join('');
    return '';
  }
  for (const child of root.content) {
    const t = nodeText(child).trim();
    if (t) return t;
  }
  return '';
}

// Tiptap JSON → HTML for the tooltip
function notasToHtml(notas: unknown): string {
  if (!notas || typeof notas !== 'object') return '';
  type TNode = { type?: string; text?: string; marks?: { type: string }[]; content?: TNode[]; attrs?: Record<string, unknown> };
  function renderNode(n: TNode): string {
    if (n.type === 'text') {
      let t = n.text ?? '';
      if (n.marks) for (const m of n.marks) {
        if (m.type === 'bold')      t = `<strong>${t}</strong>`;
        if (m.type === 'italic')    t = `<em>${t}</em>`;
        if (m.type === 'underline') t = `<u>${t}</u>`;
      }
      return t;
    }
    const inner = (n.content ?? []).map(renderNode).join('');
    switch (n.type) {
      case 'paragraph':   return `<p>${inner || '<br>'}</p>`;
      case 'heading':     return `<h${n.attrs?.level ?? 2}>${inner}</h${n.attrs?.level ?? 2}>`;
      case 'bulletList':  return `<ul>${inner}</ul>`;
      case 'orderedList': return `<ol>${inner}</ol>`;
      case 'listItem':    return `<li>${inner}</li>`;
      case 'taskList':    return `<ul class="nt-tasklist">${inner}</ul>`;
      case 'taskItem':    return `<li class="nt-taskitem"><span class="nt-cb">${n.attrs?.checked ? '☑' : '☐'}</span><span>${inner}</span></li>`;
      case 'blockquote':  return `<blockquote>${inner}</blockquote>`;
      case 'hardBreak':   return '<br>';
      default:            return inner;
    }
  }
  const root = notas as TNode;
  return (root.content ?? []).map(renderNode).join('');
}

type EventSlot = {
  card: RotinaCard;
  startCol: number;
  endCol: number;
  rowIdx: number;
  isStart: boolean;
  isEnd: boolean;
};

function assignEventSlots(weekDays: Date[], allCards: RotinaCard[]): EventSlot[] {
  const weekStart = toYMD(weekDays[0]);
  const weekEnd   = toYMD(weekDays[6]);

  const slots: EventSlot[] = allCards
    .filter(c => c.data_inicio <= weekEnd && c.data_fim >= weekStart)
    .map(c => {
      let sc = 0;
      for (let i = 0; i < weekDays.length; i++) { if (toYMD(weekDays[i]) >= c.data_inicio) { sc = i; break; } }
      let ec = 6;
      for (let i = weekDays.length - 1; i >= 0; i--) { if (toYMD(weekDays[i]) <= c.data_fim) { ec = i; break; } }
      return {
        card: c, startCol: sc, endCol: ec, rowIdx: 0,
        isStart: c.data_inicio >= weekStart && c.data_inicio <= weekEnd,
        isEnd:   c.data_fim   >= weekStart && c.data_fim   <= weekEnd,
      };
    });

  slots.sort((a, b) => a.startCol - b.startCol || (b.endCol - b.startCol) - (a.endCol - a.startCol));

  const rowEnds: number[] = [];
  for (const slot of slots) {
    let row = rowEnds.findIndex(end => end < slot.startCol);
    if (row === -1) row = rowEnds.length;
    rowEnds[row] = slot.endCol;
    slot.rowIdx = row;
  }

  return slots;
}

// ─── Resize state (shared via ref to avoid stale closures) ───────────────────
type ResizeState = {
  cardId: string;
  handle: 'start' | 'end';
  /** original dates before resize started */
  origStart: string;
  origEnd: string;
  containerRect: DOMRect;
  /** all grid days for this week, to map col→date */
  weekDays: Date[];
};

// ─── Day header cell (drop target) ───────────────────────────────────────────
function DroppableDay({ ymd, isCurrentMonth, isToday, onAdd }: {
  ymd: string; isCurrentMonth: boolean; isToday: boolean; onAdd: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: ymd });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'h-8 px-1 pt-1 border-r border-border/40 relative group/day transition-colors last:border-r-0',
        !isCurrentMonth && 'bg-muted/20',
        isOver && 'bg-primary/5',
      )}
    >
      <div className={cn(
        'text-[11px] font-medium w-5 h-5 flex items-center justify-center rounded-full',
        isToday
          ? 'bg-primary text-primary-foreground'
          : isCurrentMonth ? 'text-foreground' : 'text-muted-foreground/40',
      )}>
        {parseInt(ymd.slice(8))}
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="absolute top-1 right-1 opacity-0 group-hover/day:opacity-100 transition-opacity text-muted-foreground/60 hover:text-primary"
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}

// ─── Notes portal popup ───────────────────────────────────────────────────────
function NotesPopup({ html, anchorEl }: { html: string; anchorEl: HTMLElement }) {
  const rect = anchorEl.getBoundingClientRect();
  const left = Math.min(rect.left, window.innerWidth - 288 - 8);
  const top  = rect.bottom + 6;
  return createPortal(
    <div
      style={{ position: 'fixed', top, left, zIndex: 9999, width: 280 }}
      className="notes-tooltip bg-popover border border-border rounded-md shadow-xl p-3 text-xs max-h-52 overflow-y-auto pointer-events-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />,
    document.body,
  );
}

// ─── Spanning card (draggable + resizable) ────────────────────────────────────
function SpanningCard({ slot, onEdit, onDuplicate, onDelete, onResizeStart, isResizing }: {
  slot: EventSlot;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onResizeStart: (e: React.PointerEvent, handle: 'start' | 'end') => void;
  isResizing: boolean;
}) {
  const { card, startCol, endCol, rowIdx, isStart, isEnd } = slot;
  const isVirtual = card.id.includes('__');
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id, data: { card }, disabled: isVirtual || isResizing,
  });

  const colSpan = endCol - startCol + 1;
  const notePreview = extractNotePreview(card.notas);
  const noteHtml = notasToHtml(card.notas);
  const [hovered, setHovered] = useState(false);
  const cardDivRef = useRef<HTMLDivElement | null>(null);

  // Merge dnd-kit ref with our local ref
  const mergedRef = (el: HTMLDivElement | null) => {
    cardDivRef.current = el;
    setNodeRef(el);
  };

  return (
    <>
    <div
      ref={mergedRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'absolute',
        left: `calc(${startCol} / 7 * 100% + 2px)`,
        width: `calc(${colSpan} / 7 * 100% - ${isStart && isEnd ? 4 : isStart ? 3 : isEnd ? 3 : 2}px)`,
        top: EVENTS_PAD + rowIdx * (CARD_H + CARD_GAP),
        height: CARD_H,
        ...(transform ? { transform: CSS.Transform.toString(transform) } : {}),
      }}
      {...attributes}
      {...listeners}
      className={cn(
        'group flex flex-col justify-center px-2 text-[10.5px] font-medium border select-none touch-none overflow-hidden transition-opacity',
        isStart ? 'rounded-l cursor-grab' : 'rounded-l-none border-l-0 cursor-default',
        isEnd   ? 'rounded-r' : 'rounded-r-none border-r-0',
        COR_MAP[card.cor] ?? COR_MAP.blue,
        isDragging && 'opacity-40',
        isVirtual && 'opacity-70',
      )}
    >
      {/* Left resize handle (only on the real start edge) */}
      {isStart && !isVirtual && (
        <div
          className="absolute left-0 top-0 h-full w-2 cursor-ew-resize z-10 opacity-0 group-hover:opacity-100 hover:bg-white/20 rounded-l"
          onPointerDown={e => { e.stopPropagation(); onResizeStart(e, 'start'); }}
        />
      )}

      {/* Right resize handle (only on the real end edge) */}
      {isEnd && !isVirtual && (
        <div
          className="absolute right-0 top-0 h-full w-2 cursor-ew-resize z-10 opacity-0 group-hover:opacity-100 hover:bg-white/20 rounded-r"
          onPointerDown={e => { e.stopPropagation(); onResizeStart(e, 'end'); }}
        />
      )}

      {/* Title row */}
      <div className="flex items-center gap-1 min-w-0">
        {isStart && <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', COR_DOT[card.cor] ?? COR_DOT.blue)} />}
        <span className="truncate flex-1 leading-tight">{card.titulo}</span>
        {!isVirtual && isStart && (
          <span className="hidden group-hover:flex items-center gap-0.5 shrink-0 ml-0.5">
            <button
              type="button"
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onEdit(); }}
              className="p-0.5 rounded hover:bg-white/20"
            >
              <Pencil className="h-2.5 w-2.5" />
            </button>
            <button
              type="button"
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onDuplicate(); }}
              className="p-0.5 rounded hover:bg-white/20"
            >
              <Copy className="h-2.5 w-2.5" />
            </button>
            <button
              type="button"
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onDelete(); }}
              className="p-0.5 rounded hover:bg-white/20"
            >
              <Trash2 className="h-2.5 w-2.5" />
            </button>
          </span>
        )}
      </div>

      {/* Notes preview */}
      {notePreview && (
        <p className={cn(
          'text-[9px] opacity-60 truncate leading-tight mt-0.5',
          isStart ? 'pl-3' : 'pl-0',
        )}>
          {notePreview}
        </p>
      )}
    </div>
    {hovered && noteHtml && !isVirtual && cardDivRef.current && (
      <NotesPopup html={noteHtml} anchorEl={cardDivRef.current} />
    )}
    </>
  );
}

// ─── Main calendar ────────────────────────────────────────────────────────────
interface Props {
  userId: string;
  onEditCard: (card: RotinaCard) => void;
  onNewCard: (date: string) => void;
  refresh: number;
}

export function RotinaCalendar({ userId, onEditCard, onNewCard, refresh }: Props) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const now = new Date();
  const [year, setYear]     = useState(now.getFullYear());
  const [month, setMonth]   = useState(now.getMonth());
  const [cards, setCards]   = useState<RotinaCard[]>([]);
  const [activeCard, setActiveCard] = useState<RotinaCard | null>(null);
  const resizingRef = useRef<ResizeState | null>(null);
  const [resizingCardId, setResizingCardId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const todayYMD   = toYMD(now);
  const grid       = buildGrid(year, month);
  const rangeStart = toYMD(grid[0]);
  const rangeEnd   = toYMD(grid[grid.length - 1]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('copy_rotina_cards')
      .select('*')
      .or(`data_inicio.lte.${rangeEnd},data_fim.gte.${rangeStart}`)
      .order('data_inicio');
    setCards(data ?? []);
  }, [rangeStart, rangeEnd]);

  useEffect(() => { load(); }, [load, refresh]);

  // ─── Resize pointer events ────────────────────────────────────────────────
  useEffect(() => {
    const colFromX = (x: number) => {
      const rs = resizingRef.current;
      if (!rs) return -1;
      const { left, width } = rs.containerRect;
      return Math.max(0, Math.min(6, Math.floor((x - left) / (width / 7))));
    };

    const onMove = (e: PointerEvent) => {
      const rs = resizingRef.current;
      if (!rs) return;
      const col = colFromX(e.clientX);
      if (col < 0) return;
      const newDate = toYMD(rs.weekDays[col]);

      if (rs.handle === 'end') {
        if (newDate <= rs.origStart) return;
        setCards(prev => prev.map(c => c.id === rs.cardId ? { ...c, data_fim: newDate } : c));
      } else {
        if (newDate >= rs.origEnd) return;
        setCards(prev => prev.map(c => c.id === rs.cardId ? { ...c, data_inicio: newDate } : c));
      }
    };

    const onUp = async (e: PointerEvent) => {
      const rs = resizingRef.current;
      if (!rs) return;
      const col = colFromX(e.clientX);
      resizingRef.current = null;
      setResizingCardId(null);

      // Get the current state of the card after optimistic updates
      let finalCard: RotinaCard | undefined;
      setCards(prev => {
        finalCard = prev.find(c => c.id === rs.cardId);
        return prev;
      });

      // Clamp: ensure start < end
      if (!finalCard) return;
      const newStart = finalCard.data_inicio;
      const newEnd   = finalCard.data_fim;
      if (newStart >= newEnd) {
        // Revert
        setCards(prev => prev.map(c => c.id === rs.cardId
          ? { ...c, data_inicio: rs.origStart, data_fim: rs.origEnd } : c));
        return;
      }
      if (col < 0) {
        setCards(prev => prev.map(c => c.id === rs.cardId
          ? { ...c, data_inicio: rs.origStart, data_fim: rs.origEnd } : c));
        return;
      }

      const field = rs.handle === 'start' ? 'data_inicio' : 'data_fim';
      const newVal = rs.handle === 'start' ? newStart : newEnd;
      const { error } = await supabase.from('copy_rotina_cards')
        .update({ [field]: newVal }).eq('id', rs.cardId);
      if (error) {
        toast({ title: 'Erro ao redimensionar card', variant: 'destructive' });
        setCards(prev => prev.map(c => c.id === rs.cardId
          ? { ...c, data_inicio: rs.origStart, data_fim: rs.origEnd } : c));
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, []); // stable — only uses resizingRef

  const handleResizeStart = useCallback((
    e: React.PointerEvent,
    handle: 'start' | 'end',
    card: RotinaCard,
    containerEl: HTMLElement,
  ) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizingRef.current = {
      cardId: card.id,
      handle,
      origStart: card.data_inicio,
      origEnd: card.data_fim,
      containerRect: containerEl.getBoundingClientRect(),
      weekDays: [], // filled per-week below
    };
    setResizingCardId(card.id);
  }, []);

  const allCards = [
    ...cards,
    ...cards.flatMap(c => expandRecorrencia(c, rangeStart, rangeEnd)),
  ];

  const weeks = Array.from({ length: 6 }, (_, i) => grid.slice(i * 7, (i + 1) * 7));

  const handleDragStart = (e: DragStartEvent) => {
    setActiveCard((e.active.data.current as { card: RotinaCard }).card);
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setActiveCard(null);
    const { active, over } = e;
    if (!over) return;
    const card = (active.data.current as { card: RotinaCard }).card;
    const newStart = over.id as string;
    if (card.data_inicio === newStart || card.id.includes('__')) return;
    const durDays = Math.round(
      (new Date(card.data_fim + 'T00:00:00').getTime() - new Date(card.data_inicio + 'T00:00:00').getTime()) / 86400000
    );
    const endD = new Date(newStart + 'T00:00:00');
    endD.setDate(endD.getDate() + durDays);
    setCards(prev => prev.map(c => c.id === card.id
      ? { ...c, data_inicio: newStart, data_fim: toYMD(endD) } : c));
    const { error } = await supabase.from('copy_rotina_cards')
      .update({ data_inicio: newStart, data_fim: toYMD(endD) }).eq('id', card.id);
    if (error) { toast({ title: 'Erro ao mover card', variant: 'destructive' }); load(); }
  };

  const handleDuplicate = async (card: RotinaCard) => {
    const { error } = await supabase.from('copy_rotina_cards').insert({
      titulo: `${card.titulo} (cópia)`, data_inicio: card.data_inicio,
      data_fim: card.data_fim, notas: card.notas, cor: card.cor, criado_por: userId,
      recorrencia_tipo: null, recorrencia_dias_semana: null, recorrencia_fim: null,
    });
    if (!error) { toast({ title: 'Card duplicado' }); load(); }
  };

  const handleDelete = async (card: RotinaCard) => {
    const ok = await confirm({ title: 'Excluir card?', description: `"${card.titulo}" será removido permanentemente.` });
    if (!ok) return;
    await supabase.from('copy_rotina_cards').delete().eq('id', card.id);
    toast({ title: 'Card excluído' }); load();
  };

  const prevMonth = () => { if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1); };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      {/* Navigation */}
      <div className="flex items-center gap-3 mb-3">
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={prevMonth}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-semibold min-w-[140px] text-center">{MESES[month]} {year}</span>
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={nextMonth}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <button
          onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth()); }}
          className="text-xs text-muted-foreground hover:text-foreground ml-1"
        >
          Hoje
        </button>
      </div>

      {/* Calendar grid */}
      <div className="border border-border/40 rounded-lg overflow-hidden">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 border-b border-border/40 bg-muted/30">
          {DIAS_SEMANA.map(d => (
            <div key={d} className="text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground py-1.5">
              {d}
            </div>
          ))}
        </div>

        {/* Week rows */}
        {weeks.map((weekDays, wi) => {
          const slots = assignEventSlots(weekDays, allCards);
          const numRows = slots.reduce((m, s) => Math.max(m, s.rowIdx + 1), 0);
          const eventsH = Math.max(numRows, 1) * (CARD_H + CARD_GAP) + 2 * EVENTS_PAD;

          return (
            <div key={wi} className="border-b border-border/40 last:border-b-0">
              {/* Day number row */}
              <div className="grid grid-cols-7 border-b border-border/20">
                {weekDays.map(day => {
                  const ymd = toYMD(day);
                  return (
                    <DroppableDay
                      key={ymd}
                      ymd={ymd}
                      isCurrentMonth={day.getMonth() === month}
                      isToday={ymd === todayYMD}
                      onAdd={() => onNewCard(ymd)}
                    />
                  );
                })}
              </div>

              {/* Events area */}
              <div data-events-area className="relative w-full" style={{ height: eventsH }}>
                {slots.map(slot => (
                  <SpanningCard
                    key={slot.card.id}
                    slot={slot}
                    onEdit={() => onEditCard(slot.card)}
                    onDuplicate={() => handleDuplicate(slot.card)}
                    onDelete={() => handleDelete(slot.card)}
                    isResizing={resizingCardId === slot.card.id}
                    onResizeStart={(e, handle) => {
                      // Store weekDays into ref before the effect reads it
                      const containerEl = (e.currentTarget as HTMLElement)
                        .closest('[data-events-area]') as HTMLElement | null;
                      if (!containerEl) return;
                      handleResizeStart(e, handle, slot.card, containerEl);
                      // Patch weekDays into the ref after handleResizeStart set it
                      if (resizingRef.current) resizingRef.current.weekDays = weekDays;
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Cursor override while resizing */}
      {resizingCardId && (
        <style>{`* { cursor: ew-resize !important; user-select: none !important; }`}</style>
      )}

      <DragOverlay dropAnimation={null}>
        {activeCard && (
          <div className={cn(
            'flex items-center gap-1.5 rounded px-2 py-1 text-[10.5px] font-medium border shadow-lg opacity-90 w-40',
            COR_MAP[activeCard.cor] ?? COR_MAP.blue,
          )}>
            <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', COR_DOT[activeCard.cor] ?? COR_DOT.blue)} />
            <span className="truncate">{activeCard.titulo}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
