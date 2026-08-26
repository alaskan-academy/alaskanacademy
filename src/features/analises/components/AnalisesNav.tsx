import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { ClipboardList, History } from 'lucide-react';

/**
 * Nav interna do módulo, no padrão do Financeiro.
 *
 * A sidebar tem UMA entrada por feature (regra do CLAUDE.md); a troca entre as
 * telas do módulo acontece aqui dentro.
 */

const ITEMS = [
  { path: '/analises',           label: 'Rodada',    icon: ClipboardList, exato: true },
  { path: '/analises/historico', label: 'Histórico', icon: History,       exato: false },
];

export function AnalisesNav() {
  return (
    <div className="flex gap-1 bg-secondary rounded-lg p-1 mb-4 w-fit flex-wrap">
      {ITEMS.map(item => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.exato}
          className={({ isActive }) => cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
            isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <item.icon className="h-3.5 w-3.5" />
          {item.label}
        </NavLink>
      ))}
    </div>
  );
}
