import { useFilters } from '@/contexts/FilterContext';
import { Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { useState } from 'react';
import { format } from 'date-fns';

const datePresets = [
  { value: 'all' as const, label: 'Todos' },
  { value: 'today' as const, label: 'Hoje' },
  { value: '7d' as const, label: '7 dias' },
  { value: '30d' as const, label: '30 dias' },
];

const productOptions = [
  { value: 'todos' as const, label: 'Todos' },
  { value: 'velas' as const, label: 'Velas' },
  { value: 'saponaria' as const, label: 'Saponária' },
  { value: 'cosmeticos' as const, label: 'Cosméticos' },
];

export function GlobalFilters() {
  const { datePreset, setDatePreset, product, setProduct, startDate, endDate, setCustomRange } = useFilters();
  const [calOpen, setCalOpen] = useState(false);
  const [range, setRange] = useState<{ from?: Date; to?: Date }>({});

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1 bg-secondary rounded-lg p-1 flex-wrap">
        {datePresets.map((p) => (
          <button
            key={p.value}
            onClick={() => setDatePreset(p.value)}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
              datePreset === p.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {p.label}
          </button>
        ))}
        <Popover open={calOpen} onOpenChange={setCalOpen}>
          <PopoverTrigger asChild>
            <button
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1',
                datePreset === 'custom' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Calendar className="h-3 w-3" />
              {datePreset === 'custom' && startDate && endDate ? `${format(startDate, 'dd/MM')} - ${format(endDate, 'dd/MM')}` : 'Custom'}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <CalendarComponent
              mode="range"
              selected={range.from && range.to ? { from: range.from, to: range.to } : undefined}
              onSelect={(r) => {
                if (r?.from) setRange({ from: r.from, to: r.to });
                if (r?.from && r?.to) {
                  setCustomRange(r.from, r.to);
                  setCalOpen(false);
                }
              }}
              numberOfMonths={2}
              className="p-3 pointer-events-auto"
            />
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex items-center gap-1 bg-secondary rounded-lg p-1">
        {productOptions.map((p) => (
          <button
            key={p.value}
            onClick={() => setProduct(p.value)}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
              product === p.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
