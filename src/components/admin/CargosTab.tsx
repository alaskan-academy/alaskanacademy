import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Pencil, Trash2 } from 'lucide-react';

type Cargo = { id: string; nome: string; multiplicador: number; cor: string; ordem: number };
const blank = (ordem: number): Omit<Cargo, 'id'> => ({ nome: '', multiplicador: 1.0, cor: '#6366f1', ordem });

export function CargosTab() {
  const confirm = useConfirm();
  const [cargos, setCargos]     = useState<Cargo[]>([]);
  const [loading, setLoading]   = useState(true);
  const [open, setOpen]         = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm]         = useState<Omit<Cargo, 'id'>>(blank(1));

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('cargos').select('*').order('ordem');
    setCargos(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditingId(null);
    setForm(blank(cargos.length + 1));
    setOpen(true);
  };

  const openEdit = (c: Cargo) => {
    setEditingId(c.id);
    setForm({ nome: c.nome, multiplicador: c.multiplicador, cor: c.cor || '#6366f1', ordem: c.ordem });
    setOpen(true);
  };

  const save = async () => {
    if (!form.nome.trim()) return toast({ title: 'Preencha o nome do cargo', variant: 'destructive' });
    const payload = { ...form, multiplicador: Number(form.multiplicador) };
    const { error } = editingId
      ? await supabase.from('cargos').update(payload).eq('id', editingId)
      : await supabase.from('cargos').insert(payload);
    if (error) return toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
    toast({ title: editingId ? 'Cargo atualizado' : 'Cargo criado' });
    setOpen(false);
    load();
  };

  const remove = async (c: Cargo) => {
    if (!(await confirm({
      title: `Excluir cargo "${c.nome}"?`,
      description: 'Editores e usuários com esse cargo perderão a referência de multiplicador.',
    }))) return;
    const { error } = await supabase.from('cargos').delete().eq('id', c.id);
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    load();
  };

  return (
    <div className="space-y-4 max-w-xl">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Cargos</h3>
          <p className="text-xs text-muted-foreground">Tabela de referência: cargos e multiplicadores de comissão.</p>
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus className="h-4 w-4 mr-1" /> Novo cargo
        </Button>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-6 text-center text-muted-foreground text-sm">Carregando...</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-2.5">Cargo</th>
                <th className="text-center px-4 py-2.5">Multiplicador</th>
                <th className="text-center px-4 py-2.5">Ordem</th>
                <th className="px-4 py-2.5 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {cargos.map((c) => (
                <tr key={c.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="inline-block w-3 h-3 rounded-full shrink-0 ring-1 ring-black/10"
                        style={{ background: c.cor || '#888' }}
                      />
                      <span className="font-medium text-foreground">{c.nome}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold"
                      style={{ backgroundColor: `${c.cor}22`, color: c.cor }}
                    >
                      {Number(c.multiplicador).toFixed(2)}x
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-muted-foreground text-xs">{c.ordem}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(c)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 ml-1" onClick={() => remove(c)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive/70 hover:text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
              {!loading && cargos.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-sm">
                    Nenhum cargo cadastrado
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
            <DialogTitle>{editingId ? 'Editar cargo' : 'Novo cargo'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Nome</Label>
              <Input
                className="mt-1"
                value={form.nome}
                onChange={e => setForm({ ...form, nome: e.target.value })}
                placeholder="Ex: Júnior 1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Multiplicador</Label>
                <Input
                  className="mt-1"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.multiplicador}
                  onChange={e => setForm({ ...form, multiplicador: parseFloat(e.target.value) || 0 })}
                />
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
                  placeholder="#6366f1"
                  className="flex-1 font-mono text-xs"
                />
                <span
                  className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap"
                  style={{ backgroundColor: `${form.cor}22`, color: form.cor }}
                >
                  {form.nome || 'Prévia'}
                </span>
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
