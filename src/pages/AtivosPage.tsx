import { useEffect, useState, useMemo } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { cn } from '@/lib/utils';
import {
  Plus, Search, Pencil, Trash2, Copy, Check,
  Building2, CreditCard, Crosshair, Globe, MessageCircle,
  BookMarked, Camera, Shield,
} from 'lucide-react';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Ativo = {
  id: string;
  tipo: TipoAtivo;
  nome: string;
  asset_id: string;
  bm_id: string | null;
  status: StatusAtivo;
  perfis: string;
  notas: string;
  criado_em: string;
  atualizado_em: string;
};

type TipoAtivo   = 'bm' | 'ca' | 'pixel' | 'domain' | 'whatsapp' | 'fanpage' | 'instagram';
type StatusAtivo = 'active' | 'paused' | 'blocked' | 'unknown';

const TIPOS: { value: TipoAtivo; label: string; plural: string; icon: React.ElementType }[] = [
  { value: 'bm',        label: 'Business Manager', plural: 'Business Managers', icon: Building2 },
  { value: 'ca',        label: 'Conta de Anúncio',  plural: 'Contas de Anúncio', icon: CreditCard },
  { value: 'pixel',     label: 'Pixel',             plural: 'Pixels',            icon: Crosshair },
  { value: 'domain',    label: 'Domínio',            plural: 'Domínios',          icon: Globe },
  { value: 'whatsapp',  label: 'WhatsApp API',      plural: 'WhatsApp API',      icon: MessageCircle },
  { value: 'fanpage',   label: 'Fanpage',            plural: 'Fanpages',          icon: BookMarked },
  { value: 'instagram', label: 'Instagram',          plural: 'Instagram',         icon: Camera },
];

const STATUS_CFG: Record<StatusAtivo, { label: string; dot: string; text: string }> = {
  active:  { label: 'Ativa',         dot: 'bg-emerald-500 shadow-[0_0_6px_theme(colors.emerald.500)]', text: 'text-emerald-400' },
  paused:  { label: 'Pausada',       dot: 'bg-yellow-400 shadow-[0_0_6px_theme(colors.yellow.400)]',  text: 'text-yellow-400' },
  blocked: { label: 'Bloqueada',     dot: 'bg-red-500 shadow-[0_0_6px_theme(colors.red.500)]',         text: 'text-red-400' },
  unknown: { label: 'Desconhecido',  dot: 'bg-muted-foreground',                                         text: 'text-muted-foreground' },
};

const tipoIcon = (tipo: TipoAtivo) => TIPOS.find(t => t.value === tipo)?.icon ?? Shield;

const blankForm = () => ({
  tipo:     'ca' as TipoAtivo,
  nome:     '',
  asset_id: '',
  bm_id:    '',
  status:   'active' as StatusAtivo,
  perfis:   '',
  notas:    '',
});

// ─── Copy ID hook ─────────────────────────────────────────────────────────────

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (id: string) => {
    navigator.clipboard.writeText(id).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1800);
    });
  };
  return { copied, copy };
}

// ─── Asset Card ───────────────────────────────────────────────────────────────

