import React, { createContext, useContext, useState, useMemo, useCallback, ReactNode } from 'react';
import { subDays, subMonths, startOfDay, endOfDay, startOfMonth, endOfMonth, format } from 'date-fns';
import { inicioDiaBRT, fimDiaBRT } from '@/lib/periodo';

type DatePreset = 'all' | 'today' | 'yesterday' | '7d' | '30d' | 'thisMonth' | 'lastMonth' | 'custom';

interface FilterContextType {
  datePreset: DatePreset;
  setDatePreset: (p: DatePreset) => void;
  startDate: Date | null;
  endDate: Date | null;
  setCustomRange: (start: Date, end: Date) => void;
  startDateStr: string | null;
  endDateStr: string | null;
  /**
   * Limites do período como timestamp com offset do fuso da operação.
   * Use estes ao comparar com colunas `timestamptz` (ex: `vendas.data_venda`);
   * as versões `*DateStr` são só data e o Postgres as lê em UTC.
   */
  startISO: string | null;
  endISO: string | null;
  /**
   * As contas escolhidas. Vazio quer dizer TODAS — e não 'nenhuma'.
   *
   * Era `contaId: string | null`, uma conta por vez. Quem quisesse comparar
   * duas precisava olhar uma, anotar, trocar e olhar a outra. Lista resolve, e
   * o vazio continua significando o que o `null` significava.
   */
  contaIds: string[];
  setContaIds: (ids: string[]) => void;
}

const FilterContext = createContext<FilterContextType | null>(null);

export const useFilters = () => {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error('useFilters must be used within FilterProvider');
  return ctx;
};

export const FilterProvider = ({ children }: { children: ReactNode }) => {
  const [datePreset, setDatePresetState] = useState<DatePreset>('today');
  const [customStart, setCustomStart] = useState<Date>(subDays(new Date(), 30));
  const [customEnd, setCustomEnd] = useState<Date>(new Date());
  const [contaIds, setContaIds] = useState<string[]>([]);

  const { start, end } = useMemo(() => {
    const now = new Date();
    switch (datePreset) {
      case 'all':       return { start: null, end: null };
      case 'today':     return { start: startOfDay(now), end: endOfDay(now) };
      case 'yesterday': { const y = subDays(now, 1); return { start: startOfDay(y), end: endOfDay(y) }; }
      case '7d':        return { start: startOfDay(subDays(now, 7)), end: endOfDay(now) };
      case '30d':       return { start: startOfDay(subDays(now, 30)), end: endOfDay(now) };
      // Fecha em hoje, não no fim do mês: incluir dias que ainda não aconteceram
      // faria o rateio do custo fixo cobrar o mês inteiro contra a receita parcial,
      // e a margem apareceria pior do que é até o último dia.
      case 'thisMonth': return { start: startOfMonth(now), end: endOfDay(now) };
      case 'lastMonth': { const m = subMonths(now, 1);
                          return { start: startOfMonth(m), end: endOfMonth(m) }; }
      case 'custom':    return { start: startOfDay(customStart), end: endOfDay(customEnd) };
    }
  }, [datePreset, customStart, customEnd]);

  const startDateStr = useMemo(() => start ? format(start, 'yyyy-MM-dd') : null, [start]);
  const endDateStr   = useMemo(() => end   ? format(end,   'yyyy-MM-dd') : null, [end]);

  const startISO = useMemo(() => startDateStr ? inicioDiaBRT(startDateStr) : null, [startDateStr]);
  const endISO   = useMemo(() => endDateStr   ? fimDiaBRT(endDateStr)      : null, [endDateStr]);

  const setDatePreset  = useCallback((p: DatePreset) => setDatePresetState(p), []);
  const setCustomRange = useCallback((s: Date, e: Date) => {
    setCustomStart(s);
    setCustomEnd(e);
    setDatePresetState('custom');
  }, []);

  const value = useMemo(() => ({
    datePreset,
    setDatePreset,
    startDate: start,
    endDate: end,
    setCustomRange,
    startDateStr,
    endDateStr,
    startISO,
    endISO,
    contaIds,
    setContaIds,
  }), [datePreset, start, end, startDateStr, endDateStr, startISO, endISO, contaIds, setDatePreset, setCustomRange]);

  return (
    <FilterContext.Provider value={value}>
      {children}
    </FilterContext.Provider>
  );
};
