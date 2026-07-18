import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Pencil, Trash2, Plus } from 'lucide-react';
import { useConfirm } from '@/hooks/use-confirm';

type Setor = { id: string; nome: string };

export function SetoresTab() {
  const confirm = useConfirm();
  const [setores, setSetores] = useState<Setor[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Setor | null>(null);
  const [nome, setNome] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('setores').select('id, nome').order('nome');
    setSetores(data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setNome(''); setOpen(true); };
  const openEdit = (s: Setor) => { setEditing(s); setNome(s.nome); setOpen(true); };

  const handleSave = async () => {
    if (!nome.trim()) return toast({ title: 'Nome obrigatório', variant: 'destructive' });
    setSaving(true);
    const payload = { nome: nome.trim() };
    const { error } = editing
      ? await supabase.from('setores').update(payload).eq('id', editing.id)
      : await supabase.from('setores').insert(payload);
    setSaving(false);
    if (error) return toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
    toast({ title: editing ? 'Setor atualizado' : 'Setor criado' });
    setOpen(false);
    load();
  };

  const handleDelete = async (s: Setor) => {
    if (!(await confirm({ title: `Excluir "${s.nome}"?`, description: 'Usuários vinculados perderão este setor.' }))) return;
    const { error } = await supabase.from('setores').delete().eq('id', s.id);
    if (error) return toast({ title: 'Erro ao excluir', description: error.message, variant: 'destructive' });
    toast({ title: 'Setor removido' });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Setores</h3>
          <p className="text-xs text-muted-foreground">Categorias funcionais dos usuários.</p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Novo setor</Button>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm animate-pulse py-8 text-center">Carregando...</div>
      ) : setores.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Nenhum setor cadastrado</div>
      ) : (
        <div className="space-y-2">
          {setores.map(s => (
            <div key={s.id} className="bg-card border border-border rounded-lg px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-medium">{s.nome}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => openEdit(s)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleDelete(s)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar setor' : 'Novo setor'}</DialogTitle>
          </DialogHeader>
          <Input
            value={nome}
            onChange={e => setNome(e.target.value)}
            placeholder="Nome do setor"
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
