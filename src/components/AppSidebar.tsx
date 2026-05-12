import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, TrendingUp, Filter, ShoppingCart,
  Users, Settings, ChevronLeft, ChevronRight, Mountain, Link2, BarChart3, X, Loader2, Globe, ChevronDown
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSidebarState } from '@/contexts/SidebarContext';
import { useFilters } from '@/contexts/FilterContext';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

interface Funil {
  id: string;
  nome: string;
  produto: string;
  ativo: boolean;
}

const subPages = [
  { path: '/', label: 'Resumo', icon: LayoutDashboard },
  { path: '/meta-ads', label: 'Meta Ads', icon: TrendingUp },
  { path: '/funil', label: 'Funil', icon: Filter },
  { path: '/vendas', label: 'Vendas', icon: ShoppingCart },
  { path: '/utm', label: 'Análise UTM', icon: Link2 },
  { path: '/clientes', label: 'Clientes', icon: Users },
];

const fixedItems = [
  { path: '/configuracoes', label: 'Configurações', icon: Settings },
  { path: '/editores', label: 'Editores', icon: BarChart3 },
];

const prodColors: Record<string, string> = {
  velas: 'bg-orange-500/20 text-orange-400',
  saponaria: 'bg-green-500/20 text-green-400',
  cosmeticos: 'bg-pink-500/20 text-pink-400',
  hormonal: 'bg-purple-500/20 text-purple-400',
  velaroma: 'bg-blue-500/20 text-blue-400',
};

const WEBHOOK_BASE = 'https://prtkfwwqpcziexgipoqk.supabase.co/functions/v1/payt-webhook/';

export function AppSidebar() {
  const { collapsed, toggle, mobileOpen, setMobileOpen, isMobile } = useSidebarState();
  const { funilId, setFunilId } = useFilters();
  const location = useLocation();
  const navigate = useNavigate();
  const [funis, setFunis] = useState<Funil[]>([]);
  const [loadingFunis, setLoadingFunis] = useState(true);

  // Track which dashboard is expanded — null means "Geral"
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Sync expandedId with funilId
  useEffect(() => { setExpandedId(funilId); }, [funilId]);

  const loadFunis = async () => {
    setLoadingFunis(true);
    const { data } = await supabase.from('funis').select('id,nome,produto,ativo').eq('ativo', true).order('nome');
    setFunis(data || []);
    setLoadingFunis(false);
  };

  useEffect(() => { loadFunis(); }, []);

  const selectDashboard = (id: string | null, onNav?: () => void) => {
    const wasExpanded = expandedId === id && funilId === id;
    if (wasExpanded) return; // already selected & expanded
    setFunilId(id);
    setExpandedId(id);
    // Navigate to Resumo when switching dashboards
    if (!['/configuracoes', '/editores'].includes(location.pathname)) {
      // stay on current sub-page
    } else {
      navigate('/');
    }
    onNav?.();
  };


  const showLabels = isMobile || !collapsed;

  const DashboardItem = ({ id, label, icon, colorDot, onNav, expandable = false }: {
    id: string | null; label: string; icon?: React.ReactNode; colorDot?: string; onNav?: () => void; expandable?: boolean;
  }) => {
    const isSelected = funilId === id;
    const isExpanded = expandedId === id && isSelected;

    return (
      <div>
        <button
          onClick={() => selectDashboard(id, onNav)}
          className={cn(
            "flex items-center gap-2.5 w-full rounded-md text-sm transition-colors",
            showLabels ? "px-3 py-2" : "justify-center py-2 px-1",
            isSelected
              ? "bg-primary/15 text-primary font-medium"
              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )}
        >
          {icon || <div className={cn("w-2.5 h-2.5 rounded-full shrink-0", colorDot || 'bg-muted')} />}
          {showLabels && (
            <>
              <span className="truncate flex-1 text-left">{label}</span>
              {expandable && (
                <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", isExpanded ? "rotate-180" : "")} />
              )}
            </>
          )}
        </button>

        {/* Sub-pages — only when expanded, expandable, and labels visible */}
        {expandable && isExpanded && showLabels && (
          <div className="ml-4 mt-0.5 space-y-0.5 border-l border-sidebar-border pl-2">
            {subPages.map((sp) => {
              const isActive = location.pathname === sp.path;
              return (
                <NavLink
                  key={sp.path}
                  to={sp.path}
                  onClick={onNav}
                  className={cn(
                    "flex items-center gap-2 rounded-md text-xs font-medium transition-colors px-2 py-1.5",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent"
                  )}
                >
                  <sp.icon className="h-3.5 w-3.5 shrink-0" />
                  <span>{sp.label}</span>
                </NavLink>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const SidebarInner = ({ onNav }: { onNav?: () => void }) => (
    <>
      {/* Fixed items */}
      <div className={cn("border-b border-sidebar-border py-2", showLabels ? "px-3" : "px-2")}>
        {fixedItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={onNav}
              className={cn(
                "flex items-center gap-2.5 rounded-md text-sm font-medium transition-colors mb-0.5",
                showLabels ? "px-3 py-2" : "justify-center py-2 px-1",
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
      </div>

      {/* Dashboards */}
      <div className={cn("py-2 flex-1 overflow-y-auto", showLabels ? "px-3" : "px-2")}>
        {showLabels && (
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2 px-1">
            Dashboards
          </div>
        )}

        <div className="space-y-0.5">
          <DashboardItem id={null} label="Geral" icon={<Globe className="h-4 w-4 shrink-0" />} onNav={onNav} />

          {loadingFunis ? (
            <div className="flex justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            funis.map((f) => (
              <DashboardItem
                key={f.id}
                id={f.id}
                label={f.nome}
                colorDot={prodColors[f.produto]?.split(' ')[0]}
                onNav={onNav}
              />
            ))
          )}

        </div>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <>
        {mobileOpen && <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setMobileOpen(false)} />}
        <aside className={cn(
          "fixed left-0 top-0 h-screen bg-sidebar border-r border-sidebar-border flex flex-col z-50 transition-transform duration-300 w-64",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}>
          <div className="flex items-center justify-between px-4 h-14 border-b border-sidebar-border">
            <div className="flex items-center gap-2">
              <Mountain className="h-5 w-5 text-primary shrink-0" />
              <span className="text-foreground font-semibold text-lg tracking-tight">Alaskan</span>
            </div>
            <button onClick={() => setMobileOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
          <SidebarInner onNav={() => setMobileOpen(false)} />
        </aside>
      </>
    );
  }

  return (
    <>
      
      <aside className={cn(
        "fixed left-0 top-0 h-screen bg-sidebar border-r border-sidebar-border flex flex-col z-50 transition-all duration-300",
        collapsed ? "w-16" : "w-56"
      )}>
        <div className="flex items-center gap-2 px-4 h-14 border-b border-sidebar-border">
          <Mountain className="h-5 w-5 text-primary shrink-0" />
          {!collapsed && <span className="text-foreground font-semibold text-lg tracking-tight">Alaskan</span>}
        </div>
        <SidebarInner />
        <button
          onClick={toggle}
          className="flex items-center justify-center h-12 border-t border-sidebar-border text-muted-foreground hover:text-foreground transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </aside>
    </>
  );
}
