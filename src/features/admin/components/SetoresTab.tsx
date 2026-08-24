import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Pencil, Trash2, Plus, ChevronDown, Check } from 'lucide-react';
import { useConfirm } from '@/hooks/use-confirm';
import { cn } from '@/lib/utils';
import { PAGINAS_CONFIGURAVEIS } from '@/contexts/AuthContext';

type Setor = { id: string; nome: string; cor: string | null; ordem: number };
type Cargo = { id: string; nome: string; multiplicador: string; cor: string | null; ordem: number; setor_id: string | null };

const PRESET_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6',
];
const fmtMult = (m: string | number) => `${parseFloat(String(m)).toFixed(2)}x`;

// ── Formulário de cargo ───────────────────────────────────────────────────────

function CargoForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<Cargo>;
  onSave: (fields: { nome: string; multiplicador: number; cor: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [nome, setNome]         = useState(initial?.nome ?? '');
  const [mult, setMult]         = useState(initial?.multiplicador ? String(initial.multiplicador) : '1.00');
  const [cor, setCor]           = useState(initial?.cor ?? '#6366f1');
  const [saving, setSaving]     = useState(false);

  const handleSave = async () => {
    if (!nome.trim()) return toast({ title: 'Nome obrigatório', variant: 'destructive' });
    setSaving(true);
    await onSave({ nome: nome.trim(), multiplicador: parseFloat(mult) || 1, cor });
    setSaving(false);
  };

  return (
    <div className="space-y-3 p-3 bg-secondary/30 rounded-md border border-border">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Nome do cargo</Label>
          <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Pleno" className="mt-1 h-8 text-xs" autoFocus />
        </div>
        <div>
          <Label className="text-xs">Multiplicador</Label>
          <Input type="number" step="0.01" min="0" value={mult} onChange={e => setMult(e.target.value)} placeholder="1.00" className="mt-1 h-8 text-xs" />
        </div>
      </div>
      <div>
        <Label className="text-xs">Cor</Label>
        <div className="flex flex-wrap gap-1.5 mt-1 items-center">
          {PRESET_COLORS.map(c => (
            <button key={c} type="button" onClick={() => setCor(c)}
              className="w-5 h-5 rounded-full transition-transform hover:scale-110"
              style={{ backgroundColor: c, outline: cor === c ? `2px solid ${c}` : 'none', outlineOffset: '2px' }}
            />
          ))}
          <input type="color" value={cor} onChange={e => setCor(e.target.value)}
            className="w-5 h-5 rounded cursor-pointer border border-border bg-transparent" title="Personalizar" />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : 'Salvar cargo'}</Button>
      </div>
    </div>
  );
}

// ── Card de setor ─────────────────────────────────────────────────────────────

