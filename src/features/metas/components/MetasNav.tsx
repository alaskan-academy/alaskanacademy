import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Target, Lightbulb } from 'lucide-react';

/*
  Metas e Brainstorm são duas telas de uma área só, e a troca acontece AQUI —
  não na sidebar.

  A regra é do CLAUDE.md: a barra fica plana, uma entrada por funcionalidade, e
  quem tem sub-página resolve com uma fila de pílulas no topo do conteúdo, como
  o Financeiro já faz. Aninhar na barra foi tentado e desfeito.
*/
const ITEMS = [
  { path: '/metas',            label: 'Metas',      icon: Target },
  { path: '/metas/brainstorm', label: 'Brainstorm', icon: Lightbulb },
];

export function MetasNav() {
  return (
    <div className="mb-5 flex w-fit flex-wrap gap-1 rounded-lg bg-secondary p-1">
      {ITEMS.map(item => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === '/metas'}
          className={({ isActive }) => cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <item.icon className="h-3.5 w-3.5" />
          {item.label}
        </NavLink>
      ))}
    </div>
  );
}
