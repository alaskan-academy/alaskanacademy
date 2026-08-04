import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { CopyOffer, CopyOfferTracking } from '@/features/copywriters/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  ExternalLink, ChevronDown, ChevronRight, Search, TrendingUp,
  Archive, Globe,
} from 'lucide-react';

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  ativo:    { label: 'Ativo',    cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  pausado:  { label: 'Pausado',  cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
  arquivado:{ label: 'Arquivado',cls: 'bg-muted text-muted-foreground' },
};

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

type OfferWithTracking = CopyOffer & { tracking: CopyOfferTracking[] };

export function OffersTab() {
  const [offers, setOffers] = useState<OfferWithTracking[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
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
    load();
  }, []);

  const filtered = offers.filter(o => {
    if (!search) return true;
    const q = search.toLowerCase();
    return o.name.toLowerCase().includes(q) || (o.niche ?? '').toLowerCase().includes(q);
  });

  function toggle(id: string) {
    setExpanded(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }

  if (loading) {
    return <div className="py-16 text-center text-sm text-muted-foreground">Carregando ofertas...</div>;
  }

  if (!offers.length) {
    return <div className="py-16 text-center text-sm text-muted-foreground">Nenhuma oferta encontrada.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar oferta ou nicho..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} oferta{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="space-y-2">
        {filtered.map(offer => {
          const open = expanded.has(offer.id);
          const lastTracking = offer.tracking.at(-1);
          const s = offer.status ?? 'ativo';
          const badge = STATUS_BADGE[s] ?? { label: s, cls: 'bg-muted text-muted-foreground' };

          return (
            <div key={offer.id} className="border border-border rounded-lg overflow-hidden bg-card">
              <button
                type="button"
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
                onClick={() => toggle(offer.id)}
              >
                {open ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />}

                <span className="font-medium text-sm flex-1 min-w-0 truncate">{offer.name}</span>

                {offer.niche && (
                  <span className="text-xs text-muted-foreground hidden sm:block">{offer.niche}</span>
                )}

                {lastTracking && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground hidden md:flex">
                    <TrendingUp className="h-3 w-3" />
                    {lastTracking.active_ads_count ?? '—'} ads · Dia {lastTracking.day_number}
                  </span>
                )}

                <Badge className={cn('text-xs font-medium border-0 ml-auto sm:ml-0', badge.cls)}>
                  {badge.label}
                </Badge>
              </button>

              {open && (
                <div className="px-4 pb-4 border-t border-border">
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
    </div>
  );
}
