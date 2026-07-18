import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { Plus, Pencil, Trash2 } from 'lucide-react';

type Empresa = { id: string; nome: string; ativo: boolean };
type Oferta = { id: string; nome: string; empresa_id: string | null; ativo: boolean };

export function EmpresasOfertasTab() {
  const confirm = useConfirm();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [ofertas, setOfertas] = useState<Oferta[]>([]);
  const [loading, setLoading] = useState(true);

  const [openEmp, setOpenEmp] = useState(false);
  const [editEmp, setEditEmp] = useState<Empresa | null>(null);
  const [empForm, setEmpForm] = useState({ nome: '', ativo: true });

  const [openOf, setOpenOf] = useState(false);
  const [editOf, setEditOf] = useState<Oferta | null>(null);
  const [ofForm, setOfForm] = useState({ nome: '', empresa_id: '', ativo: true });

  const load = async () => {
    setLoading(true);
    const [e, o] = await Promise.all([
      supabase.from('empresas').select('*').order('nome'),
      supabase.from('ofertas_editores').select('*').order('nome'),
    ]);
    setEmpresas(e.data || []);
    setOfertas(o.data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const empMap = Object.fromEntries(empresas.map(e => [e.id, e.nome]));

  // Empresas
  const newEmp = () => { setEditEmp(null); setEmpForm({ nome: '', ativo: true }); setOpenEmp(true); };
  const editEmpresa = (e: Empresa) => { setEditEmp(e); setEmpForm({ nome: e.nome, ativo: e.ativo }); setOpenEmp(true); };
  const saveEmp = async () => {
    if (!empForm.nome) return toast({ title: 'Nome obrigatório', variant: 'destructive' });
    const res = editEmp
      ? await supabase.from('empresas').update(empForm).eq('id', editEmp.id)
      : await supabase.from('empresas').insert(empForm);
    if (res.error) return toast({ title: 'Erro', description: res.error.message, variant: 'destructive' });
    setOpenEmp(false); load();
  };
  const removeEmp = async (id: string) => {
    if (!(await confirm({ title: 'Excluir empresa?', description: 'A empresa será removida. Ofertas vinculadas ficarão sem empresa.' }))) return;
    const { error } = await supabase.from('empresas').delete().eq('id', id);
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    load();
  };
  const toggleEmp = async (e: Empresa) => { await supabase.from('empresas').update({ ativo: !e.ativo }).eq('id', e.id); load(); };

  // Ofertas
  const newOf = () => { setEditOf(null); setOfForm({ nome: '', empresa_id: '', ativo: true }); setOpenOf(true); };
  const editOferta = (o: Oferta) => { setEditOf(o); setOfForm({ nome: o.nome, empresa_id: o.empresa_id || '', ativo: o.ativo }); setOpenOf(true); };
  const saveOf = async () => {
    if (!ofForm.nome) return toast({ title: 'Nome obrigatório', variant: 'destructive' });
    const payload = { nome: ofForm.nome, empresa_id: ofForm.empresa_id || null, ativo: ofForm.ativo };
    const res = editOf
      ? await supabase.from('ofertas_editores').update(payload).eq('id', editOf.id)
      : await supabase.from('ofertas_editores').insert(payload);
    if (res.error) return toast({ title: 'Erro', description: res.error.message, variant: 'destructive' });
    setOpenOf(false); load();
  };
  const removeOf = async (id: string) => {
    if (!(await confirm({ title: 'Excluir oferta?', description: 'Esta oferta será removida.' }))) return;
    const { error } = await supabase.from('ofertas_editores').delete().eq('id', id);
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    load();
  };
  const toggleOf = async (o: Oferta) => { await supabase.from('ofertas_editores').update({ ativo: !o.ativo }).eq('id', o.id); load(); };

  if (loading) return <div className="p-6 text-center text-muted-foreground">Carregando...</div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Empresas */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wide text-primary">Empresas</h4>
            <p className="text-xs text-muted-foreground">Empresas que aparecem ao avaliar criativos.</p>
          </div>
          <Button size="sm" onClick={newEmp}><Plus className="h-4 w-4" /> Nova</Button>
        </div>
        <div className="bg-card border border-border rounded-lg divide-y divide-border/60">
          {empresas.length === 0 && <div className="p-4 text-sm text-muted-foreground">Nenhuma empresa</div>}
          {empresas.map(e => (
            <div key={e.id} className={`flex items-center justify-between gap-2 px-4 py-2 text-sm ${!e.ativo ? 'opacity-50' : ''}`}>
              <span>{e.nome}</span>
              <div className="flex items-center gap-2">
                <Switch checked={e.ativo} onCheckedChange={() => toggleEmp(e)} />
                <Button size="sm" variant="ghost" onClick={() => editEmpresa(e)}><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="ghost" onClick={() => removeEmp(e.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Ofertas */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wide text-primary">Ofertas</h4>
            <p className="text-xs text-muted-foreground">Vincule cada oferta à sua empresa.</p>
          </div>
          <Button size="sm" onClick={newOf}><Plus className="h-4 w-4" /> Nova</Button>
        </div>
        <div className="bg-card border border-border rounded-lg divide-y divide-border/60">
          {ofertas.length === 0 && <div className="p-4 text-sm text-muted-foreground">Nenhuma oferta</div>}
          {ofertas.map(o => (
            <div key={o.id} className={`flex items-center justify-between gap-2 px-4 py-2 text-sm ${!o.ativo ? 'opacity-50' : ''}`}>
              <div className="min-w-0">
                <div>{o.nome}</div>
                <div className="text-xs text-muted-foreground">{o.empresa_id ? empMap[o.empresa_id] || '—' : 'Sem empresa'}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Switch checked={o.ativo} onCheckedChange={() => toggleOf(o)} />
                <Button size="sm" variant="ghost" onClick={() => editOferta(o)}><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="ghost" onClick={() => removeOf(o.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Empresa dialog */}
      <Dialog open={openEmp} onOpenChange={setOpenEmp}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editEmp ? 'Editar empresa' : 'Nova empresa'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome</Label><Input value={empForm.nome} onChange={e => setEmpForm({ ...empForm, nome: e.target.value })} /></div>
            <div className="flex items-center gap-2"><Switch checked={empForm.ativo} onCheckedChange={v => setEmpForm({ ...empForm, ativo: v })} /><Label>Ativa</Label></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpenEmp(false)}>Cancelar</Button><Button onClick={saveEmp}>Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Oferta dialog */}
      <Dialog open={openOf} onOpenChange={setOpenOf}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editOf ? 'Editar oferta' : 'Nova oferta'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome</Label><Input value={ofForm.nome} onChange={e => setOfForm({ ...ofForm, nome: e.target.value })} /></div>
            <div>
              <Label>Empresa</Label>
              <Select value={ofForm.empresa_id || 'none'} onValueChange={v => setOfForm({ ...ofForm, empresa_id: v === 'none' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem empresa</SelectItem>
                  {empresas.map(e => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2"><Switch checked={ofForm.ativo} onCheckedChange={v => setOfForm({ ...ofForm, ativo: v })} /><Label>Ativa</Label></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpenOf(false)}>Cancelar</Button><Button onClick={saveOf}>Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
