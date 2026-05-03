import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/formatters';
import { Plus, Trash2 } from 'lucide-react';

const FIELDS: { key: string; label: string; bonus?: string }[] = [
  { key: 'responsabilidade', label: 'Responsabilidade e cumprimento de prazos', bonus: 'bonus_responsabilidade' },
  { key: 'refacoes', label: 'Refações por erro técnico', bonus: 'bonus_refacoes' },
  { key: 'aderencia_briefing', label: 'Aderência ao briefing', bonus: 'bonus_aderencia' },
  { key: 'performance_criativos', label: 'Performance dos criativos', bonus: 'bonus_performance' },
  { key: 'proatividade', label: 'Proatividade e evolução técnica', bonus: 'bonus_proatividade' },
  { key: 'performance_grupo', label: 'Performance em grupo', bonus: 'bonus_grupo' },
  { key: 'evolucao', label: 'Evolução e assertividade', bonus: 'bonus_evolucao' },
  { key: 'meta_time', label: 'Meta de time mensal', bonus: 'bonus_meta_time' },
];

export function AvaliacoesTab() {
  const [editores, setEditores] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [filterEditor, setFilterEditor] = useState<string>('all');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(blank());
  const [loading, setLoading] = useState(true);

  function blank() {
    const base: any = {
      editor_id: '', mes_referencia: '', avaliador: '', perfil: '',
      criativos_escalados: 0, bonus_escalados: 0, vsl_escaladas: 0, bonus_vsl: 0,
      bonus_estimado: 0, bonus_total: 0, folgas: 0,
      feedback: '', resumo_ai: '', sugestao_ai: '',
    };
    FIELDS.forEach(f => { base[f.key] = ''; if (f.bonus) base[f.bonus] = 0; });
    return base;
  }

  const load = async () => {
    setLoading(true);
    const [e, a] = await Promise.all([
      supabase.from('editores').select('id, nome').order('nome'),
      supabase.from('avaliacoes_mensais').select('*').order('mes_referencia', { ascending: false }),
    ]);
    setEditores(e.data || []);
    setItems(a.data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const editorMap = Object.fromEntries(editores.map(x => [x.id, x.nome]));

  const filtered = filterEditor === 'all' ? items : items.filter(i => i.editor_id === filterEditor);

  const save = async () => {
    if (!form.editor_id || !form.mes_referencia) {
      return toast({ title: 'Editor e mês obrigatórios', variant: 'destructive' });
    }
    const payload = { ...form };
    ['bonus_responsabilidade','bonus_refacoes','bonus_aderencia','bonus_performance','bonus_proatividade','bonus_grupo','bonus_evolucao','bonus_meta_time','bonus_escalados','bonus_vsl','bonus_estimado','bonus_total','folgas','criativos_escalados','vsl_escaladas']
      .forEach(k => payload[k] = Number(payload[k] || 0));
    const { error } = await supabase.from('avaliacoes_mensais').insert(payload);
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    toast({ title: 'Avaliação salva' });
    setOpen(false); setForm(blank()); load();
  };

  const remove = async (id: string) => {
    if (!confirm('Excluir avaliação?')) return;
    await supabase.from('avaliacoes_mensais').delete().eq('id', id); load();
  };

  // somatório do bônus estimado
  const sumEstimado = () => {
    const keys = ['bonus_responsabilidade','bonus_refacoes','bonus_aderencia','bonus_performance','bonus_proatividade','bonus_grupo','bonus_evolucao','bonus_meta_time','bonus_escalados','bonus_vsl'];
    const total = keys.reduce((s, k) => s + Number(form[k] || 0), 0);
    setForm({ ...form, bonus_estimado: total });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Filtrar por editor</Label>
          <Select value={filterEditor} onValueChange={setFilterEditor}>
            <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {editores.map(e => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Nova avaliação</Button>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? <div className="p-6 text-center text-muted-foreground">Carregando...</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-xs text-muted-foreground uppercase">
                <th className="text-left px-3 py-2">Mês</th>
                <th className="text-left px-3 py-2">Editor</th>
                <th className="text-left px-3 py-2">Avaliador</th>
                <th className="text-left px-3 py-2">Bônus estimado</th>
                <th className="text-left px-3 py-2">Bônus total</th>
                <th className="text-left px-3 py-2">Folgas</th>
                <th className="px-3 py-2"></th>
              </tr></thead>
              <tbody>
                {filtered.map(a => (
                  <tr key={a.id} className="border-b border-border/50 hover:bg-secondary/40">
                    <td className="px-3 py-2">{a.mes_referencia}</td>
                    <td className="px-3 py-2">{editorMap[a.editor_id] || '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{a.avaliador || '—'}</td>
                    <td className="px-3 py-2">{formatCurrency(Number(a.bonus_estimado || 0))}</td>
                    <td className="px-3 py-2 font-medium">{formatCurrency(Number(a.bonus_total || 0))}</td>
                    <td className="px-3 py-2">{a.folgas || 0}</td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => remove(a.id)}><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">Nenhuma avaliação</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nova avaliação mensal</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Editor</Label>
                <Select value={form.editor_id} onValueChange={v => setForm({ ...form, editor_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{editores.map(e => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Mês de referência</Label><Input type="date" value={form.mes_referencia} onChange={e => setForm({ ...form, mes_referencia: e.target.value })} /></div>
              <div><Label>Avaliador(a)</Label><Input value={form.avaliador} onChange={e => setForm({ ...form, avaliador: e.target.value })} /></div>
              <div><Label>Perfil</Label><Input value={form.perfil} onChange={e => setForm({ ...form, perfil: e.target.value })} placeholder="Misto / Estático / Dinâmico" /></div>
            </div>

            <div className="space-y-3">
              {FIELDS.map(f => (
                <div key={f.key} className="grid grid-cols-[1fr_140px] gap-2 items-end">
                  <div>
                    <Label>{f.label}</Label>
                    <Textarea rows={2} value={form[f.key]} onChange={e => setForm({ ...form, [f.key]: e.target.value })} />
                  </div>
                  {f.bonus && (
                    <div>
                      <Label>Bônus (R$)</Label>
                      <Input type="number" value={form[f.bonus]} onChange={e => setForm({ ...form, [f.bonus!]: e.target.value })} />
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-4 gap-3">
              <div><Label>Criativos escalados</Label><Input type="number" value={form.criativos_escalados} onChange={e => setForm({ ...form, criativos_escalados: e.target.value })} /></div>
              <div><Label>Bônus escalados (R$)</Label><Input type="number" value={form.bonus_escalados} onChange={e => setForm({ ...form, bonus_escalados: e.target.value })} /></div>
              <div><Label>VSL escaladas</Label><Input type="number" value={form.vsl_escaladas} onChange={e => setForm({ ...form, vsl_escaladas: e.target.value })} /></div>
              <div><Label>Bônus VSL (R$)</Label><Input type="number" value={form.bonus_vsl} onChange={e => setForm({ ...form, bonus_vsl: e.target.value })} /></div>
            </div>

            <div className="grid grid-cols-3 gap-3 items-end">
              <div><Label>Bônus estimado (R$)</Label><Input type="number" value={form.bonus_estimado} onChange={e => setForm({ ...form, bonus_estimado: e.target.value })} /></div>
              <Button variant="outline" onClick={sumEstimado}>Calcular estimado</Button>
              <div><Label>Bônus total (R$)</Label><Input type="number" value={form.bonus_total} onChange={e => setForm({ ...form, bonus_total: e.target.value })} /></div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><Label>Folgas</Label><Input type="number" step="0.5" value={form.folgas} onChange={e => setForm({ ...form, folgas: e.target.value })} /></div>
            </div>

            <div><Label>Feedback</Label><Textarea rows={3} value={form.feedback} onChange={e => setForm({ ...form, feedback: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Resumo (AI)</Label><Textarea rows={2} value={form.resumo_ai} onChange={e => setForm({ ...form, resumo_ai: e.target.value })} /></div>
              <div><Label>Sugestão de desenvolvimento (AI)</Label><Textarea rows={2} value={form.sugestao_ai} onChange={e => setForm({ ...form, sugestao_ai: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
