import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import type { Criativo, ProducaoNivel, Funil, Perfil } from './types';
import { FASES_MAP, TIPO_COR } from './constants';
import { TipoBadge } from './CriativoCard';
import { CriativoDrawer } from './CriativoDrawer';

interface Props {
  nivel: ProducaoNivel;
  setorId: string | null;
  userId: string;
  /** Quando true, filtra apenas criativos do setor do usuário (para heads) */
  somenteSetor?: boolean;
  /** Quando definido, filtra por um responsável fixo (Meu Painel) */
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
  // pad before
  for (let i = 0; i < first.getDay(); i++) {
    days.push(new Date(year, month, -first.getDay() + 1 + i));
  }
  // current month
  for (let d = 1; d <= last.getDate(); d++) {
    days.push(new Date(year, month, d));
  }
  // pad after (complete to 6 rows)
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
  // estado de expansão por dia (chave = 'YYYY-MM-DD')
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

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

    // Filtro fixo (Meu Painel — por campo do setor do usuário)
    if (fixedField && fixedValue) {
      q = q.eq(fixedField, fixedValue);
    } else if (nivel === 'membro') {
      // membro sem fixedField: só vê os seus (responsavel_id)
      q = q.eq('responsavel_id', userId);
    } else if (somenteSetor && setorId) {
      // head em "Calendário do Setor": membros do setor via join
      const { data: sp } = await supabase.from('perfis').select('id').eq('setor_id', setorId);
      const ids = sp?.map(p => p.id) ?? [];
      if (ids.length) q = q.in('responsavel_id', ids);
    }
    // socio sem somenteSetor: sem filtro de responsável

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

  const days = buildCalendarGrid(year, month);
  const todayYMD = toYMD(now);

  // index criativos by date (span from data_inicio to data_prazo, or just data_prazo)
  const byDate: Record<string, Criativo[]> = {};
  for (const c of criativos) {
    const start = c.data_inicio ?? c.data_prazo;
    const end   = c.data_prazo ?? c.data_inicio;
    if (!start || !end) continue;
    const cur = new Date(start + 'T00:00:00');
    const last = new Date(end + 'T00:00:00');
    while (cur <= last) {
      const key = toYMD(cur);
      (byDate[key] = byDate[key] ?? []).push(c);
      cur.setDate(cur.getDate() + 1);
    }
  }

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

        {/* Month navigator */}
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[130px] text-center">
            {MESES[month]} {year}
          </span>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-60 text-muted-foreground text-sm gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />Carregando...
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          {/* Header row */}
          <div className="grid grid-cols-7 bg-muted/30">
            {DIAS_SEMANA.map(d => (
              <div key={d} className="text-[10.5px] font-semibold text-muted-foreground text-center py-2 uppercase tracking-wide">
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 divide-x divide-y divide-border">
            {days.map((day, idx) => {
              const ymd = toYMD(day);
              const isCurrentMonth = day.getMonth() === month;
              const isToday = ymd === todayYMD;
              const isPast = ymd < todayYMD;
              const items = byDate[ymd] ?? [];

              return (
                <div
                  key={idx}
                  className={cn(
                    'min-h-[90px] p-1.5 flex flex-col gap-1',
                    !isCurrentMonth && 'bg-muted/10',
                  )}
                >
                  <span className={cn(
                    'text-[11px] font-semibold self-start px-1 rounded-full w-5 h-5 flex items-center justify-center',
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

                  {(() => {
                    const isExpanded = expandedDays.has(ymd);
                    const visible    = isExpanded ? items : items.slice(0, MAX_PER_DAY);
                    const hidden     = items.length - MAX_PER_DAY;
                    return (
                      <>
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
                              <span className="opacity-60 text-[9.5px]">{FASES_MAP[c.fase] ?? c.fase}</span>
                            </button>
                          );
                        })}
                        {!isExpanded && hidden > 0 && (
                          <button
                            onClick={() => setExpandedDays(prev => new Set([...prev, ymd]))}
                            className="w-full text-center text-[10px] text-muted-foreground hover:text-foreground py-0.5"
                          >
                            +{hidden} mais
                          </button>
                        )}
                        {isExpanded && items.length > MAX_PER_DAY && (
                          <button
                            onClick={() => setExpandedDays(prev => { const s = new Set(prev); s.delete(ymd); return s; })}
                            className="w-full text-center text-[10px] text-muted-foreground hover:text-foreground py-0.5"
                          >
                            ver menos
                          </button>
                        )}
                      </>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap">
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
      </div>

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
