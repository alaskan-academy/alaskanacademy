import React, { createContext, useContext, useState, useMemo, useCallback, ReactNode } from 'react';
import { subDays, startOfDay, endOfDay, format } from 'date-fns';

type DatePreset = 'all' | 'today' | 'yesterday' | '7d' | '30d' | 'custom';

interface FilterContextType {
  datePreset: DatePreset;
  setDatePreset: (p: DatePreset) => void;
  startDate: Date | null;
  endDate: Date | null;
  setCustomRange: (start: Date, end: Date) => void;
  startDateStr: string | null;
  endDateStr: string | null;
  funilId: string | null;
  setFunilId: (id: string | null) => void;
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
  const [funilId, setFunilId] = useState<string | null>(null);

  const { start, end } = useMemo(() => {
    const now = new Date();
    switch (datePreset) {
      case 'all':       return { start: null, end: null };
      case 'today':     return { start: startOfDay(now), end: endOfDay(now) };
      case 'yesterday': { const y = subDays(now, 1); return { start: startOfDay(y), end: endOfDay(y) }; }
      case '7d':        return { start: startOfDay(subDays(now, 7)), end: endOfDay(now) };
      case '30d':       return { start: startOfDay(subDays(now, 30)), end: endOfDay(now) };
      case 'custom':    return { start: startOfDay(customStart), end: endOfDay(customEnd) };
    }
  }, [datePreset, customStart, customEnd]);

  const startDateStr = useMemo(() => start ? format(start, 'yyyy-MM-dd') : null, [start]);
  const endDateStr   = useMemo(() => end   ? format(end,   'yyyy-MM-dd') : null, [end]);

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
    funilId,
    setFunilId,
  }), [datePreset, start, end, startDateStr, endDateStr, funilId, setDatePreset, setCustomRange]);

  return (
    <FilterContext.Provider value={value}>
      {children}
    </FilterContext.Provider>
  );
};