function AtivoCard({ a, isAdmin, onEdit, onDelete, copied, copy }: {
  a: Ativo; isAdmin: boolean;
  onEdit: () => void; onDelete: () => void;
  copied: string | null; copy: (id: string) => void;
}) {
  const Icon  = tipoIcon(a.tipo);
  const st    = STATUS_CFG[a.status];
  const perfis = (a.perfis || '').split(',').map(p => p.trim()).filter(Boolean);

  return (
    <div className="bg-card border border-border rounded-lg p-4 hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-semibold truncate">{a.nome}</span>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-1 shrink-0">
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Asset ID — clicável para copiar */}
      <button
        onClick={() => copy(a.asset_id)}
        className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 mb-2 rounded-md border border-border bg-secondary/50 hover:border-primary/40 hover:bg-secondary transition-colors text-left"
        title="Clique para copiar ID"
      >
        <span className="font-mono text-[11px] text-muted-foreground truncate">{a.asset_id}</span>
        {copied === a.asset_id
          ? <Check className="h-3 w-3 text-emerald-400 shrink-0" />
          : <Copy className="h-3 w-3 text-muted-foreground/50 shrink-0" />}
      </button>

      {/* Status */}
      <div className="flex items-center gap-2 mb-2">
        <div className={cn('w-2 h-2 rounded-full shrink-0', st.dot)} />
        <span className={cn('text-xs font-semibold', st.text)}>{st.label}</span>
        {a.bm_id && a.tipo !== 'bm' && (
          <span className="ml-auto text-[10px] text-muted-foreground font-mono">···{a.bm_id.slice(-6)}</span>
        )}
      </div>

      {/* Perfis */}
      {perfis.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {perfis.map(p => (
            <span key={p} className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded border border-primary/20">
              {p}
            </span>
          ))}
        </div>
      )}

      {/* Notas */}
      {a.notas && (
        <p className="text-[11px] text-muted-foreground leading-relaxed border-l-2 border-border pl-2 mt-1">
          {a.notas}
        </p>
      )}
    </div>
  );
}

// ─── BM Group (Visão Geral) ───────────────────────────────────────────────────

