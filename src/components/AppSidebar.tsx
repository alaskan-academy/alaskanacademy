import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Home, LayoutDashboard, TrendingUp, Activity, ShoppingCart,
  Users, Settings, ChevronLeft, ChevronRight, Mountain, Link2, BarChart3, X, Loader2, Globe, ChevronDown, LogOut, GraduationCap, Wallet, FlaskConical, KeyRound, Film, PenLine, Layers, Clapperboard, LineChart,
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
  { path: '/vendas',   label: 'Vendas',      icon: ShoppingCart,    key: 'vendas' },
  { path: '/utm',      label: 'UTM'         , icon: Link2,           key: 'utm' },
  { path: '/tendencias', label: 'Tendências', icon: Activity,        key: 'tendencias' },
  { path: '/clientes', label: 'Clientes',    icon: Users,           key: 'clientes' },
];

/**
 * O menu, agrupado pelo MOTIVO de abrir cada tela.
 *
 * Eram doze entradas numa lista chapada, sem separação nenhuma, e a leitura era
 * "informação perdida e jogada" — com razão: Produção, Financeiro e
 * Configurações são coisas de naturezas completamente diferentes, e nada na
 * barra dizia isso.
 *
 * O critério é o motivo de abrir, e não o que a tela tem dentro. Financeiro tem
 * revisão diária dentro, mas quem clica ali está atrás de dinheiro, não de
 * tarefa. E o mapa é o mesmo para todo mundo: o que muda por pessoa é o que ela
 * alcança, não onde as coisas ficam.
 *
 * ESTRUTURA existe porque cadastro não é nem trabalho do dia nem leitura de
 * número: são as três telas que definem COMO as coisas são, abertas de vez em
 * quando. Empurradas para dentro de "Operação" recriariam a bagunça em escala
 * menor, e no rodapé saem do caminho sem sumir.
 *
 * O Início fica fora de qualquer grupo, sozinho no topo: é a porta de entrada
 * de todo mundo, e porta de entrada não pertence a categoria nenhuma.
 */
