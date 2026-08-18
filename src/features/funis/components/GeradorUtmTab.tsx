import { useState, useEffect, useCallback } from 'react';
import { Copy, Check, Plus, ExternalLink, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, ChevronDown, Pencil, Archive, Trash2, ArchiveRestore, X, MoreHorizontal } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface Projeto { id: string; nome: string }

interface UtmLink {
  id: string;
  nome: string;
  url_base: string;
  url_final: string;
  source: string;
  medium: string;
  campaign: string;
  content: string | null;
  term: string | null;
  arquivado: boolean;
  criado_em: string;
}

const CANAIS = [
  { label: 'Bio Instagram',        source: 'instagram',            medium: 'bio'         },
  { label: 'Automação Instagram',  source: 'instagram',            medium: 'automacao'   },
  { label: 'Destaques Instagram',  source: 'instagram',            medium: 'destaques'   },
  { label: 'Bio TikTok',           source: 'tiktok',               medium: 'bio'         },
  { label: 'Recuperação WhatsApp', source: 'whatsapp',             medium: 'recuperacao' },
  { label: 'Suporte WhatsApp',     source: 'whatsapp',             medium: 'suporte'     },
  { label: 'Grupo WhatsApp',       source: 'whatsapp',             medium: 'interno'     },
  { label: 'Recuperação Email',    source: 'email',                medium: 'recuperacao' },
  { label: 'Broadcast Email',      source: 'email',                medium: 'broadcast'   },
  { label: 'Área de Membros',      source: 'area-membros-{conta}', medium: 'interno'     },
  { label: 'Site',                 source: 'site-{conta}',         medium: 'interno'     },
] as const;

const CONTAS_SUGERIDAS  = ['handify', 'laura', 'lumii'];
const CONTENT_SUGGESTIONS = ['vitrine', 'banner', 'feed', 'bio', 'automacao', 'site', 'vendedor', 'email'];
const PAGE_SIZE = 50;

type SortKey = 'nome' | 'campaign' | 'source' | 'content';
type SortDir = 'asc' | 'desc';
type HistTab = 'ativos' | 'arquivados';

function slugify(s: string) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildUrl(base: string, src: string, med: string, camp: string, cont?: string, trm?: string) {
  if (!base || !src || !med || !camp) return '';
  const p = new URLSearchParams();
  p.set('utm_source', src);
  p.set('utm_medium', med);
  p.set('utm_campaign', camp);
  if (cont) p.set('utm_content', cont);
  if (trm) p.set('utm_term', trm);
  return `${base}?${p.toString()}`;
}

function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap',
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-transparent text-muted-foreground border-border hover:text-foreground hover:border-foreground/40',
      )}
    >
      {label}
    </button>
  );
}

interface EditState {
  id: string;
  nome: string;
  url_base: string;
  source: string;
  medium: string;
  campaign: string;
  content: string;
  term: string;
}

