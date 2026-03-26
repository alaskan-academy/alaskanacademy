import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, TrendingUp, Filter, ShoppingCart,
  Users, Award, Settings, ChevronLeft, ChevronRight, Mountain, Link2, BarChart3, X, Menu, Loader2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSidebarState } from '@/contexts/SidebarContext';
import { useFilters } from '@/contexts/FilterContext';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface Funil {
  id: string;
  nome: string;
  produto: string;
  ativo: boolean;
}

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

const prodColors: Record<string, string> = {
  velas: 'bg-orange-500/20 text-orange-400',
  saponaria: 'bg-green-500/20 text-green-400',
  cosmeticos: 'bg-pink-500/20 text-pink-400',
  hormonal: 'bg-purple-500/20 text-purple-400',
  velaroma: 'bg-blue-500/20 text-blue-400',
};

export function AppSidebar() {
  const { collapsed, toggle, mobileOpen, setMobileOpen, isMobile } = useSidebarState();
  const { funilId, setFunilId } = useFilters();
  const location = useLocation();
  const [funis, setFunis] = useState<Funil[]>([]);
  const [loadingFunis, setLoadingFunis] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoadingFunis(true);
      const { data } = await supabase.from('funis').select('id,nome,produto,ativo').eq('ativo', true).order('nome');
      setFunis(data || []);
      setLoadingFunis(false);
    };
    load();
  }, []);

  const DashboardSelector = ({ showLabels }: { showLabels: boolean }) => (
    <div className={cn("border-b border-sidebar-border", showLabels ? "px-3 py-3" : "px-2 py-3")}>
      {showLabels && <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2">Dashboards</div>}
      <div className="space-y-0.5">
        <button
          onClick={() => setFunilId(null)}
          className={cn(
            "flex items-center gap-2 w-full rounded-md text-sm font-medium transition-colors",
            showLabels ? "px-3 py-2" : "justify-center py-2 px-1",
            !funilId
              ? "bg-primary/15 text-primary"
              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )}
        >
          <LayoutDashboard className="h-3.5 w-3.5 shrink-0" />
          {showLabels && <span>Geral</span>}
        </button>
        {loadingFunis ? (
          <div className="flex justify-center py-2">
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          </div>
        ) : (
          funis.map((f) => (
            <button
              key={f.id}
              onClick={() => setFunilId(f.id)}
              className={cn(
                "flex items-center gap-2 w-full rounded-md text-sm transition-colors",
                showLabels ? "px-3 py-2" : "justify-center py-2 px-1",
                funilId === f.id
                  ? "bg-primary/15 text-primary font-medium"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <div className={cn("w-2 h-2 rounded-full shrink-0", prodColors[f.produto]?.split(' ')[0] || 'bg-muted')} />
              {showLabels && <span className="truncate">{f.nome}</span>}
            </button>
          ))
        )}
      </div>
    </div>
  );

  const NavItems = ({ showLabels, onNavigate }: { showLabels: boolean; onNavigate?: () => void }) => (
    <nav className="flex-1 py-3 space-y-0.5 px-2 overflow-y-auto">
      {navItems.map((item) => {
        const isActive = location.pathname === item.path;
        return (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
              isActive
                ? "bg-primary/15 text-primary"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {showLabels && <span>{item.label}</span>}
          </NavLink>
        );
      })}
    </nav>
  );

  if (isMobile) {
    return (
      <>
        {mobileOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}
        <aside className={cn(
          "fixed left-0 top-0 h-screen bg-sidebar border-r border-sidebar-border flex flex-col z-50 transition-transform duration-300 w-64",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}>
          <div className="flex items-center justify-between px-4 h-16 border-b border-sidebar-border">
            <div className="flex items-center gap-2">
              <Mountain className="h-6 w-6 text-primary shrink-0" />
              <span className="text-foreground font-semibold text-lg tracking-tight">Alaskan</span>
            </div>
            <button onClick={() => setMobileOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
          <DashboardSelector showLabels={true} />
          <NavItems showLabels={true} onNavigate={() => setMobileOpen(false)} />
        </aside>
      </>
    );
  }

  return (
    <aside className={cn(
      "fixed left-0 top-0 h-screen bg-sidebar border-r border-sidebar-border flex flex-col z-50 transition-all duration-300",
      collapsed ? "w-16" : "w-56"
    )}>
      <div className="flex items-center gap-2 px-4 h-16 border-b border-sidebar-border">
        <Mountain className="h-6 w-6 text-primary shrink-0" />
        {!collapsed && <span className="text-foreground font-semibold text-lg tracking-tight">Alaskan</span>}
      </div>

      <DashboardSelector showLabels={!collapsed} />
      <NavItems showLabels={!collapsed} />

      <button
        onClick={toggle}
        className="flex items-center justify-center h-12 border-t border-sidebar-border text-muted-foreground hover:text-foreground transition-colors"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </button>
    </aside>
  );
}
