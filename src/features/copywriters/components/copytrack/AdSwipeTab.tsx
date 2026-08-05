import { useEffect, useState, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { CopyAdSwipe } from '@/features/copywriters/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  Search, Copy, Star, ChevronDown, ChevronUp, CheckCircle2, Check, Plus, Pencil,
} from 'lucide-react';
import { AdSwipeModal } from './AdSwipeModal';

const FORMAT_BADGE: Record<string, string> = {
  VSL:       'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  UGC:       'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  Imagem:    'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  Depoimento:'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
};

const PAGE_SIZE = 30;

export function AdSwipeTab() {
  const [ads, setAds] = useState<CopyAdSwipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterNiche, setFilterNiche] = useState('todos');
  const [filterFormat, setFilterFormat] = useState('todos');
  const [filterValidated, setFilterValidated] = useState(false);
  const [filterFavorite, setFilterFavorite] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editAd, setEditAd] = useState<CopyAdSwipe | null>(null);
  const [modalKey, setModalKey] = useState(0);

  function loadAds() {
    supabase
      .from('copytrack_ad_swipe')
      .select('id,created_at,updated_at,title,niche,source,body,headline,cta,format,angle,hook_type,notes,is_validated,is_favorite,ad_code')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setAds((data as CopyAdSwipe[]) ?? []);
        setLoading(false);
      });
  }

  useEffect(() => { loadAds(); }, []);

  function openNew() {
    setEditAd(null);
    setModalKey(k => k + 1);
    setModalOpen(true);
  }

  function openEdit(ad: CopyAdSwipe, e: React.MouseEvent) {
    e.stopPropagation();
    setEditAd(ad);
    setModalKey(k => k + 1);
    setModalOpen(true);
  }

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 250);
  };

  const niches = useMemo(() => {
    const s = new Set(ads.map(a => a.niche).filter(Boolean) as string[]);
    return ['todos', ...Array.from(s).sort()];
  }, [ads]);

  const formats = useMemo(() => {
    const s = new Set(ads.map(a => a.format).filter(Boolean) as string[]);
    return ['todos', ...Array.from(s).sort()];
  }, [ads]);

  const filtered = useMemo(() => {
    return ads.filter(a => {
      if (filterFavorite && !a.is_favorite) return false;
      if (filterValidated && !a.is_validated) return false;
      if (filterNiche !== 'todos' && a.niche !== filterNiche) return false;
      if (filterFormat !== 'todos' && a.format !== filterFormat) return false;
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        return (
          (a.title ?? '').toLowerCase().includes(q) ||
          (a.headline ?? '').toLowerCase().includes(q) ||
          (a.body ?? '').toLowerCase().includes(q) ||
          (a.ad_code ?? '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [ads, debouncedSearch, filterNiche, filterFormat, filterValidated, filterFavorite]);

  const visible = filtered.slice(0, page * PAGE_SIZE);
  const hasMore = visible.length < filtered.length;

  const handleFilterChange = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }

  async function copyAd(ad: CopyAdSwipe) {
    const parts: string[] = [];
    if (ad.headline) parts.push(ad.headline);
    if (ad.body) parts.push(ad.body);
    if (ad.cta) parts.push(ad.cta);
    const text = parts.join('\n\n');
    await navigator.clipboard.writeText(text);
    setCopied(ad.id);
    toast({ title: 'Ad copiado!', description: `${ad.title ?? ad.ad_code ?? ''}` });
    setTimeout(() => setCopied(null), 2000);
  }

  async function toggleFavorite(ad: CopyAdSwipe) {
    const newVal = !ad.is_favorite;
    setAds(prev => prev.map(a => a.id === ad.id ? { ...a, is_favorite: newVal } : a));
    await supabase.from('copytrack_ad_swipe').update({ is_favorite: newVal }).eq('id', ad.id);
  }

  if (loading) {
    return <div className="py-16 text-center text-sm text-muted-foreground">Carregando ads...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por título, headline, código..."
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>

        <Select value={filterNiche} onValueChange={handleFilterChange(setFilterNiche)}>
          <SelectTrigger className="h-9 text-sm w-40">
            <SelectValue placeholder="Nicho" />
          </SelectTrigger>
          <SelectContent>
            {niches.map(n => (
              <SelectItem key={n} value={n}>{n === 'todos' ? 'Todos os nichos' : n}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterFormat} onValueChange={handleFilterChange(setFilterFormat)}>
          <SelectTrigger className="h-9 text-sm w-40">
            <SelectValue placeholder="Formato" />
          </SelectTrigger>
          <SelectContent>
            {formats.map(f => (
              <SelectItem key={f} value={f}>{f === 'todos' ? 'Todos os formatos' : f}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant={filterValidated ? 'default' : 'outline'}
          size="sm"
          className="h-9 gap-1.5"
          onClick={() => { setFilterValidated(v => !v); setPage(1); }}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Validados
        </Button>

        <Button
          variant={filterFavorite ? 'default' : 'outline'}
          size="sm"
          className="h-9 gap-1.5"
          onClick={() => { setFilterFavorite(v => !v); setPage(1); }}
        >
          <Star className={cn('h-3.5 w-3.5', filterFavorite && 'fill-current')} />
          Favoritos
        </Button>

        <span className="text-xs text-muted-foreground">
          {visible.length} de {filtered.length} ad{filtered.length !== 1 ? 's' : ''}
        </span>
        <div className="flex-1" />
        <Button size="sm" className="h-9 gap-1.5" onClick={openNew}>
          <Plus className="h-3.5 w-3.5" />
          Novo ad
        </Button>
      </div>

      {/* Cards */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Nenhum ad encontrado.</div>
      ) : (
        <div className="space-y-3">
          {visible.map(ad => {
            const open = expanded.has(ad.id);
            const fmtCls = FORMAT_BADGE[ad.format ?? ''] ?? 'bg-muted text-muted-foreground';

            return (
              <div key={ad.id} className="border border-border rounded-lg bg-card overflow-hidden">
                {/* Header */}
                <div className="flex items-start gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {ad.ad_code && (
                        <span className="text-[10px] font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5">
                          {ad.ad_code}
                        </span>
                      )}
                      {ad.format && (
                        <Badge className={cn('text-[10px] font-medium border-0 px-1.5 py-0', fmtCls)}>
                          {ad.format}
                        </Badge>
                      )}
                      {ad.is_validated && (
                        <Badge className="text-[10px] font-medium border-0 px-1.5 py-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                          ✓ Validado
                        </Badge>
                      )}
                      {ad.niche && (
                        <span className="text-[10px] text-muted-foreground">{ad.niche}</span>
                      )}
                    </div>
                    {ad.headline ? (
                      <p className="text-sm font-medium text-foreground leading-snug">{ad.headline}</p>
                    ) : (
                      <p className="text-sm font-medium text-foreground leading-snug">{ad.title}</p>
                    )}
                    {ad.angle && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">{ad.angle}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => toggleFavorite(ad)}
                      title={ad.is_favorite ? 'Remover favorito' : 'Favoritar'}
                    >
                      <Star className={cn('h-3.5 w-3.5', ad.is_favorite ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground')} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => copyAd(ad)}
                      title="Copiar ad completo"
                    >
                      {copied === ad.id
                        ? <Check className="h-3.5 w-3.5 text-emerald-500" />
                        : <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                      }
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={e => openEdit(ad, e)}
                      title="Editar"
                    >
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => toggleExpand(ad.id)}
                    >
                      {open
                        ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                        : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      }
                    </Button>
                  </div>
                </div>

                {/* Expandido */}
                {open && (
                  <div className="px-4 pb-4 border-t border-border space-y-3 pt-3">
                    {ad.body && (
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Corpo</p>
                        <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{ad.body}</p>
                      </div>
                    )}
                    {ad.cta && (
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">CTA</p>
                        <p className="text-sm font-medium text-primary">{ad.cta}</p>
                      </div>
                    )}
                    {(ad.hook_type || ad.notes) && (
                      <div className="flex flex-wrap gap-4 pt-1 border-t border-border/60">
                        {ad.hook_type && (
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Tipo de hook</p>
                            <p className="text-xs text-foreground">{ad.hook_type}</p>
                          </div>
                        )}
                        {ad.notes && (
                          <div className="flex-1">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Notas</p>
                            <p className="text-xs text-muted-foreground italic">{ad.notes}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)}>
                Carregar mais ({filtered.length - visible.length} restantes)
              </Button>
            </div>
          )}
        </div>
      )}

      <AdSwipeModal
        key={modalKey}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => { setModalOpen(false); loadAds(); }}
        ad={editAd}
      />
    </div>
  );
}
