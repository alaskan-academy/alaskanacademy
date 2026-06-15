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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { cn } from '@/lib/utils';
import {
  ChevronRight, Plus, Edit2, Trash2, Loader2, FileText, Video,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Categoria {
  id: string;
  nome: string;
  icone: string;
  descricao: string | null;
}

interface Artigo {
  id: string;
  titulo: string;
  video_url: string | null;
  criado_em: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extracts the embed src URL from an iframe string, or returns the input as-is */
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
  const [artigos, setArtigos] = useState<Artigo[]>([]);
  const [loading, setLoading] = useState(true);

  // Article form state
  const [formOpen, setFormOpen] = useState(false);
  const [editArtigo, setEditArtigo] = useState<Artigo | null>(null);
  const [fTitulo, setFTitulo] = useState('');
  const [fVideo, setFVideo] = useState('');
  const [fConteudo, setFConteudo] = useState('');
  const [fImagens, setFImagens] = useState(''); // one URL per line
  const [saving, setSaving] = useState(false);

  // ── Data ────────────────────────────────────────────────────────────────────

  const load = async () => {
    if (!categoriaId) return;
    setLoading(true);
    const [{ data: cat }, { data: arts }] = await Promise.all([
      supabase
        .from('processos_categorias')
        .select('id, nome, icone, descricao')
        .eq('id', categoriaId)
        .single(),
      supabase
        .from('processos_artigos')
        .select('id, titulo, video_url, criado_em')
        .eq('categoria_id', categoriaId)
        .eq('ativo', true)
        .order('criado_em', { ascending: false }),
    ]);

    if (!cat) { navigate('/processos'); return; }
    setCategoria(cat);
    setArtigos(arts || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [categoriaId]);

  // ── Article CRUD ────────────────────────────────────────────────────────────

  const openNew = () => {
    setEditArtigo(null);
    setFTitulo('');
    setFVideo('');
    setFConteudo('');
    setFImagens('');
    setFormOpen(true);
  };

  const openEdit = (a: Artigo, e: React.MouseEvent) => {
    e.stopPropagation();
    // Load full article to get conteudo and imagens
    supabase
      .from('processos_artigos')
      .select('id, titulo, video_url, conteudo, imagens')
      .eq('id', a.id)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setEditArtigo(a);
        setFTitulo(data.titulo);
        setFVideo(data.video_url || '');
        setFConteudo(data.conteudo || '');
        setFImagens((data.imagens || []).join('\n'));
        setFormOpen(true);
      });
  };

  const handleDelete = async (a: Artigo, e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await confirm(`Excluir o processo "${a.titulo}"?`);
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
    const imagens = fImagens
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);
    const videoUrl = fVideo.trim() ? extractVideoUrl(fVideo.trim()) : null;
    const now = new Date().toISOString();

    let error;
    if (editArtigo) {
      ({ error } = await supabase
        .from('processos_artigos')
        .update({
          titulo: fTitulo.trim(),
          video_url: videoUrl,
          conteudo: fConteudo.trim() || null,
          imagens,
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
          video_url: videoUrl,
          conteudo: fConteudo.trim() || null,
          imagens,
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
    <DashboardLayout title={categoria?.nome ?? 'Processos'}>
      <div className="max-w-3xl mx-auto">

        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs text-muted-foreground mb-6">
          <Link to="/processos" className="hover:text-foreground transition-colors">
            Processos
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-foreground">{categoria?.nome}</span>
        </nav>

        {/* Category header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{categoria?.icone}</span>
            <div>
              <h2 className="text-xl font-bold text-foreground">{categoria?.nome}</h2>
              {categoria?.descricao && (
                <p className="text-sm text-muted-foreground mt-0.5">{categoria.descricao}</p>
              )}
            </div>
          </div>
          {isAdmin && (
            <Button size="sm" onClick={openNew} className="shrink-0">
              <Plus className="h-4 w-4 mr-1.5" />
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
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            {artigos.map((a, idx) => (
              <div
                key={a.id}
                className={cn(
                  'group flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-accent transition-colors',
                  idx !== artigos.length - 1 && 'border-b border-border/50'
                )}
                onClick={() => navigate(`/processos/${a.id}`)}
              >
                {/* Video badge */}
                {a.video_url && (
                  <Video className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                )}

                <span className="flex-1 text-sm font-medium text-foreground">{a.titulo}</span>

                {/* Admin actions */}
                {isAdmin && (
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
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

                <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0 group-hover:text-muted-foreground transition-colors" />
              </div>
            ))}
          </div>
        )}
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
              <Label htmlFor="art-video">
                URL do Vídeo{' '}
                <span className="text-muted-foreground font-normal">(opcional — Panda Video)</span>
              </Label>
              <Input
                id="art-video"
                className="mt-1.5 font-mono text-xs"
                value={fVideo}
                onChange={e => setFVideo(e.target.value)}
                placeholder="Cole a URL de embed ou o código iframe do Panda Video"
              />
            </div>

            <div>
              <Label htmlFor="art-conteudo">
                Conteúdo{' '}
                <span className="text-muted-foreground font-normal">(suporta Markdown)</span>
              </Label>
              <Textarea
                id="art-conteudo"
                className="mt-1.5 resize-none font-mono text-xs leading-relaxed"
                rows={14}
                value={fConteudo}
                onChange={e => setFConteudo(e.target.value)}
                placeholder={`## Introdução\n\nDescreva o processo aqui...\n\n## Passo a passo\n\n1. Primeiro passo\n2. Segundo passo\n3. Terceiro passo\n\n**Dica:** use **negrito** e *itálico* para destacar.`}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                ## Título &nbsp;•&nbsp; ### Subtítulo &nbsp;•&nbsp; **negrito** &nbsp;•&nbsp; *itálico* &nbsp;•&nbsp; 1. lista numerada &nbsp;•&nbsp; - lista com marcador &nbsp;•&nbsp; [link](url)
              </p>
            </div>

            <div>
              <Label htmlFor="art-imagens">
                Imagens ilustrativas{' '}
                <span className="text-muted-foreground font-normal">(opcional — uma URL por linha)</span>
              </Label>
              <Textarea
                id="art-imagens"
                className="mt-1.5 resize-none font-mono text-xs"
                rows={3}
                value={fImagens}
                onChange={e => setFImagens(e.target.value)}
                placeholder={"https://exemplo.com/imagem1.png\nhttps://exemplo.com/imagem2.png"}
              />
            </div>

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
