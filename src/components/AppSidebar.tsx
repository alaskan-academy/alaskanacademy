import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Home, LayoutDashboard, TrendingUp, Activity, Filter, ShoppingCart,
  Users, Settings, ChevronLeft, ChevronRight, Mountain, Link2, BarChart3, X, Loader2, Globe, ChevronDown, LogOut, GraduationCap, Wallet, FlaskConical, KeyRound, Film, PenLine, Layers, Clapperboard,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSidebarState } from '@/contexts/SidebarContext';
import { useFilters } from '@/contexts/FilterContext';
import { useAuth } from '@/contexts/AuthContext';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { NotificacoesPopover } from '@/components/NotificacoesPopover';

const ALL_SUB_PAGES = [
  { path: '/resumo',   label: 'Resumo',      icon: LayoutDashboard, key: 'overview' },
  { path: '/meta-ads', label: 'Meta Ads',    icon: TrendingUp,      key: 'meta-ads' },
  { path: '/funil',    label: 'Funil',       icon: Filter,          key: 'funil' },
  { path: '/vendas',   label: 'Vendas',      icon: ShoppingCart,    key: 'vendas' },
  { path: '/utm',      label: 'Análise UTM', icon: Link2,           key: 'utm' },
  { path: '/tendencias', label: 'Tendências', icon: Activity,        key: 'tendencias' },
  { path: '/clientes', label: 'Clientes',    icon: Users,           key: 'clientes' },
];

const ALL_FIXED_ITEMS = [
  // O Início é a porta de entrada de todo mundo, então mora na lista achatada e
  // não dentro do seletor de dashboards — aquele grupo é do funil e só sócio vê.
  { path: '/',              label: 'Início',        icon: Home,          key: 'inicio',       adminOnly: false, sectorOnly: null },
  { path: '/processos',     label: 'Processos',     icon: GraduationCap, key: 'processos',    adminOnly: false, sectorOnly: null },
  { path: '/laboratorio',   label: 'Laboratório',   icon: FlaskConical,  key: 'laboratorio',  adminOnly: false, sectorOnly: null },
  { path: '/acessos',       label: 'Acessos',       icon: KeyRound,      key: 'acessos',      adminOnly: false, sectorOnly: null },
  { path: '/editores',      label: 'Editores',      icon: BarChart3,     key: 'editores',     adminOnly: false, sectorOnly: null },
  { path: '/copywriters',   label: 'Copywriters',   icon: PenLine,       key: 'copywriters',  adminOnly: false, sectorOnly: 'Copy' },
  { path: '/producao',      label: 'Produção',      icon: Film,          key: 'producao',     adminOnly: false, sectorOnly: null },
  { path: '/criativos',     label: 'Criativos',     icon: Clapperboard,  key: 'criativos',    adminOnly: true,  sectorOnly: null },
  { path: '/funis-gestao',  label: 'Funis',         icon: Layers,        key: 'funis-gestao', adminOnly: false, sectorOnly: null },
  { path: '/financeiro',    label: 'Financeiro',    icon: Wallet,        key: 'financeiro',   adminOnly: false, sectorOnly: null },
  { path: '/configuracoes', label: 'Configurações', icon: Settings,      key: 'configuracoes', adminOnly: true, sectorOnly: null  },
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
  const { user, canAccess, perfil, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const subPages   = ALL_SUB_PAGES.filter(p => canAccess(p.key));
  const fixedItems = ALL_FIXED_ITEMS.filter(p => {
    if (p.adminOnly) return perfil?.is_admin;
    if (p.sectorOnly) return perfil?.is_admin || perfil?.setor?.nome === p.sectorOnly;
    return canAccess(p.key);
  });

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  /**
   * A sidebar tem um dashboard só.
   *
   * Antes ela listava a tabela `funis` — 22 linhas todas inativas, então na prática
   * só "Geral" aparecia. O recorte por conta de anúncio virou filtro no cabeçalho,
   * junto do período, porque é lá que ele pertence: é um recorte da visão, não uma
   * visão diferente. E o filtro só oferece conta que gastou no período escolhido,
   * em vez de despejar as quinze.
   */
  const [geralAberto, setGeralAberto] = useState(true);


  const showLabels = isMobile || !collapsed;

  const DashboardItem = ({ label, icon, onNav }: {
    label: string; icon?: React.ReactNode; onNav?: () => void;
  }) => {
    const isExpanded = geralAberto;

    return (
      <div>
        <button
          onClick={() => setGeralAberto(v => !v)}
          className={cn(
            "flex items-center gap-2.5 w-full rounded-md text-sm transition-colors",
            showLabels ? "px-3 py-2" : "justify-center py-2 px-1",
            "bg-primary/15 text-primary font-medium",
          )}
        >
          {icon}
          {showLabels && (
            <>
              <span className="truncate flex-1 text-left">{label}</span>
              <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", isExpanded ? "rotate-180" : "")} />
            </>
          )}
        </button>

        {/* Sub-páginas — só quando aberto e com rótulos visíveis */}
        {isExpanded && showLabels && (
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
          const isActive = item.path === '/financeiro'
            ? location.pathname.startsWith('/financeiro')
            : location.pathname === item.path;
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

      {/* Dashboards — some inteiro para quem não alcança nenhuma sub-página.
          Na prática hoje isso é "só sócio e admin": as três pessoas não-admin não
          têm nenhuma das páginas de dashboard liberada, e o grupo aparecia para
          elas como um bloco que abria e não tinha nada dentro. A condição olha o
          que a pessoa alcança em vez de checar `is_admin`, para que liberar
          Vendas a alguém no Acessos volte a mostrar o grupo sozinho. */}
      {subPages.length > 0 && (
      <div className={cn("py-2 flex-1 overflow-y-auto", showLabels ? "px-3" : "px-2")}>
        {showLabels && (
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2 px-1">
            Dashboards
          </div>
        )}

        <div className="space-y-0.5">
          <DashboardItem label="Geral" icon={<Globe className="h-4 w-4 shrink-0" />} onNav={onNav} />
        </div>
      </div>
      )}

      {/* Era o bloco acima, com `flex-1`, que empurrava o rodapé (nome, sino e
          sair) para o fim da barra. Escondendo o bloco para quem não é sócio, o
          rodapé subia e ficava colado no último item do menu. Este espaçador
          repõe o esticamento só quando o bloco não existe — quem é sócio
          continua com o comportamento de antes, inclusive a rolagem do grupo. */}
      {subPages.length === 0 && <div className="flex-1" />}
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
          <div className="border-t border-sidebar-border flex items-center gap-2 px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{perfil?.nome}</p>
              {perfil?.is_admin && <p className="text-[10px] text-muted-foreground">Admin</p>}
            </div>
            {user && <NotificacoesPopover userId={user.id} collapsed={false} />}
            <button onClick={handleSignOut} title="Sair" className="text-muted-foreground hover:text-foreground p-1 rounded">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
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
        {/* Usuário + logout */}
        <div className={cn(
          "border-t border-sidebar-border flex items-center gap-2 px-3 py-2",
          collapsed ? "justify-center flex-col" : "",
        )}>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{perfil?.nome}</p>
              {perfil?.is_admin && <p className="text-[10px] text-muted-foreground">Admin</p>}
            </div>
          )}
          {user && (
            <NotificacoesPopover userId={user.id} collapsed={collapsed} />
          )}
          <button
            onClick={handleSignOut}
            title="Sair"
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        <button
          onClick={toggle}
          className="flex items-center justify-center h-10 border-t border-sidebar-border text-muted-foreground hover:text-foreground transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </aside>
    </>
  );
}
