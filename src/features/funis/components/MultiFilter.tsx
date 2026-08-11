import { useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface Option {
  id: string;
  label: string;
}

interface Props {
  placeholder: string;
  options: Option[];
  value: string[];
  onChange: (v: string[]) => void;
  width?: string;
}

export function MultiFilter({ placeholder, options, value, onChange, width = 'w-48' }: Props) {
  const [open, setOpen] = useState(false);

  const triggerLabel =
    value.length === 0
      ? placeholder
      : value.length === 1
      ? (options.find(o => o.id === value[0])?.label ?? placeholder)
      : `${value.length} selecionados`;

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter(s => s !== id) : [...value, id]);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'h-9 text-sm flex items-center justify-between gap-1.5 px-3 rounded-md border border-input bg-background hover:bg-accent transition-colors font-normal',
            width,
            value.length > 0 && 'border-primary/60',
          )}
        >
          <span className="truncate text-left flex-1">{triggerLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="p-1.5 min-w-[180px] max-w-[260px]"
        align="start"
        onInteractOutside={() => setOpen(false)}
      >
        <div className="flex flex-col gap-0.5">
          {options.map(o => {
            const checked = value.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                onMouseDown={e => {
                  e.preventDefault(); // evita que o Popover feche por blur
                  toggle(o.id);
                }}
                className="flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-muted text-left w-full"
              >
                <span className={cn(
                  'flex h-4 w-4 shrink-0 rounded border items-center justify-center',
                  checked ? 'bg-primary border-primary' : 'border-border',
                )}>
                  {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                </span>
                <span className="truncate">{o.label}</span>
              </button>
            );
          })}
          {options.length === 0 && (
            <p className="text-xs text-muted-foreground px-2 py-2">Nenhuma opção</p>
          )}
        </div>
        {value.length > 0 && (
          <button
            type="button"
            onMouseDown={e => {
              e.preventDefault();
              onChange([]);
            }}
            className="mt-1 w-full text-[11px] text-muted-foreground hover:text-foreground text-center py-1 border-t border-border/50"
          >
            Limpar seleção
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
