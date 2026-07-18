import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { Plus, Trash2, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

type Editor = { id: string; nome: string; cargo_id: string | null; ativo: boolean };
type Cargo  = { id: string; nome: string; cor: string | null };
type Promo  = { id: string; editor_id: string; cargo_id: string; data: string; observacao: string | null };

const blank = () => ({ cargo_id: '', data: '', observacao: '' });

export function PromocoesEditorTab() {
  const confirm = useConfirm();
  const [editores, setEditores]     = useState<Editor[]>([]);
  const [cargos, setCargos]         = useState<Cargo[]>([]);
  const [selected, setSelected]     = useState<Editor | null>(null);
  const [promocoes, setPromocoes]   = useState<Promo[]>([]);
  const [loading, setLoading]       = useState(true);
  const [loadingPromos, setLoadingPromos] = useState(false);
  const [open, setOpen]             = useState(false);
  const [form, setForm]             = useState(blank());
  const [saving, setSaving]         = useState(false);

  const cargoMap = Object.fromEntries(cargos.map(c => [c.id, c]));

  /* ── Load editores + cargos ── */
  const load = async () => {
    setLoading(true);
    const [e, c] = await Promise.all([
      supabase.from('editores').select('id, nome, cargo_id, ativo').not('usuario_id', 'is', null).order('nome'),
      supabase.from('cargos').select('id, nome, cor').order('ordem'),
    ]);
    setEditores(e.data || []);
    setCargos(c.data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  /* ── Load promoções do editor selecionado ── */
  const loadPromos = async (editorId: string) => {
    setLoadingPromos(true);
    const { data } = await supabase
      .from('editor_promocoes')
      .select('*')
      .eq('editor_id', editorId)
      .order('data', { ascending: false });
    setPromocoes(data || []);
    setLoadingPromos(false);
  };

  const selectEditor = (ed: Editor) => {
    setSelected(ed);
    loadPromos(ed.id);
  };

  /* ── Adicionar promoção ── */
  const handleSave = async () => {
    if (!form.cargo_id || !form.data || !selected) return;
    setSaving(true);
    const { error } = await supabase.from('editor_promocoes').insert({
      editor_id: selected.id, cargo_id: form.cargo_id, data: form.data, observacao: form.observacao || null,
    });
    if (error) { toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' }); setSaving(false); return; }
    // Atualiza cargo atual do editor
    await supabase.from('editores').update({ cargo_id: form.cargo_id }).eq('id', selected.id);
    toast({ title: 'Promoção registrada' });
    setSaving(false); setOpen(false); setForm(blank());
    load(); loadPromos(selected.id);
  };

  /* ── Excluir promoção ── */
  const handleDelete = async (p: Promo) => {
    if (!(await confirm({ title: 'Excluir esta promoção?', description: 'Esta ação não pode ser desfeita.' }))) return;
    const { error } = await supabase.from('editor_promocoes').delete().eq('id', p.id);
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    toast({ title: 'Promoção removida' });
    loadPromos(selected!.id);
  };

  return (
    <div className="flex gap-4 min-h-[500px]">

      {/* Lista de editores */}
      <div className="w-52 shrink-0 bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-medium">Editores</h3>
        </div>
        <div className="divide-y divide-border max-h-[560px] overflow-y-auto">
          {loading && <p className="p-4 text-sm text-muted-foreground">Carregando...</p>}
          {!loading && editores.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">Nenhum editor vinculado</p>
          )}
          {editores.map(ed => {
            const cg = ed.cargo_id ? cargoMap[ed.cargo_id] : null;
            return (
              <button
                key={ed.id}
                onClick={() => selectEditor(ed)}
                className={cn(
                  'w-full text-left px-4 py-3 flex items-center justify-between transition-colors hover:bg-secondary/50',
                  selected?.id === ed.id ? 'bg-secondary' : '',
                  !ed.ativo && 'opacity-50',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{ed.nome}</p>
                  {cg && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: cg.cor || '#888' }} />
                      {cg.nome}
                    </p>
                  )}
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </button>
            );
          })}
        </div>
      </div>

      {/* Painel de promoções */}
      <div className="flex-1 min-w-0">
        {!selected ? (
          <div className="bg-card border border-border rounded-lg h-full flex items-center justify-center text-sm text-muted-foreground">
            Selecione um editor para gerenciar as promoções
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div>
                <h4 className="text-sm font-medium">{selected.nome}</h4>
                <p className="text-xs text-muted-foreground">Histórico de promoções</p>
              </div>
              <Button size="sm" onClick={() => { setForm(blank()); setOpen(true); }}>
                <Plus className="h-4 w-4 mr-1" /> Adicionar
              </Button>
            </div>

            {loadingPromos ? (
              <p className="p-6 text-sm text-muted-foreground text-center">Carregando...</p>
            ) : promocoes.length === 0 ? (
              <p className="p-8 text-sm text-muted-foreground text-center">Nenhuma promoção registrada</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30 text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="text-left px-4 py-2.5">Data</th>
                    <th className="text-left px-4 py-2.5">Cargo</th>
                    <th className="text-left px-4 py-2.5">Observação</th>
                    <th className="px-4 py-2.5 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {promocoes.map(p => (
                    <tr key={p.id} className="border-b border-border/50 last:border-0 hover:bg-secondary/20 transition-colors">
                      <td className="px-4 py-2.5 whitespace-nowrap">{p.data}</td>
                      <td className="px-4 py-2.5">
                        {p.cargo_id && cargoMap[p.cargo_id] ? (
                          <span className="flex items-center gap-1.5">
                            <span className="inline-block w-2 h-2 rounded-full shrink-0"
                              style={{ background: cargoMap[p.cargo_id].cor || '#888' }} />
                            {cargoMap[p.cargo_id].nome}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{p.observacao || '—'}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleDelete(p)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive/60 hover:text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Modal: Nova promoção */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nova promoção — {selected?.nome}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Cargo</Label>
              <Select value={form.cargo_id} onValueChange={v => setForm({ ...form, cargo_id: v })}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione o cargo" /></SelectTrigger>
                <SelectContent>
                  {cargos.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Data</Label>
              <Input type="date" className="mt-1" value={form.data} onChange={e => setForm({ ...form, data: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Observação</Label>
              <Textarea className="mt-1 text-xs min-h-[72px]" value={form.observacao}
                placeholder="Opcional"
                onChange={e => setForm({ ...form, observacao: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving || !form.cargo_id || !form.data}>
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
