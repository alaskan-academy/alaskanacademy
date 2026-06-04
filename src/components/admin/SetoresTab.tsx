import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { PAGINAS } from '@/contexts/AuthContext';

type Setor = { id: string; nome: string; pagina_key: string | null; cor: string; ordem: number };
const blank = (ordem: number): Omit<Setor, 'id'> => ({ nome: '', pagina_key: null, cor: '#6366f1', ordem });

const PAGINA_LABELS: Record<string, string> = Object.fromEntries(PAGINAS.map(p => [p.key, p.label]));

export function SetoresTab() {
  const confirm = useConfirm();
  const [setores, setSetores]     = useState<Setor[]>([]);
  const [loading, setLoading]     = useState(true);
  const [open, setOpen]           = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm]           = useState<Omit<Setor, 'id'>>(blank(1));

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('setores').select('*').order('ordem');
    setSetores(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditingId(null);
    setForm(blank(setores.length + 1));
    setOpen(true);
  };

  const openEdit = (s: Setor) => {
    setEditingId(s.id);
    setForm({ nome: s.nome, pagina_key: s.pagina_key, cor: s.cor || '#6366f1', ordem: s.ordem });
    setOpen(true);
  };

  const save = async () => {
    if (!form.nome.trim()) return toast({ title: 'Preencha o nome do setor', variant: 'destructive' });
    const payload = { ...form, pagina_key: form.pagina_key || null };
    const { error } = editingId
      ? await supabase.from('setores').update(payload).eq('id', editingId)
      : await supabase.from('setores').insert(payload);
    if (error) return toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
    toast({ title: editingId ? 'Setor atualizado' : 'Setor criado' });
    setOpen(false);
    load();
  };

  const remove = async (s: Setor) => {
    if (!(await confirm({
      title: `Excluir setor "${s.nome}"?`,
      description: 'Os cargos vinculados perderão a referência de setor.',
    }))) return;
    const { error } = await supabase.from('setores').delete().eq('id', s.id);
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    load();
  };

  return (
    <div className="space-y-4 max-w-xl">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Setores</h3>
          <p className="text-xs text-muted-foreground">
            Defina os setores da equipe. Ao atribuir um cargo, o acesso à página do setor é concedido automaticamente.
          </p>
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus className="h-4 w-4 mr-1" /> Novo setor
        </Button>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-6 text-center text-muted-foreground text-sm">Carregando...</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-2.5">Setor</th>
                <th className="text-left px-4 py-2.5">Acesso automático</th>
                <th className="text-center px-4 py-2.5">Ordem</th>
                <th className="px-4 py-2.5 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {setores.map(s => (
                <tr key={s.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="inline-block w-3 h-3 rounded-full shrink-0 ring-1 ring-black/10"
                        style={{ background: s.cor || '#888' }}
                      />
                      <span className="font-medium text-foreground">{s.nome}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {s.pagina_key ? (
                      <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                        {PAGINA_LABELS[s.pagina_key] ?? s.pagina_key}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">— nenhuma —</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-muted-foreground">{s.ordem}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(s)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 ml-1" onClick={() => remove(s)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive/70 hover:text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
              {!loading && setores.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-sm">
                    Nenhum setor cadastrado
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar setor' : 'Novo setor'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Nome</Label>
              <Input
                className="mt-1"
                value={form.nome}
                onChange={e => setForm({ ...form, nome: e.target.value })}
                placeholder="Ex: Editor, Copy, Gestor de Tráfego"
              />
            </div>

            <div>
              <Label className="text-xs">Acesso automático à página</Label>
              <p className="text-[11px] text-muted-foreground mb-1.5">
                Ao atribuir um cargo deste setor, o usuário recebe acesso à página selecionada.
              </p>
              <select
                value={form.pagina_key ?? ''}
                onChange={e => setForm({ ...form, pagina_key: e.target.value || null })}
                className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm"
              >
                <option value="">— Nenhuma —</option>
                {PAGINAS.map(p => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Cor</Label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="color"
                    value={form.cor}
                    onChange={e => setForm({ ...form, cor: e.target.value })}
                    className="h-9 w-12 rounded cursor-pointer border border-border bg-transparent p-0.5"
                  />
                  <Input
                    value={form.cor}
                    onChange={e => setForm({ ...form, cor: e.target.value })}
                    className="font-mono text-xs"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Ordem</Label>
                <Input
                  className="mt-1"
                  type="number"
                  min="1"
                  value={form.ordem}
                  onChange={e => setForm({ ...form, ordem: parseInt(e.target.value) || 1 })}
                />
              </div>
            </div>

            {/* Prévia */}
            <div className="border border-border/50 rounded-md p-3 bg-secondary/30">
              <p className="text-xs text-muted-foreground mb-1.5">Prévia</p>
              <div className="flex items-center gap-2">
                <span
                  className="inline-block w-3 h-3 rounded-full shrink-0"
                  style={{ background: form.cor }}
                />
                <span className="text-sm font-medium">{form.nome || 'Nome do setor'}</span>
                {form.pagina_key && (
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full ml-1">
                    → {PAGINA_LABELS[form.pagina_key] ?? form.pagina_key}
                  </span>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save}>{editingId ? 'Salvar' : 'Criar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
