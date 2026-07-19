import { useEffect, useState, useMemo, useRef } from 'react';
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
  Search, Eye, EyeOff, Copy, Check, ExternalLink,
  Plus, Pencil, Trash2, ChevronDown, ChevronRight, Settings2, X,
} from 'lucide-react';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Acesso = {
  id: string;
  ferramenta: string;
  setor: string;
  url: string | null;
  login: string | null;
  senha: string | null;
  status: 'ativo' | 'inativo';
  notas: string | null;
};

// ─── Constantes ───────────────────────────────────────────────────────────────

const SETORES_DEFAULT = [
  'Administrativo', 'Automação', 'Área de Membros', 'Banco de Dados',
  'Construtor IA', 'Cursos e Formações', 'Edição', 'Pesquisa',
];

const SETOR_DOT: Record<string, string> = {
  'Administrativo':    'bg-blue-400',
  'Edição':            'bg-yellow-400',
  'Automação':         'bg-red-400',
  'Área de Membros':   'bg-emerald-400',
  'Pesquisa':          'bg-purple-400',
  'Cursos e Formações':'bg-orange-400',
  'Construtor IA':     'bg-pink-400',
  'Banco de Dados':    'bg-slate-400',
};

const CONF_KEY = 'setores_acessos';

const sortSetores = (arr: string[]) => [...arr].sort((a, b) => a.localeCompare(b, 'pt'));

const blankForm = (setor = '') => ({
  ferramenta: '', setor, url: '', login: '',
  senha: '', status: 'ativo' as 'ativo' | 'inativo', notas: '',
});

// ─── CopyBtn ──────────────────────────────────────────────────────────────────

