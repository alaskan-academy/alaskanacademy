import { AlertTriangle, X } from 'lucide-react';
import { useState } from 'react';
import { Dominio, daysUntilExpiry } from '../types';

interface Props {
  dominios: Dominio[];
  onGoToDominios: () => void;
}

export function AlertaBanner({ dominios, onGoToDominios }: Props) {
  const [dismissed, setDismissed] = useState(false);

  const expirando = dominios.filter(d => {
    if (!d.ativo) return false;
    const days = daysUntilExpiry(d.vencimento);
    return days !== null && days <= 30;
  });

  if (dismissed || expirando.length === 0) return null;

  const criticos = expirando.filter(d => (daysUntilExpiry(d.vencimento) ?? 999) <= 7);

  return (
    <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 mb-4 ${
      criticos.length > 0
        ? 'border-red-500/40 bg-red-500/10'
        : 'border-amber-500/40 bg-amber-500/10'
    }`}>
      <AlertTriangle className={`h-4 w-4 shrink-0 ${criticos.length > 0 ? 'text-red-400' : 'text-amber-400'}`} />
      <div className="flex-1 min-w-0">
        <span className={`text-sm font-medium ${criticos.length > 0 ? 'text-red-300' : 'text-amber-300'}`}>
          {expirando.length === 1
            ? `Domínio "${expirando[0].nome}" vence em breve`
            : `${expirando.length} domínios com vencimento próximo`}
          {criticos.length > 0 && ` — ${criticos.length} crítico${criticos.length > 1 ? 's' : ''}`}
        </span>
        <button
          onClick={onGoToDominios}
          className={`ml-2 text-xs underline underline-offset-2 ${criticos.length > 0 ? 'text-red-400' : 'text-amber-400'}`}
        >
          Ver domínios
        </button>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-muted-foreground hover:text-foreground shrink-0"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
