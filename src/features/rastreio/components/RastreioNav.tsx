import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Activity, List, SlidersHorizontal } from 'lucide-react';

/**
 * A sub-navegação do Rastreio, em pílulas DENTRO da página.
 *
 * A sidebar da casa é plana: uma funcionalidade com várias sub-páginas ganha
 * UMA entrada lá e troca de aba aqui. É a mesma forma do `FinanceiroNav` —
 * e são cópias em vez de um componente compartilhado porque o painel ainda
 * não tem um, e inventá-lo agora mudaria três telas que funcionam para
 * ganhar nada hoje.
 */
const ITEMS = [
  { path: '/rastreio', label: 'Visão geral', icon: Activity, fim: true },
  { path: '/rastreio/eventos', label: 'Eventos', icon: List, fim: false },
  { path: '/rastreio/configuracao', label: 'Configuração', icon: SlidersHorizontal, fim: false },
];

export function RastreioNav() {
  return (
    <div className="mb-5 flex w-fit flex-wrap gap-1 rounded-lg bg-secondary p-1">
      {ITEMS.map(item => (
        <NavLink
          key={item.path}
          to={item.path}
          /* `end` só na Visão geral: sem isso ela ficaria ativa em todas as
             filhas, porque `/rastreio` é prefixo de `/rastreio/eventos`. */
          end={item.fim}
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
