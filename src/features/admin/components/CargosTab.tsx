import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Pencil, Trash2, Plus } from 'lucide-react';
import { useConfirm } from '@/hooks/use-confirm';

type Cargo = { id: string; nome: string; multiplicador: string; cor: string; ordem: number };

const PRESET_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6',
];

const fmtMult = (m: string | number) => `${parseFloat(String(m)).toFixed(2)}x`;

export function CargosTab() {
  const confirm = useConfirm();
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Cargo | null>(null);
  const [nome, setNome] = useState('');
  const [multiplicador, setMultiplicador] = useState('1.00');
  const [cor, setCor] = useState('#6366f1');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('cargos').select('id, nome, multiplicador, cor, ordem').order('ordem');
    setCargos(data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setNome(''); setMultiplicador('1.00'); setCor('#6366f1');
    setOpen(true);
  };

  const openEdit = (c: Cargo) => {
    setEditing(c);
    setNome(c.nome);
    setMultiplicador(String(c.multiplicador));
    setCor(c.cor || '#6366f1');
    setOpen(true);
  };

  const handleSave = async () => {
    if (!nome.trim()) return toast({ title: 'Nome obrigatório', variant: 'destructive' });
    setSaving(true);
    const maxOrdem = cargos.length > 0 ? Math.max(...cargos.map(c => c.ordem)) + 1 : 0;
    const payload = {
      nome: nome.trim(),
      multiplicador: parseFloat(multiplicador) || 1,
      cor,
      ordem: editing?.ordem ?? maxOrdem,
    };
    const { error } = editing
      ? await supabase.from('cargos').update(payload).eq('id', editing.id)
      : await supabase.from('cargos').insert(payload);
    setSaving(false);
    if (error) return toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
    toast({ title: editing ? 'Cargo atualizado' : 'Cargo criado' });
    setOpen(false);
    load();
  };

  const handleDelete = async (c: Cargo) => {
    if (!(await confirm({ title: `Excluir cargo "${c.nome}"?`, description: 'Usuários com este cargo ficarão sem cargo.' }))) return;
    const { error } = await supabase.from('cargos').delete().eq('id', c.id);
    if (error) return toast({ title: 'Erro ao excluir', description: error.message, variant: 'destructive' });
    toast({ title: 'Cargo removido' });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Cargos</h3>
          <p className="text-xs text-muted-foreground">Cargos e multiplicadores de comissão dos editores.</p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Novo cargo</Button>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm animate-pulse py-8 text-center">Carregando...</div>
      ) : cargos.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Nenhum cargo cadastrado</div>
      ) : (
        <div className="space-y-2">
          {cargos.map(c => (
            <div key={c.id} className="bg-card border border-border rounded-lg px-4 py-3 flex items-center gap-3">
              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: c.cor || '#6366f1' }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{c.nome}</span>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ backgroundColor: `${c.cor || '#6366f1'}20`, color: c.cor || '#6366f1' }}
                  >
                    {fmtMult(c.multiplicador)}
                  </span>
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button size="sm" variant="ghost" onClick={() => openEdit(c)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleDelete(c)}>
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
            <DialogTitle>{editing ? 'Editar cargo' : 'Novo cargo'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Nome</Label>
              <Input
                value={nome}
                onChange={e => setNome(e.target.value)}
                placeholder="Ex: Sênior"
                className="mt-1"
                autoFocus
              />
            </div>
            <div>
              <Label className="text-xs">Multiplicador de comissão</Label>
              <Input
                type="number" step="0.01" min="0"
                value={multiplicador}
                onChange={e => setMultiplicador(e.target.value)}
                placeholder="1.00"
                className="mt-1"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Valor atual: {fmtMult(multiplicador || 1)}
              </p>
            </div>
            <div>
              <Label className="text-xs">Cor</Label>
              <div className="flex flex-wrap gap-2 mt-1.5 items-center">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCor(c)}
                    className="w-6 h-6 rounded-full transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      outline: cor === c ? `2px solid ${c}` : 'none',
                      outlineOffset: '2px',
                    }}
                  />
                ))}
                <input
                  type="color"
                  value={cor}
                  onChange={e => setCor(e.target.value)}
                  className="w-6 h-6 rounded cursor-pointer border border-border bg-transparent"
                  title="Cor personalizada"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
