import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, TrendingUp, Filter, ShoppingCart,
  Users, Settings, ChevronLeft, ChevronRight, Mountain, Link2, BarChart3, X, Loader2,
  Plus, Globe, Copy, Check, ChevronDown
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSidebarState } from '@/contexts/SidebarContext';
import { useFilters } from '@/contexts/FilterContext';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
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

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createProduto, setCreateProduto] = useState('');
  const [createPaytKey, setCreatePaytKey] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdUrl, setCreatedUrl] = useState('');
  const [copied, setCopied] = useState(false);

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

  const handleCreate = async () => {
    if (!createName || !createProduto) return;
    setCreating(true);
    const { data, error } = await supabase.from('funis').insert({
      nome: createName, produto: createProduto, payt_key: createPaytKey || null, ativo: true,
    }).select('id').single();
    setCreating(false);
    if (error) { toast({ title: 'Erro', description: error.message, variant: 'destructive' }); return; }
    setCreatedUrl(`${WEBHOOK_BASE}${data.id}`);
    loadFunis();
    toast({ title: 'Dashboard criado!' });
  };

  const resetCreate = () => {
    setCreateOpen(false); setCreateName(''); setCreateProduto(''); setCreatePaytKey(''); setCreatedUrl(''); setCopied(false);
  };

  const copyUrl = () => { navigator.clipboard.writeText(createdUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const showLabels = isMobile || !collapsed;

  const DashboardItem = ({ id, label, icon, colorDot, onNav }: {
    id: string | null; label: string; icon?: React.ReactNode; colorDot?: string; onNav?: () => void;
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
              <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", isExpanded ? "rotate-180" : "")} />
            </>
          )}
        </button>

        {/* Sub-pages — only when expanded and labels visible */}
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

          {/* Create button */}
          <button
            onClick={() => setCreateOpen(true)}
            className={cn(
              "flex items-center gap-2 w-full rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors mt-1",
              showLabels ? "px-3 py-2" : "justify-center py-2 px-1"
            )}
            title="Criar Dashboard"
          >
            <Plus className={cn(showLabels ? "h-3.5 w-3.5" : "h-4 w-4")} />
            {showLabels && <span>Criar Dashboard</span>}
          </button>
        </div>
      </div>
    </>
  );

  const CreateModal = () => (
    <Dialog open={createOpen} onOpenChange={(o) => { if (!o) resetCreate(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{createdUrl ? 'Dashboard criado!' : 'Criar Dashboard'}</DialogTitle>
          <DialogDescription>
            {createdUrl ? 'Copie a URL abaixo e cole nas configurações da Payt.' : 'Preencha os dados do novo funil.'}
          </DialogDescription>
        </DialogHeader>
        {!createdUrl ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input placeholder="Ex: Velas Perfeitas" value={createName} onChange={(e) => setCreateName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Produto</Label>
              <Select value={createProduto} onValueChange={setCreateProduto}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="velas">Velas</SelectItem>
                  <SelectItem value="saponaria">Saponaria</SelectItem>
                  <SelectItem value="cosmeticos">Cosméticos</SelectItem>
                  <SelectItem value="hormonal">Hormonal</SelectItem>
                  <SelectItem value="velaroma">Velaroma</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Integration Key da Payt</Label>
              <Input placeholder="Cole a integration_key" value={createPaytKey} onChange={(e) => setCreatePaytKey(e.target.value)} />
            </div>
            <DialogFooter>
              <Button onClick={handleCreate} disabled={creating || !createName || !createProduto}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Criar
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-muted rounded-lg p-3 text-xs font-mono break-all">{createdUrl}</div>
            <Button onClick={copyUrl} className="w-full gap-2">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copiado!' : 'Copiar URL'}
            </Button>
            <Button variant="outline" className="w-full" onClick={resetCreate}>Fechar</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );

  if (isMobile) {
    return (
      <>
        <CreateModal />
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
      <CreateModal />
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
