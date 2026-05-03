import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/formatters';
import { Plus, ChevronRight, Pencil, Trash2 } from 'lucide-react';

type Cargo = { id: string; nome: string; multiplicador: number; cor: string | null; ordem: number };
type Editor = { id: string; nome: string; cargo_id: string | null; data_inicio: string | null; ativo: boolean; observacoes: string | null };

export function PerfisTab() {
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [editores, setEditores] = useState<Editor[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Editor | null>(null);
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<Editor | null>(null);
  const [form, setForm] = useState({ nome: '', cargo_id: '', data_inicio: '', ativo: true, observacoes: '' });

  const load = async () => {
    setLoading(true);
    const [c, e] = await Promise.all([
      supabase.from('cargos').select('*').order('ordem'),
      supabase.from('editores').select('*').order('nome'),
    ]);
    setCargos(c.data || []);
    setEditores(e.data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const cargoMap = Object.fromEntries(cargos.map(c => [c.id, c]));

  const openNew = () => {
    setEditing(null);
    setForm({ nome: '', cargo_id: '', data_inicio: '', ativo: true, observacoes: '' });
    if (cargos.length === 0) load();
    setOpenForm(true);
  };
  const openEdit = (ed: Editor) => {
    setEditing(ed);
    setForm({
      nome: ed.nome, cargo_id: ed.cargo_id || '', data_inicio: ed.data_inicio || '',
      ativo: ed.ativo, observacoes: ed.observacoes || '',
    });
    setOpenForm(true);
  };

  const save = async () => {
    const payload: any = {
      nome: form.nome,
      cargo_id: form.cargo_id || null,
      data_inicio: form.data_inicio || null,
      ativo: form.ativo,
      observacoes: form.observacoes || null,
    };
    const res = editing
      ? await supabase.from('editores').update(payload).eq('id', editing.id)
      : await supabase.from('editores').insert(payload);
    if (res.error) return toast({ title: 'Erro', description: res.error.message, variant: 'destructive' });
    toast({ title: editing ? 'Editor atualizado' : 'Editor criado' });
    setOpenForm(false);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm('Excluir este editor?')) return;
    const { error } = await supabase.from('editores').delete().eq('id', id);
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    if (selected?.id === id) setSelected(null);
    load();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-1 bg-card border border-border rounded-lg">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-medium">Editores</h3>
          <Button size="sm" onClick={openNew}><Plus className="h-4 w-4" /> Novo</Button>
        </div>
        <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
          {loading && <div className="p-4 text-sm text-muted-foreground">Carregando...</div>}
          {!loading && editores.length === 0 && <div className="p-4 text-sm text-muted-foreground">Nenhum editor cadastrado</div>}
          {editores.map(ed => {
            const cg = ed.cargo_id ? cargoMap[ed.cargo_id] : null;
            return (
              <button key={ed.id} onClick={() => setSelected(ed)}
                className={`w-full text-left px-4 py-3 hover:bg-secondary/50 transition-colors flex items-center justify-between ${selected?.id === ed.id ? 'bg-secondary' : ''}`}>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate flex items-center gap-2">
                    {ed.nome}
                    {!ed.ativo && <Badge variant="outline" className="text-xs">inativo</Badge>}
                  </div>
                  {cg && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                      <span className="inline-block w-2 h-2 rounded-full" style={{ background: cg.cor || '#888' }} />
                      {cg.nome} · {Number(cg.multiplicador).toFixed(2)}x
                    </div>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      </div>

      <div className="lg:col-span-2">
        {selected ? (
          <EditorDetail
            editor={selected}
            cargos={cargos}
            cargoMap={cargoMap}
            onEdit={() => openEdit(selected)}
            onDelete={() => remove(selected.id)}
            onChanged={load}
          />
        ) : (
          <div className="bg-card border border-border rounded-lg p-8 text-center text-muted-foreground text-sm">
            Selecione um editor à esquerda para ver detalhes
          </div>
        )}
      </div>

      <Dialog open={openForm} onOpenChange={setOpenForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Editar editor' : 'Novo editor'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nome</Label>
              <Input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div>
              <Label>Cargo</Label>
              <Select value={form.cargo_id} onValueChange={v => setForm({ ...form, cargo_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {cargos.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.nome} — {Number(c.multiplicador).toFixed(2)}x</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Data de início</Label>
              <Input type="date" value={form.data_inicio} onChange={e => setForm({ ...form, data_inicio: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <input id="ativo" type="checkbox" checked={form.ativo} onChange={e => setForm({ ...form, ativo: e.target.checked })} />
              <Label htmlFor="ativo">Ativo</Label>
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea value={form.observacoes} onChange={e => setForm({ ...form, observacoes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenForm(false)}>Cancelar</Button>
            <Button onClick={save}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditorDetail({ editor, cargos, cargoMap, onEdit, onDelete, onChanged }: {
  editor: Editor; cargos: Cargo[]; cargoMap: Record<string, Cargo>;
  onEdit: () => void; onDelete: () => void; onChanged: () => void;
}) {
  const [promocoes, setPromocoes] = useState<any[]>([]);
  const [avaliacoes, setAvaliacoes] = useState<any[]>([]);

  const load = async () => {
    const [p, a] = await Promise.all([
      supabase.from('editor_promocoes').select('*').eq('editor_id', editor.id).order('data', { ascending: false }),
      supabase.from('avaliacoes_mensais').select('*').eq('editor_id', editor.id).order('mes_referencia', { ascending: false }),
    ]);
    setPromocoes(p.data || []); setAvaliacoes(a.data || []);
  };
  useEffect(() => { load(); }, [editor.id]);

  const cargoAtual = editor.cargo_id ? cargoMap[editor.cargo_id] : null;

  const addPromocao = async () => {
    const cargo_id = prompt('ID do cargo (ou cancele e use o formulário abaixo)');
    if (!cargo_id) return;
    const data = prompt('Data (YYYY-MM-DD)');
    if (!data) return;
    await supabase.from('editor_promocoes').insert({ editor_id: editor.id, cargo_id, data });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-lg p-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">{editor.nome}</h2>
            {cargoAtual && (
              <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: cargoAtual.cor || '#888' }} />
                {cargoAtual.nome}
                <Badge variant="secondary">multiplicador {Number(cargoAtual.multiplicador).toFixed(2)}x</Badge>
              </div>
            )}
            <div className="text-xs text-muted-foreground mt-2">
              Início: {editor.data_inicio || '—'} · {editor.ativo ? 'Ativo' : 'Inativo'}
            </div>
            {editor.observacoes && <p className="text-sm mt-3 text-foreground/80">{editor.observacoes}</p>}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
            <Button size="sm" variant="outline" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
      </div>

      <HistoricoPromocoes editorId={editor.id} cargos={cargos} cargoMap={cargoMap} items={promocoes} reload={load} />
      <HistoricoComissoes items={avaliacoes} />
      <HistoricoFolgas items={avaliacoes} />
    </div>
  );
}

function HistoricoPromocoes({ editorId, cargos, cargoMap, items, reload }: any) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ cargo_id: '', data: '', observacao: '' });
  const save = async () => {
    if (!form.cargo_id || !form.data) return;
    const { error } = await supabase.from('editor_promocoes').insert({ editor_id: editorId, ...form });
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    await supabase.from('editores').update({ cargo_id: form.cargo_id }).eq('id', editorId);
    setOpen(false); setForm({ cargo_id: '', data: '', observacao: '' }); reload();
  };
  return (
    <Section title="Histórico de promoções" onAdd={() => setOpen(true)}>
      {items.length === 0 ? <Empty /> : (
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-muted-foreground border-b border-border">
            <th className="text-left py-2 px-3">Data</th><th className="text-left py-2 px-3">Cargo</th><th className="text-left py-2 px-3">Observação</th>
          </tr></thead>
          <tbody>
            {items.map((p: any) => (
              <tr key={p.id} className="border-b border-border/50">
                <td className="py-2 px-3">{p.data}</td>
                <td className="py-2 px-3">{cargoMap[p.cargo_id]?.nome || '—'}</td>
                <td className="py-2 px-3 text-muted-foreground">{p.observacao || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova promoção</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Cargo</Label>
              <Select value={form.cargo_id} onValueChange={v => setForm({ ...form, cargo_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{cargos.map((c: Cargo) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Data</Label><Input type="date" value={form.data} onChange={e => setForm({ ...form, data: e.target.value })} /></div>
            <div><Label>Observação</Label><Textarea value={form.observacao} onChange={e => setForm({ ...form, observacao: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={save}>Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

function HistoricoComissoes({ items }: any) {
  const rows = [...items].sort((a: any, b: any) => (a.mes_referencia < b.mes_referencia ? 1 : -1));
  const totalEstimado = rows.reduce((s: number, i: any) => s + Number(i.bonus_estimado || 0), 0);
  const totalFinal = rows.reduce((s: number, i: any) => s + Number(i.bonus_total || 0), 0);
  return (
    <Section title="Histórico de comissões" extra={<span className="text-xs text-muted-foreground">Calculado das avaliações</span>}>
      {rows.length === 0 ? <Empty /> : (
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-muted-foreground border-b border-border">
            <th className="text-left py-2 px-3">Mês</th>
            <th className="text-left py-2 px-3">Bônus estimado</th>
            <th className="text-left py-2 px-3">Bônus total</th>
            <th className="text-left py-2 px-3">Avaliador</th>
          </tr></thead>
          <tbody>
            {rows.map((p: any) => (
              <tr key={p.id} className="border-b border-border/50">
                <td className="py-2 px-3">{p.mes_referencia}</td>
                <td className="py-2 px-3">{formatCurrency(Number(p.bonus_estimado || 0))}</td>
                <td className="py-2 px-3 font-medium">{formatCurrency(Number(p.bonus_total || 0))}</td>
                <td className="py-2 px-3 text-muted-foreground">{p.avaliador || '—'}</td>
              </tr>
            ))}
            <tr className="bg-secondary/40 font-medium">
              <td className="py-2 px-3">Total</td>
              <td className="py-2 px-3">{formatCurrency(totalEstimado)}</td>
              <td className="py-2 px-3 text-primary">{formatCurrency(totalFinal)}</td>
              <td className="py-2 px-3"></td>
            </tr>
          </tbody>
        </table>
      )}
    </Section>
  );
}

function HistoricoFolgas({ items }: any) {
  const rows = [...items].sort((a: any, b: any) => (a.mes_referencia < b.mes_referencia ? 1 : -1));
  const total = rows.reduce((s: number, i: any) => s + Number(i.folgas || 0), 0);
  return (
    <Section title="Folgas" extra={<span className="text-xs text-muted-foreground">Calculado das avaliações</span>}>
      {rows.length === 0 ? <Empty /> : (
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-muted-foreground border-b border-border">
            <th className="text-left py-2 px-3">Mês</th>
            <th className="text-left py-2 px-3">Folgas</th>
            <th className="text-left py-2 px-3">Avaliador</th>
          </tr></thead>
          <tbody>
            {rows.map((p: any) => (
              <tr key={p.id} className="border-b border-border/50">
                <td className="py-2 px-3">{p.mes_referencia}</td>
                <td className="py-2 px-3">{Number(p.folgas || 0)}</td>
                <td className="py-2 px-3 text-muted-foreground">{p.avaliador || '—'}</td>
              </tr>
            ))}
            <tr className="bg-secondary/40 font-medium">
              <td className="py-2 px-3">Total</td>
              <td className="py-2 px-3 text-primary">{total}</td>
              <td className="py-2 px-3"></td>
            </tr>
          </tbody>
        </table>
      )}
    </Section>
  );
}

function Section({ title, extra, onAdd, children }: any) {
  return (
    <div className="bg-card border border-border rounded-lg">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3"><h4 className="text-sm font-medium">{title}</h4>{extra}</div>
        <Button size="sm" variant="outline" onClick={onAdd}><Plus className="h-4 w-4" /> Adicionar</Button>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}
function Empty() { return <div className="p-6 text-sm text-muted-foreground text-center">Sem registros</div>; }
