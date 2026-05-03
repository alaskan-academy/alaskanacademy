import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/formatters';
import { Plus, Trash2 } from 'lucide-react';

type Opcao = { id: string; criterio_id: string; label: string; valor: number; ordem: number; ativo: boolean };
type Criterio = { id: string; chave: string; label: string; tipo: 'single' | 'multi' | 'number'; ordem: number; ativo: boolean; opcoes: Opcao[] };

export function AvaliacoesTab() {
  const [editores, setEditores] = useState<any[]>([]);
  const [cargos, setCargos] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [criterios, setCriterios] = useState<Criterio[]>([]);
  const [filterEditor, setFilterEditor] = useState<string>('all');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(blankForm());
  const [loading, setLoading] = useState(true);

  function blankForm() {
    return {
      editor_id: '', mes_referencia: '', avaliador: '', perfil: '',
      criativos_escalados: 0, vsl_escaladas: 0,
      bonus_total_override: '', // se vazio, usa cálculo automático
      feedback: '',
      respostas: {} as Record<string, string | string[] | number>,
    };
  }

  const load = async () => {
    setLoading(true);
    const [e, a, c, o, cg] = await Promise.all([
      supabase.from('editores').select('id, nome, cargo_id').order('nome'),
      supabase.from('avaliacoes_mensais').select('*').order('mes_referencia', { ascending: false }),
      supabase.from('criterios_avaliacao').select('*').eq('ativo', true).order('ordem'),
      supabase.from('criterio_opcoes').select('*').eq('ativo', true).order('ordem'),
      supabase.from('cargos').select('*'),
    ]);
    setEditores(e.data || []);
    setItems(a.data || []);
    setCargos(cg.data || []);
    const opts = o.data || [];
    setCriterios((c.data || []).map((cr: any) => ({ ...cr, opcoes: opts.filter((x: any) => x.criterio_id === cr.id) })));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const editorMap = Object.fromEntries(editores.map(x => [x.id, x.nome]));
  const cargoMap = Object.fromEntries(cargos.map(c => [c.id, c]));
  const filtered = filterEditor === 'all' ? items : items.filter(i => i.editor_id === filterEditor);

  // Cargo do editor selecionado e multiplicador
  const editorSel = editores.find(e => e.id === form.editor_id);
  const cargoSel = editorSel?.cargo_id ? cargoMap[editorSel.cargo_id] : null;
  const multiplicador = cargoSel ? Number(cargoSel.multiplicador) : 1;

  // Cálculo automático do bônus base
  const { bonusBase, folgasAuto } = useMemo(() => {
    let total = 0;
    let folgas = 0;
    const folgaRe = /\((\d+(?:[.,]\d+)?)\s*folgas?\)/i;
    for (const cr of criterios) {
      const r = form.respostas[cr.chave];
      if (cr.tipo === 'single' && r) {
        const op = cr.opcoes.find(o => o.id === r);
        if (op) {
          total += Number(op.valor);
          const m = op.label.match(folgaRe); if (m) folgas += Number(m[1].replace(',', '.'));
        }
      } else if (cr.tipo === 'multi' && Array.isArray(r)) {
        for (const id of r) {
          const op = cr.opcoes.find(o => o.id === id);
          if (op) {
            total += Number(op.valor);
            const m = op.label.match(folgaRe); if (m) folgas += Number(m[1].replace(',', '.'));
          }
        }
      } else if (cr.tipo === 'number') {
        const unit = Number(cr.opcoes[0]?.valor || 0);
        total += Number(r || 0) * unit;
      }
    }
    total += Number(form.criativos_escalados || 0) * 50;
    total += Number(form.vsl_escaladas || 0) * 100;
    return { bonusBase: total, folgasAuto: folgas };
  }, [form, criterios]);

  const bonusEstimado = bonusBase;
  const bonusComMultiplicador = Math.round(bonusBase * multiplicador * 100) / 100;


  const openNew = () => { setForm(blankForm()); setOpen(true); };

  const save = async () => {
    if (!form.editor_id || !form.mes_referencia)
      return toast({ title: 'Editor e mês obrigatórios', variant: 'destructive' });

    // Snapshot textual das respostas para preservar histórico se opções forem alteradas
    const respostasSnapshot: Record<string, any> = {};
    for (const cr of criterios) {
      const r = form.respostas[cr.chave];
      if (cr.tipo === 'single' && r) {
        const op = cr.opcoes.find(o => o.id === r);
        if (op) respostasSnapshot[cr.chave] = { tipo: 'single', label: op.label, valor: Number(op.valor) };
      } else if (cr.tipo === 'multi' && Array.isArray(r)) {
        const sel = cr.opcoes.filter(o => r.includes(o.id)).map(o => ({ label: o.label, valor: Number(o.valor) }));
        respostasSnapshot[cr.chave] = { tipo: 'multi', selecoes: sel };
      } else if (cr.tipo === 'number') {
        respostasSnapshot[cr.chave] = { tipo: 'number', quantidade: Number(r || 0), unitario: Number(cr.opcoes[0]?.valor || 0) };
      }
    }

    const payload: any = {
      editor_id: form.editor_id,
      mes_referencia: form.mes_referencia,
      avaliador: form.avaliador || null,
      perfil: form.perfil || null,
      criativos_escalados: Number(form.criativos_escalados || 0),
      bonus_escalados: Number(form.criativos_escalados || 0) * 50,
      vsl_escaladas: Number(form.vsl_escaladas || 0),
      bonus_vsl: Number(form.vsl_escaladas || 0) * 100,
      bonus_estimado: bonusEstimado,
      bonus_total: Number(form.bonus_total || bonusEstimado),
      folgas: Number(form.folgas || 0),
      feedback: form.feedback || null,
      resumo_ai: form.resumo_ai || null,
      sugestao_ai: form.sugestao_ai || null,
      respostas: respostasSnapshot,
    };
    const { error } = await supabase.from('avaliacoes_mensais').insert(payload);
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    toast({ title: 'Avaliação salva' });
    setOpen(false); setForm(blankForm()); load();
  };

  const remove = async (id: string) => {
    if (!confirm('Excluir avaliação?')) return;
    await supabase.from('avaliacoes_mensais').delete().eq('id', id); load();
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
        <Button onClick={openNew}><Plus className="h-4 w-4" /> Nova avaliação</Button>
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

            {criterios.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground bg-secondary/30 rounded">
                Nenhum critério configurado. Vá até a aba <strong>Configuração</strong> para criar.
              </div>
            )}

            {criterios.map(cr => (
              <div key={cr.id} className="space-y-2 border-b border-border/40 pb-3">
                <Label className="text-sm">{cr.label}</Label>
                {cr.tipo === 'single' && (
                  <Select
                    value={(form.respostas[cr.chave] as string) || ''}
                    onValueChange={v => setForm({ ...form, respostas: { ...form.respostas, [cr.chave]: v } })}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecione uma opção" /></SelectTrigger>
                    <SelectContent>
                      {cr.opcoes.map(op => (
                        <SelectItem key={op.id} value={op.id}>
                          {op.label} <span className="text-muted-foreground">(R$ {Number(op.valor)})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {cr.tipo === 'multi' && (
                  <div className="space-y-1.5">
                    {cr.opcoes.map(op => {
                      const arr = (form.respostas[cr.chave] as string[]) || [];
                      const checked = arr.includes(op.id);
                      return (
                        <label key={op.id} className="flex items-start gap-2 text-sm cursor-pointer hover:bg-secondary/30 rounded px-2 py-1">
                          <Checkbox checked={checked} onCheckedChange={(v) => {
                            const next = v ? [...arr, op.id] : arr.filter(x => x !== op.id);
                            setForm({ ...form, respostas: { ...form.respostas, [cr.chave]: next } });
                          }} />
                          <span>{op.label} <span className="text-muted-foreground">(R$ {Number(op.valor)})</span></span>
                        </label>
                      );
                    })}
                  </div>
                )}
                {cr.tipo === 'number' && (
                  <div className="flex items-center gap-2">
                    <Input type="number" min={0} className="w-32"
                      value={(form.respostas[cr.chave] as number) || 0}
                      onChange={e => setForm({ ...form, respostas: { ...form.respostas, [cr.chave]: Number(e.target.value) } })} />
                    <span className="text-xs text-muted-foreground">× R$ {Number(cr.opcoes[0]?.valor || 0)} cada</span>
                  </div>
                )}
              </div>
            ))}

            <div className="grid grid-cols-2 gap-3">
              <div><Label>Criativos escalados</Label><Input type="number" value={form.criativos_escalados} onChange={e => setForm({ ...form, criativos_escalados: e.target.value })} /><span className="text-xs text-muted-foreground">R$ 50 por unidade</span></div>
              <div><Label>VSL escaladas</Label><Input type="number" value={form.vsl_escaladas} onChange={e => setForm({ ...form, vsl_escaladas: e.target.value })} /><span className="text-xs text-muted-foreground">R$ 100 por unidade</span></div>
            </div>

            <div className="bg-secondary/40 border border-border rounded-lg p-4 grid grid-cols-2 gap-4 items-end">
              <div>
                <Label className="text-xs text-muted-foreground">Bônus estimado (calculado)</Label>
                <div className="text-2xl font-semibold text-primary">{formatCurrency(bonusEstimado)}</div>
              </div>
              <div>
                <Label>Bônus total a pagar (R$)</Label>
                <Input type="number" value={form.bonus_total || bonusEstimado} onChange={e => setForm({ ...form, bonus_total: e.target.value })} />
                <p className="text-xs text-muted-foreground mt-1">Aplique multiplicador de cargo aqui se necessário.</p>
              </div>
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