function EditModal({ link, onClose, onSaved }: { link: UtmLink; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<EditState>({
    id: link.id,
    nome: link.nome,
    url_base: link.url_base,
    source: link.source,
    medium: link.medium,
    campaign: link.campaign,
    content: link.content ?? '',
    term: link.term ?? '',
  });
  const [saving, setSaving] = useState(false);

  const urlFinal = buildUrl(form.url_base, form.source, form.medium, form.campaign, form.content, form.term);

  const save = async () => {
    setSaving(true);
    await supabase.from('utm_links').update({
      nome:      form.nome,
      url_base:  form.url_base,
      url_final: urlFinal,
      source:    form.source,
      medium:    form.medium,
      campaign:  form.campaign,
      content:   form.content || null,
      term:      form.term || null,
    }).eq('id', form.id);
    setSaving(false);
    toast({ description: 'Link atualizado!' });
    onSaved();
  };

  const f = (k: keyof EditState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-card border border-border rounded-lg w-full max-w-lg mx-4 p-5 space-y-4 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Editar Link UTM</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Nome</label>
            <Input className="h-8 text-sm" value={form.nome} onChange={f('nome')} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">URL Base</label>
            <Input className="h-8 text-sm" value={form.url_base} onChange={f('url_base')} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">utm_source</label>
              <Input className="h-8 text-xs font-mono" value={form.source} onChange={f('source')} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">utm_medium</label>
              <Input className="h-8 text-xs font-mono" value={form.medium} onChange={f('medium')} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">utm_campaign</label>
              <Input className="h-8 text-xs font-mono" value={form.campaign} onChange={f('campaign')} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">utm_content</label>
              <Input className="h-8 text-xs font-mono" value={form.content} onChange={f('content')} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">utm_term</label>
            <Input className="h-8 text-xs font-mono" value={form.term} onChange={f('term')} />
          </div>
          {urlFinal && (
            <p className="text-[11px] font-mono text-muted-foreground break-all bg-muted/30 rounded px-2 py-1.5">{urlFinal}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button size="sm" disabled={saving || !urlFinal} onClick={save}>Salvar</Button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirm({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div className="bg-card border border-border rounded-lg w-full max-w-sm mx-4 p-5 space-y-4 shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold">Excluir link?</h3>
        <p className="text-xs text-muted-foreground">Esta ação não pode ser desfeita.</p>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onCancel}>Cancelar</Button>
          <Button size="sm" variant="destructive" onClick={onConfirm}>Excluir</Button>
        </div>
      </div>
    </div>
  );
}

export function GeradorUtmTab() {
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [links, setLinks]       = useState<UtmLink[]>([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [page, setPage]         = useState(0);
  const [sortKey, setSortKey]   = useState<SortKey>('nome');
  const [sortDir, setSortDir]   = useState<SortDir>('asc');
  const [histTab, setHistTab]   = useState<HistTab>('ativos');
  const [editLink, setEditLink] = useState<UtmLink | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Form
  const [canalLabel, setCanalLabel]     = useState('');
  const [canalInput, setCanalInput]     = useState('');
  const [customSource, setCustomSource] = useState('');
  const [customMedium, setCustomMedium] = useState('');
  const [conta, setConta]               = useState('');
  const [projetoId, setProjetoId]       = useState('');
  const [campaign, setCampaign]         = useState('');
  const [urlBase, setUrlBase]           = useState('');
  const [content, setContent]           = useState('');
  const [term, setTerm]                 = useState('');
  const [searchQ, setSearchQ]           = useState('');

  const canal      = CANAIS.find(c => c.label === canalLabel);
  const isCustom   = !!canalLabel && !canal;
  const needsConta = canal && canal.source.includes('{conta}');
  const source     = canal
    ? canal.source.replace('{conta}', slugify(conta))
    : (isCustom ? (customSource || slugify(canalLabel)) : '');
  const medium     = canal?.medium ?? (isCustom ? customMedium : '');
  const urlFinal   = buildUrl(urlBase, source, medium, campaign, content, term);
  const nomeAuto   = [canalLabel, conta, campaign].filter(Boolean).join(' - ');

  const selectCanal = (label: string) => {
    setCanalLabel(label);
    setCanalInput(label);
    setConta('');
    setCustomSource('');
    setCustomMedium('');
  };

  const handleCanalInput = (val: string) => {
    setCanalInput(val);
    const match = CANAIS.find(c => c.label.toLowerCase() === val.toLowerCase().trim());
    if (match) {
      setCanalLabel(match.label);
      setConta('');
      setCustomSource('');
      setCustomMedium('');
    } else {
      setCanalLabel(val.trim());
    }
  };

  const load = useCallback(async () => {
    const [p, l] = await Promise.all([
      supabase.from('ofertas_editores').select('id,nome').eq('ativo', true).order('nome'),
      supabase.from('utm_links').select('*').order('criado_em', { ascending: false }).limit(500),
    ]);
    setProjetos((p.data ?? []) as Projeto[]);
    setLinks((l.data ?? []) as UtmLink[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const p = projetos.find(p => p.id === projetoId);
    if (p) setCampaign(slugify(p.nome));
  }, [projetoId, projetos]);

  useEffect(() => { setPage(0); }, [searchQ, sortKey, sortDir, histTab]);

  const handleCopy = (url: string, id = 'preview') => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast({ description: 'URL copiada!' });
  };

  const handleSave = async () => {
    if (!urlFinal || !canalLabel) return;
    setSaving(true);
    await supabase.from('utm_links').insert({
      nome:       nomeAuto,
      url_base:   urlBase,
      url_final:  urlFinal,
      source,
      medium,
      campaign,
      content:    content || null,
      term:       term || null,
    });
    await load();
    setSaving(false);
    toast({ description: 'Link salvo!' });
  };

  const handleArchive = async (id: string, arquivado: boolean) => {
    await supabase.from('utm_links').update({ arquivado: !arquivado }).eq('id', id);
    setLinks(prev => prev.map(l => l.id === id ? { ...l, arquivado: !arquivado } : l));
    toast({ description: arquivado ? 'Link restaurado!' : 'Link arquivado!' });
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await supabase.from('utm_links').delete().eq('id', deleteId);
    setLinks(prev => prev.filter(l => l.id !== deleteId));
    setDeleteId(null);
    toast({ description: 'Link excluído.' });
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const baseLinks = links.filter(l => histTab === 'ativos' ? !l.arquivado : l.arquivado);

  const filtered = (() => {
    const base = searchQ
      ? baseLinks.filter(l =>
          l.nome.toLowerCase().includes(searchQ.toLowerCase()) ||
          l.campaign.toLowerCase().includes(searchQ.toLowerCase()) ||
          l.source.toLowerCase().includes(searchQ.toLowerCase()) ||
          (l.content ?? '').toLowerCase().includes(searchQ.toLowerCase())
        )
      : [...baseLinks];
    return base.sort((a, b) => {
      const av = (sortKey === 'content' ? (a.content ?? '') : a[sortKey]).toLowerCase();
      const bv = (sortKey === 'content' ? (b.content ?? '') : b[sortKey]).toLowerCase();
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  })();

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const ativosCount    = links.filter(l => !l.arquivado).length;
  const arquivadosCount = links.filter(l => l.arquivado).length;

  const stepNum = (n: number) => needsConta ? n + 1 : n;

  return (
    <>
      {editLink && (
        <EditModal
          link={editLink}
          onClose={() => setEditLink(null)}
          onSaved={async () => { setEditLink(null); await load(); }}
        />
      )}
      {deleteId && (
        <DeleteConfirm
          onCancel={() => setDeleteId(null)}
          onConfirm={handleDelete}
        />
      )}

      <div className="space-y-6">
        {/* ── Generator ─────────────────────────────────────────────── */}
        <div className="border border-border rounded-lg p-4 space-y-5 bg-card">
          <h3 className="text-sm font-semibold">Gerar Link UTM</h3>

          {/* 1. Canal de Venda */}
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">1. Canal de Venda</label>
            <div className="flex flex-wrap gap-1.5">
              {CANAIS.map(c => (
                <Pill
                  key={c.label}
                  label={c.label}
                  active={canalLabel === c.label}
                  onClick={() => selectCanal(c.label)}
                />
              ))}
            </div>
            <Input
              className="h-9 text-sm"
              placeholder="ou digite um canal personalizado..."
              value={canalInput}
              onChange={e => handleCanalInput(e.target.value)}
            />
            {isCustom && (
              <div className="flex gap-2 pt-1">
                <div className="flex-1 space-y-1">
                  <label className="text-[11px] text-muted-foreground">utm_source</label>
                  <Input className="h-8 text-xs font-mono" placeholder="ex: panda" value={customSource} onChange={e => setCustomSource(e.target.value)} />
                </div>
                <div className="flex-1 space-y-1">
                  <label className="text-[11px] text-muted-foreground">utm_medium</label>
                  <Input className="h-8 text-xs font-mono" placeholder="ex: buque-velas" value={customMedium} onChange={e => setCustomMedium(e.target.value)} />
                </div>
              </div>
            )}
            {canal && (
              <p className="text-[11px] text-muted-foreground font-mono pl-0.5">
                source: <span className="text-foreground">{source || canal.source}</span>
                {' · '}medium: <span className="text-foreground">{medium}</span>
              </p>
            )}
          </div>

          {/* 2. Conta (condicional) */}
          {needsConta && (
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">
                2. {canal?.label === 'Área de Membros' ? 'Conta' : 'Slug do Site'}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {CONTAS_SUGERIDAS.map(s => (
                  <Pill key={s} label={s} active={conta === s} onClick={() => setConta(s)} />
                ))}
              </div>
              <Input className="h-9 text-sm" placeholder="ou digite outra conta..." value={conta} onChange={e => setConta(e.target.value)} />
              {conta && (
                <p className="text-[11px] text-muted-foreground font-mono pl-0.5">
                  source: <span className="text-foreground">{source}</span>
                </p>
              )}
            </div>
          )}

          {/* Projeto */}
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">{stepNum(2)}. Projeto (utm_campaign)</label>
            <Select value={projetoId} onValueChange={setProjetoId}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione o projeto" /></SelectTrigger>
              <SelectContent>
                {projetos.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            {campaign && (
              <p className="text-[11px] text-muted-foreground font-mono pl-0.5">
                utm_campaign: <span className="text-foreground">{campaign}</span>
              </p>
            )}
          </div>

          {/* URL Base */}
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">{stepNum(3)}. URL Base</label>
            <Input className="h-9 text-sm" placeholder="https://checkout.payt.com.br/... ou https://payt.site/..." value={urlBase} onChange={e => setUrlBase(e.target.value)} />
          </div>

          {/* utm_content */}
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">
              {stepNum(4)}. utm_content <span className="text-muted-foreground/50">(opcional)</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {CONTENT_SUGGESTIONS.map(s => (
                <Pill key={s} label={s} active={content === s} onClick={() => setContent(prev => prev === s ? '' : s)} />
              ))}
            </div>
            <Input className="h-9 text-sm" placeholder="ou digite um conteúdo personalizado..." value={content} onChange={e => setContent(e.target.value)} />
          </div>

          {/* utm_term */}
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">
              {stepNum(5)}. utm_term <span className="text-muted-foreground/50">(tráfego pago — opcional)</span>
            </label>
            <Input className="h-9 text-sm" placeholder="ex: velas+artesanais" value={term} onChange={e => setTerm(e.target.value)} />
          </div>

          {/* URL preview */}
          {urlFinal ? (
            <div className="flex items-start gap-2 bg-muted/40 rounded-md px-3 py-2.5">
              <p className="flex-1 text-xs font-mono text-foreground break-all select-all leading-relaxed">{urlFinal}</p>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0 mt-0.5" onClick={() => handleCopy(urlFinal)}>
                {copiedId === 'preview' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          ) : (
            <div className="h-10 bg-muted/20 rounded-md flex items-center px-3">
              <p className="text-xs text-muted-foreground/40">A URL aparecerá aqui quando Canal, Projeto e URL Base forem preenchidos</p>
            </div>
          )}

          <div className="flex justify-end">
            <Button size="sm" className="gap-1.5" disabled={!urlFinal || saving} onClick={handleSave}>
              <Plus className="h-3.5 w-3.5" />Salvar no histórico
            </Button>
          </div>
        </div>

        {/* ── History ───────────────────────────────────────────────── */}
        <div className="space-y-3">
          {/* Header row: tabs + search */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-0 border-b border-border flex-1">
              <button
                onClick={() => setHistTab('ativos')}
                className={cn(
                  'px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                  histTab === 'ativos'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                Histórico
                <span className="ml-1.5 text-xs text-muted-foreground">({ativosCount})</span>
              </button>
              <button
                onClick={() => setHistTab('arquivados')}
                className={cn(
                  'px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                  histTab === 'arquivados'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                Arquivados
                {arquivadosCount > 0 && (
                  <span className="ml-1.5 text-xs text-muted-foreground">({arquivadosCount})</span>
                )}
              </button>
            </div>
            <Input
              className="h-8 text-sm w-56 shrink-0"
              placeholder="Buscar..."
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
              {histTab === 'arquivados' ? 'Nenhum link arquivado.' : 'Nenhum link encontrado.'}
            </div>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {([ ['nome', 'Nome'], ['campaign', 'Campanha'], ['source', 'Source'], ['content', 'Conteúdo'] ] as [SortKey, string][]).map(([key, label]) => (
                        <th key={key} className="text-left px-3 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleSort(key)}
                            className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                          >
                            {label}
                            {sortKey === key
                              ? (sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)
                              : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                          </button>
                        </th>
                      ))}
                      <th className="px-3 py-2 w-24" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {paginated.map(l => (
                      <tr key={l.id} className="hover:bg-muted/20 transition-colors group">
                        <td className="px-3 py-2 text-xs max-w-[220px] truncate" title={l.nome}>{l.nome}</td>
                        <td className="px-3 py-2 text-xs font-mono text-muted-foreground whitespace-nowrap">{l.campaign}</td>
                        <td className="px-3 py-2 text-xs font-mono text-muted-foreground whitespace-nowrap">{l.source}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{l.content ?? '—'}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                                  <MoreHorizontal className="h-3.5 w-3.5" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem onClick={() => handleCopy(l.url_final, l.id)} className="gap-2 text-xs cursor-pointer">
                                  <Copy className="h-3.5 w-3.5" /> Copiar URL
                                </DropdownMenuItem>
                                <DropdownMenuItem asChild>
                                  <a href={l.url_final} target="_blank" rel="noopener noreferrer" className="gap-2 text-xs cursor-pointer flex items-center">
                                    <ExternalLink className="h-3.5 w-3.5" /> Abrir link
                                  </a>
                                </DropdownMenuItem>
                                {histTab === 'ativos' && (
                                  <DropdownMenuItem onClick={() => setEditLink(l)} className="gap-2 text-xs cursor-pointer">
                                    <Pencil className="h-3.5 w-3.5" /> Editar
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => handleArchive(l.id, l.arquivado)} className="gap-2 text-xs cursor-pointer">
                                  {l.arquivado
                                    ? <><ArchiveRestore className="h-3.5 w-3.5" /> Restaurar</>
                                    : <><Archive className="h-3.5 w-3.5" /> Arquivar</>}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setDeleteId(l.id)} className="gap-2 text-xs cursor-pointer text-destructive focus:text-destructive">
                                  <Trash2 className="h-3.5 w-3.5" /> Excluir
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-muted/20">
                  <span className="text-xs text-muted-foreground">
                    {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} de {filtered.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="text-xs text-muted-foreground px-1">{page + 1} / {totalPages}</span>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                      disabled={page === totalPages - 1}
                      className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
