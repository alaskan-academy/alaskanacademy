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
import { Plus, Trash2, Pencil, GripVertical } from 'lucide-react';

type Categoria = 'individual' | 'grupo' | 'meta';
type Opcao = { id: string; criterio_id: string; label: string; valor: number; ordem: number; ativo: boolean };
type Criterio = { id: string; chave: string; label: string; tipo: 'single' | 'multi' | 'number'; ordem: number; ativo: boolean; categoria: Categoria };

const CATEGORIAS: { value: Categoria; label: string; description: string }[] = [
  { value: 'individual', label: 'Avaliação individual', description: 'Critérios avaliados por editor individualmente.' },
  { value: 'grupo', label: 'Avaliação em grupo', description: 'Critérios avaliados a partir do desempenho do time.' },
  { value: 'meta', label: 'Meta da empresa', description: 'Metas coletivas/empresariais que impactam todos.' },
];

export function ConfiguracaoTab() {
  const confirm = useConfirm();
  const [criterios, setCriterios] = useState<Criterio[]>([]);
  const [opcoes, setOpcoes] = useState<Opcao[]>([]);
  const [loading, setLoading] = useState(true);

  const [openCrit, setOpenCrit] = useState(false);
  const [editingCrit, setEditingCrit] = useState<Criterio | null>(null);
  const [critForm, setCritForm] = useState({ chave: '', label: '', tipo: 'single' as 'single'|'multi'|'number', ordem: 0, ativo: true, categoria: 'individual' as Categoria });

  const [openOpt, setOpenOpt] = useState(false);
  const [editingOpt, setEditingOpt] = useState<Opcao | null>(null);
  const [optForm, setOptForm] = useState({ criterio_id: '', label: '', valor: 0, ordem: 0, ativo: true });

  const load = async () => {
    setLoading(true);
    const [c, o] = await Promise.all([
      supabase.from('criterios_avaliacao').select('*').order('ordem'),
      supabase.from('criterio_opcoes').select('*').order('ordem'),
    ]);
    setCriterios(c.data || []); setOpcoes(o.data || []); setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openNewCrit = () => {
    setEditingCrit(null);
    setCritForm({ chave: '', label: '', tipo: 'single', ordem: criterios.length + 1, ativo: true });
    setOpenCrit(true);
  };
  const openEditCrit = (c: Criterio) => {
    setEditingCrit(c);
    setCritForm({ chave: c.chave, label: c.label, tipo: c.tipo, ordem: c.ordem, ativo: c.ativo });
    setOpenCrit(true);
  };
  const saveCrit = async () => {
    if (!critForm.chave || !critForm.label) return toast({ title: 'Chave e label obrigatórios', variant: 'destructive' });
    const res = editingCrit
      ? await supabase.from('criterios_avaliacao').update(critForm).eq('id', editingCrit.id)
      : await supabase.from('criterios_avaliacao').insert(critForm);
    if (res.error) return toast({ title: 'Erro', description: res.error.message, variant: 'destructive' });
    setOpenCrit(false); load();
  };
  const removeCrit = async (id: string) => {
    if (!(await confirm({ title: 'Excluir critério?', description: 'O critério e todas as suas opções serão removidos.' }))) return;
    await supabase.from('criterios_avaliacao').delete().eq('id', id); load();
  };
  const toggleCritAtivo = async (c: Criterio) => {
    await supabase.from('criterios_avaliacao').update({ ativo: !c.ativo }).eq('id', c.id); load();
  };

  const openNewOpt = (criterio_id: string) => {
    setEditingOpt(null);
    const len = opcoes.filter(o => o.criterio_id === criterio_id).length;
    setOptForm({ criterio_id, label: '', valor: 0, ordem: len + 1, ativo: true });
    setOpenOpt(true);
  };
  const openEditOpt = (o: Opcao) => {
    setEditingOpt(o);
    setOptForm({ criterio_id: o.criterio_id, label: o.label, valor: Number(o.valor), ordem: o.ordem, ativo: o.ativo });
    setOpenOpt(true);
  };
  const saveOpt = async () => {
    if (!optForm.label) return toast({ title: 'Label obrigatório', variant: 'destructive' });
    const payload = { ...optForm, valor: Number(optForm.valor), ordem: Number(optForm.ordem) };
    const res = editingOpt
      ? await supabase.from('criterio_opcoes').update(payload).eq('id', editingOpt.id)
      : await supabase.from('criterio_opcoes').insert(payload);
    if (res.error) return toast({ title: 'Erro', description: res.error.message, variant: 'destructive' });
    setOpenOpt(false); load();
  };
  const removeOpt = async (id: string) => {
    if (!(await confirm({ title: 'Excluir opção?', description: 'Esta opção será removida permanentemente.' }))) return;
    await supabase.from('criterio_opcoes').delete().eq('id', id); load();
  };
  const toggleOptAtivo = async (o: Opcao) => {
    await supabase.from('criterio_opcoes').update({ ativo: !o.ativo }).eq('id', o.id); load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Critérios de avaliação</h3>
          <p className="text-xs text-muted-foreground">Configure perguntas, opções e valores usados no formulário de avaliação mensal.</p>
        </div>
        <Button onClick={openNewCrit}><Plus className="h-4 w-4" /> Novo critério</Button>
      </div>

      {loading ? <div className="p-6 text-center text-muted-foreground">Carregando...</div> : (
        <div className="space-y-3">
          {criterios.map(c => {
            const opts = opcoes.filter(o => o.criterio_id === c.id).sort((a,b) => a.ordem - b.ordem);
            return (
              <div key={c.id} className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
                  <div className="flex items-center gap-3 min-w-0">
                    <GripVertical className="h-4 w-4 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{c.label}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">{c.tipo}</span>
                        <span className="text-xs text-muted-foreground">#{c.chave}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={c.ativo} onCheckedChange={() => toggleCritAtivo(c)} />
                    <Button size="sm" variant="ghost" onClick={() => openEditCrit(c)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => removeCrit(c.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>

                <div className="divide-y divide-border/60">
                  {opts.length === 0 && <div className="px-4 py-3 text-xs text-muted-foreground">Nenhuma opção</div>}
                  {opts.map(o => (
                    <div key={o.id} className={`flex items-center justify-between gap-3 px-4 py-2 text-sm ${!o.ativo ? 'opacity-50' : ''}`}>
                      <div className="min-w-0 truncate">{o.label}</div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs text-muted-foreground">R$ {Number(o.valor)}</span>
                        <Switch checked={o.ativo} onCheckedChange={() => toggleOptAtivo(o)} />
                        <Button size="sm" variant="ghost" onClick={() => openEditOpt(o)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => removeOpt(o.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-2 bg-secondary/30">
                  <Button size="sm" variant="outline" onClick={() => openNewOpt(c.id)}><Plus className="h-3.5 w-3.5" /> Nova opção</Button>
                </div>
              </div>
            );
          })}
          {criterios.length === 0 && <div className="p-8 text-center text-muted-foreground bg-card border border-border rounded-lg">Nenhum critério criado ainda</div>}
        </div>
      )}

      {/* Critério dialog */}
      <Dialog open={openCrit} onOpenChange={setOpenCrit}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingCrit ? 'Editar critério' : 'Novo critério'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Chave (única)</Label><Input value={critForm.chave} onChange={e => setCritForm({ ...critForm, chave: e.target.value })} placeholder="ex: responsabilidade" /></div>
            <div><Label>Label</Label><Input value={critForm.label} onChange={e => setCritForm({ ...critForm, label: e.target.value })} /></div>
            <div>
              <Label>Tipo</Label>
              <Select value={critForm.tipo} onValueChange={v => setCritForm({ ...critForm, tipo: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Escolha única (dropdown)</SelectItem>
                  <SelectItem value="multi">Múltipla escolha (checkbox, soma)</SelectItem>
                  <SelectItem value="number">Quantidade × valor unitário</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Ordem</Label><Input type="number" value={critForm.ordem} onChange={e => setCritForm({ ...critForm, ordem: Number(e.target.value) })} /></div>
              <div className="flex items-end gap-2"><Switch checked={critForm.ativo} onCheckedChange={v => setCritForm({ ...critForm, ativo: v })} /><Label>Ativo</Label></div>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpenCrit(false)}>Cancelar</Button><Button onClick={saveCrit}>Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Opção dialog */}
      <Dialog open={openOpt} onOpenChange={setOpenOpt}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingOpt ? 'Editar opção' : 'Nova opção'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Label</Label><Input value={optForm.label} onChange={e => setOptForm({ ...optForm, label: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Valor (R$)</Label><Input type="number" value={optForm.valor} onChange={e => setOptForm({ ...optForm, valor: Number(e.target.value) })} /></div>
              <div><Label>Ordem</Label><Input type="number" value={optForm.ordem} onChange={e => setOptForm({ ...optForm, ordem: Number(e.target.value) })} /></div>
            </div>
            <div className="flex items-center gap-2"><Switch checked={optForm.ativo} onCheckedChange={v => setOptForm({ ...optForm, ativo: v })} /><Label>Ativo</Label></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpenOpt(false)}>Cancelar</Button><Button onClick={saveOpt}>Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