function BmGroup({ bm, children, copied, copy }: {
  bm: Ativo; children: Ativo[];
  copied: string | null; copy: (id: string) => void;
}) {
  const st = STATUS_CFG[bm.status];
  return (
    <div className="bg-card border border-primary/20 rounded-lg p-4 mb-4">
      <div className="flex items-center gap-3 mb-3 pb-3 border-b border-border/60">
        <Building2 className="h-5 w-5 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">{bm.nome}</div>
          <button
            onClick={() => copy(bm.asset_id)}
            className="flex items-center gap-1 mt-0.5 font-mono text-[11px] text-primary/70 hover:text-primary transition-colors"
            title="Clique para copiar ID da BM"
          >
            {bm.asset_id}
            {copied === bm.asset_id ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
          </button>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className={cn('w-2 h-2 rounded-full', st.dot)} />
          <span className="text-xs text-muted-foreground">{children.length} ativo{children.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
      {bm.notas && (
        <p className="text-xs text-muted-foreground mb-3 italic">{bm.notas}</p>
      )}
      {children.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {children.map(a => (
            <AtivoCard key={a.id} a={a} isAdmin={false} onEdit={() => {}} onDelete={() => {}} copied={copied} copy={copy} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function AtivosPage() {
  const { perfil } = useAuth();
  const isAdmin = perfil?.is_admin ?? false;
  const confirm = useConfirm();
  const { copied, copy } = useCopy();

  const [ativos, setAtivos]   = useState<Ativo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [bmFilter, setBmFilter] = useState('all');

  const [open, setOpen]           = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm]           = useState(blankForm());
  const [saving, setSaving]       = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('meta_ativos').select('*').order('tipo').order('nome');
    if (error) toast({ title: 'Erro ao carregar ativos', description: error.message, variant: 'destructive' });
    setAtivos(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // ── Filtro ────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = ativos;
    if (bmFilter !== 'all') list = list.filter(a => a.bm_id === bmFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(a =>
        a.nome.toLowerCase().includes(q) ||
        a.asset_id.includes(q) ||
        a.notas.toLowerCase().includes(q) ||
        a.perfis.toLowerCase().includes(q)
      );
    }
    return list;
  }, [ativos, search, bmFilter]);

  const bms = useMemo(() => ativos.filter(a => a.tipo === 'bm'), [ativos]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:   ativos.length,
    ativos:  ativos.filter(a => a.status === 'active').length,
    bloq:    ativos.filter(a => a.status === 'blocked').length,
    bm:      ativos.filter(a => a.tipo === 'bm').length,
    ca:      ativos.filter(a => a.tipo === 'ca').length,
    pixel:   ativos.filter(a => a.tipo === 'pixel').length,
    domain:  ativos.filter(a => a.tipo === 'domain').length,
  }), [ativos]);

  // ── CRUD ──────────────────────────────────────────────────────────────────
  const openNew = () => { setEditingId(null); setForm(blankForm()); setOpen(true); };
  const openEdit = (a: Ativo) => {
    setEditingId(a.id);
    setForm({ tipo: a.tipo, nome: a.nome, asset_id: a.asset_id, bm_id: a.bm_id || '', status: a.status, perfis: a.perfis, notas: a.notas });
    setOpen(true);
  };

  const save = async () => {
    if (!form.nome.trim()) return toast({ title: 'Nome obrigatório', variant: 'destructive' });
    if (!form.asset_id.trim()) return toast({ title: 'ID do ativo obrigatório', variant: 'destructive' });
    setSaving(true);
    const payload = {
      tipo:     form.tipo,
      nome:     form.nome.trim(),
      asset_id: form.asset_id.trim(),
      bm_id:    form.bm_id.trim() || null,
      status:   form.status,
      perfis:   form.perfis.trim(),
      notas:    form.notas.trim(),
      atualizado_em: new Date().toISOString(),
    };
    const { error } = editingId
      ? await supabase.from('meta_ativos').update(payload).eq('id', editingId)
      : await supabase.from('meta_ativos').insert(payload);
    setSaving(false);
    if (error) return toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
    toast({ title: editingId ? 'Ativo atualizado' : 'Ativo adicionado' });
    setOpen(false);
    load();
  };

  const remove = async (a: Ativo) => {
    if (!(await confirm({ title: `Excluir "${a.nome}"?`, description: 'Esta ação não pode ser desfeita.' }))) return;
    const { error } = await supabase.from('meta_ativos').delete().eq('id', a.id);
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    toast({ title: 'Ativo excluído' });
    load();
  };

  // ── Render grid de cards ──────────────────────────────────────────────────
  const renderGrid = (list: Ativo[]) => (
    list.length === 0
      ? <p className="text-sm text-muted-foreground py-8 text-center">Nenhum ativo encontrado.</p>
      : <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {list.map(a => (
            <AtivoCard key={a.id} a={a} isAdmin={isAdmin}
              onEdit={() => openEdit(a)} onDelete={() => remove(a)}
              copied={copied} copy={copy} />
          ))}
        </div>
  );

  // ── Visão Geral — agrupada por BM ─────────────────────────────────────────
  const renderOverview = () => (
    <div>
      {bms.map(bm => {
        if (bmFilter !== 'all' && bm.asset_id !== bmFilter) return null;
        const children = filtered.filter(a => a.bm_id === bm.asset_id && a.tipo !== 'bm');
        if (search && children.length === 0 && !bm.nome.toLowerCase().includes(search.toLowerCase())) return null;
        return <BmGroup key={bm.id} bm={bm} children={children} copied={copied} copy={copy} />;
      })}
    </div>
  );

  return (
    <DashboardLayout title="Ativos Meta Ads">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-muted-foreground">Inventário de ativos da empresa no Meta Ads Manager</p>
        {isAdmin && (
          <Button onClick={openNew} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Novo ativo
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-6">
        {[
          { label: 'Total',     value: stats.total,  color: '' },
          { label: 'Ativos',    value: stats.ativos, color: 'text-emerald-400' },
          { label: 'Bloq.',     value: stats.bloq,   color: stats.bloq > 0 ? 'text-red-400' : '' },
          { label: 'BMs',       value: stats.bm,     color: 'text-primary' },
          { label: 'CAs',       value: stats.ca,     color: '' },
          { label: 'Pixels',    value: stats.pixel,  color: '' },
          { label: 'Domínios',  value: stats.domain, color: '' },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-lg px-3 py-2.5 text-center">
            <div className={cn('text-xl font-bold tabular-nums', s.color || 'text-foreground')}>{s.value}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 mb-5">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Buscar por nome, ID ou nota..." value={search}
            onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-sm" />
        </div>
        <Select value={bmFilter} onValueChange={setBmFilter}>
          <SelectTrigger className="w-56 h-8 text-sm"><SelectValue placeholder="Todas as BMs" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as BMs</SelectItem>
            {bms.map(bm => <SelectItem key={bm.asset_id} value={bm.asset_id}>{bm.nome}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Tabs */}
      {loading ? (
        <div className="text-center py-16 text-muted-foreground text-sm">Carregando...</div>
      ) : (
        <Tabs defaultValue="all">
          <TabsList className="bg-secondary border border-border mb-5 flex-wrap h-auto">
            <TabsTrigger value="all"       className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Visão Geral</TabsTrigger>
            {TIPOS.map(t => (
              <TabsTrigger key={t.value} value={t.value} className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                <t.icon className="h-3.5 w-3.5 mr-1" />{t.plural}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="all">{renderOverview()}</TabsContent>
          {TIPOS.map(t => (
            <TabsContent key={t.value} value={t.value}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-primary flex items-center gap-2">
                  <t.icon className="h-4 w-4" />{t.plural}
                  <span className="bg-primary/15 text-primary text-xs px-2 py-0.5 rounded-full font-bold">
                    {filtered.filter(a => a.tipo === t.value).length}
                  </span>
                </h3>
                {isAdmin && (
                  <Button size="sm" variant="outline" onClick={() => { setForm({ ...blankForm(), tipo: t.value }); setEditingId(null); setOpen(true); }}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Novo {t.label}
                  </Button>
                )}
              </div>
              {renderGrid(filtered.filter(a => a.tipo === t.value))}
            </TabsContent>
          ))}
        </Tabs>
      )}

      {/* Dialog criar/editar */}
      <Dialog open={open} onOpenChange={v => !v && setOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar ativo' : 'Novo ativo'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tipo <span className="text-destructive">*</span></Label>
                <Select value={form.tipo} onValueChange={v => setForm({ ...form, tipo: v as TipoAtivo })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIPOS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm({ ...form, status: v as StatusAtivo })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Ativa</SelectItem>
                    <SelectItem value="paused">Pausada</SelectItem>
                    <SelectItem value="blocked">Bloqueada</SelectItem>
                    <SelectItem value="unknown">Desconhecido</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Nome <span className="text-destructive">*</span></Label>
              <Input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })}
                className="mt-1" placeholder="Ex: Velas Perfeitas - RMKT" />
            </div>
            <div>
              <Label>ID do ativo <span className="text-destructive">*</span></Label>
              <Input value={form.asset_id} onChange={e => setForm({ ...form, asset_id: e.target.value })}
                className="mt-1 font-mono" placeholder="Ex: 474062128831453" />
            </div>
            {form.tipo !== 'bm' && (
              <div>
                <Label>BM responsável</Label>
                <Select value={form.bm_id || 'none'} onValueChange={v => setForm({ ...form, bm_id: v === 'none' ? '' : v })}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione a BM..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— sem BM —</SelectItem>
                    {bms.map(bm => <SelectItem key={bm.asset_id} value={bm.asset_id}>{bm.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Perfis / Contas conectadas <span className="text-xs text-muted-foreground">(separados por vírgula)</span></Label>
              <Input value={form.perfis} onChange={e => setForm({ ...form, perfis: e.target.value })}
                className="mt-1" placeholder="Ex: Andressa, Laura Martins" />
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })}
                className="mt-1 min-h-[70px] text-sm" placeholder="Informações adicionais..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Salvando...' : editingId ? 'Salvar' : 'Adicionar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
