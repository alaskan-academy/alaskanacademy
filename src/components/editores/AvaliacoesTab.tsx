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
import { useConfirm } from '@/hooks/use-confirm';
import { formatCurrency } from '@/lib/formatters';
import { Plus, Trash2, Pencil } from 'lucide-react';

type Opcao = { id: string; criterio_id: string; label: string; valor: number; ordem: number; ativo: boolean };
type Criterio = { id: string; chave: string; label: string; tipo: 'single' | 'multi' | 'number'; ordem: number; ativo: boolean; opcoes: Opcao[] };

const CHAVE_CRIATIVOS = 'criativos_escalados';
const CHAVE_VSL = 'vsl_escaladas';

export function AvaliacoesTab() {
  const confirm = useConfirm();
  const [editores, setEditores] = useState<any[]>([]);
  const [cargos, setCargos] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [criterios, setCriterios] = useState<Criterio[]>([]);
  const [filterEditor, setFilterEditor] = useState<string>('all');
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<any>(blankForm());
  const [loading, setLoading] = useState(true);

  function blankForm() {
    return {
      editor_id: '', mes_referencia: '', data_lancamento: '', avaliador: '', perfil: '',
      bonus_total_override: '',
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

  const editorSel = editores.find(e => e.id === form.editor_id);
  const cargoSel = editorSel?.cargo_id ? cargoMap[editorSel.cargo_id] : null;
  const multiplicador = cargoSel ? Number(cargoSel.multiplicador) : 1;

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
    return { bonusBase: total, folgasAuto: folgas };
  }, [form, criterios]);

  const bonusEstimado = bonusBase;
  const bonusComMultiplicador = Math.round(bonusBase * multiplicador * 100) / 100;

  const openNew = () => { setEditingId(null); setForm(blankForm()); setOpen(true); };

  const openEdit = (a: any) => {
    const respostas: Record<string, any> = {};
    const snap = a.respostas || {};
    for (const cr of criterios) {
      const s = snap[cr.chave];
      if (!s) continue;
      if (cr.tipo === 'single') {
        const op = cr.opcoes.find(o => o.id === s.id) || cr.opcoes.find(o => o.label === s.label);
        if (op) respostas[cr.chave] = op.id;
      } else if (cr.tipo === 'multi') {
        const ids: string[] = [];
        for (const sel of (s.selecoes || [])) {
          const op = cr.opcoes.find(o => o.id === sel.id) || cr.opcoes.find(o => o.label === sel.label);
          if (op) ids.push(op.id);
        }
        respostas[cr.chave] = ids;
      } else if (cr.tipo === 'number') {
        respostas[cr.chave] = Number(s.quantidade || 0);
      }
    }
    // Compat: se colunas legadas existirem e critérios ainda não foram criados, ainda exibir
    if (a.criativos_escalados != null && respostas[CHAVE_CRIATIVOS] == null) respostas[CHAVE_CRIATIVOS] = Number(a.criativos_escalados);
    if (a.vsl_escaladas != null && respostas[CHAVE_VSL] == null) respostas[CHAVE_VSL] = Number(a.vsl_escaladas);

    setEditingId(a.id);
    setForm({
      editor_id: a.editor_id || '',
      mes_referencia: a.mes_referencia ? String(a.mes_referencia).slice(0, 7) : '',
      data_lancamento: a.data_lancamento ? String(a.data_lancamento).slice(0, 10) : '',
      avaliador: a.avaliador || '',
      perfil: a.perfil || '',
      bonus_total_override: a.bonus_total != null && a.bonus_estimado != null && Number(a.bonus_total) !== Math.round(Number(a.bonus_estimado) * (cargoMap[editores.find(e => e.id === a.editor_id)?.cargo_id]?.multiplicador || 1) * 100) / 100
        ? String(a.bonus_total) : '',
      feedback: a.feedback || '',
      respostas,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.editor_id || !form.mes_referencia)
      return toast({ title: 'Editor e mês obrigatórios', variant: 'destructive' });

    const respostasSnapshot: Record<string, any> = {};
    for (const cr of criterios) {
      const r = form.respostas[cr.chave];
      if (cr.tipo === 'single' && r) {
        const op = cr.opcoes.find(o => o.id === r);
        if (op) respostasSnapshot[cr.chave] = { tipo: 'single', id: op.id, label: op.label, valor: Number(op.valor) };
      } else if (cr.tipo === 'multi' && Array.isArray(r)) {
        const sel = cr.opcoes.filter(o => r.includes(o.id)).map(o => ({ id: o.id, label: o.label, valor: Number(o.valor) }));
        respostasSnapshot[cr.chave] = { tipo: 'multi', selecoes: sel };
      } else if (cr.tipo === 'number') {
        respostasSnapshot[cr.chave] = { tipo: 'number', quantidade: Number(r || 0), unitario: Number(cr.opcoes[0]?.valor || 0) };
      }
    }

    const bonusFinal = form.bonus_total_override !== '' && form.bonus_total_override != null
      ? Number(form.bonus_total_override)
      : bonusComMultiplicador;

    // Mantém colunas legadas se os critérios existirem
    const critCriativos = criterios.find(c => c.chave === CHAVE_CRIATIVOS);
    const critVsl = criterios.find(c => c.chave === CHAVE_VSL);
    const qtdCriativos = Number(form.respostas[CHAVE_CRIATIVOS] || 0);
    const qtdVsl = Number(form.respostas[CHAVE_VSL] || 0);
    const unitCriativos = Number(critCriativos?.opcoes[0]?.valor || 50);
    const unitVsl = Number(critVsl?.opcoes[0]?.valor || 100);

    const payload: any = {
      editor_id: form.editor_id,
      mes_referencia: form.mes_referencia ? `${form.mes_referencia.slice(0, 7)}-01` : null,
      data_lancamento: form.data_lancamento || null,
      avaliador: form.avaliador || null,
      perfil: form.perfil || null,
      criativos_escalados: qtdCriativos,
      bonus_escalados: qtdCriativos * unitCriativos,
      vsl_escaladas: qtdVsl,
      bonus_vsl: qtdVsl * unitVsl,
      bonus_estimado: bonusEstimado,
      bonus_total: bonusFinal,
      folgas: folgasAuto,
      feedback: form.feedback || null,
      respostas: respostasSnapshot,
    };
    const { error } = editingId
      ? await supabase.from('avaliacoes_mensais').update(payload).eq('id', editingId)
      : await supabase.from('avaliacoes_mensais').insert(payload);
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    toast({ title: editingId ? 'Avaliação atualizada' : 'Avaliação salva' });
    setOpen(false); setEditingId(null); setForm(blankForm()); load();
  };

  const remove = async (id: string) => {
    if (!(await confirm({ title: 'Excluir avaliação?', description: 'Esta avaliação será removida permanentemente.' }))) return;
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
                <th className="text-left px-3 py-2">Bônus total</th>
                <th className="text-left px-3 py-2">Folgas</th>
                <th className="px-3 py-2"></th>
              </tr></thead>
              <tbody>
                {filtered.map(a => (
                  <tr key={a.id} className="border-b border-border/50 hover:bg-secondary/40 cursor-pointer" onClick={() => openEdit(a)}>
                    <td className="px-3 py-2">{a.mes_referencia}</td>
                    <td className="px-3 py-2">{editorMap[a.editor_id] || '—'}</td>
                    <td className="px-3 py-2 font-medium">{formatCurrency(Number(a.bonus_total || 0))}</td>
                    <td className="px-3 py-2">{a.folgas || 0}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(a)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(a.id)}><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">Nenhuma avaliação</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingId ? 'Editar avaliação' : 'Nova avaliação mensal'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Editor</Label>
                <Select value={form.editor_id} onValueChange={v => setForm({ ...form, editor_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{editores.map(e => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Mês de referência</Label><Input type="month" value={form.mes_referencia} onChange={e => setForm({ ...form, mes_referencia: e.target.value })} /></div>
              <div><Label>Data de lançamento</Label><Input type="date" value={form.data_lancamento} onChange={e => setForm({ ...form, data_lancamento: e.target.value })} /></div>
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

            <div className="bg-secondary/40 border border-border rounded-lg p-4 space-y-3">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Bônus base</Label>
                  <div className="text-lg font-medium">{formatCurrency(bonusEstimado)}</div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Multiplicador {cargoSel ? `(${cargoSel.nome})` : ''}</Label>
                  <div className="text-lg font-medium">{multiplicador.toFixed(2)}x</div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Folgas (auto)</Label>
                  <div className="text-lg font-medium">{folgasAuto}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 items-end pt-2 border-t border-border/60">
                <div>
                  <Label className="text-xs text-muted-foreground">Bônus total calculado</Label>
                  <div className="text-2xl font-semibold text-primary">{formatCurrency(bonusComMultiplicador)}</div>
                </div>
                <div>
                  <Label>Override do bônus total (opcional)</Label>
                  <Input type="number" placeholder={String(bonusComMultiplicador)}
                    value={form.bonus_total_override}
                    onChange={e => setForm({ ...form, bonus_total_override: e.target.value })} />
                </div>
              </div>
            </div>

            <div><Label>Feedback</Label><Textarea rows={3} value={form.feedback} onChange={e => setForm({ ...form, feedback: e.target.value })} /></div>

          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save}>{editingId ? 'Salvar alterações' : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
