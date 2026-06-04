import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Pencil, Trash2 } from 'lucide-react';

type Setor = { id: string; nome: string; cor: string };
type Cargo = {
  id: string; nome: string; multiplicador: number; cor: string; ordem: number;
  setor_id: string | null; gap_salarial: number | null; tempo_permanencia_meses: number | null;
};

const blank = (ordem: number): Omit<Cargo, 'id'> => ({
  nome: '', multiplicador: 1.0, cor: '#6366f1', ordem, setor_id: null,
  gap_salarial: null, tempo_permanencia_meses: null,
});

const fmtMeses = (m: number | null) => {
  if (!m) return '—';
  if (m < 12) return `${m}m`;
  const anos = Math.floor(m / 12);
  const resto = m % 12;
  return resto ? `${anos}a ${resto}m` : `${anos}a`;
};

const fmtBRL = (v: number | null) =>
  v != null ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }) : '—';

export function CargosTab() {
  const confirm   = useConfirm();
  const [setores, setSetores]     = useState<Setor[]>([]);
  const [cargos, setCargos]       = useState<Cargo[]>([]);
  const [loading, setLoading]     = useState(true);
  const [open, setOpen]           = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm]           = useState<Omit<Cargo, 'id'>>(blank(1));

  const load = async () => {
    setLoading(true);
    const [c, s] = await Promise.all([
      supabase.from('cargos').select('*').order('setor_id').order('ordem'),
      supabase.from('setores').select('id, nome, cor').order('ordem'),
    ]);
    setCargos(c.data || []);
    setSetores(s.data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditingId(null);
    setForm({ ...blank(cargos.length + 1), setor_id: setores[0]?.id ?? null });
    setOpen(true);
  };

  const openEdit = (c: Cargo) => {
    setEditingId(c.id);
    setForm({
      nome: c.nome, multiplicador: c.multiplicador, cor: c.cor || '#6366f1',
      ordem: c.ordem, setor_id: c.setor_id,
      gap_salarial: c.gap_salarial, tempo_permanencia_meses: c.tempo_permanencia_meses,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.nome.trim()) return toast({ title: 'Preencha o nome do cargo', variant: 'destructive' });
    const payload = {
      ...form,
      multiplicador: Number(form.multiplicador),
      setor_id: form.setor_id || null,
      gap_salarial: form.gap_salarial !== null && (form.gap_salarial as any) !== '' ? Number(form.gap_salarial) : null,
      tempo_permanencia_meses: form.tempo_permanencia_meses !== null && (form.tempo_permanencia_meses as any) !== '' ? Number(form.tempo_permanencia_meses) : null,
    };
    const { error } = editingId
      ? await supabase.from('cargos').update(payload).eq('id', editingId)
      : await supabase.from('cargos').insert(payload);
    if (error) return toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
    toast({ title: editingId ? 'Cargo atualizado' : 'Cargo criado' });
    setOpen(false);
    load();
  };

  const remove = async (c: Cargo) => {
    if (!(await confirm({
      title: `Excluir cargo "${c.nome}"?`,
      description: 'Usuários com esse cargo perderão a referência de multiplicador.',
    }))) return;
    const { error } = await supabase.from('cargos').delete().eq('id', c.id);
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    load();
  };

  // Agrupar por setor
  const groups: { setor: Setor | null; cargos: Cargo[] }[] = [];
  const semSetor = cargos.filter(c => !c.setor_id);
  setores.forEach(s => {
    const group = cargos.filter(c => c.setor_id === s.id);
    if (group.length > 0) groups.push({ setor: s, cargos: group });
  });
  if (semSetor.length > 0) groups.push({ setor: null, cargos: semSetor });

  return (
    <div className="space-y-4 max-w-3xl">

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Cargos</h3>
          <p className="text-xs text-muted-foreground">Níveis, multiplicadores e referências de cada setor.</p>
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus className="h-4 w-4 mr-1" /> Novo cargo
        </Button>
      </div>

      {loading ? (
        <div className="bg-card border border-border rounded-lg p-6 text-center text-muted-foreground text-sm">
          Carregando...
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(({ setor, cargos: gc }) => (
            <div key={setor?.id ?? 'sem-setor'} className="bg-card border border-border rounded-lg overflow-hidden">

              {/* Cabeçalho do setor */}
              <div className="flex items-center gap-2 px-4 py-2.5 bg-secondary/40 border-b border-border">
                {setor ? (
                  <>
                    <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: setor.cor || '#888' }} />
                    <span className="text-xs font-semibold text-foreground">{setor.nome}</span>
                  </>
                ) : (
                  <span className="text-xs font-semibold text-muted-foreground">Sem setor</span>
                )}
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-[11px] text-muted-foreground uppercase tracking-wide">
                    <th className="text-left px-4 py-2">Cargo</th>
                    <th className="text-center px-4 py-2">Mult.</th>
                    <th className="text-center px-4 py-2">Gap salarial</th>
                    <th className="text-center px-4 py-2">Permanência</th>
                    <th className="text-center px-4 py-2">Ordem</th>
                    <th className="px-4 py-2 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {gc.map(c => (
                    <tr key={c.id} className="border-b border-border/50 last:border-0 hover:bg-secondary/30 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: c.cor || setor?.cor || '#888' }} />
                          <span className="font-medium">{c.nome}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
                          style={{ backgroundColor: `${c.cor}22`, color: c.cor }}>
                          {Number(c.multiplicador).toFixed(2)}x
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center text-xs">
                        {c.gap_salarial != null
                          ? <span className="text-emerald-500 font-medium">{fmtBRL(c.gap_salarial)}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center text-xs">
                        {c.tempo_permanencia_meses != null
                          ? <span className="font-medium">{fmtMeses(c.tempo_permanencia_meses)}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center text-xs text-muted-foreground">{c.ordem}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(c)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 ml-1" onClick={() => remove(c)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive/70 hover:text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {groups.length === 0 && (
            <div className="bg-card border border-border rounded-lg p-8 text-center text-muted-foreground text-sm">
              Nenhum cargo cadastrado
            </div>
          )}
        </div>
      )}

      {/* ── Modal ── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar cargo' : 'Novo cargo'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">

            <div>
              <Label className="text-xs">Setor</Label>
              <select value={form.setor_id ?? ''} onChange={e => setForm({ ...form, setor_id: e.target.value || null })}
                className="w-full mt-1 bg-secondary border border-border rounded-md px-3 py-2 text-sm">
                <option value="">— Sem setor —</option>
                {setores.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
            </div>

            <div>
              <Label className="text-xs">Nome do cargo</Label>
              <Input className="mt-1" value={form.nome}
                onChange={e => setForm({ ...form, nome: e.target.value })}
                placeholder="Ex: Júnior 1, Pleno, Sênior" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Multiplicador</Label>
                <Input className="mt-1" type="number" step="0.01" min="0"
                  value={form.multiplicador}
                  onChange={e => setForm({ ...form, multiplicador: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <Label className="text-xs">Ordem</Label>
                <Input className="mt-1" type="number" min="1"
                  value={form.ordem}
                  onChange={e => setForm({ ...form, ordem: parseInt(e.target.value) || 1 })} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1 border-t border-border/50">
              <div className="pt-3">
                <Label className="text-xs">Gap salarial (R$)</Label>
                <Input className="mt-1" type="number" step="0.01" min="0" placeholder="Ex: 500"
                  value={form.gap_salarial ?? ''}
                  onChange={e => setForm({ ...form, gap_salarial: e.target.value !== '' ? parseFloat(e.target.value) : null })} />
              </div>
              <div className="pt-3">
                <Label className="text-xs">Permanência (meses)</Label>
                <Input className="mt-1" type="number" step="1" min="1" placeholder="Ex: 6"
                  value={form.tempo_permanencia_meses ?? ''}
                  onChange={e => setForm({ ...form, tempo_permanencia_meses: e.target.value !== '' ? parseInt(e.target.value) : null })} />
              </div>
            </div>

            <div>
              <Label className="text-xs">Cor</Label>
              <div className="flex items-center gap-2 mt-1">
                <input type="color" value={form.cor}
                  onChange={e => setForm({ ...form, cor: e.target.value })}
                  className="h-9 w-12 rounded cursor-pointer border border-border bg-transparent p-0.5" />
                <Input value={form.cor} onChange={e => setForm({ ...form, cor: e.target.value })} className="font-mono text-xs" />
                <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap"
                  style={{ backgroundColor: `${form.cor}22`, color: form.cor }}>
                  {form.nome || 'Prévia'}
                </span>
              </div>
            </div>

          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save}>{editingId ? 'Salvar' : 'Criar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