const GRUPOS = [
  {
    titulo: null,   // Início não tem cabeçalho: é a porta, não uma seção.
    itens: [
      { path: '/', label: 'Início', icon: Home, key: 'inicio', adminOnly: false, sectorOnly: null },
    ],
  },
  {
    titulo: 'Operação',
    itens: [
      { path: '/processos',   label: 'Processos',   icon: GraduationCap, key: 'processos',   adminOnly: false, sectorOnly: null },
      { path: '/producao',    label: 'Produção',    icon: Film,          key: 'producao',    adminOnly: false, sectorOnly: null },
      // Operação para todo mundo, e não um grupo por perfil. A sócia abre para
      // avaliar criativo e conferir NF; o editor abre para ver a performance
      // dele e lançar a NF dele. Os motivos são diferentes, mas os dois têm
      // tarefa dentro — e um menu igual para todos é mais fácil de explicar do
      // que um item que muda de lugar conforme quem olha.
      { path: '/editores',    label: 'Editores',    icon: BarChart3,     key: 'editores',    adminOnly: false, sectorOnly: null },
      { path: '/copywriters', label: 'Copywriters', icon: PenLine,       key: 'copywriters', adminOnly: false, sectorOnly: 'Copy' },
      { path: '/laboratorio', label: 'Laboratório', icon: FlaskConical,  key: 'laboratorio', adminOnly: false, sectorOnly: null },
    ],
  },
  {
    titulo: 'Dados',
    itens: [
      { path: '/analises',   label: 'Análises',   icon: LineChart,    key: 'analises',   adminOnly: true,  sectorOnly: null },
      // Dado sobre a operação, e só sócio alcança: Desempenho e Por Projeto são
      // leitura, e a Avaliação que escreve é o julgamento de quem já veio ler.
      { path: '/criativos',  label: 'Criativos',  icon: Clapperboard, key: 'criativos',  adminOnly: true,  sectorOnly: null },
      { path: '/financeiro', label: 'Financeiro', icon: Wallet,    key: 'financeiro', adminOnly: false, sectorOnly: null },
    ],
  },
  {
    titulo: 'Estrutura',
    itens: [
      { path: '/funis-gestao',  label: 'Funis',         icon: Layers,   key: 'funis-gestao',  adminOnly: false, sectorOnly: null },
      { path: '/acessos',       label: 'Acessos',       icon: KeyRound, key: 'acessos',       adminOnly: false, sectorOnly: null },
      { path: '/configuracoes', label: 'Configurações', icon: Settings, key: 'configuracoes', adminOnly: true,  sectorOnly: null },
    ],
  },
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

  const subPages = ALL_SUB_PAGES.filter(p => canAccess(p.key));

  /**
   * O que cada pessoa alcança. O GRUPO é o mesmo para todo mundo.
   *
   * Cheguei a fazer o item mudar de grupo conforme o perfil — Editores em
   * Operação para a sócia e em Dados para o editor, já que os dois abrem por
   * motivos diferentes. Ela cortou, e com razão: os dois têm tarefa lá dentro
   * (ela confere as notas fiscais, ele lança a dele), e um menu igual para
   * todos é mais fácil de explicar do que um item que muda de lugar conforme
   * quem olha.
   *
   * A permissão continua por pessoa; o mapa, não.
   */
  const podeVer = (p: { adminOnly: boolean; sectorOnly: string | null; key: string }) => {
    if (p.adminOnly) return perfil?.is_admin;
    if (p.sectorOnly) return perfil?.is_admin || perfil?.setor?.nome === p.sectorOnly;
    return canAccess(p.key);
  };

  // Grupo que ficou sem nenhum item permitido some inteiro, cabeçalho junto:
  // um título de seção com nada embaixo é pior que a seção não existir.
  const grupos = GRUPOS
    .map(g => ({ ...g, itens: g.itens.filter(podeVer) }))
    .filter(g => g.itens.length > 0);

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
      {/* Os grupos, na ordem em que o dia acontece: fazer, ler, configurar.
          `flex-1` aqui é o que empurra o rodapé para o fim da barra, e a
          rolagem vive nele porque agora é este bloco que pode passar da tela. */}
      <div className={cn("flex-1 overflow-y-auto py-2", showLabels ? "px-3" : "px-2")}>
        {grupos.map((grupo, i) => (
          <div key={grupo.titulo ?? 'inicio'} className={cn(i > 0 && 'mt-3')}>
            {/* Recolhida, a barra fica só com ícones: um título de seção ali
                viraria três letras cortadas. O espaçamento entre grupos
                continua separando, e é o suficiente sem os rótulos. */}
            {showLabels && grupo.titulo && (
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1 px-3">
                {grupo.titulo}
              </div>
            )}
            {grupo.itens.map((item) => {
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

            {/* O seletor de funil mora DENTRO de Dados, e não num grupo
                "Dashboards" à parte: as sete sub-páginas são dados por funil,
                exatamente como Análises e Financeiro são dados. Separá-las
                sugeria que fossem outra coisa.

                Some inteiro para quem não alcança nenhuma sub-página — na
                prática só sócio e admin. Antes aparecia para os outros como um
                bloco que abria e não tinha nada dentro. */}
            {grupo.titulo === 'Dados' && subPages.length > 0 && (
              <div className="mt-0.5">
                <DashboardItem label="Geral" icon={<Globe className="h-4 w-4 shrink-0" />} onNav={onNav} />
              </div>
            )}
          </div>
        ))}
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
          {/* `border-border` e nao `border-sidebar-border`: esta linha ENCOSTA na do
              cabecalho principal, e os dois tons (36,36,36 contra 41,41,41)
              faziam um degrau visivel no meio do topo da tela. As outras linhas
              da sidebar continuam com o tom dela. */}
          <div className="flex items-center justify-between px-4 h-14 border-b border-border">
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
        <div className="flex items-center gap-2 px-4 h-14 border-b border-border">
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