function SetorCard({
  setor,
  cargos,
  permissoes,
  onChanged,
}: {
  setor: Setor;
  cargos: Cargo[];
  permissoes: string[];
  onChanged: () => void;
}) {
  const confirm                     = useConfirm();
  const [expanded, setExpanded]     = useState(false);
  const [addingCargo, setAddingCargo] = useState(false);
  const [editingCargo, setEditingCargo] = useState<Cargo | null>(null);
  const [savingPerm, setSavingPerm] = useState<string | null>(null);

  // ── Permissões por setor ──────────────────────────────────────────────────

  const togglePerm = async (pagina: string) => {
    const has = permissoes.includes(pagina);
    setSavingPerm(pagina);
    if (has) {
      await supabase.from('setor_permissoes').delete()
        .eq('setor_id', setor.id).eq('pagina', pagina);
    } else {
      await supabase.from('setor_permissoes').insert({ setor_id: setor.id, pagina });
    }
    setSavingPerm(null);
    onChanged();
  };

  // ── CRUD cargos ──────────────────────────────────────────────────────────

  const handleCreateCargo = async (fields: { nome: string; multiplicador: number; cor: string }) => {
    const maxOrdem = cargos.length > 0 ? Math.max(...cargos.map(c => c.ordem)) + 1 : 0;
    const { error } = await supabase.from('cargos').insert({
      ...fields, setor_id: setor.id, ordem: maxOrdem,
    });
    if (error) { toast({ title: 'Erro ao criar cargo', variant: 'destructive' }); return; }
    toast({ title: 'Cargo criado' });
    setAddingCargo(false);
    onChanged();
  };

  const handleEditCargo = async (cargo: Cargo, fields: { nome: string; multiplicador: number; cor: string }) => {
    const { error } = await supabase.from('cargos').update(fields).eq('id', cargo.id);
    if (error) { toast({ title: 'Erro ao atualizar cargo', variant: 'destructive' }); return; }
    toast({ title: 'Cargo atualizado' });
    setEditingCargo(null);
    onChanged();
  };

  const handleDeleteCargo = async (cargo: Cargo) => {
    if (!(await confirm({ title: `Excluir cargo "${cargo.nome}"?`, description: 'Usuários com este cargo ficarão sem cargo.' }))) return;
    const { error } = await supabase.from('cargos').delete().eq('id', cargo.id);
    if (error) { toast({ title: 'Erro ao excluir', variant: 'destructive' }); return; }
    toast({ title: 'Cargo removido' });
    onChanged();
  };

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* Header do setor */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/30 transition-colors text-left"
      >
        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: setor.cor ?? '#888' }} />
        <span className="text-sm font-medium flex-1">{setor.nome}</span>
        <span className="text-xs text-muted-foreground mr-2">
          {cargos.length} cargo{cargos.length !== 1 ? 's' : ''} · {permissoes.length} página{permissoes.length !== 1 ? 's' : ''}
        </span>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-5">

          {/* ── Cargos ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cargos</p>
              <Button size="sm" variant="outline" onClick={() => { setAddingCargo(true); setEditingCargo(null); }}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Novo cargo
              </Button>
            </div>

            {cargos.length === 0 && !addingCargo && (
              <p className="text-xs text-muted-foreground py-2">Nenhum cargo cadastrado neste setor.</p>
            )}

            <div className="space-y-2">
              {cargos.map(cargo => (
                editingCargo?.id === cargo.id ? (
                  <CargoForm
                    key={cargo.id}
                    initial={cargo}
                    onSave={fields => handleEditCargo(cargo, fields)}
                    onCancel={() => setEditingCargo(null)}
                  />
                ) : (
                  <div key={cargo.id} className="flex items-center gap-2 bg-secondary/20 rounded-md px-3 py-2">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cargo.cor ?? '#888' }} />
                    <span className="text-sm flex-1">{cargo.nome}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                      style={{ backgroundColor: `${cargo.cor ?? '#888'}20`, color: cargo.cor ?? '#888' }}>
                      {fmtMult(cargo.multiplicador)}
                    </span>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                      onClick={() => { setEditingCargo(cargo); setAddingCargo(false); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                      onClick={() => handleDeleteCargo(cargo)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                )
              ))}

              {addingCargo && (
                <CargoForm
                  onSave={handleCreateCargo}
                  onCancel={() => setAddingCargo(false)}
                />
              )}
            </div>
          </div>

          {/* ── Páginas padrão ── */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Acesso padrão (páginas liberadas para este setor)
            </p>
            <div className="flex flex-wrap gap-2">
              {PAGINAS_CONFIGURAVEIS.map(p => {
                const active  = permissoes.includes(p.key);
                const loading = savingPerm === p.key;
                return (
                  <button
                    key={p.key}
                    onClick={() => togglePerm(p.key)}
                    disabled={loading}
                    className={cn(
                      'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border transition-colors',
                      active
                        ? 'bg-primary/10 border-primary/30 text-primary'
                        : 'bg-secondary border-border text-muted-foreground',
                      loading && 'opacity-50 cursor-wait',
                    )}
                  >
                    {active && <Check className="h-3 w-3" />}
                    {p.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              Ao vincular um usuário a este setor, suas permissões serão inicializadas com estas páginas.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Formulário de setor ───────────────────────────────────────────────────────

function SetorDialog({
  open,
  initial,
  onSave,
  onClose,
}: {
  open: boolean;
  initial?: Setor | null;
  onSave: (fields: { nome: string; cor: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [nome, setNome] = useState(initial?.nome ?? '');
  const [cor, setCor]   = useState(initial?.cor ?? '#6366f1');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNome(initial?.nome ?? '');
    setCor(initial?.cor ?? '#6366f1');
  }, [initial, open]);

  const handleSave = async () => {
    if (!nome.trim()) return toast({ title: 'Nome obrigatório', variant: 'destructive' });
    setSaving(true);
    await onSave({ nome: nome.trim(), cor });
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{initial ? 'Editar setor' : 'Novo setor'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Nome</Label>
            <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Editor" className="mt-1" autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSave()} />
          </div>
          <div>
            <Label className="text-xs">Cor</Label>
            <div className="flex flex-wrap gap-2 mt-1.5 items-center">
              {PRESET_COLORS.map(c => (
                <button key={c} type="button" onClick={() => setCor(c)}
                  className="w-6 h-6 rounded-full transition-transform hover:scale-110"
                  style={{ backgroundColor: c, outline: cor === c ? `2px solid ${c}` : 'none', outlineOffset: '2px' }}
                />
              ))}
              <input type="color" value={cor} onChange={e => setCor(e.target.value)}
                className="w-6 h-6 rounded cursor-pointer border border-border bg-transparent" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export function SetoresTab() {
  const confirm = useConfirm();
  const [setores, setSetores]         = useState<Setor[]>([]);
  const [cargos, setCargos]           = useState<Cargo[]>([]);
  const [permissoes, setPermissoes]   = useState<Record<string, string[]>>({});
  const [loading, setLoading]         = useState(true);
  const [dialogOpen, setDialogOpen]   = useState(false);
  const [editingSetor, setEditingSetor] = useState<Setor | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: ss }, { data: cs }, { data: ps }] = await Promise.all([
      supabase.from('setores').select('id, nome, cor, ordem').order('ordem'),
      supabase.from('cargos').select('id, nome, multiplicador, cor, ordem, setor_id').order('ordem'),
      supabase.from('setor_permissoes').select('setor_id, pagina'),
    ]);
    setSetores(ss ?? []);
    setCargos(cs ?? []);
    const pm: Record<string, string[]> = {};
    for (const row of ps ?? []) {
      if (!pm[row.setor_id]) pm[row.setor_id] = [];
      pm[row.setor_id].push(row.pagina);
    }
    setPermissoes(pm);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditingSetor(null); setDialogOpen(true); };
  const openEdit   = (s: Setor) => { setEditingSetor(s); setDialogOpen(true); };

  const handleSaveSetor = async (fields: { nome: string; cor: string }) => {
    const maxOrdem = setores.length > 0 ? Math.max(...setores.map(s => s.ordem)) + 1 : 0;
    const { error } = editingSetor
      ? await supabase.from('setores').update(fields).eq('id', editingSetor.id)
      : await supabase.from('setores').insert({ ...fields, ordem: maxOrdem });
    if (error) { toast({ title: 'Erro ao salvar setor', variant: 'destructive' }); return; }
    toast({ title: editingSetor ? 'Setor atualizado' : 'Setor criado' });
    setDialogOpen(false);
    load();
  };

  const handleDeleteSetor = async (s: Setor) => {
    const qtdCargos = cargos.filter(c => c.setor_id === s.id).length;
    const desc = qtdCargos > 0
      ? `Este setor tem ${qtdCargos} cargo(s) que ficarão sem setor. Deseja continuar?`
      : 'O setor e suas permissões padrão serão removidos.';
    if (!(await confirm({ title: `Excluir setor "${s.nome}"?`, description: desc }))) return;
    const { error } = await supabase.from('setores').delete().eq('id', s.id);
    if (error) { toast({ title: 'Erro ao excluir', variant: 'destructive' }); return; }
    toast({ title: 'Setor removido' });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Setores & Cargos</h3>
          <p className="text-xs text-muted-foreground">Gerencie setores, os cargos de cada um e as páginas padrão de acesso.</p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Novo setor</Button>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm animate-pulse py-8 text-center">Carregando...</div>
      ) : setores.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Nenhum setor cadastrado</div>
      ) : (
        <div className="space-y-3">
          {setores.map(s => (
            <div key={s.id} className="relative group">
              <SetorCard
                setor={s}
                cargos={cargos.filter(c => c.setor_id === s.id)}
                permissoes={permissoes[s.id] ?? []}
                onChanged={load}
              />
              {/* Ações do setor — aparecem no hover */}
              <div className="absolute top-2.5 right-10 hidden group-hover:flex gap-1 z-10">
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 bg-card border border-border"
                  onClick={() => openEdit(s)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 bg-card border border-border"
                  onClick={() => handleDeleteSetor(s)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <SetorDialog
        open={dialogOpen}
        initial={editingSetor}
        onSave={handleSaveSetor}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}
