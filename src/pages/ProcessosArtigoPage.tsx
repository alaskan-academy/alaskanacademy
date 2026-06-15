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
import { MarkdownRenderer, extractTOC, type TocItem } from '@/components/MarkdownRenderer';
import { ChevronRight, Edit2, Loader2, ImageIcon, ArrowLeft, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Artigo {
  id: string;
  titulo: string;
  video_url: string | null;
  conteudo: string | null;
  imagens: string[];
  criado_em: string;
  atualizado_em: string;
  categoria_id: string;
  categoria_nome: string;
  categoria_icone: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractVideoUrl(raw: string): string {
  const m = raw.match(/src=["']([^"']+)["']/);
  return m ? m[1] : raw.trim();
}

function readingTime(content: string): string {
  const words = content.trim().split(/\s+/).length;
  const minutes = Math.max(1, Math.round(words / 200));
  return `${minutes} min de leitura`;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProcessosArtigoPage() {
  const { artigoId } = useParams<{ artigoId: string }>();
  const navigate = useNavigate();
  const { perfil, user } = useAuth();
  const isAdmin = perfil?.is_admin;

  const [artigo, setArtigo] = useState<Artigo | null>(null);
  const [loading, setLoading] = useState(true);
  const [toc, setToc] = useState<TocItem[]>([]);

  // Edit form
  const [formOpen, setFormOpen] = useState(false);
  const [fTitulo, setFTitulo] = useState('');
  const [fVideo, setFVideo] = useState('');
  const [fConteudo, setFConteudo] = useState('');
  const [fImagens, setFImagens] = useState('');
  const [saving, setSaving] = useState(false);

  // Image lightbox
  const [lightbox, setLightbox] = useState<string | null>(null);

  // Active TOC item
  const [activeToc, setActiveToc] = useState<string>('');

  // ── Data ────────────────────────────────────────────────────────────────────

  const load = async () => {
    if (!artigoId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('processos_artigos')
      .select(`
        id, titulo, video_url, conteudo, imagens, criado_em, atualizado_em,
        categoria_id,
        processos_categorias ( nome, icone )
      `)
      .eq('id', artigoId)
      .eq('ativo', true)
      .single();

    if (error || !data) {
      navigate('/processos');
      return;
    }

    const loaded: Artigo = {
      id: data.id,
      titulo: data.titulo,
      video_url: data.video_url,
      conteudo: data.conteudo,
      imagens: data.imagens || [],
      criado_em: data.criado_em,
      atualizado_em: data.atualizado_em,
      categoria_id: data.categoria_id,
      categoria_nome: (data.processos_categorias as any)?.nome ?? '',
      categoria_icone: (data.processos_categorias as any)?.icone ?? '📋',
    };

    setArtigo(loaded);
    setToc(loaded.conteudo ? extractTOC(loaded.conteudo) : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [artigoId]);

  // ── Edit form ────────────────────────────────────────────────────────────────

  const openEdit = () => {
    if (!artigo) return;
    setFTitulo(artigo.titulo);
    setFVideo(artigo.video_url || '');
    setFConteudo(artigo.conteudo || '');
    setFImagens(artigo.imagens.join('\n'));
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!fTitulo.trim() || !artigo) return;
    setSaving(true);
    const imagens = fImagens.split('\n').map(l => l.trim()).filter(Boolean);
    const videoUrl = fVideo.trim() ? extractVideoUrl(fVideo.trim()) : null;

    const { error } = await supabase
      .from('processos_artigos')
      .update({
        titulo: fTitulo.trim(),
        video_url: videoUrl,
        conteudo: fConteudo.trim() || null,
        imagens,
        atualizado_por: user?.id,
        atualizado_em: new Date().toISOString(),
      })
      .eq('id', artigo.id);

    setSaving(false);
    if (error) {
      toast({ title: 'Erro', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Processo atualizado' });
    setFormOpen(false);
    load();
  };

  // ── TOC scroll ───────────────────────────────────────────────────────────────

  const scrollToHeading = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveToc(id);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <DashboardLayout title="Carregando...">
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  if (!artigo) return null;

  return (
    <DashboardLayout title={artigo.titulo}>
      <div className="max-w-5xl mx-auto">

        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs text-muted-foreground mb-8">
          <Link to="/processos" className="hover:text-foreground transition-colors flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" />
            Processos
          </Link>
          <ChevronRight className="h-3 w-3" />
          <Link
            to={`/processos/c/${artigo.categoria_id}`}
            className="hover:text-foreground transition-colors"
          >
            {artigo.categoria_nome}
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-foreground truncate max-w-[220px]">{artigo.titulo}</span>
        </nav>

        {/* ── Two-column layout: article + TOC ── */}
        <div className="flex gap-8 items-start">

          {/* ── Main article ── */}
          <article className="flex-1 min-w-0">

            {/* Article header */}
            <div className="mb-6">
              {/* Category badge */}
              <div className="flex items-center gap-2 mb-3">
                <span className="text-base">{artigo.categoria_icone}</span>
                <span className="text-xs text-muted-foreground font-medium">{artigo.categoria_nome}</span>
                {artigo.conteudo && (
                  <>
                    <span className="text-muted-foreground/30">·</span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {readingTime(artigo.conteudo)}
                    </span>
                  </>
                )}
              </div>

              <div className="flex items-start justify-between gap-4">
                <h1 className="text-2xl font-bold text-foreground leading-tight">{artigo.titulo}</h1>
                {isAdmin && (
                  <Button size="sm" variant="outline" onClick={openEdit} className="shrink-0 gap-1.5">
                    <Edit2 className="h-3.5 w-3.5" />
                    Editar
                  </Button>
                )}
              </div>
            </div>

            {/* Video embed */}
            {artigo.video_url && (
              <div className="mb-8">
                <div
                  className="relative w-full rounded-xl overflow-hidden border border-border bg-black"
                  style={{ paddingBottom: '56.25%' }}
                >
                  <iframe
                    src={artigo.video_url}
                    className="absolute inset-0 w-full h-full"
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                    allowFullScreen
                    title={artigo.titulo}
                  />
                </div>
              </div>
            )}

            {/* Markdown content */}
            {artigo.conteudo && (
              <div className="bg-card border border-border rounded-xl px-8 py-7 mb-6">
                <MarkdownRenderer content={artigo.conteudo} />
              </div>
            )}

            {/* Images */}
            {artigo.imagens.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-medium text-muted-foreground">Imagens ilustrativas</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {artigo.imagens.map((url, i) => (
                    <button
                      key={i}
                      onClick={() => setLightbox(url)}
                      className="relative aspect-video rounded-lg overflow-hidden border border-border bg-muted hover:opacity-90 transition-opacity"
                      title="Clique para ampliar"
                    >
                      <img
                        src={url}
                        alt={`Imagem ${i + 1}`}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="text-xs text-muted-foreground/50 mt-8 pt-4 border-t border-border/40 flex items-center justify-between">
              <span>
                Atualizado em{' '}
                {new Date(artigo.atualizado_em).toLocaleDateString('pt-BR', {
                  day: '2-digit', month: 'long', year: 'numeric',
                })}
              </span>
              <Link
                to={`/processos/c/${artigo.categoria_id}`}
                className="flex items-center gap-1 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              >
                Ver todos de {artigo.categoria_nome}
                <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
          </article>

          {/* ── Right sidebar — Table of Contents ── */}
          {toc.length > 1 && (
            <aside className="w-52 shrink-0 hidden xl:block">
              <div className="sticky top-6">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-3">
                  Neste artigo
                </p>
                <nav className="space-y-0.5">
                  {toc.map(item => (
                    <button
                      key={item.id}
                      onClick={() => scrollToHeading(item.id)}
                      className={cn(
                        'w-full text-left text-xs py-1.5 transition-colors rounded',
                        item.level === 1 && 'font-semibold',
                        item.level === 2 && 'pl-0',
                        item.level === 3 && 'pl-3',
                        activeToc === item.id
                          ? 'text-primary font-medium'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {item.level === 3 && (
                        <span className="inline-block w-1 h-1 rounded-full bg-muted-foreground/40 mr-1.5 mb-0.5" />
                      )}
                      {item.text}
                    </button>
                  ))}
                </nav>
              </div>
            </aside>
          )}
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt="Imagem ampliada"
            className="max-w-full max-h-full rounded-xl object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {/* ── Edit dialog ── */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Processo</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            <div>
              <Label htmlFor="edit-titulo">Título *</Label>
              <Input
                id="edit-titulo"
                className="mt-1.5"
                value={fTitulo}
                onChange={e => setFTitulo(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="edit-video">
                URL do Vídeo{' '}
                <span className="text-muted-foreground font-normal">(opcional — Panda Video)</span>
              </Label>
              <Input
                id="edit-video"
                className="mt-1.5 font-mono text-xs"
                value={fVideo}
                onChange={e => setFVideo(e.target.value)}
                placeholder="Cole a URL de embed ou o código iframe do Panda Video"
              />
            </div>

            <div>
              <Label htmlFor="edit-conteudo">
                Conteúdo{' '}
                <span className="text-muted-foreground font-normal">(suporta Markdown)</span>
              </Label>
              <Textarea
                id="edit-conteudo"
                className="mt-1.5 resize-none font-mono text-xs leading-relaxed"
                rows={14}
                value={fConteudo}
                onChange={e => setFConteudo(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                ## Título &nbsp;•&nbsp; ### Subtítulo &nbsp;•&nbsp; **negrito** &nbsp;•&nbsp; *itálico* &nbsp;•&nbsp; 1. lista &nbsp;•&nbsp; [link](url)
              </p>
            </div>

            <div>
              <Label htmlFor="edit-imagens">
                Imagens ilustrativas{' '}
                <span className="text-muted-foreground font-normal">(opcional — uma URL por linha)</span>
              </Label>
              <Textarea
                id="edit-imagens"
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
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
