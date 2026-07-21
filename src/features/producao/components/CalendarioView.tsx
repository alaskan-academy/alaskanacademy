import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import type { Criativo, ProducaoNivel, Funil, Perfil } from './types';
import { FASES_MAP, TIPO_COR } from './constants';
import { CriativoDrawer } from './CriativoDrawer';
import { CriativoFormModal } from './CriativoFormModal';

interface Props {
  nivel: ProducaoNivel;
  setorId: string | null;
  userId: string;
  somenteSetor?: boolean;
  fixedField?: 'responsavel_id' | 'copy_id' | 'gestor_id';
  fixedValue?: string;
}

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function buildCalendarGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const days: Date[] = [];
  for (let i = 0; i < first.getDay(); i++) {
    days.push(new Date(year, month, -first.getDay() + 1 + i));
  }
  for (let d = 1; d <= last.getDate(); d++) {
    days.push(new Date(year, month, d));
  }
  const remaining = 42 - days.length;
  for (let i = 1; i <= remaining; i++) {
    days.push(new Date(year, month + 1, i));
  }
  return days;
}

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const MAX_PER_DAY = 5;

type SpanEntry = {
  criativo: Criativo;
  startCol: number; // 1-7
  endCol: number;   // 2-8, exclusive (CSS grid-column)
  isFirst: boolean;
  isLast: boolean;
  lane: number;
};

