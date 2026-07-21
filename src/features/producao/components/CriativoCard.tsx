import { cn } from '@/lib/utils';
import type { Criativo, CriativoTipo } from './types';
import { TIPOS_LABEL, getUrgency } from './constants';

interface Props {
  criativo: Criativo;
  onClick: () => void;
}

export function CriativoCard({ criativo, onClick }: Props) {
  const urgency = getUrgency(criativo.data_prazo);

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left bg-card border rounded-md p-2.5 hover:border-primary/50 transition-colors',
        urgency === 'late' && 'border-l-2 border-l-red-500',
        urgency === 'warn' && 'border-l-2 border-l-amber-500',
      )}
    >
      <p className="text-[12.5px] font-medium text-foreground leading-tight line-clamp-2 mb-2">
        {criativo.nome}
      </p>
      <div className="flex items-center gap-1 flex-wrap">
        <TipoBadge tipo={criativo.tipo} />
        {criativo.funil && (
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded truncate max-w-[84px]">
            {criativo.funil.nome}
          </span>
        )}
      </div>
      {(criativo.responsavel || criativo.data_prazo) && (
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[10.5px] text-muted-foreground truncate flex-1">
            {criativo.responsavel?.nome ?? '—'}
          </span>
          {criativo.data_prazo && (
            <span className={cn(
              'text-[10px] font-medium shrink-0',
              urgency === 'late' ? 'text-red-400' :
              urgency === 'warn' ? 'text-amber-400' : 'text-muted-foreground',
            )}>
              {new Date(criativo.data_prazo + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

export function TipoBadge({ tipo }: { tipo: string }) {
  const colors: Record<string, string> = {
    criativo: 'bg-blue-500/10 text-blue-400',
    vsl:      'bg-amber-500/10 text-amber-400',
    aula:     'bg-green-500/10 text-green-400',
  };
  return (
    <span className={cn(
      'text-[10px] font-semibold px-1.5 py-0.5 rounded',
      colors[tipo] ?? 'bg-muted text-muted-foreground',
    )}>
      {TIPOS_LABEL[tipo as CriativoTipo] ?? tipo}
    </span>
  );
}
