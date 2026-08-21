import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { Search } from 'lucide-react';
import { useFilters } from '@/contexts/FilterContext';

const PAGE_SIZE = 50;

export default function ClientsPage() {
  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const { contaId } = useFilters();

  // Reset page when search or funnel changes
  useEffect(() => { setPage(0); }, [search, contaId]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const from = page * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;

      if (contaId) {
        const { data: vendas } = await supabase.from('vendas').select('cliente_id').eq('ad_account_id', contaId);
        const clienteIds = [...new Set((vendas || []).map((v: any) => v.cliente_id).filter(Boolean))];
        if (clienteIds.length === 0) { setData([]); setTotal(0); setLoading(false); return; }
        let q = supabase
          .from('vw_clientes_listagem')
          .select('*', { count: 'exact' })
          .in('id', clienteIds)
          .order('total_gasto', { ascending: false })
          .range(from, to);
        if (search) q = q.or(`nome.ilike.%${search}%,email.ilike.%${search}%`);
        const { data: rows, count } = await q;
        setData(rows ?? []);
        setTotal(count ?? 0);
      } else {
        let q = supabase
          .from('vw_clientes_listagem')
          .select('*', { count: 'exact' })
          .order('total_gasto', { ascending: false })
          .range(from, to);
        if (search) q = q.or(`nome.ilike.%${search}%,email.ilike.%${search}%`);
        const { data: rows, count } = await q;
        setData(rows ?? []);
        setTotal(count ?? 0);
      }

      setLoading(false);
    };
    fetchData();
  }, [page, search, contaId]);

  const columns = [
    { key: 'nome', label: 'Nome' },
    { key: 'email', label: 'Email' },
    { key: 'telefone', label: 'Telefone' },
    { key: 'total_pedidos', label: 'Pedidos', format: formatNumber },
    { key: 'total_gasto', label: 'Total Gasto', format: formatCurrency },
    { key: 'ultima_compra', label: 'Última Compra' },
    { key: 'produto_principal', label: 'Produto Principal' },
    { key: 'canal_aquisicao', label: 'Canal' },
  ];

  return (
    <DashboardLayout title="Clientes">
      <div className="mb-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por nome ou email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-muted-foreground">Carregando...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {columns.map(c => (
                    <th key={c.key} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-secondary/50 transition-colors">
                    {columns.map(c => (
                      <td key={c.key} className="px-4 py-3 text-foreground whitespace-nowrap">
                        {c.format ? c.format(row[c.key] || 0) : (row[c.key] || '-')}
                      </td>
                    ))}
                  </tr>
                ))}
                {data.length === 0 && (
                  <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-muted-foreground">Nenhum cliente encontrado</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {!loading && total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border text-xs text-muted-foreground">
            <span>
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total.toLocaleString('pt-BR')}
            </span>
            <div className="flex gap-1">
              <button
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
                className="px-3 py-1 rounded border border-border disabled:opacity-40 hover:bg-accent transition-colors"
              >
                ← Anterior
              </button>
              <button
                disabled={(page + 1) * PAGE_SIZE >= total}
                onClick={() => setPage(p => p + 1)}
                className="px-3 py-1 rounded border border-border disabled:opacity-40 hover:bg-accent transition-colors"
              >
                Próxima →
              </button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
