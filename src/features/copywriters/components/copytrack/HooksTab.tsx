import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { CopyHook } from '@/features/copywriters/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Search, Copy, Star, Check } from 'lucide-react';

const FORMAT_BADGE: Record<string, string> = {
  VSL: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  UGC: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
};

export function HooksTab() {
  const [hooks, setHooks] = useState<CopyHook[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('todos');
  const [filterObjective, setFilterObjective] = useState('todos');
  const [filterFavorite, setFilterFavorite] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('copytrack_hooks')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setHooks(data ?? []);
        setLoading(false);
      });
  }, []);

  const hookTypes = useMemo(() => {
    const s = new Set(hooks.map(h => h.hook_type).filter(Boolean) as string[]);
    return ['todos', ...Array.from(s).sort()];
  }, [hooks]);

  const objectives = useMemo(() => {
    const s = new Set(hooks.map(h => h.objective).filter(Boolean) as string[]);
    return ['todos', ...Array.from(s).sort()];
  }, [hooks]);

  const filtered = useMemo(() => {
    return hooks.filter(h => {
      if (filterFavorite && !h.is_favorite) return false;
      if (filterType !== 'todos' && h.hook_type !== filterType) return false;
      if (filterObjective !== 'todos' && h.objective !== filterObjective) return false;
      if (search) {
        const q = search.toLowerCase();
        return h.hook_text.toLowerCase().includes(q);
      }
      return true;
    });
  }, [hooks, search, filterType, filterObjective, filterFavorite]);

  async function copyHook(hook: CopyHook) {
    await navigator.clipboard.writeText(hook.hook_text);
    setCopied(hook.id);
    toast({ title: 'Hook copiado!', description: hook.hook_text.slice(0, 60) + '…' });
    setTimeout(() => setCopied(null), 2000);
  }

  async function toggleFavorite(hook: CopyHook) {
    const newVal = !hook.is_favorite;
    setHooks(prev => prev.map(h => h.id === hook.id ? { ...h, is_favorite: newVal } : h));
    await supabase.from('copytrack_hooks').update({ is_favorite: newVal }).eq('id', hook.id);
  }

  if (loading) {
    return <div className="py-16 text-center text-sm text-muted-foreground">Carregando hooks...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar hook..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>

        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="h-9 text-sm w-44">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            {hookTypes.map(t => (
              <SelectItem key={t} value={t}>{t === 'todos' ? 'Todos os tipos' : t}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterObjective} onValueChange={setFilterObjective}>
          <SelectTrigger className="h-9 text-sm w-44">
            <SelectValue placeholder="Objetivo" />
          </SelectTrigger>
          <SelectContent>
            {objectives.map(o => (
              <SelectItem key={o} value={o}>{o === 'todos' ? 'Todos os objetivos' : o}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant={filterFavorite ? 'default' : 'outline'}
          size="sm"
          className="h-9 gap-1.5"
          onClick={() => setFilterFavorite(v => !v)}
        >
          <Star className={cn('h-3.5 w-3.5', filterFavorite && 'fill-current')} />
          Favoritos
        </Button>

        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} hook{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Nenhum hook encontrado.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(hook => (
            <div
              key={hook.id}
              className="border border-border rounded-lg p-3 bg-card flex flex-col gap-2 hover:border-primary/40 transition-colors"
            >
              <p className="text-sm leading-relaxed flex-1 text-foreground">{hook.hook_text}</p>

              <div className="flex flex-wrap gap-1.5 mt-1">
                {hook.hook_type && (
                  <Badge className="text-[10px] font-medium border-0 bg-muted text-muted-foreground px-1.5 py-0">
                    {hook.hook_type}
                  </Badge>
                )}
                {hook.objective && (
                  <Badge className="text-[10px] font-medium border-0 bg-muted/60 text-muted-foreground px-1.5 py-0">
                    {hook.objective}
                  </Badge>
                )}
                {(hook.format ?? []).map(f => (
                  <Badge
                    key={f}
                    className={cn('text-[10px] font-medium border-0 px-1.5 py-0', FORMAT_BADGE[f] ?? 'bg-muted text-muted-foreground')}
                  >
                    {f}
                  </Badge>
                ))}
              </div>

              <div className="flex items-center gap-1 pt-1 border-t border-border/60">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 gap-1.5 text-xs flex-1"
                  onClick={() => copyHook(hook)}
                >
                  {copied === hook.id
                    ? <><Check className="h-3.5 w-3.5 text-emerald-500" /> Copiado</>
                    : <><Copy className="h-3.5 w-3.5" /> Copiar</>
                  }
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => toggleFavorite(hook)}
                  title={hook.is_favorite ? 'Remover favorito' : 'Favoritar'}
                >
                  <Star className={cn('h-3.5 w-3.5', hook.is_favorite ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground')} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
