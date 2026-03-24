import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { useFilters } from '@/contexts/FilterContext';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/formatters';
import { cn } from '@/lib/utils';

type Level = 'campanha' | 'adset' | 'ad';

export default function MetaAdsPage() {
  const { startDateStr, endDateStr, product } = useFilters();
  const [level, setLevel] = useState<Level>('campanha');
  const [data, setData] = useState<any[]>([]);
  const [sortCol, setSortCol] = useState('investimento');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      let q = supabase.from('vw_metricas_meta_nivel').select('*')
        .eq('nivel', level);
      if (startDateStr && endDateStr) q = q.gte('data', startDateStr).lte('data', endDateStr);
      if (product !== 'todos') q = q.eq('produto', product);
      q = q.order(sortCol, { ascending: sortDir === 'asc' });

      const { data: result } = await q;
      setData(result || []);
      setLoading(false);
    };
    fetch();
  }, [startDateStr, endDateStr, product, level, sortCol, sortDir]);

  const toggleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  const columns = [
    { key: 'nome', label: 'Nome', format: (v: any) => v },
    { key: 'impressoes', label: 'Impressões', format: formatNumber },
    { key: 'alcance', label: 'Alcance', format: formatNumber },
    { key: 'frequencia', label: 'Freq.', format: (v: number) => v?.toFixed(2) },
    { key: 'cliques', label: 'Cliques', format: formatNumber },
    { key: 'ctr', label: 'CTR', format: (v: number) => formatPercent(v || 0) },
    { key: 'cpm', label: 'CPM', format: formatCurrency },
    { key: 'cpc', label: 'CPC', format: formatCurrency },
    { key: 'investimento', label: 'Invest.', format: formatCurrency },
    { key: 'compras_meta', label: 'Compras', format: formatNumber },
    { key: 'faturamento_atribuido', label: 'Fat. Atrib.', format: formatCurrency },
    { key: 'roas', label: 'ROAS', format: (v: number) => `${(v || 0).toFixed(2)}x` },
  ];

  const levels: { value: Level; label: string }[] = [
    { value: 'campanha', label: 'Campanha' },
    { value: 'adset', label: 'Conjunto' },
    { value: 'ad', label: 'Anúncio' },
  ];

  return (
    <DashboardLayout title="Meta Ads">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center gap-1 bg-secondary rounded-lg p-1">
          {levels.map((l) => (
            <button key={l.value} onClick={() => setLevel(l.value)}
              className={cn("px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                level === l.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}>
              {l.label}
            </button>
          ))}
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
                  {columns.map((col) => (
                    <th key={col.key}
                      onClick={() => toggleSort(col.key)}
                      className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground transition-colors">
                      {col.label} {sortCol === col.key && (sortDir === 'asc' ? '↑' : '↓')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-secondary/50 transition-colors">
                    {columns.map((col) => (
                      <td key={col.key} className="px-4 py-3 text-foreground whitespace-nowrap">
                        {col.key === 'nome' ? row[col.key] : col.format(row[col.key] || 0)}
                      </td>
                    ))}
                  </tr>
                ))}
                {data.length === 0 && (
                  <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-muted-foreground">Nenhum dado encontrado</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
