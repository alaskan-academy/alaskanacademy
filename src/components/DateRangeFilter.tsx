import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Calendar, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DateRangeFilterProps {
  de: string;
  ate: string;
  onChangeDe: (v: string) => void;
  onChangeAte: (v: string) => void;
  className?: string;
}

function fmtShort(iso: string) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  const mes = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][parseInt(m) - 1];
  return `${d} ${mes} ${y}`;
}

export function DateRangeFilter({ de, ate, onChangeDe, onChangeAte, className }: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const hasFilter = de || ate;

  const label = hasFilter
    ? [de && fmtShort(de), ate && fmtShort(ate)].filter(Boolean).join(' → ')
    : 'Qualquer data';

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChangeDe('');
    onChangeAte('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-1.5 h-8 px-3 text-sm rounded-md border transition-colors',
            hasFilter
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-input bg-background text-muted-foreground hover:text-foreground hover:border-border',
            className,
          )}
        >
          <Calendar className="h-3.5 w-3.5 shrink-0" />
          <span>{label}</span>
          {hasFilter && (
            <X className="h-3 w-3 ml-0.5 shrink-0 opacity-60 hover:opacity-100" onClick={clear} />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3" align="start">
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">De</Label>
            <input
              type="date"
              value={de}
              onChange={e => onChangeDe(e.target.value)}
              className="w-full h-8 text-sm px-2 rounded-md border border-input bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Até</Label>
            <input
              type="date"
              value={ate}
              min={de || undefined}
              onChange={e => onChangeAte(e.target.value)}
              className="w-full h-8 text-sm px-2 rounded-md border border-input bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          {hasFilter && (
            <Button variant="ghost" size="sm" className="w-full h-7 text-xs text-muted-foreground" onClick={() => { onChangeDe(''); onChangeAte(''); }}>
              Limpar datas
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
