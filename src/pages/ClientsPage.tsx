import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { Search } from 'lucide-react';
import { useFilters } from '@/contexts/FilterContext';

export default function ClientsPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const { funilId } = useFilters();

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      let result: any[] = [];

      if (funilId) {
        // Filter clients who have at least one sale in this funnel
        const { data: rows } = await supabase.rpc('get_clientes_por_funil', { p_funil_id: funilId });
        result = rows || [];
        if (search) {
          const s = search.toLowerCase();
          result = result.filter((r: any) => r.nome?.toLowerCase().includes(s) || r.email?.toLowerCase().includes(s));
        }
      } else {
        let q = supabase.from('vw_clientes_listagem').select('*').order('total_gasto', { ascending: false });
        if (search) q = q.or(`nome.ilike.%${search}%,email.ilike.%${search}%`);
        const { data: rows } = await q;
        result = rows || [];
      }

      setData(result);
      setLoading(false);
    };
    fetchData();
  }, [search, funilId]);

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
      </div>
    </DashboardLayout>
  );
}
