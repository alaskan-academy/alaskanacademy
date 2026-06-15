import { useEffect, useState, useMemo, useRef } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { cn } from '@/lib/utils';
import {
  Plus, Search, Pencil, Trash2, Link2, ImageIcon, Upload, X,
  Sheet, Loader2, BookOpen, Tag, User, Calendar, ExternalLink,
} from 'lucide-react';

// ─── Tipos ───────────────────────────────────────────────────────────────────

type Area = {
  id: string;
  slug: string;
  nome: string;
  categoria: string;
  icone: string;
};

type Referencia = {
  id: string;
  titulo: string;
  descricao: string | null;
  area_id: string | null;
  area?: Area;
  links: string[];
  imagens: string[];
  tags: string[];
  criado_por: string | null;
  criado_por_nome?: string;
  criado_em: string;
  atualizado_por: string | null;
  atualizado_em: string | null;
};

type FormState = {
  titulo: string;
  descricao: string;
  area_id: string;
  tags: string;
  links: string[];
  imagensExistentes: string[];
  imagensPendentes: File[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CATEGORIA_LABEL: Record<string, string> = {
  trafego:        'Tráfego',
  criativo:       'Criativo',
  funil_oferta:   'Funil & Oferta',
  produto:        'Produto',
  relacionamento: 'Relacionamento',
  interno:        'Interno',
};

const blankForm = (): FormState => ({
  titulo:             '',
  descricao:          '',
  area_id:            '',
  tags:               '',
  links:              [''],
  imagensExistentes:  [],
  imagensPendentes:   [],
});

function fmtDate(d: string | null) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function hostnameOf(url: string) {
  try { return new URL(url).hostname.replace('www.', ''); } catch { return url.slice(0, 25); }
}

function storagePathFrom(url: string) {
  return url.split('/storage/v1/object/public/referencias/')[1] ?? null;
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function ReferenciasPage() {
  const { perfil, user } = useAuth();
  const isAdmin = perfil?.is_admin ?? false;
  const confirm = useConfirm();

  const [areas,      setAreas]      = useState<Area[]>([]);
  const [referencias, setReferencias] = useState<Referencia[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [syncing,    setSyncing]    = useState(false);

  const [search,     setSearch]     = useState('');
  const [filtroArea, setFiltroArea] = useState('');

  const [openForm,   setOpenForm]   = useState(false);
  const [editingId,  setEditingId]  = useState<string | null>(null);
  const [form,       setForm]       = useState<FormState>(blankForm());
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  const [detalhe,    setDetalhe]    = useState<Referencia | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = async () => {
    setLoading(true);
    const [{ data: areasData }, { data: refsData }, { data: perfisData }] = await Promise.all([
      supabase.from('radar_areas').select('*').eq('ativo', true).order('ordem'),
      supabase.from('referencias').select('*').is('deletado_em', null).order('criado_em', { ascending: false }),
      supabase.from('perfis').select('id, nome').order('nome'),
    ]);
    setAreas(areasData || []);
    const areaMap  = Object.fromEntries((areasData  || []).map((a: Area)    => [a.id, a]));
    const perfilMap = Object.fromEntries((perfisData || []).map((p: any)    => [p.id, p.nome]));
    setReferencias((refsData || []).map((r: any) => ({
      ...r,
      links:            r.links   || [],
      imagens:          r.imagens || [],
      tags:             r.tags    || [],
      area:             areaMap[r.area_id] ?? null,
      criado_por_nome:  perfilMap[r.criado_por] ?? null,
    })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // ── Filtros ───────────────────────────────────────────────────────────────
  const filtradas = useMemo(() => referencias.filter(r => {
    if (search) {
      const q = search.toLowerCase();
      const match = r.titulo.toLowerCase().includes(q)
        || (r.descricao || '').toLowerCase().includes(q)
        || r.tags.some(t => t.toLowerCase().includes(q));
      if (!match) return false;
    }
    if (filtroArea && r.area_id !== filtroArea) return false;
    return true;
  }), [referencias, search, filtroArea]);

  // ── Form helpers ──────────────────────────────────────────────────────────
  const openNew = () => {
    setEditingId(null);
    setForm(blankForm());
    setPreviewUrls([]);
    setOpenForm(true);
  };

  const openEdit = (r: Referencia) => {
    setDetalhe(null);
    setEditingId(r.id);
    setForm({
      titulo:            r.titulo,
      descricao:         r.descricao || '',
      area_id:           r.area_id || '',
      tags:              (r.tags || []).join(', '),
      links:             r.links.length > 0 ? [...r.links, ''] : [''],
      imagensExistentes: [...(r.imagens || [])],
      imagensPendentes:  [],
    });
    setPreviewUrls([]);
    setOpenForm(true);
  };

  const closeForm = () => {
    previewUrls.forEach(u => URL.revokeObjectURL(u));
    setPreviewUrls([]);
    setOpenForm(false);
  };

  // ── Links ─────────────────────────────────────────────────────────────────
  const setLink = (idx: number, val: string) =>
    setForm(prev => { const links = [...prev.links]; links[idx] = val; return { ...prev, links }; });

  const addLink = () =>
    setForm(prev => ({ ...prev, links: [...prev.links, ''] }));

  const removeLink = (idx: number) =>
    setForm(prev => ({ ...prev, links: prev.links.filter((_, i) => i !== idx) }));

  // OG auto-fill título quando vazio
  const tryFetchOG = async (url: string) => {
    if (!url || form.titulo.trim()) return;
    try {
      const res  = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`);
      const json = await res.json();
      if (json.status === 'success' && json.data?.title) {
        setForm(prev => prev.titulo.trim() ? prev : { ...prev, titulo: json.data.title });
      }
    } catch {}
  };

  // ── Imagens ───────────────────────────────────────────────────────────────
  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const arr  = Array.from(files);
    const urls = arr.map(f => URL.createObjectURL(f));
    setForm(prev => ({ ...prev, imagensPendentes: [...prev.imagensPendentes, ...arr] }));
    setPreviewUrls(prev => [...prev, ...urls]);
  };

  const removePending = (idx: number) => {
    URL.revokeObjectURL(previewUrls[idx]);
    setForm(prev => ({ ...prev, imagensPendentes: prev.imagensPendentes.filter((_, i) => i !== idx) }));
    setPreviewUrls(prev => prev.filter((_, i) => i !== idx));
  };

  const removeExisting = async (url: string) => {
    const path = storagePathFrom(url);
    if (path) await supabase.storage.from('referencias').remove([path]);
    setForm(prev => ({ ...prev, imagensExistentes: prev.imagensExistentes.filter(u => u !== url) }));
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const save = async () => {
    if (!form.titulo.trim()) return toast({ title: 'Título obrigatório', variant: 'destructive' });
    setSaving(true);
    try {
      const cleanLinks = form.links.map(l => l.trim()).filter(Boolean);
      const tags       = form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
      const refId      = editingId || crypto.randomUUID();

      // Upload imagens pendentes
      const newUrls: string[] = [];
      for (const file of form.imagensPendentes) {
        const ext  = file.name.split('.').pop() || 'jpg';
        const path = `${refId}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('referencias')
          .upload(path, file, { contentType: file.type });
        if (upErr) throw upErr;
        const { data: { publicUrl } } = supabase.storage.from('referencias').getPublicUrl(path);
        newUrls.push(publicUrl);
      }

      const allImagens = [...form.imagensExistentes, ...newUrls];

      const payload = {
        titulo:         form.titulo.trim(),
        descricao:      form.descricao || null,
        area_id:        form.area_id || null,
        links:          cleanLinks,
        imagens:        allImagens,
        tags,
        atualizado_em:  new Date().toISOString(),
        atualizado_por: user?.id ?? null,
      };

      const { error } = editingId
        ? await supabase.from('referencias').update(payload).eq('id', editingId)
        : await supabase.from('referencias').insert({ ...payload, id: refId, criado_por: user?.id });

      if (error) throw error;

      toast({ title: editingId ? 'Referência atualizada' : 'Referência criada' });
      closeForm();
      load();
      silentSyncSheets();
    } catch (e: any) {
      toast({ title: 'Erro ao salvar', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const remove = async (r: Referencia) => {
    if (!(await confirm({
      title: 'Excluir referência?',
      description: 'A referência e todas as imagens serão excluídas permanentemente.',
    }))) return;

    // Apaga imagens do Storage
    const paths = (r.imagens || []).map(storagePathFrom).filter((p): p is string => !!p);
    if (paths.length > 0) await supabase.storage.from('referencias').remove(paths);

    const { error } = await supabase.from('referencias')
      .update({ deletado_em: new Date().toISOString(), deletado_por: user?.id })
      .eq('id', r.id);

    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    toast({ title: 'Referência excluída' });
    setDetalhe(null);
    load();
    silentSyncSheets();
  };

  // ── Sheets sync ───────────────────────────────────────────────────────────
  const silentSyncSheets = () => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return;
      fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/referencias-sheets-sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      }).catch(() => {});
    });
  };

  const syncSheets = async () => {
    setSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res  = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/referencias-sheets-sync`,
        { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' } },
      );
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      toast({ title: `Planilha atualizada — ${json.synced} referências exportadas` });
    } catch (e: any) {
      toast({ title: 'Erro ao sincronizar', description: e.message, variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  };

  const podeEditar = (r: Referencia) => isAdmin || r.criado_por === user?.id;

  // ── Grouped areas for select ──────────────────────────────────────────────
  const areasByCategoria = useMemo(() =>
    areas.reduce((acc, a) => {
      if (!acc[a.categoria]) acc[a.categoria] = [];
      acc[a.categoria].push(a);
      return acc;
    }, {} as Record<string, Area[]>),
  [areas]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout title="Referências">

      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-6">
        <p className="text-sm text-muted-foreground mt-0.5">Banco de referências da equipe</p>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={syncSheets} disabled={syncing} title="Exportar para Google Sheets">
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sheet className="h-4 w-4" />}
              <span className="hidden sm:inline ml-1">{syncing ? 'Sincronizando...' : 'Sheets'}</span>
            </Button>
          )}
          <Button onClick={openNew} className="shrink-0">
            <Plus className="h-4 w-4 mr-1" /> Nova referência
          </Button>
        </div>
      </div>

      {/* ── Filtros ── */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Buscar referência..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-sm" />
        </div>
        <Select value={filtroArea || 'all'} onValueChange={v => setFiltroArea(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-44 h-8 text-sm"><SelectValue placeholder="Área" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as áreas</SelectItem>
            {areas.map(a => <SelectItem key={a.id} value={a.id}>{a.icone} {a.nome}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* ── Grade ── */}
      {loading ? (
        <div className="text-center py-16 text-muted-foreground text-sm">Carregando...</div>
      ) : filtradas.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{referencias.length === 0 ? 'Nenhuma referência cadastrada ainda.' : 'Nenhuma referência encontrada com esses filtros.'}</p>
          {referencias.length === 0 && (
            <Button variant="outline" size="sm" className="mt-3" onClick={openNew}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar primeira referência
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtradas.map(r => (
            <div
              key={r.id}
              onClick={() => setDetalhe(r)}
              className="bg-card border border-border rounded-lg overflow-hidden cursor-pointer hover:border-primary/40 transition-colors"
            >
              {/* Tira de imagens */}
              {r.imagens.length > 0 && (
                <div className="flex h-36 bg-muted/20 overflow-hidden">
                  {r.imagens.slice(0, 3).map((img, i) => (
                    <div
                      key={i}
                      className={cn(
                        'relative overflow-hidden',
                        r.imagens.length === 1 ? 'w-full' :
                        r.imagens.length === 2 ? 'w-1/2'  : 'w-1/3',
                        i > 0 && 'border-l border-border/40',
                      )}
                    >
                      <img src={img} alt="" className="w-full h-full object-cover" />
                      {i === 2 && r.imagens.length > 3 && (
                        <div className="absolute inset-0 bg-black/55 flex items-center justify-center">
                          <span className="text-white text-sm font-bold">+{r.imagens.length - 3}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Conteúdo */}
              <div className="p-4">
                {r.area && (
                  <span className="text-xs text-muted-foreground block mb-1">{r.area.icone} {r.area.nome}</span>
                )}
                <p className="text-sm font-medium leading-snug mb-2 line-clamp-2">{r.titulo}</p>

                {/* Links */}
                {r.links.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {r.links.slice(0, 2).map((link, i) => (
                      <span key={i} className="inline-flex items-center gap-1 text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded border border-primary/20 max-w-[140px]">
                        <Link2 className="h-2.5 w-2.5 shrink-0" />
                        <span className="truncate">{hostnameOf(link)}</span>
                      </span>
                    ))}
                    {r.links.length > 2 && (
                      <span className="text-[10px] text-muted-foreground self-center">+{r.links.length - 2}</span>
                    )}
                  </div>
                )}

                {/* Tags */}
                {r.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {r.tags.slice(0, 3).map(tag => (
                      <span key={tag} className="text-[10px] bg-secondary text-muted-foreground px-1.5 py-0.5 rounded">{tag}</span>
                    ))}
                    {r.tags.length > 3 && <span className="text-[10px] text-muted-foreground">+{r.tags.length - 3}</span>}
                  </div>
                )}

                {/* Rodapé */}
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
                  {r.criado_por_nome && (
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <User className="h-3 w-3" />{r.criado_por_nome}
                    </span>
                  )}
                  <span className="text-[11px] text-muted-foreground flex items-center gap-1 ml-auto">
                    <Calendar className="h-3 w-3" />{fmtDate(r.criado_em)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Detalhe Dialog ── */}
      <Dialog open={!!detalhe} onOpenChange={v => !v && setDetalhe(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {detalhe && (
            <>
              <DialogHeader>
                {detalhe.area && (
                  <p className="text-xs text-muted-foreground mb-1">{detalhe.area.icone} {detalhe.area.nome}</p>
                )}
                <DialogTitle className="text-base leading-snug text-left">{detalhe.titulo}</DialogTitle>
              </DialogHeader>

              <div className="space-y-4 text-sm mt-2">

                {/* Galeria */}
                {detalhe.imagens.length > 0 && (
                  <div className={cn(
                    'grid gap-2',
                    detalhe.imagens.length === 1 ? 'grid-cols-1' :
                    detalhe.imagens.length === 2 ? 'grid-cols-2' : 'grid-cols-3',
                  )}>
                    {detalhe.imagens.map((img, i) => (
                      <a key={i} href={img} target="_blank" rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="block overflow-hidden rounded-md border border-border hover:opacity-90 transition-opacity">
                        <img src={img} alt="" className="w-full h-40 object-cover" />
                      </a>
                    ))}
                  </div>
                )}

                {/* Descrição */}
                {detalhe.descricao && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Descrição</p>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{detalhe.descricao}</p>
                  </div>
                )}

                {/* Links */}
                {detalhe.links.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Links</p>
                    <div className="space-y-1.5">
                      {detalhe.links.map((link, i) => (
                        <div key={i} className="flex items-center gap-2 p-2 bg-muted/40 rounded border border-border/50">
                          <Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <a href={link} target="_blank" rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="text-sm text-primary hover:underline truncate flex items-center gap-1">
                            {link}
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tags */}
                {detalhe.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    <Tag className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                    {detalhe.tags.map(tag => (
                      <span key={tag} className="text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded">{tag}</span>
                    ))}
                  </div>
                )}

                {/* Meta */}
                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground border border-border rounded-md px-3 py-2">
                  {detalhe.criado_por_nome && (
                    <span className="flex items-center gap-1"><User className="h-3 w-3" /> {detalhe.criado_por_nome}</span>
                  )}
                  {detalhe.criado_em && (
                    <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {fmtDate(detalhe.criado_em)}</span>
                  )}
                  {detalhe.atualizado_em && (
                    <span className="flex items-center gap-1 text-muted-foreground/60">
                      Atualizado {fmtDate(detalhe.atualizado_em)}
                    </span>
                  )}
                </div>
              </div>

              {podeEditar(detalhe) && (
                <DialogFooter className="mt-4 gap-2 sm:justify-start">
                  <Button size="sm" variant="outline" onClick={() => openEdit(detalhe)}>
                    <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(detalhe)}>
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Excluir
                  </Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Modal Criar / Editar ── */}
      <Dialog open={openForm} onOpenChange={v => { if (!v) closeForm(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              {editingId ? 'Editar referência' : 'Nova referência'}
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* Título */}
            <div className="col-span-2">
              <Label>Título <span className="text-destructive">*</span></Label>
              <Input
                value={form.titulo}
                onChange={e => setForm({ ...form, titulo: e.target.value })}
                placeholder="Nome ou descrição curta"
                className="mt-1"
              />
            </div>

            {/* Área */}
            <div>
              <Label>Área</Label>
              <Select value={form.area_id || 'none'} onValueChange={v => setForm({ ...form, area_id: v === 'none' ? '' : v })}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem área</SelectItem>
                  {Object.entries(areasByCategoria).map(([cat, lista]) => (
                    <div key={cat}>
                      <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                        {CATEGORIA_LABEL[cat] || cat}
                      </div>
                      {lista.map(a => (
                        <SelectItem key={a.id} value={a.id}>{a.icone} {a.nome}</SelectItem>
                      ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tags */}
            <div>
              <Label>Tags <span className="text-xs text-muted-foreground">(separadas por vírgula)</span></Label>
              <Input
                value={form.tags}
                onChange={e => setForm({ ...form, tags: e.target.value })}
                placeholder="criativo, produto, topo de funil"
                className="mt-1"
              />
            </div>

            {/* Descrição */}
            <div className="col-span-2">
              <Label>Descrição</Label>
              <Textarea
                value={form.descricao}
                onChange={e => setForm({ ...form, descricao: e.target.value })}
                placeholder="Contexto, observações ou notas sobre essa referência..."
                className="mt-1 min-h-[80px]"
              />
            </div>

            {/* Links */}
            <div className="col-span-2">
              <Label className="flex items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5" /> Links
              </Label>
              <div className="mt-2 space-y-2">
                {form.links.map((link, idx) => (
                  <div key={idx} className="flex gap-2">
                    <Input
                      value={link}
                      onChange={e => setLink(idx, e.target.value)}
                      onBlur={() => { if (idx === 0) tryFetchOG(link); }}
                      placeholder="https://..."
                      className="flex-1 text-sm"
                    />
                    {form.links.length > 1 && (
                      <Button
                        type="button" variant="ghost" size="icon"
                        className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeLink(idx)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addLink} className="w-full">
                  <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar link
                </Button>
              </div>
            </div>

            {/* Imagens */}
            <div className="col-span-2">
              <Label className="flex items-center gap-1.5">
                <ImageIcon className="h-3.5 w-3.5" /> Imagens
              </Label>
              <div className="mt-2">
                {/* Miniaturas */}
                {(form.imagensExistentes.length > 0 || previewUrls.length > 0) && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {form.imagensExistentes.map((url, i) => (
                      <div key={`ex-${i}`} className="relative group w-20 h-20 shrink-0">
                        <img src={url} alt="" className="w-full h-full object-cover rounded-md border border-border" />
                        <button
                          type="button"
                          onClick={() => removeExisting(url)}
                          className="absolute -top-1.5 -right-1.5 bg-destructive text-white rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    {previewUrls.map((url, i) => (
                      <div key={`pend-${i}`} className="relative group w-20 h-20 shrink-0">
                        <img src={url} alt="" className="w-full h-full object-cover rounded-md border-2 border-primary/50" />
                        <button
                          type="button"
                          onClick={() => removePending(i)}
                          className="absolute -top-1.5 -right-1.5 bg-destructive text-white rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Botão de upload */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={e => { handleFiles(e.target.files); e.target.value = ''; }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full border-dashed h-10"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5 mr-2" />
                  {form.imagensPendentes.length > 0
                    ? `${form.imagensPendentes.length} imagem(ns) — clique para adicionar mais`
                    : 'Fazer upload de imagens'}
                </Button>
                {form.imagensPendentes.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1 text-center">
                    Imagens com borda azul serão enviadas ao salvar
                  </p>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={closeForm}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Salvando...</> : editingId ? 'Salvar alterações' : 'Criar referência'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </DashboardLayout>
  );
}
