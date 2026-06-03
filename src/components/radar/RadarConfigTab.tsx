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
import { cn } from '@/lib/utils';
import { Plus, Pencil, Trash2, Archive, ArchiveRestore, ChevronUp, ChevronDown } from 'lucide-react';

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
  { value: 'trafego',       label: 'Tráfego' },
  { value: 'criativo',      label: 'Criativo' },
  { value: 'funil_oferta',  label: 'Funil & Oferta' },
  { value: 'produto',       label: 'Produto' },
  { value: 'relacionamento',label: 'Relacionamento' },
  { value: 'interno',       label: 'Interno' },
];

const blankArea  = () => ({ nome: '', slug: '', categoria: 'trafego', icone: '🔬', descricao: '' });
const blankProj  = () => ({ nome: '', descricao: '' });

// ─── Seção Áreas ─────────────────────────────────────────────────────────────

function AreasSection() {
  const confirm = useConfirm();
  const [areas, setAreas]       = useState<Area[]>([]);
  const [loading, setLoading]   = useState(true);
  const [open, setOpen]         = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm]         = useState(blankArea());

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('radar_areas').select('*').order('ordem');
    setAreas(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditingId(null);
    setForm(blankArea());
    setOpen(true);
  };

  const openEdit = (a: Area) => {
    setEditingId(a.id);
    setForm({
      nome:      a.nome,
      slug:      a.slug,
      categoria: a.categoria,
      icone:     a.icone || '🔬',
      descricao: (a.descricao || []).join('\n'),
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.nome.trim()) return toast({ title: 'Nome obrigatório', variant: 'destructive' });
    const slug = editingId
      ? form.slug
      : form.nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const payload = {
      nome:      form.nome.trim(),
      slug,
      categoria: form.categoria,
      icone:     form.icone.trim() || '🔬',
      descricao: form.descricao.split('\n').map(s => s.trim()).filter(Boolean),
    };
    const { error } = editingId
      ? await supabase.from('radar_areas').update(payload).eq('id', editingId)
      : await supabase.from('radar_areas').insert({ ...payload, ordem: areas.length + 1 });
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    toast({ title: editingId ? 'Área atualizada' : 'Área criada' });
    setOpen(false);
    load();
  };

  const remove = async (a: Area) => {
    if (!(await confirm({ title: `Excluir "${a.nome}"?`, description: 'Esta ação não pode ser desfeita.' }))) return;
    const { error } = await supabase.from('radar_areas').delete().eq('id', a.id);
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
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
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold">Áreas do Radar</h3>
          <p className="text-xs text-muted-foreground">Categorias de teste disponíveis no Radar Alaskan</p>
        </div>
        <Button size="sm" onClick={openNew}><Plus className="h-3.5 w-3.5 mr-1" /> Nova área</Button>
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground py-4">Carregando...</div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground uppercase">
                <th className="text-left px-3 py-2 w-8">#</th>
                <th className="text-left px-3 py-2">Área</th>
                <th className="text-left px-3 py-2">Categoria</th>
                <th className="text-left px-3 py-2 hidden sm:table-cell">Ícone</th>
                <th className="px-3 py-2 w-28"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a, i) => (
                <tr key={a.id} className="border-b border-border/50 hover:bg-secondary/30">
                  <td className="px-3 py-2 text-muted-foreground">
                    <div className="flex flex-col gap-0.5">
                      <button onClick={() => moveOrdem(a, 'up')} disabled={i === 0} className="disabled:opacity-20 hover:text-foreground">
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button onClick={() => moveOrdem(a, 'down')} disabled={i === sorted.length - 1} className="disabled:opacity-20 hover:text-foreground">
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2 font-medium">{a.nome}</td>
                  <td className="px-3 py-2 text-muted-foreground text-xs">
                    {CATEGORIAS.find(c => c.value === a.categoria)?.label ?? a.categoria}
                  </td>
                  <td className="px-3 py-2 hidden sm:table-cell text-base">{a.icone}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(a)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(a)} className="text-destructive hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground text-xs">Nenhuma área cadastrada</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      <Dialog open={open} onOpenChange={v => !v && setOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar área' : 'Nova área'}</DialogTitle>
          </DialogHeader>
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
              <Textarea
                value={form.descricao}
                onChange={e => setForm({ ...form, descricao: e.target.value })}
                className="mt-1 min-h-[100px] text-sm"
                placeholder="Testes de campanha e público&#10;Estratégias de lance&#10;Escalonamento"
              />
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
  const [projetos, setProjetos]     = useState<Projeto[]>([]);
  const [loading, setLoading]       = useState(true);
  const [open, setOpen]             = useState(false);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [form, setForm]             = useState(blankProj());
  const [showInativos, setShowInativos] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('radar_projetos').select('*').order('ordem');
    setProjetos(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditingId(null);
    setForm(blankProj());
    setOpen(true);
  };

  const openEdit = (p: Projeto) => {
    setEditingId(p.id);
    setForm({ nome: p.nome, descricao: p.descricao || '' });
    setOpen(true);
  };

  const save = async () => {
    if (!form.nome.trim()) return toast({ title: 'Nome obrigatório', variant: 'destructive' });
    const payload = { nome: form.nome.trim(), descricao: form.descricao || null, atualizado_em: new Date().toISOString() };
    const { error } = editingId
      ? await supabase.from('radar_projetos').update(payload).eq('id', editingId)
      : await supabase.from('radar_projetos').insert({ ...payload, ordem: projetos.length + 1 });
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    toast({ title: editingId ? 'Projeto atualizado' : 'Projeto criado' });
    setOpen(false);
    load();
  };

  const toggleAtivo = async (p: Projeto) => {
    const acao = p.ativo ? 'arquivar' : 'restaurar';
    if (!(await confirm({ title: `${acao.charAt(0).toUpperCase() + acao.slice(1)} "${p.nome}"?`, description: p.ativo ? 'O projeto ficará inativo mas não será excluído.' : 'O projeto voltará a aparecer nas opções.' }))) return;
    await supabase.from('radar_projetos').update({ ativo: !p.ativo }).eq('id', p.id);
    load();
  };

  const remove = async (p: Projeto) => {
    if (!(await confirm({ title: `Excluir "${p.nome}"?`, description: 'Esta ação não pode ser desfeita.' }))) return;
    const { error } = await supabase.from('radar_projetos').delete().eq('id', p.id);
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    load();
  };

  const visiveis = projetos.filter(p => showInativos || p.ativo);
  const temInativos = projetos.some(p => !p.ativo);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold">Projetos</h3>
          <p className="text-xs text-muted-foreground">Projetos da empresa — usados para categorizar testes no Radar</p>
        </div>
        <div className="flex items-center gap-2">
          {temInativos && (
            <Button size="sm" variant="ghost" onClick={() => setShowInativos(!showInativos)} className="text-xs text-muted-foreground">
              {showInativos ? 'Ocultar arquivados' : 'Ver arquivados'}
            </Button>
          )}
          <Button size="sm" onClick={openNew}><Plus className="h-3.5 w-3.5 mr-1" /> Novo projeto</Button>
        </div>
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground py-4">Carregando...</div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground uppercase">
                <th className="text-left px-3 py-2">Projeto</th>
                <th className="text-left px-3 py-2 hidden sm:table-cell">Descrição</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="px-3 py-2 w-28"></th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map(p => (
                <tr key={p.id} className={cn('border-b border-border/50 hover:bg-secondary/30', !p.ativo && 'opacity-50')}>
                  <td className="px-3 py-2 font-medium">{p.nome}</td>
                  <td className="px-3 py-2 text-muted-foreground text-xs hidden sm:table-cell">
                    {p.descricao || <span className="italic opacity-50">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded-full border font-medium',
                      p.ativo
                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                        : 'bg-secondary text-muted-foreground border-border'
                    )}>
                      {p.ativo ? 'Ativo' : 'Arquivado'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => toggleAtivo(p)} title={p.ativo ? 'Arquivar' : 'Restaurar'}>
                      {p.ativo ? <Archive className="h-3.5 w-3.5" /> : <ArchiveRestore className="h-3.5 w-3.5" />}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(p)} className="text-destructive hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
              {visiveis.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground text-xs">Nenhum projeto cadastrado</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      <Dialog open={open} onOpenChange={v => !v && setOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar projeto' : 'Novo projeto'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nome <span className="text-destructive">*</span></Label>
              <Input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} className="mt-1" placeholder="Ex: Curso Saponaria Brasil" />
            </div>
            <div>
              <Label>Descrição <span className="text-xs text-muted-foreground">(opcional)</span></Label>
              <Textarea value={form.descricao} onChange={e => setForm({ ...form, descricao: e.target.value })} className="mt-1 min-h-[80px]" placeholder="Breve descrição do projeto..." />
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
    <div className="space-y-10 max-w-4xl">
      <AreasSection />
      <div className="border-t border-border" />
      <ProjetosSection />
    </div>
  );
}
