import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { supabase } from '@/lib/supabase';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { Trash2, Pencil, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { PerfisTab } from '@/components/editores/PerfisTab';
import { AvaliacoesTab } from '@/components/editores/AvaliacoesTab';
import { DesempenhoTab } from '@/components/editores/DesempenhoTab';
import { ConfiguracaoTab } from '@/components/editores/ConfiguracaoTab';
import { EmpresasOfertasTab } from '@/components/editores/EmpresasOfertasTab';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type Row = {
  id: string;
  mes_referencia: string;
  empresa: string;
  oferta: string;
  editor_id: string;
  ads_testados: number;
  ads_validados: number;
};

const blank = () => ({
  id: '' as string,
  mes_referencia: '',
  empresa: '',
  oferta: '',
  editor_id: '',
  ads_testados: 0,
  ads_validados: 0,
});

export default function EditorsPage() {
  const confirm = useConfirm();
  const [editors, setEditors] = useState<any[]>([]);
  const [empresas, setEmpresas] = useState<any[]>([]);
  const [ofertas, setOfertas] = useState<any[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank());
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [e, r, emp, of] = await Promise.all([
      supabase.from('editores').select('id, nome').order('nome'),
      supabase.from('avaliacoes_criativos').select('*').order('mes_referencia', { ascending: false }),
      supabase.from('empresas').select('*').eq('ativo', true).order('nome'),
      supabase.from('ofertas_editores').select('*').eq('ativo', true).order('nome'),
    ]);
    setEditors(e.data || []);
    setRows((r.data as any) || []);
    setEmpresas(emp.data || []);
    setOfertas(of.data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const editorMap = Object.fromEntries(editors.map(x => [x.id, x.nome]));
  const ofertasFiltradas = form.empresa
    ? ofertas.filter(o => {
        const emp = empresas.find(e => e.nome === form.empresa);
        return !emp || !o.empresa_id || o.empresa_id === emp.id;
      })
    : ofertas;

  const taxa = (testados: number, validados: number) =>
    testados > 0 ? Math.round((validados / testados) * 100) : 0;

  const openNew = () => { setEditingId(null); setForm(blank()); setOpen(true); };
  const openEdit = (r: Row) => {
    setEditingId(r.id);
    setForm({
      id: r.id,
      mes_referencia: r.mes_referencia ? String(r.mes_referencia).slice(0, 7) : '',
      empresa: r.empresa || '',
      oferta: r.oferta || '',
      editor_id: r.editor_id || '',
      ads_testados: Number(r.ads_testados || 0),
      ads_validados: Number(r.ads_validados || 0),
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.mes_referencia || !form.editor_id || !form.empresa || !form.oferta) {
      return toast({ title: 'Preencha mês, empresa, oferta e editor', variant: 'destructive' });
    }
    const payload = {
      mes_referencia: `${form.mes_referencia.slice(0, 7)}-01`,
      empresa: form.empresa,
      oferta: form.oferta,
      editor_id: form.editor_id,
      ads_testados: Number(form.ads_testados),
      ads_validados: Number(form.ads_validados),
      taxa_assertividade: taxa(Number(form.ads_testados), Number(form.ads_validados)),
    };
    const { error } = editingId
      ? await supabase.from('avaliacoes_criativos').update(payload).eq('id', editingId)
      : await supabase.from('avaliacoes_criativos').insert(payload);
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    toast({ title: editingId ? 'Atualizado' : 'Salvo' });
    setOpen(false); setEditingId(null); setForm(blank()); load();
  };

  const remove = async (id: string) => {
    if (!(await confirm({ title: 'Excluir registro?', description: 'Esta entrada será removida permanentemente.' }))) return;
    const { error } = await supabase.from('avaliacoes_criativos').delete().eq('id', id);
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    load();
  };

  const tabCls = "data-[state=active]:bg-primary data-[state=active]:text-primary-foreground";

  return (
    <DashboardLayout title="Performance de Editores">
      <Tabs defaultValue="perfis" className="space-y-4">
        <TabsList className="bg-secondary border border-border flex-wrap h-auto">
          <TabsTrigger value="perfis" className={tabCls}>Perfis</TabsTrigger>
          <TabsTrigger value="avaliacoes" className={tabCls}>Avaliações</TabsTrigger>
          <TabsTrigger value="desempenho" className={tabCls}>Desempenho</TabsTrigger>
          <TabsTrigger value="avaliacao" className={tabCls}>Avaliar criativo</TabsTrigger>
          <TabsTrigger value="config" className={tabCls}>Configuração</TabsTrigger>
        </TabsList>

        <TabsContent value="perfis"><PerfisTab /></TabsContent>
        <TabsContent value="avaliacoes"><AvaliacoesTab /></TabsContent>
        <TabsContent value="desempenho"><DesempenhoTab /></TabsContent>
        <TabsContent value="config">
          <Tabs defaultValue="criterios" className="space-y-4">
            <TabsList className="bg-secondary border border-border">
              <TabsTrigger value="criterios" className={tabCls}>Critérios</TabsTrigger>
              <TabsTrigger value="empresas" className={tabCls}>Empresas e ofertas</TabsTrigger>
            </TabsList>
            <TabsContent value="criterios"><ConfiguracaoTab /></TabsContent>
            <TabsContent value="empresas"><EmpresasOfertasTab /></TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="avaliacao">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold">Desempenho de ADs</h3>
                <p className="text-xs text-muted-foreground">Registre Ads testados e validados por editor, oferta e empresa.</p>
              </div>
              <Button onClick={openNew}><Plus className="h-4 w-4" /> Novo registro</Button>
            </div>

            <div className="bg-card border border-border rounded-lg overflow-hidden">
              {loading ? <div className="p-6 text-center text-muted-foreground">Carregando...</div> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground uppercase">
                        <th className="text-left px-3 py-2">Mês de análise</th>
                        <th className="text-left px-3 py-2">Empresa</th>
                        <th className="text-left px-3 py-2">Oferta</th>
                        <th className="text-left px-3 py-2">Editor responsável</th>
                        <th className="text-right px-3 py-2">Ads testados</th>
                        <th className="text-right px-3 py-2">Ads validados</th>
                        <th className="text-right px-3 py-2">Taxa (%)</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => (
                        <tr key={r.id} className="border-b border-border/50 hover:bg-secondary/40 cursor-pointer" onClick={() => openEdit(r)}>
                          <td className="px-3 py-2">{r.mes_referencia ? String(r.mes_referencia).slice(0, 7) : '—'}</td>
                          <td className="px-3 py-2">{r.empresa}</td>
                          <td className="px-3 py-2">{r.oferta}</td>
                          <td className="px-3 py-2">{editorMap[r.editor_id] || '—'}</td>
                          <td className="px-3 py-2 text-right">{r.ads_testados}</td>
                          <td className="px-3 py-2 text-right">{r.ads_validados}</td>
                          <td className="px-3 py-2 text-right font-medium">{taxa(r.ads_testados, r.ads_validados)}%</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                            <Button size="sm" variant="ghost" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                            <Button size="sm" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4" /></Button>
                          </td>
                        </tr>
                      ))}
                      {rows.length === 0 && (
                        <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">Nenhum registro</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <Dialog open={open} onOpenChange={setOpen}>
              <DialogContent>
                <DialogHeader><DialogTitle>{editingId ? 'Editar registro' : 'Novo registro'}</DialogTitle></DialogHeader>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Mês de análise</Label><Input type="month" value={form.mes_referencia} onChange={e => setForm({ ...form, mes_referencia: e.target.value })} /></div>
                  <div>
                    <Label>Editor responsável</Label>
                    <select value={form.editor_id} onChange={e => setForm({ ...form, editor_id: e.target.value })}
                      className="w-full mt-1 bg-secondary border border-border rounded-md px-3 py-2 text-sm">
                      <option value="">Selecione...</option>
                      {editors.map(ed => <option key={ed.id} value={ed.id}>{ed.nome}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label>Empresa</Label>
                    <Select value={form.empresa} onValueChange={v => setForm({ ...form, empresa: v, oferta: '' })}>
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {empresas.map(e => <SelectItem key={e.id} value={e.nome}>{e.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Oferta</Label>
                    <Select value={form.oferta} onValueChange={v => setForm({ ...form, oferta: v })}>
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {ofertasFiltradas.map(o => <SelectItem key={o.id} value={o.nome}>{o.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Ads testados</Label><Input type="number" min={0} value={form.ads_testados} onChange={e => setForm({ ...form, ads_testados: Number(e.target.value) })} /></div>
                  <div><Label>Ads validados</Label><Input type="number" min={0} value={form.ads_validados} onChange={e => setForm({ ...form, ads_validados: Number(e.target.value) })} /></div>
                  <div className="col-span-2">
                    <Label>Taxa de assertividade</Label>
                    <div className="text-2xl font-semibold text-primary">{taxa(form.ads_testados, form.ads_validados)}%</div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                  <Button onClick={save}>{editingId ? 'Salvar alterações' : 'Salvar'}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
}
