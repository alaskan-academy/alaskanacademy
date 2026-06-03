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
import { toast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { cn } from '@/lib/utils';
import {
  Plus, Search, Pencil, Trash2, Copy, Check,
  Building2, CreditCard, Crosshair, Globe, MessageCircle,
  BookMarked, Camera, Shield, ChevronDown, ChevronRight,
} from 'lucide-react';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type TipoAtivo   = 'bm' | 'ca' | 'pixel' | 'domain' | 'whatsapp' | 'fanpage' | 'instagram';
type StatusAtivo = 'active' | 'paused' | 'blocked' | 'unknown';

type Ativo = {
  id: string; tipo: TipoAtivo; nome: string; asset_id: string;
  bm_id: string | null; status: StatusAtivo; perfis: string; notas: string;
  criado_em: string; atualizado_em: string;
};

const TIPOS: { value: TipoAtivo; label: string; plural: string; icon: React.ElementType }[] = [
  { value: 'bm',        label: 'Business Manager', plural: 'Business Managers', icon: Building2 },
  { value: 'ca',        label: 'Conta de Anúncio',  plural: 'Contas de Anúncio', icon: CreditCard },
  { value: 'pixel',     label: 'Pixel',             plural: 'Pixels',            icon: Crosshair },
  { value: 'domain',    label: 'Domínio',            plural: 'Domínios',          icon: Globe },
  { value: 'whatsapp',  label: 'WhatsApp API',      plural: 'WhatsApp API',      icon: MessageCircle },
  { value: 'fanpage',   label: 'Fanpage',            plural: 'Fanpages',          icon: BookMarked },
  { value: 'instagram', label: 'Instagram',          plural: 'Instagram',         icon: Camera },
];

const STATUS_CFG: Record<StatusAtivo, { label: string; dot: string; badge: string }> = {
  active:  { label: 'Ativa',        dot: 'bg-emerald-500 shadow-[0_0_5px_theme(colors.emerald.500)]', badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  paused:  { label: 'Pausada',      dot: 'bg-yellow-400 shadow-[0_0_5px_theme(colors.yellow.400)]',   badge: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20' },
  blocked: { label: 'Bloqueada',    dot: 'bg-red-500 shadow-[0_0_5px_theme(colors.red.500)]',          badge: 'bg-red-500/10 text-red-400 border-red-500/20' },
  unknown: { label: 'Desconhecido', dot: 'bg-muted-foreground/50',                                       badge: 'bg-muted text-muted-foreground border-border' },
};

const tipoIcon = (tipo: TipoAtivo) => TIPOS.find(t => t.value === tipo)?.icon ?? Shield;
const tipoLabel = (tipo: TipoAtivo) => TIPOS.find(t => t.value === tipo)?.label ?? tipo;

const blankForm = () => ({
  tipo: 'ca' as TipoAtivo, nome: '', asset_id: '',
  bm_id: '', status: 'active' as StatusAtivo, perfis: '', notas: '',
});

// ─── Copy hook ────────────────────────────────────────────────────────────────

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

// ─── Linha de ativo (lista flat) ─────────────────────────────────────────────

function AtivoRow({ a, bmName, isAdmin, onEdit, onDelete, copied, copy }: {
  a: Ativo; bmName: string;
  isAdmin: boolean; onEdit: () => void; onDelete: () => void;
  copied: string | null; copy: (id: string) => void;
}) {
  const Icon = tipoIcon(a.tipo);
  const st   = STATUS_CFG[a.status];

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors group">
      {/* Ícone + nome */}
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium truncate">{a.nome}</span>
        {a.notas && (
          <span className="ml-2 text-[11px] text-muted-foreground italic truncate hidden sm:inline">{a.notas}</span>
        )}
      </div>

      {/* BM (tela grande) */}
      {bmName && (
        <span className="hidden lg:block text-xs text-muted-foreground truncate max-w-[140px] shrink-0">{bmName}</span>
      )}

      {/* Asset ID — copiar */}
      <button
        onClick={() => copy(a.asset_id)}
        className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
        title="Copiar ID"
      >
        {a.asset_id}
        {copied === a.asset_id
          ? <Check className="h-3 w-3 text-emerald-400" />
          : <Copy className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />}
      </button>

      {/* Status badge */}
      <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 hidden sm:block', st.badge)}>
        {st.label}
      </span>
      <div className={cn('w-2 h-2 rounded-full shrink-0 sm:hidden', st.dot)} />

      {/* Ações (admin) */}
      {isAdmin && (
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onEdit}>
            <Pencil className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive hover:text-destructive" onClick={onDelete}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Seção de BM (agrupada) ───────────────────────────────────────────────────

function BmSection({ bm, children, bmMap, isAdmin, onEdit, onDelete, copied, copy }: {
  bm: Ativo; children: Ativo[]; bmMap: Record<string, string>;
  isAdmin: boolean; onEdit: (a: Ativo) => void; onDelete: (a: Ativo) => void;
  copied: string | null; copy: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);

  // Resumo por tipo
  const summary = useMemo(() => {
    const counts: Partial<Record<TipoAtivo, number>> = {};
    for (const a of children) counts[a.tipo] = (counts[a.tipo] || 0) + 1;
    return Object.entries(counts)
      .map(([tipo, count]) => `${count} ${tipoLabel(tipo as TipoAtivo)}`)
      .join(' · ');
  }, [children]);

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden mb-3">
      {/* Header da BM */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
      >
        <Building2 className="h-4 w-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">{bm.nome}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{summary || 'Nenhum ativo vinculado'}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* ID da BM */}
          <button
            onClick={e => { e.stopPropagation(); copy(bm.asset_id); }}
            className="hidden sm:flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            title="Copiar ID da BM"
          >
            {bm.asset_id}
            {copied === bm.asset_id ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          </button>
          {isAdmin && (
            <div className="flex gap-0.5" onClick={e => e.stopPropagation()}>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => onEdit(bm)}>
                <Pencil className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive hover:text-destructive" onClick={() => onDelete(bm)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          )}
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      {/* Lista de ativos */}
      {open && children.length > 0 && (
        <div className="border-t border-border divide-y divide-border/50">
          {children.map(a => (
            <AtivoRow key={a.id} a={a} bmName=""
              isAdmin={isAdmin} onEdit={() => onEdit(a)} onDelete={() => onDelete(a)}
              copied={copied} copy={copy} />
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

  const [ativos, setAtivos]     = useState<Ativo[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [bmFilter, setBmFilter] = useState('all');
  const [tipoFilter, setTipoFilter] = useState<TipoAtivo | 'all'>('all');
  const [view, setView]         = useState<'bm' | 'lista'>('bm');

  const [open, setOpen]           = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm]           = useState(blankForm());
  const [saving, setSaving]       = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('meta_ativos').select('*').order('tipo').order('nome');
    if (error) toast({ title: 'Erro ao carregar', description: error.message, variant: 'destructive' });
    setAtivos(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const bms    = useMemo(() => ativos.filter(a => a.tipo === 'bm'), [ativos]);
  const bmMap  = useMemo(() => Object.fromEntries(bms.map(b => [b.asset_id, b.nome])), [bms]);

  const filtered = useMemo(() => {
    let list = view === 'lista' ? ativos.filter(a => a.tipo !== 'bm') : ativos;
    if (bmFilter !== 'all') list = list.filter(a => a.bm_id === bmFilter || a.asset_id === bmFilter);
    if (tipoFilter !== 'all') list = list.filter(a => a.tipo === tipoFilter);
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
  }, [ativos, bmFilter, tipoFilter, tipoFilter, search, view]);

  // Stats
  const total   = ativos.length;
  const ativos_ = ativos.filter(a => a.status === 'active').length;
  const bloq    = ativos.filter(a => a.status === 'blocked').length;

  // CRUD
  const openNew  = (tipo?: TipoAtivo) => { setEditingId(null); setForm({ ...blankForm(), tipo: tipo || 'ca' }); setOpen(true); };
  const openEdit = (a: Ativo) => {
    setEditingId(a.id);
    setForm({ tipo: a.tipo, nome: a.nome, asset_id: a.asset_id, bm_id: a.bm_id || '', status: a.status, perfis: a.perfis, notas: a.notas });
    setOpen(true);
  };

  const save = async () => {
    if (!form.nome.trim())     return toast({ title: 'Nome obrigatório',         variant: 'destructive' });
    if (!form.asset_id.trim()) return toast({ title: 'ID do ativo obrigatório',  variant: 'destructive' });
    setSaving(true);
    const payload = {
      tipo: form.tipo, nome: form.nome.trim(), asset_id: form.asset_id.trim(),
      bm_id: form.bm_id.trim() || null, status: form.status,
      perfis: form.perfis.trim(), notas: form.notas.trim(),
      atualizado_em: new Date().toISOString(),
    };
    const { error } = editingId
      ? await supabase.from('meta_ativos').update(payload).eq('id', editingId)
      : await supabase.from('meta_ativos').insert(payload);
    setSaving(false);
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    toast({ title: editingId ? 'Ativo atualizado' : 'Ativo adicionado' });
    setOpen(false); load();
  };

  const remove = async (a: Ativo) => {
    if (!(await confirm({ title: `Excluir "${a.nome}"?`, description: 'Esta ação não pode ser desfeita.' }))) return;
    const { error } = await supabase.from('meta_ativos').delete().eq('id', a.id);
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    toast({ title: 'Ativo excluído' });
    load();
  };

  return (
    <DashboardLayout title="Ativos Meta Ads">

      {/* ── Barra superior ── */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {/* Stats inline */}
        <div className="flex items-center gap-3 text-sm">
          <span className="font-semibold text-foreground">{total} ativos</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-emerald-400 font-medium">{ativos_} ativos</span>
          {bloq > 0 && <>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-red-400 font-medium">{bloq} bloqueados</span>
          </>}
        </div>

        <div className="flex-1" />

        {/* View toggle */}
        <div className="flex items-center bg-secondary border border-border rounded-lg p-0.5 text-xs">
          <button onClick={() => setView('bm')}
            className={cn('px-3 py-1 rounded-md font-medium transition-colors',
              view === 'bm' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
            Por BM
          </button>
          <button onClick={() => setView('lista')}
            className={cn('px-3 py-1 rounded-md font-medium transition-colors',
              view === 'lista' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
            Lista
          </button>
        </div>

        {isAdmin && (
          <Button size="sm" onClick={() => openNew()}>
            <Plus className="h-4 w-4 mr-1" /> Novo ativo
          </Button>
        )}
      </div>

      {/* ── Filtros ── */}
      <div className="flex flex-wrap gap-2 mb-5">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Buscar por nome, ID ou nota..."
            value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-sm" />
        </div>
        <Select value={bmFilter} onValueChange={setBmFilter}>
          <SelectTrigger className="w-52 h-8 text-sm"><SelectValue placeholder="Todas as BMs" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as BMs</SelectItem>
            {bms.map(b => <SelectItem key={b.asset_id} value={b.asset_id}>{b.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        {view === 'lista' && (
          <Select value={tipoFilter} onValueChange={v => setTipoFilter(v as TipoAtivo | 'all')}>
            <SelectTrigger className="w-44 h-8 text-sm"><SelectValue placeholder="Todos os tipos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              {TIPOS.filter(t => t.value !== 'bm').map(t => (
                <SelectItem key={t.value} value={t.value}>{t.plural}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* ── Conteúdo ── */}
      {loading ? (
        <div className="text-center py-16 text-sm text-muted-foreground">Carregando...</div>
      ) : view === 'bm' ? (

        /* ── Visão Por BM ── */
        <div>
          {bms
            .filter(bm => bmFilter === 'all' || bm.asset_id === bmFilter)
            .map(bm => {
              const children = filtered.filter(a => a.bm_id === bm.asset_id && a.tipo !== 'bm');
              if (search && children.length === 0 && !bm.nome.toLowerCase().includes(search.toLowerCase())) return null;
              return (
                <BmSection key={bm.id} bm={bm} children={children} bmMap={bmMap}
                  isAdmin={isAdmin} onEdit={openEdit} onDelete={remove}
                  copied={copied} copy={copy} />
              );
            })}
        </div>

      ) : (

        /* ── Visão Lista agrupada por tipo ── */
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {/* Cabeçalho */}
          <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/30">
            <div className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nome</div>
            <div className="hidden lg:block w-[140px] text-xs font-semibold uppercase tracking-wide text-muted-foreground">BM</div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">ID do ativo</div>
            <div className="hidden sm:block w-20 text-xs font-semibold uppercase tracking-wide text-muted-foreground text-right">Status</div>
            {isAdmin && <div className="w-14" />}
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">Nenhum ativo encontrado.</div>
          ) : tipoFilter !== 'all' ? (
            /* Filtrado por tipo — lista simples */
            <div className="divide-y divide-border/50">
              {filtered.map(a => (
                <AtivoRow key={a.id} a={a} bmName={bmMap[a.bm_id || ''] || ''}
                  isAdmin={isAdmin} onEdit={() => openEdit(a)} onDelete={() => remove(a)}
                  copied={copied} copy={copy} />
              ))}
            </div>
          ) : (
            /* Sem filtro de tipo — agrupa por categoria com separador sutil */
            <>
              {TIPOS.filter(t => t.value !== 'bm').map(t => {
                const grupo = filtered.filter(a => a.tipo === t.value);
                if (grupo.length === 0) return null;
                return (
                  <div key={t.value}>
                    {/* Separador de tipo */}
                    <div className="flex items-center gap-2 px-4 py-1.5 bg-muted/20 border-t border-border/60">
                      <t.icon className="h-3 w-3 text-muted-foreground/70" />
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                        {t.plural}
                      </span>
                      <span className="text-[10px] text-muted-foreground/50 ml-1">{grupo.length}</span>
                    </div>
                    <div className="divide-y divide-border/40">
                      {grupo.map(a => (
                        <AtivoRow key={a.id} a={a} bmName={bmMap[a.bm_id || ''] || ''}
                          isAdmin={isAdmin} onEdit={() => openEdit(a)} onDelete={() => remove(a)}
                          copied={copied} copy={copy} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

      )}

      {/* ── Dialog criar/editar ── */}
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
                className="mt-1 font-mono text-sm" placeholder="Ex: 474062128831453" />
            </div>
            {form.tipo !== 'bm' && (
              <div>
                <Label>BM responsável</Label>
                <Select value={form.bm_id || 'none'} onValueChange={v => setForm({ ...form, bm_id: v === 'none' ? '' : v })}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione a BM..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— sem BM —</SelectItem>
                    {bms.map(b => <SelectItem key={b.asset_id} value={b.asset_id}>{b.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Perfis conectados <span className="text-xs text-muted-foreground">(separados por vírgula)</span></Label>
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
