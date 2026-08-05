import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Plus, Pencil, Search } from 'lucide-react';
import { DominioModal } from './DominioModal';
import { Dominio, Funil, daysUntilExpiry } from '../types';

interface Props {
  dominios: Dominio[];
  funis: Funil[];
  onReload: () => void;
}

function ExpiryBadge({ vencimento }: { vencimento: string | null }) {
  const days = daysUntilExpiry(vencimento);
  if (days === null) return <span className="text-xs text-muted-foreground">—</span>;

  const date = new Date(vencimento! + 'T00:00:00').toLocaleDateString('pt-BR');

  if (days < 0) {
    return <Badge className="text-[10px] border-0 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">Vencido há {Math.abs(days)}d</Badge>;
  }
  if (days <= 7) {
    return <Badge className="text-[10px] border-0 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">Vence em {days}d</Badge>;
  }
  if (days <= 30) {
    return <Badge className="text-[10px] border-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Vence em {days}d</Badge>;
  }
  return <span className="text-xs text-muted-foreground tabular-nums">{date}</span>;
}

export function DominiosTab({ dominios, funis, onReload }: Props) {
  const [search, setSearch] = useState('');
  const [filterFunil, setFilterFunil] = useState('todos');
  const [filterAtivo, setFilterAtivo] = useState('todos');
  const [modalOpen, setModalOpen] = useState(false);
  const [editDominio, setEditDominio] = useState<Dominio | null>(null);
  const [modalKey, setModalKey] = useState(0);

  const funilMap = Object.fromEntries(funis.map(f => [f.id, f]));

  const filtered = dominios.filter(d => {
    if (filterAtivo === 'ativo' && !d.ativo) return false;
    if (filterAtivo === 'inativo' && d.ativo) return false;
    if (filterFunil !== 'todos') {
      if (filterFunil === '__none__' && d.funil_id !== null) return false;
      if (filterFunil !== '__none__' && d.funil_id !== filterFunil) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      return d.nome.toLowerCase().includes(q) || (d.registrador ?? '').toLowerCase().includes(q);
    }
    return true;
  });

  // Sort: expiring soonest first, then alphabetical
  const sorted = [...filtered].sort((a, b) => {
    const da = daysUntilExpiry(a.vencimento) ?? 9999;
    const db = daysUntilExpiry(b.vencimento) ?? 9999;
    if (da !== db) return da - db;
    return a.nome.localeCompare(b.nome);
  });

  function openNew() {
    setEditDominio(null);
    setModalKey(k => k + 1);
    setModalOpen(true);
  }

  function openEdit(d: Dominio) {
    setEditDominio(d);
    setModalKey(k => k + 1);
    setModalOpen(true);
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar domínio..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>

        <Select value={filterFunil} onValueChange={setFilterFunil}>
          <SelectTrigger className="h-9 text-sm w-44">
            <SelectValue placeholder="Funil" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os funis</SelectItem>
            <SelectItem value="__none__">Independentes</SelectItem>
            {funis.map(f => (
              <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterAtivo} onValueChange={setFilterAtivo}>
          <SelectTrigger className="h-9 text-sm w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="ativo">Ativos</SelectItem>
            <SelectItem value="inativo">Inativos</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground">{sorted.length} domínio{sorted.length !== 1 ? 's' : ''}</span>
        <div className="flex-1" />
        <Button size="sm" className="h-9 gap-1.5" onClick={openNew}>
          <Plus className="h-3.5 w-3.5" />
          Novo domínio
        </Button>
      </div>

      {sorted.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Nenhum domínio encontrado.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs">
                <th className="text-left py-2 pr-4 font-medium">Domínio</th>
                <th className="text-left py-2 pr-4 font-medium">Funil</th>
                <th className="text-left py-2 pr-4 font-medium">Vencimento</th>
                <th className="text-left py-2 pr-4 font-medium">Registrador</th>
                <th className="text-left py-2 pr-4 font-medium">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {sorted.map(d => {
                const funil = d.funil_id ? funilMap[d.funil_id] : null;
                return (
                  <tr key={d.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="py-2.5 pr-4">
                      <span className={cn('font-mono text-xs', !d.ativo && 'text-muted-foreground line-through')}>
                        {d.nome}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4">
                      {funil
                        ? <span className="text-xs text-foreground">{funil.nome}</span>
                        : <span className="text-xs text-muted-foreground">Independente</span>
                      }
                    </td>
                    <td className="py-2.5 pr-4">
                      <ExpiryBadge vencimento={d.vencimento} />
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className="text-xs text-muted-foreground">{d.registrador ?? '—'}</span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge className={cn(
                        'text-[10px] border-0',
                        d.ativo
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : 'bg-muted text-muted-foreground',
                      )}>
                        {d.ativo ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => openEdit(d)}
                        className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                        title="Editar"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <DominioModal
        key={modalKey}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => { setModalOpen(false); onReload(); }}
        dominio={editDominio}
        funis={funis}
      />
    </div>
  );
}
