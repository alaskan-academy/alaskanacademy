import { ChevronDown, Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Option {
  id: string;
  nome: string;
}

interface Props {
  label: string;
  options: Option[];
  value: string[];
  onChange: (v: string[]) => void;
  width?: string;
  /**
   * Largura da lista aberta. Os 180px padrão cortam nomes de projeto como
   * "Workshop Buquê de Velas" — quem usa nomes longos passa outro valor em vez
   * de todo mundo herdar uma lista larga demais.
   */
  larguraDaLista?: string;
}

export function MultiFilter({
  label, options, value, onChange, width = 'w-44', larguraDaLista = '180px',
}: Props) {
  const triggerLabel =
    value.length === 0
      ? label
      : value.length === 1
      ? (options.find(o => o.id === value[0])?.nome ?? label)
      : `${value.length} selecionados`;

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter(s => s !== id) : [...value, id]);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'h-8 text-xs justify-between gap-1 font-normal',
            width,
            value.length > 0 && 'border-primary/60 text-foreground',
          )}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-1.5" style={{ width: larguraDaLista }}>
        <div className="flex flex-col gap-0.5">
          {options.map(o => {
            const checked = value.includes(o.id);
            return (
              <button
                key={o.id}
                onClick={() => toggle(o.id)}
                className="flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-muted text-left w-full"
              >
                <span className={cn(
                  'flex h-4 w-4 shrink-0 rounded border items-center justify-center',
                  checked ? 'bg-primary border-primary' : 'border-border',
                )}>
                  {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                </span>
                <span className="truncate">{o.nome}</span>
              </button>
            );
          })}
        </div>
        {value.length > 0 && (
          <button
            onClick={() => onChange([])}
            className="mt-1 w-full text-[11px] text-muted-foreground hover:text-foreground text-center py-1"
          >
            Limpar seleção
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