function CopyBtn({ text, className }: { text: string; className?: string }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  return (
    <button
      onClick={copy}
      title="Copiar"
      className={cn('p-1 rounded text-muted-foreground hover:text-foreground transition-colors', className)}
    >
      {done ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// ─── SenhaCell ────────────────────────────────────────────────────────────────

function SenhaCell({ senha }: { senha: string | null }) {
  const [visible, setVisible] = useState(false);
  if (!senha) return <span className="text-muted-foreground/40 text-xs">—</span>;
  return (
    <div className="flex items-center gap-0.5">
      <span className="font-mono text-xs">{visible ? senha : '••••••••'}</span>
      <button
        onClick={() => setVisible(v => !v)}
        title={visible ? 'Ocultar' : 'Revelar'}
        className="ml-1 p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
      >
        {visible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
      </button>
      <CopyBtn text={senha} />
    </div>
  );
}

// ─── AcessoRow ────────────────────────────────────────────────────────────────

function AcessoRow({ a, isAdmin, onEdit, onDelete }: {
  a: Acesso; isAdmin: boolean; onEdit: () => void; onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors group">
      <div className="w-44 shrink-0">
        <span className="text-sm font-medium">{a.ferramenta}</span>
        {a.notas && (
          <p className="text-[11px] text-muted-foreground leading-tight mt-0.5 truncate max-w-[168px]">{a.notas}</p>
        )}
      </div>
      <div className="flex-1 min-w-0 flex items-center gap-0.5">
        {a.login ? (
          <>
            <span className="text-xs text-muted-foreground truncate">{a.login}</span>
            <CopyBtn text={a.login} className="shrink-0" />
          </>
        ) : (
          <span className="text-muted-foreground/40 text-xs">—</span>
        )}
      </div>
      <div className="w-52 shrink-0">
        <SenhaCell senha={a.senha} />
      </div>
      <div className="w-24 shrink-0">
        {a.url ? (
          <a
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Acessar <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <span className="text-muted-foreground/40 text-xs">—</span>
        )}
      </div>
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

// ─── SetorSection ─────────────────────────────────────────────────────────────

function SetorSection({ setor, itens, isAdmin, onEdit, onDelete }: {
  setor: string; itens: Acesso[]; isAdmin: boolean;
  onEdit: (a: Acesso) => void; onDelete: (a: Acesso) => void;
}) {
  const [open, setOpen] = useState(true);
  const dot = SETOR_DOT[setor] || 'bg-muted-foreground/40';

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden mb-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
      >
        <div className={cn('w-2.5 h-2.5 rounded-full shrink-0', dot)} />
        <span className="font-semibold text-sm flex-1">{setor}</span>
        <span className="text-xs text-muted-foreground mr-2">
          {itens.length} ferramenta{itens.length !== 1 ? 's' : ''}
        </span>
        {open
          ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
          : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <>
          <div className="flex items-center gap-3 px-4 py-1.5 border-t border-border bg-muted/20">
            <div className="w-44 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Ferramenta</div>
            <div className="flex-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Login</div>
            <div className="w-52 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Senha</div>
            <div className="w-24 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Link</div>
            {isAdmin && <div className="w-14 shrink-0" />}
          </div>
          <div className="divide-y divide-border/50">
            {itens.map(a => (
              <AcessoRow
                key={a.id}
                a={a}
                isAdmin={isAdmin}
                onEdit={() => onEdit(a)}
                onDelete={() => onDelete(a)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── SetoresPanel (inline dentro do dialog) ───────────────────────────────────

function SetoresPanel({ setores, acessos, onClose, onSave }: {
  setores: string[];
  acessos: Acesso[];
  onClose: () => void;
  onSave: (updated: string[]) => Promise<void>;
}) {
  const confirm = useConfirm();
  const [list, setList]         = useState<string[]>(setores);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editVal, setEditVal]   = useState('');
  const [newNome, setNewNome]   = useState('');
  const [saving, setSaving]     = useState(false);
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingIdx !== null) editRef.current?.focus();
  }, [editingIdx]);

  const usageCount = (nome: string) => acessos.filter(a => a.setor === nome).length;

  const startEdit = (i: number) => {
    setEditingIdx(i);
    setEditVal(list[i]);
  };

  const confirmEdit = async (i: number) => {
    const trimmed = editVal.trim();
    if (!trimmed || trimmed === list[i]) { setEditingIdx(null); return; }
    if (list.some((s, j) => j !== i && s.toLowerCase() === trimmed.toLowerCase())) {
      toast({ title: 'Já existe um setor com esse nome', variant: 'destructive' });
      return;
    }
    const oldName = list[i];
    const updated = sortSetores(list.map((s, j) => j === i ? trimmed : s));
    setSaving(true);
    // Bulk-update acessos that use the old name
    if (usageCount(oldName) > 0) {
      const { error } = await supabase.from('acessos').update({ setor: trimmed }).eq('setor', oldName);
      if (error) {
        toast({ title: 'Erro ao renomear', description: error.message, variant: 'destructive' });
        setSaving(false);
        return;
      }
    }
    await onSave(updated);
    setList(updated);
    setEditingIdx(null);
    setSaving(false);
  };

  const remove = async (i: number) => {
    const nome = list[i];
    const count = usageCount(nome);
    if (count > 0) {
      const ok = await confirm({
        title: `Excluir setor "${nome}"?`,
        description: `${count} ferramenta${count !== 1 ? 's' : ''} usa${count === 1 ? '' : 'm'} este setor. Elas ficarão sem setor definido.`,
      });
      if (!ok) return;
    }
    const updated = list.filter((_, j) => j !== i);
    setSaving(true);
    await onSave(updated);
    setList(updated);
    setSaving(false);
  };

  const add = async () => {
    const trimmed = newNome.trim();
    if (!trimmed) return;
    if (list.some(s => s.toLowerCase() === trimmed.toLowerCase())) {
      toast({ title: 'Setor já existe', variant: 'destructive' });
      return;
    }
    const updated = sortSetores([...list, trimmed]);
    setSaving(true);
    await onSave(updated);
    setList(updated);
    setNewNome('');
    setSaving(false);
  };

  return (
    <div className="flex flex-col gap-0">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold">Gerenciar setores</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Lista */}
      <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
        {list.map((s, i) => (
          <div key={s} className="flex items-center gap-2 group rounded-md px-2 py-1 hover:bg-muted/40">
            {editingIdx === i ? (
              <Input
                ref={editRef}
                value={editVal}
                onChange={e => setEditVal(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') confirmEdit(i);
                  if (e.key === 'Escape') setEditingIdx(null);
                }}
                className="h-6 text-xs flex-1 px-1.5"
                disabled={saving}
              />
            ) : (
              <span className="text-sm flex-1 truncate">{s}</span>
            )}
            <span className="text-[10px] text-muted-foreground/50 shrink-0 tabular-nums">
              {usageCount(s)}
            </span>
            {editingIdx === i ? (
              <button
                onClick={() => confirmEdit(i)}
                disabled={saving}
                className="text-xs text-primary hover:underline shrink-0 disabled:opacity-50"
              >
                Ok
              </button>
            ) : (
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button
                  onClick={() => startEdit(i)}
                  className="p-0.5 rounded text-muted-foreground hover:text-foreground"
                  title="Renomear"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  onClick={() => remove(i)}
                  className="p-0.5 rounded text-muted-foreground hover:text-destructive"
                  title="Excluir"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Novo setor */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
        <Input
          value={newNome}
          onChange={e => setNewNome(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Novo setor..."
          className="h-7 text-xs flex-1"
          disabled={saving}
        />
        <Button size="sm" variant="outline" onClick={add} disabled={saving || !newNome.trim()} className="h-7 px-2 text-xs">
          <Plus className="h-3 w-3 mr-1" /> Adicionar
        </Button>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function AcessosPage() {
  const { perfil } = useAuth();
  const isAdmin = perfil?.is_admin ?? false;
  const confirm = useConfirm();

  const [acessos, setAcessos]           = useState<Acesso[]>([]);
  const [loading, setLoading]           = useState(true);
  const [search, setSearch]             = useState('');
  const [setorFilter, setSetorFilter]   = useState('todos');
  const [showInativos, setShowInativos] = useState(false);

  const [open, setOpen]             = useState(false);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [form, setForm]             = useState(blankForm());
  const [saving, setSaving]         = useState(false);
  const [showSetores, setShowSetores] = useState(false);

  // Setores dinâmicos
  const [setores, setSetores] = useState<string[]>(SETORES_DEFAULT);

  // ── Carrega setores de configuracoes ──
  const loadSetores = async () => {
    const { data } = await supabase
      .from('configuracoes')
      .select('value')
      .eq('key', CONF_KEY)
      .maybeSingle();
    if (data?.value) {
      try { setSetores(sortSetores(JSON.parse(data.value))); } catch { /* usa default */ }
    }
  };

  const saveSetores = async (updated: string[]) => {
    await supabase.from('configuracoes').upsert(
      { key: CONF_KEY, value: JSON.stringify(updated) },
      { onConflict: 'key' },
    );
    setSetores(updated);
  };

  // ── Carrega acessos ──
  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('acessos')
      .select('*')
      .order('setor')
      .order('ferramenta');
    if (error) toast({ title: 'Erro ao carregar', description: error.message, variant: 'destructive' });
    setAcessos(data || []);
    setLoading(false);
  };

  useEffect(() => { loadSetores(); load(); }, []);

  const setoresList = useMemo(() => [...new Set(acessos.map(a => a.setor))].sort(), [acessos]);

  const filtered = useMemo(() => {
    let list = acessos;
    if (!showInativos) list = list.filter(a => a.status === 'ativo');
    if (setorFilter !== 'todos') list = list.filter(a => a.setor === setorFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(a =>
        a.ferramenta.toLowerCase().includes(q) ||
        (a.login || '').toLowerCase().includes(q) ||
        (a.notas || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [acessos, showInativos, setorFilter, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, Acesso[]>();
    for (const a of filtered) {
      if (!map.has(a.setor)) map.set(a.setor, []);
      map.get(a.setor)!.push(a);
    }
    return [...map.entries()];
  }, [filtered]);

  const openNew = () => {
    setEditingId(null);
    setForm(blankForm(setores[0] || ''));
    setShowSetores(false);
    setOpen(true);
  };
  const openEdit = (a: Acesso) => {
    setEditingId(a.id);
    setForm({
      ferramenta: a.ferramenta, setor: a.setor,
      url: a.url || '', login: a.login || '',
      senha: a.senha || '', status: a.status, notas: a.notas || '',
    });
    setShowSetores(false);
    setOpen(true);
  };

  const save = async () => {
    if (!form.ferramenta.trim())
      return toast({ title: 'Nome da ferramenta obrigatório', variant: 'destructive' });
    setSaving(true);
    const payload = {
      ferramenta:    form.ferramenta.trim(),
      setor:         form.setor,
      url:           form.url.trim()   || null,
      login:         form.login.trim() || null,
      senha:         form.senha.trim() || null,
      status:        form.status,
      notas:         form.notas.trim() || null,
      atualizado_em: new Date().toISOString(),
    };
    const { error } = editingId
      ? await supabase.from('acessos').update(payload).eq('id', editingId)
      : await supabase.from('acessos').insert(payload);
    setSaving(false);
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    toast({ title: editingId ? 'Ferramenta atualizada' : 'Ferramenta adicionada' });
    setOpen(false);
    load();
  };

  const remove = async (a: Acesso) => {
    if (!(await confirm({ title: `Excluir "${a.ferramenta}"?`, description: 'Esta ação não pode ser desfeita.' }))) return;
    const { error } = await supabase.from('acessos').delete().eq('id', a.id);
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    toast({ title: 'Ferramenta excluída' });
    load();
  };

  return (
    <DashboardLayout title="Acessos">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar ferramenta, login..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>

        <Select value={setorFilter} onValueChange={setSetorFilter}>
          <SelectTrigger className="w-48 h-8 text-sm">
            <SelectValue placeholder="Todos os setores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os setores</SelectItem>
            {setoresList.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>

        <button
          onClick={() => setShowInativos(v => !v)}
          className={cn(
            'flex items-center h-8 px-3 text-sm rounded-md border transition-colors',
            showInativos
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-input bg-background text-muted-foreground hover:text-foreground',
          )}
        >
          {showInativos ? 'Exibindo todos' : 'Apenas ativos'}
        </button>

        {isAdmin && (
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4 mr-1" /> Nova ferramenta
          </Button>
        )}
      </div>

      {/* Conteúdo */}
      {loading ? (
        <div className="text-center py-16 text-sm text-muted-foreground">Carregando...</div>
      ) : grouped.length === 0 ? (
        <div className="text-center py-16 text-sm text-muted-foreground">Nenhuma ferramenta encontrada.</div>
      ) : (
        grouped.map(([setor, itens]) => (
          <SetorSection
            key={setor}
            setor={setor}
            itens={itens}
            isAdmin={isAdmin}
            onEdit={openEdit}
            onDelete={remove}
          />
        ))
      )}

      {/* Dialog CRUD */}
      <Dialog open={open} onOpenChange={v => { if (!v) { setOpen(false); setShowSetores(false); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar ferramenta' : 'Nova ferramenta'}</DialogTitle>
          </DialogHeader>

          {showSetores ? (
            // ── Painel de setores ──
            <SetoresPanel
              setores={setores}
              acessos={acessos}
              onClose={() => setShowSetores(false)}
              onSave={async (updated) => {
                await saveSetores(updated);
                // Se o setor atual do form não existe mais, corrige
                if (!updated.includes(form.setor) && updated.length > 0) {
                  setForm(f => ({ ...f, setor: updated[0] }));
                }
              }}
            />
          ) : (
            // ── Formulário principal ──
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Nome <span className="text-destructive">*</span></Label>
                  <Input
                    value={form.ferramenta}
                    onChange={e => setForm({ ...form, ferramenta: e.target.value })}
                    className="mt-1" placeholder="Ex: Notion"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label>Setor</Label>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => setShowSetores(true)}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Settings2 className="h-3 w-3" />
                        Gerenciar
                      </button>
                    )}
                  </div>
                  <Select value={form.setor} onValueChange={v => setForm({ ...form, setor: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {setores.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>URL de acesso</Label>
                <Input
                  value={form.url}
                  onChange={e => setForm({ ...form, url: e.target.value })}
                  className="mt-1" placeholder="https://..."
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Login / E-mail</Label>
                  <Input
                    value={form.login}
                    onChange={e => setForm({ ...form, login: e.target.value })}
                    className="mt-1" placeholder="usuario@email.com"
                  />
                </div>
                <div>
                  <Label>Senha</Label>
                  <Input
                    value={form.senha}
                    onChange={e => setForm({ ...form, senha: e.target.value })}
                    className="mt-1" placeholder="••••••••"
                  />
                </div>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm({ ...form, status: v as 'ativo' | 'inativo' })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ativo">Ativo</SelectItem>
                    <SelectItem value="inativo">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Observações</Label>
                <Textarea
                  value={form.notas}
                  onChange={e => setForm({ ...form, notas: e.target.value })}
                  className="mt-1 min-h-[60px] text-sm"
                  placeholder="Informações adicionais, serial keys, etc."
                />
              </div>
            </div>
          )}

          {!showSetores && (
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={save} disabled={saving}>
                {saving ? 'Salvando...' : editingId ? 'Salvar' : 'Adicionar'}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
