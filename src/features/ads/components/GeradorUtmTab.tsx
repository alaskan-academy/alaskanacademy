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
  // Vem da view `vw_utm_links_desempenho`. Existiam 134 links e nenhuma tela
  // dizia qual vendeu — era o defeito central desta área.
  vendas: number;
  faturamento: number;
  dias_de_vida: number;
  // > 1 quando outros links tem a MESMA combinacao de UTMs. Ai a venda conta
  // para todos eles, e somar a coluna infla o total.
  links_com_mesma_utm: number;
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

type SortKey = 'nome' | 'campaign' | 'source' | 'content' | 'vendas';
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
        'px-2.5 py-1 rounded-full text-xs font-medium border transition-all whitespace-nowrap',
        active
          ? 'bg-primary/15 text-primary border-primary/40'
          : 'bg-transparent text-muted-foreground border-border/60 hover:text-foreground hover:border-border hover:bg-muted/30',
      )}
    >
      {label}
    </button>
  );
}

function StepBadge({ n, filled }: { n: number; filled: boolean }) {
  return (
    <div className={cn(
      'mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center text-[10px] font-bold shrink-0 transition-all duration-200',
      filled
        ? 'border-primary/40 bg-primary/10 text-primary'
        : 'border-border/60 bg-transparent text-muted-foreground/50',
    )}>
      {n}
    </div>
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
      supabase.from('vw_utm_links_desempenho').select('*').order('criado_em', { ascending: false }).limit(500),
    ]);
    setProjetos((p.data ?? []) as Projeto[]);
    setLinks((l.data ?? []) as UtmLink[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  /*
    Escolher um projeto PREENCHE a campanha; não é a única forma de tê-la.

    O campo era um seletor fechado com os projetos cadastrados, e link de UTM
    se gera para muita coisa que não é projeto: um teste, um post pontual, uma
    parceria, um material que ninguém vai cadastrar em lugar nenhum. Quem
    precisava disso ficava sem link — ou cadastrava um projeto de mentira só
    para destravar o formulário, que é pior.

    O que o banco guarda em `utm_links` sempre foi só o texto de `campaign`:
    não existe `projeto_id` na tabela. Ou seja, o seletor nunca foi a fonte da
    verdade — era um atalho de digitação que estava se passando por
    obrigatoriedade.
  */
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
      // Vendas é número; ordenar como texto colocaria "9" depois de "13".
      if (sortKey === 'vendas') {
        return sortDir === 'asc' ? a.vendas - b.vendas : b.vendas - a.vendas;
      }
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
        <div className="border border-border rounded-lg overflow-hidden bg-card">
          {/* Card header */}
          <div className="px-4 py-3 border-b border-border bg-muted/10">
            <h3 className="text-sm font-semibold text-foreground">Gerar Link UTM</h3>
          </div>

          {/* Steps */}
          <div className="divide-y divide-border/40">

            {/* Step 1 — Canal de Venda */}
            <div className="flex gap-4 px-4 py-4">
              <StepBadge n={1} filled={!!canalLabel} />
              <div className="flex-1 min-w-0 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Canal de Venda</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">De onde vem o tráfego — preenche <span className="font-mono">utm_source</span> e <span className="font-mono">utm_medium</span></p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {CANAIS.map(c => (
                    <Pill key={c.label} label={c.label} active={canalLabel === c.label} onClick={() => selectCanal(c.label)} />
                  ))}
                </div>
                <Input className="h-8 text-sm" placeholder="ou digite um canal personalizado..." value={canalInput} onChange={e => handleCanalInput(e.target.value)} />
                {isCustom && (
                  <div className="flex gap-2">
                    <div className="flex-1 space-y-1">
                      <label className="text-[11px] text-muted-foreground">utm_source <span className="text-muted-foreground/50">— onde o link foi publicado</span></label>
                      <Input className="h-8 text-xs font-mono" placeholder="ex: panda, youtube" value={customSource} onChange={e => setCustomSource(e.target.value)} />
                    </div>
                    <div className="flex-1 space-y-1">
                      <label className="text-[11px] text-muted-foreground">utm_medium <span className="text-muted-foreground/50">— tipo de acesso (bio, stories, automação…)</span></label>
                      <Input className="h-8 text-xs font-mono" placeholder="ex: video, stories" value={customMedium} onChange={e => setCustomMedium(e.target.value)} />
                    </div>
                  </div>
                )}
                {canal && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/40 text-[11px] font-mono text-muted-foreground">
                      source: <span className="text-foreground">{source || canal.source}</span>
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/40 text-[11px] font-mono text-muted-foreground">
                      medium: <span className="text-foreground">{medium}</span>
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Step 2 — Conta (condicional) */}
            {needsConta && (
              <div className="flex gap-4 px-4 py-4">
                <StepBadge n={2} filled={!!conta} />
                <div className="flex-1 min-w-0 space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{canal?.label === 'Área de Membros' ? 'Conta' : 'Slug do Site'}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Completa o <span className="font-mono">utm_source</span> com o identificador da conta</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {CONTAS_SUGERIDAS.map(s => (
                      <Pill key={s} label={s} active={conta === s} onClick={() => setConta(s)} />
                    ))}
                  </div>
                  <Input className="h-8 text-sm" placeholder="ou digite outra conta..." value={conta} onChange={e => setConta(e.target.value)} />
                  {conta && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-muted/40 text-[11px] font-mono text-muted-foreground">
                      source: <span className="text-foreground ml-1">{source}</span>
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Projeto */}
            <div className="flex gap-4 px-4 py-4">
              {/* O passo está cumprido quando há CAMPANHA — escrita ou vinda
                  do seletor —, e não quando há projeto escolhido. */}
              <StepBadge n={stepNum(2)} filled={!!campaign} />
              <div className="flex-1 min-w-0 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Campanha</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Escolha um projeto ou escreva — vira o <span className="font-mono">utm_campaign</span>
                  </p>
                </div>
                <Select value={projetoId} onValueChange={setProjetoId}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Selecione o projeto" /></SelectTrigger>
                  <SelectContent>
                    {projetos.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
                {/*
                  O mesmo arranjo que o campo "Conta" logo acima já usa:
                  sugestões primeiro, campo livre embaixo. Escrever aqui limpa
                  o projeto selecionado — senão a tela mostraria um projeto
                  escolhido ao lado de uma campanha que não é a dele.
                */}
                <Input
                  className="h-8 text-sm"
                  placeholder="ou escreva a campanha (teste-black-friday, parceria-fulano...)"
                  value={campaign}
                  onChange={e => { setCampaign(slugify(e.target.value)); if (projetoId) setProjetoId(''); }}
                />
                {campaign && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-muted/40 text-[11px] font-mono text-muted-foreground">
                    utm_campaign: <span className="text-foreground ml-1">{campaign}</span>
                  </span>
                )}
              </div>
            </div>

            {/* URL Base */}
            <div className="flex gap-4 px-4 py-4">
              <StepBadge n={stepNum(3)} filled={!!urlBase} />
              <div className="flex-1 min-w-0 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">URL de destino</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Link do checkout ou página — sem parâmetros UTM</p>
                </div>
                <Input className="h-8 text-sm" placeholder="https://checkout.payt.com.br/... ou https://payt.site/..." value={urlBase} onChange={e => setUrlBase(e.target.value)} />
              </div>
            </div>

            {/* Conteúdo */}
            <div className="flex gap-4 px-4 py-4">
              <StepBadge n={stepNum(4)} filled={!!content} />
              <div className="flex-1 min-w-0 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Conteúdo <span className="text-xs font-normal text-muted-foreground/60 ml-1">opcional</span></p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Onde o link está — tipo de material ou posicionamento (<span className="font-mono">utm_content</span>)</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {CONTENT_SUGGESTIONS.map(s => (
                    <Pill key={s} label={s} active={content === s} onClick={() => setContent(prev => prev === s ? '' : s)} />
                  ))}
                </div>
                <Input className="h-8 text-sm" placeholder="ou digite um conteúdo personalizado..." value={content} onChange={e => setContent(e.target.value)} />
              </div>
            </div>

            {/* Termo */}
            <div className="flex gap-4 px-4 py-4">
              <StepBadge n={stepNum(5)} filled={!!term} />
              <div className="flex-1 min-w-0 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Termo de busca <span className="text-xs font-normal text-muted-foreground/60 ml-1">opcional</span></p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Palavra-chave do anúncio — principalmente para Google Ads (<span className="font-mono">utm_term</span>)</p>
                </div>
                <Input className="h-8 text-sm" placeholder="ex: velas+artesanais" value={term} onChange={e => setTerm(e.target.value)} />
              </div>
            </div>
          </div>

          {/* URL output + save */}
          <div className="border-t border-border bg-muted/5 px-4 py-3 space-y-2.5">
            {urlFinal ? (
              <div className="flex items-start gap-2 border border-emerald-500/20 bg-emerald-500/5 rounded-md px-3 py-2.5">
                <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                <p className="flex-1 text-xs font-mono text-foreground break-all select-all leading-relaxed">{urlFinal}</p>
                <button className="p-1 text-muted-foreground hover:text-foreground transition-colors shrink-0" onClick={() => handleCopy(urlFinal)}>
                  {copiedId === 'preview' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            ) : (
              <div className="border border-dashed border-border/50 rounded-md px-3 py-2.5">
                <p className="text-[11px] text-muted-foreground/40 text-center">Preencha Canal, Campanha e URL para gerar o link</p>
              </div>
            )}
            <Button className="w-full gap-2 h-9" disabled={!urlFinal || saving} onClick={handleSave}>
              <Plus className="h-4 w-4" /> Salvar no histórico
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
                      {([ ['nome', 'Nome'], ['campaign', 'Campanha'], ['source', 'Source'], ['content', 'Conteúdo'], ['vendas', 'Vendas'] ] as [SortKey, string][]).map(([key, label]) => (
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
                        <td className="px-3 py-2 text-xs whitespace-nowrap">
                          {l.vendas > 0 ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="font-medium tabular-nums">{l.vendas}</span>
                              <span className="text-muted-foreground tabular-nums">
                                {l.faturamento.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}
                              </span>
                              {/* A mesma venda conta para todo link que compartilha a
                                  combinação de UTMs. Sem este aviso, somar a coluna dá
                                  um total inflado e ninguém desconfia. */}
                              {l.links_com_mesma_utm > 1 && (
                                <span
                                  title={`${l.links_com_mesma_utm} links têm esta mesma combinação de UTMs — estas vendas são do conjunto, não deste link.`}
                                  className="text-[10px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30"
                                >
                                  ÷{l.links_com_mesma_utm}
                                </span>
                              )}
                            </span>
                          ) : (
                            // Link novo e link morto parecem iguais olhando só o zero,
                            // e pedem reações opostas: esperar ou investigar.
                            <span className={cn(
                              'text-[11px]',
                              l.dias_de_vida >= 30 ? 'text-red-400/80' : 'text-muted-foreground/50',
                            )}>
                              {l.dias_de_vida >= 30 ? `0 em ${l.dias_de_vida} dias` : 'ainda sem vendas'}
                            </span>
                          )}
                        </td>
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