function getSpanningForWeek(weekDays: Date[], spanning: Criativo[]): SpanEntry[] {
  const weekStart = toYMD(weekDays[0]);
  const weekEnd   = toYMD(weekDays[6]);

  const raw: Omit<SpanEntry, 'lane'>[] = [];

  for (const c of spanning) {
    const cStart = c.data_inicio!;
    const cEnd   = c.data_prazo!;
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

  // sort by startCol, then longest span first — better lane packing
  raw.sort((a, b) => a.startCol - b.startCol || (b.endCol - b.startCol) - (a.endCol - a.startCol));

  // greedy lane assignment
  const laneEnds: number[] = [];
  return raw.map(e => {
    let lane = laneEnds.findIndex(end => end <= e.startCol);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = e.endCol;
    return { ...e, lane };
  });
}

export function CalendarioView({ nivel, setorId, userId, somenteSetor, fixedField, fixedValue }: Props) {
  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [criativos, setCriativos] = useState<Criativo[]>([]);
  const [funis, setFunis]         = useState<Funil[]>([]);
  const [perfis, setPerfis]       = useState<Perfil[]>([]);
  const [loading, setLoading]     = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filtroFunil, setFiltroFunil] = useState('');
  const [filtroTipo, setFiltroTipo]   = useState('');
  const [filtroResp, setFiltroResp]   = useState('');
  const [popoverDay, setPopoverDay] = useState<string | null>(null);
  const [createDate, setCreateDate] = useState<string | null>(null);

  const loadAux = useCallback(async () => {
    const [{ data: fs }, { data: ps }] = await Promise.all([
      supabase.from('funis').select('id,nome,produto,ativo').eq('ativo', true).order('nome'),
      supabase.from('perfis').select('id,nome,is_admin').order('nome'),
    ]);
    setFunis(fs ?? []);
    setPerfis(ps ?? []);
  }, []);

  const loadCriativos = useCallback(async () => {
    setLoading(true);

    const windowStart = new Date(year, month - 2, 1);
    const windowEnd   = new Date(year, month + 3, 0);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    let q = supabase
      .from('criativos')
      .select([
        '*',
        'funil:funis(id,nome,produto)',
        'responsavel:perfis!responsavel_id(id,nome)',
        'copy:perfis!copy_id(id,nome)',
        'gestor:perfis!gestor_id(id,nome)',
      ].join(','))
      .not('data_prazo', 'is', null)
      .gte('data_prazo', fmt(windowStart))
      .lte('data_prazo', fmt(windowEnd))
      .order('data_prazo')
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

    if (filtroFunil) q = q.eq('funil_id', filtroFunil);
    if (filtroTipo)  q = q.eq('tipo', filtroTipo);
    if (filtroResp)  q = q.eq('responsavel_id', filtroResp);

    const { data } = await q;
    setCriativos(data ?? []);
    setLoading(false);
  }, [nivel, setorId, userId, somenteSetor, fixedField, fixedValue, year, month, filtroFunil, filtroTipo, filtroResp]);

  useEffect(() => { loadAux(); }, [loadAux]);
  useEffect(() => { loadCriativos(); }, [loadCriativos]);

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  };

  const days    = buildCalendarGrid(year, month);
  const todayYMD = toYMD(now);

  // Separate spanning (data_inicio < data_prazo) from single-day events
  const spanning: Criativo[] = [];
  const byDate: Record<string, Criativo[]> = {};

  for (const c of criativos) {
    if (c.data_inicio && c.data_prazo && c.data_inicio < c.data_prazo) {
      spanning.push(c);
    } else {
      // single-day: show on data_prazo
      const key = c.data_prazo ?? c.data_inicio;
      if (key) (byDate[key] = byDate[key] ?? []).push(c);
    }
  }

  // Chunk flat 42 days into 6 week rows
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={filtroFunil || '_'} onValueChange={v => setFiltroFunil(v === '_' ? '' : v)}>
          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Todos os funis" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_">Todos os funis</SelectItem>
            {funis.map(f => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
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

        {/* Legend — inline with toolbar */}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded bg-blue-500/20 border border-blue-500/30" />
            Criativo
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded bg-purple-500/20 border border-purple-500/30" />
            VSL
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded bg-green-500/20 border border-green-500/30" />
            Aula
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded bg-red-500/20 border border-red-500/30" />
            Atrasado
          </div>
          <div className="flex items-center gap-1.5 pl-2 border-l border-border/40">
            <div className="w-6 h-2 rounded-sm bg-blue-500/20 border border-blue-500/30" />
            Período
          </div>
        </div>

        <div className="flex items-center gap-1 border-l border-border/40 pl-2">
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[130px] text-center">
            {MESES[month]} {year}
          </span>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {(year !== now.getFullYear() || month !== now.getMonth()) && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs ml-1"
              onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth()); }}
            >
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
        <div className="border border-border rounded-lg overflow-hidden">
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
              const spanEntries = getSpanningForWeek(weekDays, spanning);
              const laneCount   = spanEntries.length > 0
                ? spanEntries.reduce((m, e) => Math.max(m, e.lane), 0) + 1
                : 0;

              // Height per spanning lane: 20px bar + 2px gap
              const LANE_H = 22;
              const spanOffset = laneCount > 0 ? laneCount * LANE_H + 4 : 0;

              return (
                <div key={wIdx} className="relative">
                  {/* ── Spanning bars — absolute overlay inside the week row ── */}
                  {laneCount > 0 && (
                    <div
                      className="absolute top-0.5 left-0 right-0 grid grid-cols-7 pointer-events-none z-10"
                      style={{ gridTemplateRows: `repeat(${laneCount}, ${LANE_H}px)` }}
                    >
                      {spanEntries.map(e => {
                        const isLate = e.criativo.data_prazo! < todayYMD
                          && e.criativo.fase !== 'postado'
                          && e.criativo.fase !== 'aprovado';
                        const tipoCor = isLate
                          ? 'bg-red-500/20 text-red-300 border-red-500/30'
                          : (TIPO_COR[e.criativo.tipo] ?? 'bg-primary/10 text-primary border-primary/20');
                        const editorName = e.criativo.responsavel?.nome ?? e.criativo.editor_nome_historico;

                        return (
                          <button
                            key={`${e.criativo.id}-w${wIdx}`}
                            onClick={() => setSelectedId(e.criativo.id)}
                            title={`${e.criativo.nome} · ${e.criativo.data_inicio} → ${e.criativo.data_prazo}${editorName ? ` · ${editorName}` : ''}`}
                            className={cn(
                              'pointer-events-auto flex items-center gap-1 text-[10.5px] px-1.5 border h-[18px] overflow-hidden',
                              'transition-opacity hover:opacity-75 cursor-pointer self-center',
                              tipoCor,
                              e.isFirst ? 'rounded-l-[3px] ml-0.5' : 'rounded-l-none border-l-0 ml-0',
                              e.isLast  ? 'rounded-r-[3px] mr-0.5' : 'rounded-r-none border-r-0 mr-0',
                            )}
                            style={{
                              gridColumn: `${e.startCol} / ${e.endCol}`,
                              gridRow:    `${e.lane + 1}`,
                            }}
                          >
                            {e.isFirst && (
                              <span className="font-medium truncate leading-none">{e.criativo.nome}</span>
                            )}
                            {!e.isFirst && editorName && (
                              <span className="opacity-60 truncate leading-none text-[9px]">{editorName}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* ── Day cells ── */}
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
                          className={cn(
                            'p-1.5 flex flex-col gap-1 group/day',
                            !isCurrentMonth && 'bg-muted/10',
                          )}
                          style={{ minHeight: `${90 + spanOffset}px`, paddingTop: `${spanOffset + 6}px` }}
                        >
                          <div className="flex items-center justify-between">
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
                            {nivel !== 'membro' && isCurrentMonth && (
                              <button
                                onClick={() => setCreateDate(ymd)}
                                title="Novo criativo"
                                className="opacity-0 group-hover/day:opacity-100 transition-opacity text-muted-foreground/50 hover:text-foreground h-4 w-4 flex items-center justify-center rounded hover:bg-accent"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            )}
                          </div>

                          {visible.map(c => {
                            const isLate = isPast && c.fase !== 'postado' && c.fase !== 'aprovado';
                            const tipoCor = isLate
                              ? 'bg-red-500/20 text-red-300 border-red-500/30'
                              : (TIPO_COR[c.tipo] ?? 'bg-primary/10 text-primary border-primary/20');
                            return (
                              <button
                                key={c.id}
                                onClick={() => setSelectedId(c.id)}
                                className={cn(
                                  'w-full text-left rounded px-1.5 py-0.5 text-[10.5px] truncate transition-colors hover:opacity-80 border',
                                  tipoCor,
                                )}
                                title={`${c.nome} — ${FASES_MAP[c.fase] ?? c.fase}`}
                              >
                                <span className="font-medium truncate block leading-tight">{c.nome}</span>
                                {(c.responsavel?.nome ?? c.editor_nome_historico) && (
                                  <span className="opacity-50 text-[9px] truncate block">
                                    {c.responsavel?.nome ?? c.editor_nome_historico}
                                  </span>
                                )}
                                <span className="opacity-60 text-[9.5px]">{FASES_MAP[c.fase] ?? c.fase}</span>
                              </button>
                            );
                          })}

                          {hidden > 0 && (
                            <Popover
                              open={popoverDay === ymd}
                              onOpenChange={open => setPopoverDay(open ? ymd : null)}
                            >
                              <PopoverTrigger asChild>
                                <button className="w-full text-center text-[10px] text-muted-foreground hover:text-foreground py-0.5 hover:bg-accent/50 rounded transition-colors">
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
                                    const cLate = isPast && c.fase !== 'postado' && c.fase !== 'aprovado';
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
