import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/DashboardLayout';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { cn } from '@/lib/utils';
import {
  Search, Plus, Edit2, Trash2, Loader2, FileText, ChevronRight,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Categoria {
  id: string;
  nome: string;
  icone: string;
  descricao: string | null;
  ativo: boolean;
  artigo_count: number;
}

interface ArtigoSearch {
  id: string;
  titulo: string;
  categoria_id: string;
  categoria_nome: string;
  categoria_icone: string;
}

// ── Emoji options ─────────────────────────────────────────────────────────────

const ICON_OPTIONS = [
  '📋', '🎨', '📦', '🚀', '⚙️', '📊', '🎯', '💡',
  '🔧', '📝', '🤝', '💬', '🔒', '🌐', '📈', '🎬',
  '🛒', '📣', '✅', '🧪',
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProcessosPage() {
  const { perfil } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const isAdmin = perfil?.is_admin;

  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [artigos, setArtigos] = useState<ArtigoSearch[]>([]);
  const [busca, setBusca] = useState('');
  const [loading, setLoading] = useState(true);

  // Category form
  const [formOpen, setFormOpen] = useState(false);
  const [editCat, setEditCat] = useState<Categoria | null>(null);
  const [fNome, setFNome] = useState('');
  const [fIcone, setFIcone] = useState('📋');
  const [fDesc, setFDesc] = useState('');
  const [saving, setSaving] = useState(false);

  // ── Data ──────────────────────────────────────────────────────────────────

  const load = async () => {
    setLoading(true);
    const [{ data: cats }, { data: arts }] = await Promise.all([
      supabase
        .from('processos_categorias')
        .select('*')
        .eq('ativo', true)
        .order('criado_em', { ascending: false }),
      supabase
        .from('processos_artigos')
        .select('id, titulo, categoria_id, processos_categorias(nome, icone)')
        .eq('ativo', true)
        .order('criado_em', { ascending: false }),
    ]);

    const countMap: Record<string, number> = {};
    (arts || []).forEach((a: any) => {
      countMap[a.categoria_id] = (countMap[a.categoria_id] || 0) + 1;
    });

    setCategorias(
      (cats || []).map((c: any) => ({ ...c, artigo_count: countMap[c.id] || 0 }))
    );
    setArtigos(
      (arts || []).map((a: any) => ({
        id: a.id,
        titulo: a.titulo,
        categoria_id: a.categoria_id,
        categoria_nome: a.processos_categorias?.nome ?? '',
        categoria_icone: a.processos_categorias?.icone ?? '📋',
      }))
    );
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // ── Search ────────────────────────────────────────────────────────────────

  const resultados = useMemo(() => {
    if (!busca.trim()) return [];
    const q = busca.toLowerCase();
    return artigos.filter(a => a.titulo.toLowerCase().includes(q));
  }, [busca, artigos]);

  // ── Category CRUD ─────────────────────────────────────────────────────────

  const openNew = () => {
    setEditCat(null);
    setFNome('');
    setFIcone('📋');
    setFDesc('');
    setFormOpen(true);
  };

  const openEdit = (cat: Categoria, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditCat(cat);
    setFNome(cat.nome);
    setFIcone(cat.icone);
    setFDesc(cat.descricao || '');
    setFormOpen(true);
  };

  const handleDelete = async (cat: Categoria, e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await confirm(
      `Excluir a categoria "${cat.nome}"? Todos os processos vinculados também serão removidos.`
    );
    if (!ok) return;
    const { error } = await supabase
      .from('processos_categorias')
      .update({ ativo: false, atualizado_em: new Date().toISOString() })
      .eq('id', cat.id);
    if (error) {
      toast({ title: 'Erro', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Categoria excluída' });
    load();
  };

  const handleSave = async () => {
    if (!fNome.trim()) return;
    setSaving(true);
    const payload = {
      nome: fNome.trim(),
      icone: fIcone,
      descricao: fDesc.trim() || null,
      atualizado_em: new Date().toISOString(),
    };
    const { error } = editCat
      ? await supabase.from('processos_categorias').update(payload).eq('id', editCat.id)
      : await supabase.from('processos_categorias').insert({
          nome: payload.nome,
          icone: payload.icone,
          descricao: payload.descricao,
        });
    setSaving(false);
    if (error) {
      toast({ title: 'Erro', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: editCat ? 'Categoria atualizada' : 'Categoria criada' });
    setFormOpen(false);
    load();
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout title="Processos da Empresa">
      <div className="max-w-5xl mx-auto">

        {/* Sub-header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <p className="text-sm text-muted-foreground leading-relaxed max-w-xl">
            Central de conhecimento com os processos e fluxos internos da Alaskan.
          </p>
          {isAdmin && (
            <Button size="sm" onClick={openNew} className="shrink-0">
              <Plus className="h-4 w-4 mr-1.5" />
              Nova Categoria
            </Button>
          )}
        </div>

        {/* Search bar */}
        <div className="relative mb-8">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Buscar processos..."
            className="pl-10 h-11 text-sm bg-card"
            value={busca}
            onChange={e => setBusca(e.target.value)}
          />
        </div>

        {/* ── Search results ── */}
        {busca.trim() ? (
          <div>
            <p className="text-xs text-muted-foreground mb-3">
              {resultados.length} resultado{resultados.length !== 1 ? 's' : ''} para &ldquo;{busca}&rdquo;
            </p>
            {resultados.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Search className="h-8 w-8 mx-auto mb-3 opacity-30" />
                <p className="font-medium">Nenhum processo encontrado</p>
                <p className="text-sm mt-1">Tente outra palavra-chave</p>
              </div>
            ) : (
              <div className="space-y-1 bg-card border border-border rounded-xl overflow-hidden">
                {resultados.map((a, idx) => (
                  <button
                    key={a.id}
                    onClick={() => navigate(`/processos/${a.id}`)}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-3.5 hover:bg-accent transition-colors text-left',
                      idx !== resultados.length - 1 && 'border-b border-border/50'
                    )}
                  >
                    <span className="text-xl shrink-0">{a.categoria_icone}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{a.titulo}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{a.categoria_nome}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* ── Category grid ── */
          loading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : categorias.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              <FileText className="h-10 w-10 mx-auto mb-3 opacity-25" />
              <p className="font-medium">Nenhuma categoria ainda</p>
              {isAdmin && (
                <p className="text-sm mt-1">Clique em &ldquo;Nova Categoria&rdquo; para começar</p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {categorias.map(cat => (
                <div
                  key={cat.id}
                  onClick={() => navigate(`/processos/c/${cat.id}`)}
                  className="relative group bg-card border border-border rounded-xl p-6 cursor-pointer hover:border-primary/40 hover:shadow-lg transition-all duration-200"
                >
                  {/* Admin controls */}
                  {isAdmin && (
                    <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={e => openEdit(cat, e)}
                        className="p-1.5 rounded-md bg-background border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                        title="Editar categoria"
                      >
                        <Edit2 className="h-3 w-3" />
                      </button>
                      <button
                        onClick={e => handleDelete(cat, e)}
                        className="p-1.5 rounded-md bg-background border border-border hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        title="Excluir categoria"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )}

                  <div className="text-3xl mb-3">{cat.icone}</div>
                  <h3 className="font-semibold text-foreground mb-1 pr-12">{cat.nome}</h3>
                  {cat.descricao && (
                    <p className="text-xs text-muted-foreground mb-3 line-clamp-2 leading-relaxed">
                      {cat.descricao}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {cat.artigo_count} processo{cat.artigo_count !== 1 ? 's' : ''}
                  </p>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* ── Category form dialog ── */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editCat ? 'Editar Categoria' : 'Nova Categoria'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">

            {/* Icon picker */}
            <div>
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Ícone</Label>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {ICON_OPTIONS.map(ic => (
                  <button
                    key={ic}
                    type="button"
                    onClick={() => setFIcone(ic)}
                    className={cn(
                      'text-xl p-2 rounded-lg border transition-all',
                      fIcone === ic
                        ? 'border-primary bg-primary/10 scale-110'
                        : 'border-border hover:border-muted-foreground/50'
                    )}
                  >
                    {ic}
                  </button>
                ))}
                <Input
                  className="w-14 text-center text-lg px-1"
                  value={fIcone}
                  onChange={e => setFIcone(e.target.value)}
                  maxLength={2}
                  placeholder="✨"
                  title="Ou digite qualquer emoji"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="cat-nome">Nome *</Label>
              <Input
                id="cat-nome"
                className="mt-1.5"
                value={fNome}
                onChange={e => setFNome(e.target.value)}
                placeholder="Ex: Tráfego Pago"
                onKeyDown={e => e.key === 'Enter' && handleSave()}
              />
            </div>

            <div>
              <Label htmlFor="cat-desc">Descrição</Label>
              <Textarea
                id="cat-desc"
                className="mt-1.5 resize-none"
                rows={2}
                value={fDesc}
                onChange={e => setFDesc(e.target.value)}
                placeholder="Breve descrição desta categoria..."
              />
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={() => setFormOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={saving || !fNome.trim()}>
                {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                {editCat ? 'Salvar' : 'Criar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
