import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { ClipboardList, TrendingUp, ArrowLeftRight, FileText, Wallet, PieChart } from 'lucide-react';

const ITEMS = [
  { path: '/financeiro/revisao',       label: 'Revisão',       icon: ClipboardList },
  { path: '/financeiro/caixa',         label: 'Caixa & DRE',   icon: Wallet },
  { path: '/financeiro/gastos',        label: 'Gastos',        icon: PieChart },
  { path: '/financeiro/resultado',     label: 'Resultado',     icon: TrendingUp },
  { path: '/financeiro/conciliacao',   label: 'Conciliação',   icon: ArrowLeftRight },
  { path: '/financeiro/notas-fiscais', label: 'Notas Fiscais', icon: FileText },
];

export function FinanceiroNav() {
  return (
    <div className="flex gap-1 bg-secondary rounded-lg p-1 mb-5 w-fit flex-wrap">
      {ITEMS.map(item => (
        <NavLink
          key={item.path}
          to={item.path}
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
