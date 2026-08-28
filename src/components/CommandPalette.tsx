import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, TrendingUp, ShoppingCart, Link2,
  FlaskConical, GraduationCap, BarChart3, Wallet, KeyRound, Film, Settings,
} from 'lucide-react';
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandSeparator,
} from '@/components/ui/command';
import { DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { FASES_MAP } from '@/features/producao/components/constants';

const PAGES = [
  { path: '/',              label: 'Resumo',        icon: LayoutDashboard },
  { path: '/meta-ads',      label: 'Meta Ads',      icon: TrendingUp      },
  { path: '/vendas',        label: 'Vendas',        icon: ShoppingCart    },
  { path: '/utm',           label: 'Análise UTM',   icon: Link2           },
  { path: '/laboratorio',   label: 'Laboratório',   icon: FlaskConical    },
  { path: '/processos',     label: 'Processos',     icon: GraduationCap   },
  { path: '/editores',      label: 'Editores',      icon: BarChart3       },
  { path: '/financeiro',    label: 'Financeiro',    icon: Wallet          },
  { path: '/acessos',       label: 'Acessos',       icon: KeyRound        },
  { path: '/producao',      label: 'Produção',      icon: Film            },
  { path: '/configuracoes', label: 'Configurações', icon: Settings        },
];

const TIPO_DOT: Record<string, string> = {
  criativo: 'bg-blue-400',
  vsl:      'bg-purple-400',
  aula:     'bg-green-400',
};


type CriativoResult = { id: string; nome: string; tipo: string; fase: string };

export function CommandPalette() {
  const navigate  = useNavigate();
  const [open, setOpen]         = useState(false);
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState<CriativoResult[]>([]);
  const [loading, setLoading]   = useState(false);

  // Ctrl+K / Cmd+K global shortcut
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    const handleCustom = () => setOpen(true);
    document.addEventListener('keydown', handleKey);
    document.addEventListener('openCommandPalette', handleCustom);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('openCommandPalette', handleCustom);
    };
  }, []);

  // Debounced criativo search
  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('producoes')
        .select('id,nome,tipo,fase')
        .ilike('nome', `%${query}%`)
        .limit(8);
      setResults(data ?? []);
      setLoading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const go = useCallback((path: string) => {
    navigate(path);
    setOpen(false);
    setQuery('');
  }, [navigate]);

  const filteredPages = query.length < 1
    ? PAGES
    : PAGES.filter(p => p.label.toLowerCase().includes(query.toLowerCase()));

  return (
    <CommandDialog open={open} onOpenChange={v => { setOpen(v); if (!v) setQuery(''); }}>
      <DialogTitle className="sr-only">Busca global</DialogTitle>
      <CommandInput
        placeholder="Buscar criativos, páginas..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {loading ? 'Buscando...' : 'Nenhum resultado.'}
        </CommandEmpty>

        {results.length > 0 && (
          <>
            <CommandGroup heading="Criativos">
              {results.map(c => (
                <CommandItem
                  key={c.id}
                  value={c.nome}
                  onSelect={() => go('/producao')}
                  className="flex items-center gap-2"
                >
                  <span className={cn('w-2 h-2 rounded-full shrink-0', TIPO_DOT[c.tipo] ?? 'bg-primary')} />
                  <span className="flex-1 truncate">{c.nome}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {FASES_MAP[c.fase] ?? c.fase}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {filteredPages.length > 0 && (
          <CommandGroup heading="Páginas">
            {filteredPages.map(p => (
              <CommandItem
                key={p.path}
                value={p.label}
                onSelect={() => go(p.path)}
                className="flex items-center gap-2"
              >
                <p.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <span>{p.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
