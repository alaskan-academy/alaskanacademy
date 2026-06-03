import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown } from 'lucide-react';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Area = {
  id: string;
  slug: string;
  nome: string;
  categoria: string;
  icone: string;
  descricao: string[];
  ordem: number;
  ativo: boolean;
};

type Projeto = {
  id: string;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  ordem: number;
};

const CATEGORIAS = [
  { value: 'trafego',        label: 'Tráfego' },
  { value: 'criativo',       label: 'Criativo' },
  { value: 'funil_oferta',   label: 'Funil & Oferta' },
  { value: 'produto',        label: 'Produto' },
  { value: 'relacionamento', label: 'Relacionamento' },
  { value: 'interno',        label: 'Interno' },
];

const blankArea = () => ({ nome: '', slug: '', categoria: 'trafego', icone: '🔬', descricao: '' });
const blankProj = () => ({ nome: '', descricao: '' });

// ─── Seção Áreas ─────────────────────────────────────────────────────────────

function AreasSection() {
  const confirm = useConfirm();
  const [areas, setAreas]         = useState<Area[]>([]);
  const [loading, setLoading]     = useState(true);
  const [open, setOpen]           = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm]           = useState(blankArea());

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('radar_areas').select('*').order('ordem');
    setAreas(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditingId(null); setForm(blankArea()); setOpen(true); };
  const openEdit = (a: Area) => {
    setEditingId(a.id);
    setForm({ nome: a.nome, slug: a.slug, categoria: a.categoria, icone: a.icone || '🔬', descricao: (a.descricao || []).join('\n') });
    setOpen(true);
  };

  const save = async () => {
    if (!form.nome.trim()) return toast({ title: 'Nome obrigatório', variant: 'destructive' });
    const slug = editingId
      ? form.slug
      : form.nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const payload = {
      nome: form.nome.trim(), slug,
      categoria: form.categoria,
      icone: form.icone.trim() || '🔬',
      descricao: form.descricao.split('\n').map(s => s.trim()).filter(Boolean),
    };
    const { error } = editingId
      ? await supabase.from('radar_areas').update(payload).eq('id', editingId)
      : await supabase.from('radar_areas').insert({ ...payload, ordem: areas.length + 1 });
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    toast({ title: editingId ? 'Área atualizada' : 'Área criada' });
    setOpen(false); load();
  };

  const remove = async (a: Area) => {
    if (!(await confirm({ title: `Excluir "${a.nome}"?`, description: 'Esta ação não pode ser desfeita.' }))) return;
    const { error } = await supabase.from('radar_areas').delete().eq('id', a.id);
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    load();
  };

  const toggleAtivo = async (a: Area) => {
    await supabase.from('radar_areas').update({ ativo: !a.ativo }).eq('id', a.id);
    load();
  };

  const moveOrdem = async (a: Area, dir: 'up' | 'down') => {
    const sorted = [...areas].sort((x, y) => x.ordem - y.ordem);
    const idx = sorted.findIndex(x => x.id === a.id);
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const other = sorted[swapIdx];
    await Promise.all([
      supabase.from('radar_areas').update({ ordem: other.ordem }).eq('id', a.id),
      supabase.from('radar_areas').update({ ordem: a.ordem }).eq('id', other.id),
    ]);
    load();
  };

  const sorted = [...areas].sort((a, b) => a.ordem - b.ordem);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold uppercase tracking-wide text-primary">Áreas</h4>
          <p className="text-xs text-muted-foreground">Categorias de teste disponíveis no Radar.</p>
        </div>
        <Button size="sm" onClick={openNew}><Plus className="h-4 w-4" /> Nova</Button>
      </div>

      {loading ? (
        <div className="p-4 text-sm text-muted-foreground">Carregando...</div>
      ) : (
        <div className="bg-card border border-border rounded-lg divide-y divide-border/60">
          {sorted.length === 0 && <div className="p-4 text-sm text-muted-foreground">Nenhuma área cadastrada</div>}
          {sorted.map((a, i) => (
            <div key={a.id} className={`flex items-center justify-between gap-2 px-4 py-2 text-sm ${!a.ativo ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-2 min-w-0">
                {/* reordenar */}
                <div className="flex flex-col shrink-0">
                  <button onClick={() => moveOrdem(a, 'up')} disabled={i === 0} className="disabled:opacity-20 text-muted-foreground hover:text-foreground leading-none">
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button onClick={() => moveOrdem(a, 'down')} disabled={i === sorted.length - 1} className="disabled:opacity-20 text-muted-foreground hover:text-foreground leading-none">
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </div>
                <span className="text-base shrink-0">{a.icone}</span>
                <div className="min-w-0">
                  <div className="font-medium truncate">{a.nome}</div>
                  <div className="text-xs text-muted-foreground">{CATEGORIAS.find(c => c.value === a.categoria)?.label ?? a.categoria}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Switch checked={a.ativo} onCheckedChange={() => toggleAtivo(a)} />
                <Button size="sm" variant="ghost" onClick={() => openEdit(a)}><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="ghost" onClick={() => remove(a)} className="text-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={v => !v && setOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingId ? 'Editar área' : 'Nova área'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label>Nome <span className="text-destructive">*</span></Label>
                <Input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} className="mt-1" placeholder="Ex: Meta Ads" />
              </div>
              <div>
                <Label>Ícone (emoji)</Label>
                <Input value={form.icone} onChange={e => setForm({ ...form, icone: e.target.value })} className="mt-1 text-center text-xl" placeholder="📣" />
              </div>
            </div>
            <div>
              <Label>Categoria</Label>
              <Select value={form.categoria} onValueChange={v => setForm({ ...form, categoria: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIAS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Descrição <span className="text-xs text-muted-foreground">(uma linha por tópico)</span></Label>
              <Textarea value={form.descricao} onChange={e => setForm({ ...form, descricao: e.target.value })}
                className="mt-1 min-h-[100px] text-sm"
                placeholder="Testes de campanha e público&#10;Estratégias de lance&#10;Escalonamento" />
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

// ─── Seção Projetos ───────────────────────────────────────────────────────────

function ProjetosSection() {
  const confirm = useConfirm();
  const [projetos, setProjetos]   = useState<Projeto[]>([]);
  const [loading, setLoading]     = useState(true);
  const [open, setOpen]           = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm]           = useState(blankProj());

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('radar_projetos').select('*').order('ordem');
    setProjetos(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditingId(null); setForm(blankProj()); setOpen(true); };
  const openEdit = (p: Projeto) => { setEditingId(p.id); setForm({ nome: p.nome, descricao: p.descricao || '' }); setOpen(true); };

  const save = async () => {
    if (!form.nome.trim()) return toast({ title: 'Nome obrigatório', variant: 'destructive' });
    const payload = { nome: form.nome.trim(), descricao: form.descricao || null, atualizado_em: new Date().toISOString() };
    const { error } = editingId
      ? await supabase.from('radar_projetos').update(payload).eq('id', editingId)
      : await supabase.from('radar_projetos').insert({ ...payload, ordem: projetos.length + 1 });
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    toast({ title: editingId ? 'Projeto atualizado' : 'Projeto criado' });
    setOpen(false); load();
  };

  const toggleAtivo = async (p: Projeto) => {
    await supabase.from('radar_projetos').update({ ativo: !p.ativo }).eq('id', p.id);
    load();
  };

  const remove = async (p: Projeto) => {
    if (!(await confirm({ title: `Excluir "${p.nome}"?`, description: 'Esta ação não pode ser desfeita.' }))) return;
    const { error } = await supabase.from('radar_projetos').delete().eq('id', p.id);
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    load();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold uppercase tracking-wide text-primary">Projetos</h4>
          <p className="text-xs text-muted-foreground">Projetos da empresa para categorizar testes no Radar.</p>
        </div>
        <Button size="sm" onClick={openNew}><Plus className="h-4 w-4" /> Novo</Button>
      </div>

      {loading ? (
        <div className="p-4 text-sm text-muted-foreground">Carregando...</div>
      ) : (
        <div className="bg-card border border-border rounded-lg divide-y divide-border/60">
          {projetos.length === 0 && <div className="p-4 text-sm text-muted-foreground">Nenhum projeto cadastrado</div>}
          {projetos.map(p => (
            <div key={p.id} className={`flex items-center justify-between gap-2 px-4 py-2 text-sm ${!p.ativo ? 'opacity-50' : ''}`}>
              <div className="min-w-0">
                <div className="font-medium truncate">{p.nome}</div>
                {p.descricao && <div className="text-xs text-muted-foreground truncate">{p.descricao}</div>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Switch checked={p.ativo} onCheckedChange={() => toggleAtivo(p)} />
                <Button size="sm" variant="ghost" onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="ghost" onClick={() => remove(p)} className="text-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={v => !v && setOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editingId ? 'Editar projeto' : 'Novo projeto'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nome <span className="text-destructive">*</span></Label>
              <Input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} className="mt-1" placeholder="Ex: Curso Saponaria Brasil" />
            </div>
            <div>
              <Label>Descrição <span className="text-xs text-muted-foreground">(opcional)</span></Label>
              <Textarea value={form.descricao} onChange={e => setForm({ ...form, descricao: e.target.value })} className="mt-1 min-h-[70px]" placeholder="Breve descrição do projeto..." />
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

// ─── Tab principal ────────────────────────────────────────────────────────────

export function RadarConfigTab() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-4xl">
      <AreasSection />
      <ProjetosSection />
    </div>
  );
}
