import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { CopyOffer, CopyOfferTracking } from '@/features/copywriters/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  ExternalLink, ChevronDown, ChevronRight, Search, TrendingUp,
  Archive, Globe, Plus, Pencil, Eye,
} from 'lucide-react';
import { OfferModal } from './OfferModal';

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  acompanhando: { label: 'Acompanhando', cls: 'bg-violet-500 text-white dark:bg-violet-500 dark:text-white' },
  monitorando:  { label: 'Monitorando',  cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' },
  ativo:        { label: 'Ativo',        cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  pausado:      { label: 'Pausado',      cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
  arquivado:    { label: 'Arquivado',    cls: 'bg-muted text-muted-foreground' },
};

const HIGHLIGHT_STATUSES = new Set(['acompanhando']);

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

type OfferWithTracking = CopyOffer & { tracking: CopyOfferTracking[] };

export function OffersTab() {
  const [offers, setOffers] = useState<OfferWithTracking[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('todos');
  const [filterNiche, setFilterNiche] = useState('todos');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [editOffer, setEditOffer] = useState<CopyOffer | null>(null);
  const [modalKey, setModalKey] = useState(0);

  async function load() {
    const [{ data: offersData }, { data: trackingData }] = await Promise.all([
      supabase.from('copytrack_offers').select('*').order('created_at', { ascending: false }),
      supabase.from('copytrack_offer_tracking').select('*').order('day_number', { ascending: true }),
    ]);

    const trackingMap: Record<string, CopyOfferTracking[]> = {};
    for (const t of trackingData ?? []) {
      if (!t.offer_id) continue;
      if (!trackingMap[t.offer_id]) trackingMap[t.offer_id] = [];
      trackingMap[t.offer_id].push(t);
    }

    setOffers((offersData ?? []).map((o: CopyOffer) => ({
      ...o,
      tracking: trackingMap[o.id] ?? [],
    })));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const niches = ['todos', ...Array.from(new Set(offers.map(o => o.niche).filter(Boolean) as string[])).sort()];

  const filtered = offers.filter(o => {
    if (filterStatus !== 'todos' && (o.status ?? 'ativo') !== filterStatus) return false;
    if (filterNiche !== 'todos' && o.niche !== filterNiche) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return o.name.toLowerCase().includes(q) || (o.niche ?? '').toLowerCase().includes(q);
  });

  // highlighted statuses first
  const sorted = [...filtered].sort((a, b) => {
    const aIs = HIGHLIGHT_STATUSES.has(a.status ?? '');
    const bIs = HIGHLIGHT_STATUSES.has(b.status ?? '');
    if (aIs && !bIs) return -1;
    if (!aIs && bIs) return 1;
    return 0;
  });

  function toggle(id: string) {
    setExpanded(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }

  function openNew() {
    setEditOffer(null);
    setModalKey(k => k + 1);
    setModalOpen(true);
  }

  function openEdit(offer: CopyOffer, e: React.MouseEvent) {
    e.stopPropagation();
    setEditOffer(offer);
    setModalKey(k => k + 1);
    setModalOpen(true);
  }

  const acompanhandoCount = offers.filter(o => HIGHLIGHT_STATUSES.has(o.status ?? '')).length;

  if (loading) {
    return <div className="py-16 text-center text-sm text-muted-foreground">Carregando ofertas...</div>;
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar oferta ou nicho..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>

        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-9 text-sm w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            <SelectItem value="acompanhando">Acompanhando</SelectItem>
            <SelectItem value="monitorando">Monitorando</SelectItem>
            <SelectItem value="ativo">Ativo</SelectItem>
            <SelectItem value="pausado">Pausado</SelectItem>
            <SelectItem value="arquivado">Arquivado</SelectItem>
          </SelectContent>
        </Select>

        {niches.length > 1 && (
          <Select value={filterNiche} onValueChange={setFilterNiche}>
            <SelectTrigger className="h-9 text-sm w-40">
              <SelectValue placeholder="Nicho" />
            </SelectTrigger>
            <SelectContent>
              {niches.map(n => (
                <SelectItem key={n} value={n}>{n === 'todos' ? 'Todos os nichos' : n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <span className="text-xs text-muted-foreground">{sorted.length} oferta{sorted.length !== 1 ? 's' : ''}</span>
        <div className="flex-1" />
        <Button size="sm" className="h-9 gap-1.5" onClick={openNew}>
          <Plus className="h-3.5 w-3.5" />
          Nova oferta
        </Button>
      </div>

      {/* "Acompanhando" callout banner */}
      {acompanhandoCount > 0 && filterStatus === 'todos' && (
        <div className="flex items-center gap-2.5 rounded-lg border border-violet-400/50 bg-violet-500/10 px-4 py-2.5">
          <Eye className="h-4 w-4 text-violet-400 shrink-0" />
          <span className="text-sm font-medium text-violet-300">
            {acompanhandoCount} oferta{acompanhandoCount !== 1 ? 's' : ''} sendo acompanhada{acompanhandoCount !== 1 ? 's' : ''} agora
          </span>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Nenhuma oferta encontrada.</div>
      ) : (
        <div className="space-y-2">
          {sorted.map(offer => {
            const open = expanded.has(offer.id);
            const lastTracking = offer.tracking.at(-1);
            const s = offer.status ?? 'ativo';
            const badge = STATUS_BADGE[s] ?? { label: s, cls: 'bg-muted text-muted-foreground' };
            const isHighlighted = HIGHLIGHT_STATUSES.has(s);

            return (
              <div
                key={offer.id}
                className={cn(
                  'rounded-lg overflow-hidden transition-all',
                  isHighlighted
                    ? 'border-2 border-violet-500/70 bg-violet-500/5 shadow-[0_0_12px_2px_rgba(139,92,246,0.15)]'
                    : 'border border-border bg-card',
                )}
              >
                {/* Row — div instead of button to avoid nested-button DOM violation */}
                <div
                  role="button"
                  tabIndex={0}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors cursor-pointer"
                  onClick={() => toggle(offer.id)}
                  onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggle(offer.id)}
                >
                  {open
                    ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  }

                  {isHighlighted && (
                    <span className="relative flex h-2 w-2 flex-shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
                    </span>
                  )}

                  <span className={cn('font-medium text-sm flex-1 min-w-0 truncate', isHighlighted && 'text-violet-200')}>
                    {offer.name}
                  </span>

                  {offer.niche && (
                    <span className="text-xs text-muted-foreground hidden sm:block">{offer.niche}</span>
                  )}

                  {lastTracking && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground hidden md:flex">
                      <TrendingUp className="h-3 w-3" />
                      {lastTracking.active_ads_count ?? '—'} ads · Dia {lastTracking.day_number}
                    </span>
                  )}

                  <Badge className={cn('text-xs font-semibold border-0 ml-auto sm:ml-0', badge.cls)}>
                    {badge.label}
                  </Badge>

                  <button
                    type="button"
                    onClick={e => openEdit(offer, e)}
                    className="ml-1 p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                    title="Editar"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>

                {open && (
                  <div className="px-4 pb-4 border-t border-border/60">
                    <div className="pt-3 flex flex-wrap gap-2 mb-3">
                      {offer.ad_library_url && (
                        <a
                          href={offer.ad_library_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                        >
                          <Archive className="h-3 w-3" />
                          Biblioteca de Anúncios
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {offer.page_url && (
                        <a
                          href={offer.page_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                        >
                          <Globe className="h-3 w-3" />
                          Página
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>

                    {offer.notes && (
                      <p className="text-xs text-muted-foreground mb-3 italic">{offer.notes}</p>
                    )}

                    {offer.tracking.length > 0 ? (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                          Histórico de Tracking
                        </p>
                        <div className="overflow-x-auto">
                          <table className="text-xs w-full">
                            <thead>
                              <tr className="text-muted-foreground border-b border-border">
                                <th className="text-left py-1 pr-4 font-medium">Dia</th>
                                <th className="text-left py-1 pr-4 font-medium">Data</th>
                                <th className="text-left py-1 pr-4 font-medium">Ads Ativos</th>
                                <th className="text-left py-1 font-medium">Notas</th>
                              </tr>
                            </thead>
                            <tbody>
                              {offer.tracking.map(t => (
                                <tr key={t.id} className="border-b border-border/50 last:border-0">
                                  <td className="py-1 pr-4 tabular-nums">#{t.day_number ?? '—'}</td>
                                  <td className="py-1 pr-4 tabular-nums">{fmtDate(t.tracked_date)}</td>
                                  <td className="py-1 pr-4 tabular-nums font-medium">{t.active_ads_count ?? '—'}</td>
                                  <td className="py-1 text-muted-foreground">{t.notes ?? '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Nenhum tracking registrado.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <OfferModal
        key={modalKey}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => { setModalOpen(false); load(); }}
        offer={editOffer}
      />
    </div>
  );
}
