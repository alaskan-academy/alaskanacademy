import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, TrendingUp, Filter, ShoppingCart,
  Users, Award, Settings, ChevronLeft, ChevronRight, Mountain, Link2, BarChart3
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSidebarState } from '@/contexts/SidebarContext';

const navItems = [
  { path: '/', label: 'Visão Geral', icon: LayoutDashboard },
  { path: '/meta-ads', label: 'Meta Ads', icon: TrendingUp },
  { path: '/analise-ads', label: 'Análise de Ads', icon: BarChart3 },
  { path: '/funil', label: 'Funil', icon: Filter },
  { path: '/vendas', label: 'Vendas', icon: ShoppingCart },
  { path: '/utm', label: 'Análise UTM', icon: Link2 },
  { path: '/clientes', label: 'Clientes', icon: Users },
  { path: '/editores', label: 'Editores', icon: Award },
  { path: '/configuracoes', label: 'Configurações', icon: Settings },
];

export function AppSidebar() {
  const { collapsed, toggle } = useSidebarState();
  const location = useLocation();

  return (
    <aside className={cn(
      "fixed left-0 top-0 h-screen bg-sidebar border-r border-sidebar-border flex flex-col z-50 transition-all duration-300",
      collapsed ? "w-16" : "w-56"
    )}>
      <div className="flex items-center gap-2 px-4 h-16 border-b border-sidebar-border">
        <Mountain className="h-6 w-6 text-primary shrink-0" />
        {!collapsed && <span className="text-foreground font-semibold text-lg tracking-tight">Alaskan</span>}
      </div>

      <nav className="flex-1 py-4 space-y-1 px-2">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/15 text-primary"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>

      <button
        onClick={toggle}
        className="flex items-center justify-center h-12 border-t border-sidebar-border text-muted-foreground hover:text-foreground transition-colors"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </button>
    </aside>
  );
}
