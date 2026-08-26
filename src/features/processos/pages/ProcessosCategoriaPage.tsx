import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
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
import { BlocosEditor } from '../components/BlocosEditor';
import { lerBlocos, semVazios, type Bloco } from '../components/BlocosRenderer';
import {
  ChevronRight, Plus, Edit2, Trash2, Loader2, FileText, Video, ArrowLeft,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Categoria {
  id: string;
  nome: string;
  icone: string;
  descricao: string | null;
}

interface CategoriaNav {
  id: string;
  nome: string;
  icone: string;
}

interface Artigo {
  id: string;
  titulo: string;
  video_url: string | null;
  criado_em: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractVideoUrl(raw: string): string {
  const m = raw.match(/src=["']([^"']+)["']/);
  return m ? m[1] : raw.trim();
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProcessosCategoriaPage() {
  const { categoriaId } = useParams<{ categoriaId: string }>();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { perfil, user } = useAuth();
  const isAdmin = perfil?.is_admin;

  const [categoria, setCategoria] = useState<Categoria | null>(null);
  const [todasCategorias, setTodasCategorias] = useState<CategoriaNav[]>([]);
  const [artigos, setArtigos] = useState<Artigo[]>([]);
  const [loading, setLoading] = useState(true);

  // Article form state
  const [formOpen, setFormOpen] = useState(false);
  const [editArtigo, setEditArtigo] = useState<Artigo | null>(null);
  const [fTitulo, setFTitulo] = useState('');
  const [fBlocos, setFBlocos] = useState<Bloco[]>([]);
  const [fCategoriasAdicionais, setFCategoriasAdicionais] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // ── Data ────────────────────────────────────────────────────────────────────

  const load = async () => {
    // O id vem da URL. Sem conferir o formato, ele entra numa expressão de
    // filtro montada por concatenação logo abaixo, e um `,` ou `)` digitado
    // ali quebra a consulta — ou muda o que ela filtra.
    if (!categoriaId || !/^[0-9a-f-]{36}$/i.test(categoriaId)) {
      navigate('/processos');
      return;
    }
    setLoading(true);
    const [{ data: cat }, { data: arts }, { data: allCats }] = await Promise.all([
      supabase
        .from('processos_categorias')
        .select('id, nome, icone, descricao')
        .eq('id', categoriaId)
        // Categoria excluída continuava abrindo por URL, com os artigos dentro
        // — a grade da home filtra `ativo`, esta página não filtrava.
        .eq('ativo', true)
        .maybeSingle(),
      supabase
        .from('processos_artigos')
        .select('id, titulo, video_url, criado_em')
        .or(`categoria_id.eq.${categoriaId},categorias_adicionais.cs.{${categoriaId}}`)
        .eq('ativo', true)
        .order('criado_em', { ascending: false }),
      supabase
        .from('processos_categorias')
        .select('id, nome, icone')
        .eq('ativo', true)
        .order('criado_em', { ascending: false }),
    ]);

    if (!cat) { navigate('/processos'); return; }
    setCategoria(cat);
    setArtigos(arts || []);
    setTodasCategorias(allCats || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [categoriaId]);

  // ── Article CRUD ────────────────────────────────────────────────────────────

  const openNew = () => {
    setEditArtigo(null);
    setFTitulo('');
    // Já começa com um bloco de texto: uma tela em branco com quatro botões
    // faz a pessoa escolher antes de saber o que quer, e o texto é sempre o
    // primeiro passo.
    setFBlocos([{ tipo: 'texto', dados: { html: '' } }]);
    setFCategoriasAdicionais([]);
    setFormOpen(true);
  };

  const openEdit = (a: Artigo, e: React.MouseEvent) => {
    e.stopPropagation();
    supabase
      .from('processos_artigos')
      .select('id, titulo, blocos, categorias_adicionais')
      .eq('id', a.id)
      .single()
      .then(({ data, error }) => {
        // Falhava em silêncio: sem `error`, um problema de rede deixava o botão
        // "Editar" simplesmente não fazendo nada.
        if (error || !data) {
          toast({
            title: 'Não consegui abrir este processo',
            description: error?.message, variant: 'destructive',
          });
          return;
        }
        setEditArtigo(a);
        setFTitulo(data.titulo);
        setFBlocos(lerBlocos(data.blocos));
        setFCategoriasAdicionais(data.categorias_adicionais || []);
        setFormOpen(true);
      });
  };

  const handleDelete = async (a: Artigo, e: React.MouseEvent) => {
    e.stopPropagation();
    // Objeto, não string — ver o mesmo conserto em `ProcessosPage`.
    const ok = await confirm({
      title: `Excluir o processo "${a.titulo}"?`,
      // A de categoria já explicava o que acontece; esta ficava só com o
      // título e a frase genérica do diálogo. Quem exclui precisa saber que
      // some da busca também, e não só da lista que está vendo.
      description: 'Ele sai desta lista, da busca e de qualquer outra categoria em que apareça.',
      confirmText: 'Excluir',
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase
      .from('processos_artigos')
      .update({ ativo: false, atualizado_em: new Date().toISOString() })
      .eq('id', a.id);
    if (error) {
      toast({ title: 'Erro', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Processo excluído' });
    load();
  };

  const handleSave = async () => {
    if (!fTitulo.trim() || !categoriaId) return;
    setSaving(true);
    const now = new Date().toISOString();
    const blocos = semVazios(fBlocos);

    let error;
    if (editArtigo) {
      ({ error } = await supabase
        .from('processos_artigos')
        .update({
          titulo: fTitulo.trim(),
          blocos,
          // Os campos antigos são zerados ao salvar: manter os dois seria duas
          // versões do mesmo texto, e elas divergiriam na primeira edição.
          conteudo: null,
          video_url: null,
          imagens: [],
          categorias_adicionais: fCategoriasAdicionais,
          atualizado_por: user?.id,
          atualizado_em: now,
        })
        .eq('id', editArtigo.id));
    } else {
      ({ error } = await supabase
        .from('processos_artigos')
        .insert({
          titulo: fTitulo.trim(),
          categoria_id: categoriaId,
          blocos,
          categorias_adicionais: fCategoriasAdicionais,
          criado_por: user?.id,
        }));
    }

    setSaving(false);
    if (error) {
      toast({ title: 'Erro', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: editArtigo ? 'Processo atualizado' : 'Processo criado' });
    setFormOpen(false);
    load();
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout title={categoria?.nome ?? 'Processos'} hideFilters hideTitle>
      <div className="max-w-5xl mx-auto">

        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs text-muted-foreground mb-6">
          <Link to="/processos" className="hover:text-foreground transition-colors flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" />
            Processos
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-foreground">{categoria?.nome}</span>
        </nav>

        <div className="flex gap-7 items-start">

          {/* ── Left sidebar — category navigation ── */}
          <aside className="w-52 shrink-0 hidden lg:block">
            <div className="sticky top-6">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-3 px-2">
                Categorias
              </p>
              <nav className="space-y-0.5">
                {todasCategorias.map(c => (
                  <button
                    key={c.id}
                    onClick={() => navigate(`/processos/c/${c.id}`)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors',
                      c.id === categoriaId
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    )}
                  >
                    <span className="text-base shrink-0">{c.icone}</span>
                    <span className="truncate">{c.nome}</span>
                  </button>
                ))}
              </nav>
            </div>
          </aside>

          {/* ── Main content ── */}
          <div className="flex-1 min-w-0">

            {/* Category header */}
            <div className="flex items-start justify-between gap-4 mb-6">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-2xl shrink-0">
                  {categoria?.icone}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground leading-tight">{categoria?.nome}</h2>
                  {categoria?.descricao && (
                    <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">
                      {categoria.descricao}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {artigos.length} artigo{artigos.length !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>

              {isAdmin && (
                <Button size="sm" onClick={openNew} className="shrink-0 gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  Novo Processo
                </Button>
              )}
            </div>

            {/* Articles list */}
            {loading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : artigos.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-xl">
                <FileText className="h-8 w-8 mx-auto mb-3 opacity-30" />
                <p className="font-medium">Nenhum processo nesta categoria</p>
                {isAdmin && (
                  <p className="text-sm mt-1">Clique em &ldquo;Novo Processo&rdquo; para adicionar</p>
                )}
              </div>
            ) : (
              <div className="bg-card border border-border rounded-xl overflow-hidden divide-y divide-border/50">
                {artigos.map(a => (
                  <div
                    key={a.id}
                    // Mesma razão do card de categoria: tem botões dentro, então
                    // não pode ser `button` — mas precisa alcançar o teclado.
                    role="button"
                    tabIndex={0}
                    className="group flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-accent transition-colors focus-visible:outline-none focus-visible:bg-accent focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary"
                    onClick={() => navigate(`/processos/${a.id}`)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(`/processos/${a.id}`);
                      }
                    }}
                  >
                    {/* Left accent stripe (visible on hover) */}
                    <div className="w-0.5 h-8 rounded-full bg-primary scale-y-0 group-hover:scale-y-100 transition-transform origin-center shrink-0" />

                    {/* Video badge */}
                    {a.video_url ? (
                      <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                        <Video className="h-3.5 w-3.5 text-primary" />
                      </div>
                    ) : (
                      <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center shrink-0">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground/60" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
                        {a.titulo}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(a.criado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </p>
                    </div>

                    {/* Admin actions */}
                    {isAdmin && (
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity mr-1">
                        <button
                          onClick={e => openEdit(a, e)}
                          className="p-1.5 rounded-md hover:bg-background border border-transparent hover:border-border text-muted-foreground hover:text-foreground transition-all"
                          title="Editar"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={e => handleDelete(a, e)}
                          className="p-1.5 rounded-md hover:bg-destructive/10 border border-transparent hover:border-destructive/20 text-muted-foreground hover:text-destructive transition-all"
                          title="Excluir"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}

                    <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Article form dialog ── */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editArtigo ? 'Editar Processo' : 'Novo Processo'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            <div>
              <Label htmlFor="art-titulo">Título *</Label>
              <Input
                id="art-titulo"
                className="mt-1.5"
                value={fTitulo}
                onChange={e => setFTitulo(e.target.value)}
                placeholder="Ex: Como criar uma campanha no Meta Ads"
              />
            </div>

            <div>
              <Label>
                Conteúdo{' '}
                <span className="text-muted-foreground font-normal">
                  (blocos — a ordem é sua)
                </span>
              </Label>
              <div className="mt-1.5">
                <BlocosEditor blocos={fBlocos} onChange={setFBlocos} />
              </div>
            </div>

            {/* Extra categories */}
            {todasCategorias.filter(c => c.id !== categoriaId).length > 0 && (
              <div>
                <Label>
                  Também aparece em{' '}
                  <span className="text-muted-foreground font-normal">(opcional — outras categorias)</span>
                </Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {todasCategorias
                    .filter(c => c.id !== categoriaId)
                    .map(c => {
                      const checked = fCategoriasAdicionais.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() =>
                            setFCategoriasAdicionais(prev =>
                              checked ? prev.filter(id => id !== c.id) : [...prev, c.id]
                            )
                          }
                          className={cn(
                            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-all',
                            checked
                              ? 'bg-primary/10 border-primary/40 text-primary font-medium'
                              : 'border-border text-muted-foreground hover:border-muted-foreground/50'
                          )}
                        >
                          <span>{c.icone}</span>
                          <span>{c.nome}</span>
                        </button>
                      );
                    })}
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2 border-t border-border">
              <Button variant="outline" onClick={() => setFormOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={saving || !fTitulo.trim()}>
                {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                {editArtigo ? 'Salvar' : 'Criar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
