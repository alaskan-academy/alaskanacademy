import React, { createContext, useContext, useState, ReactNode } from 'react';
import { subDays, startOfDay, endOfDay, format } from 'date-fns';

type DatePreset = 'all' | 'today' | '7d' | '30d' | 'custom';
type ProductFilter = 'todos' | 'velas' | 'saponaria' | 'cosmeticos' | 'hormonal' | 'velaroma';

interface FilterContextType {
  datePreset: DatePreset;
  setDatePreset: (p: DatePreset) => void;
  startDate: Date | null;
  endDate: Date | null;
  setCustomRange: (start: Date, end: Date) => void;
  product: ProductFilter;
  setProduct: (p: ProductFilter) => void;
  startDateStr: string | null;
  endDateStr: string | null;
}

const FilterContext = createContext<FilterContextType | null>(null);

export const useFilters = () => {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error('useFilters must be used within FilterProvider');
  return ctx;
};

export const FilterProvider = ({ children }: { children: ReactNode }) => {
  const [datePreset, setDatePresetState] = useState<DatePreset>('today');
  const [product, setProduct] = useState<ProductFilter>('todos');
  const [customStart, setCustomStart] = useState<Date>(subDays(new Date(), 30));
  const [customEnd, setCustomEnd] = useState<Date>(new Date());

  const getDates = (): { start: Date | null; end: Date | null } => {
    const now = new Date();
    switch (datePreset) {
      case 'all':
        return { start: null, end: null };
      case 'today':
        return { start: startOfDay(now), end: endOfDay(now) };
      case '7d':
        return { start: startOfDay(subDays(now, 7)), end: endOfDay(now) };
      case '30d':
        return { start: startOfDay(subDays(now, 30)), end: endOfDay(now) };
      case 'custom':
        return { start: startOfDay(customStart), end: endOfDay(customEnd) };
    }
  };

  const { start, end } = getDates();

  const setDatePreset = (p: DatePreset) => setDatePresetState(p);
  const setCustomRange = (s: Date, e: Date) => {
    setCustomStart(s);
    setCustomEnd(e);
    setDatePresetState('custom');
  };

  return (
    <FilterContext.Provider
      value={{
        datePreset,
        setDatePreset,
        startDate: start,
        endDate: end,
        setCustomRange,
        product,
        setProduct,
        startDateStr: start ? format(start, 'yyyy-MM-dd') : null,
        endDateStr: end ? format(end, 'yyyy-MM-dd') : null,
      }}
    >
      {children}
    </FilterContext.Provider>
  );
};
