import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { KPICard } from '@/components/KPICard';
import { useFilters } from '@/contexts/FilterContext';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/formatters';
import { ChevronRight, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

const LEVELS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_placement'] as const;
const LEVEL_LABELS: Record<string, string> = {
  utm_source: 'Source',
  utm_medium: 'Medium',
  utm_campaign: 'Campaign',
  utm_content: 'Content',
  utm_placement: 'Placement',
};

export default function UTMPage() {
  const { startDateStr, endDateStr, product } = useFilters();
  const [levelIndex, setLevelIndex] = useState(0);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const currentLevel = LEVELS[levelIndex];

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      let q = supabase.from('vw_vendas_por_utm').select('*');
      if (startDateStr && endDateStr) {
        // view doesn't have date filter, we fetch all
      }
      if (product !== 'todos') q = q.eq('produto', product);

      // Apply drill-down filters
      Object.entries(filters).forEach(([key, value]) => {
        q = q.eq(key, value);
      });

      const { data: result } = await q;
      const rows = result || [];

      // Group by current level
      const grouped: Record<string, { vendas_aprovadas: number; vendas_pendentes: number; faturamento: number; taxa_aprovacao_sum: number; count: number }> = {};
      rows.forEach((r: any) => {
        const key = r[currentLevel] || '(vazio)';
        if (!grouped[key]) grouped[key] = { vendas_aprovadas: 0, vendas_pendentes: 0, faturamento: 0, taxa_aprovacao_sum: 0, count: 0 };
        grouped[key].vendas_aprovadas += r.vendas_aprovadas || 0;
        grouped[key].vendas_pendentes += r.vendas_pendentes || 0;
        grouped[key].faturamento += r.faturamento || 0;
        grouped[key].taxa_aprovacao_sum += r.taxa_aprovacao_pct || 0;
        grouped[key].count += 1;
      });

      const tableData = Object.entries(grouped).map(([name, v]) => ({
        name,
        vendas_aprovadas: v.vendas_aprovadas,
        faturamento: v.faturamento,
        taxa_aprovacao_pct: v.count > 0 ? v.taxa_aprovacao_sum / v.count : 0,
        ticket_medio: v.vendas_aprovadas > 0 ? v.faturamento / v.vendas_aprovadas : 0,
      })).sort((a, b) => b.faturamento - a.faturamento);

      setData(tableData);
      setLoading(false);
    };
    fetchData();
  }, [startDateStr, endDateStr, product, levelIndex, filters]);

  const totals = data.reduce((acc, r) => ({
    vendas: acc.vendas + r.vendas_aprovadas,
    faturamento: acc.faturamento + r.faturamento,
  }), { vendas: 0, faturamento: 0 });
  const avgTaxa = data.length > 0 ? data.reduce((s, r) => s + r.taxa_aprovacao_pct, 0) / data.length : 0;
  const avgTicket = totals.vendas > 0 ? totals.faturamento / totals.vendas : 0;

  const drillDown = (value: string) => {
    if (levelIndex < LEVELS.length - 1) {
      setFilters(prev => ({ ...prev, [currentLevel]: value }));
      setLevelIndex(prev => prev + 1);
    }
  };

  const goBack = () => {
    if (levelIndex > 0) {
      const newFilters = { ...filters };
      delete newFilters[LEVELS[levelIndex - 1]];
      setFilters(newFilters);
      setLevelIndex(prev => prev - 1);
    }
  };

  const resetAll = () => {
    setFilters({});
    setLevelIndex(0);
  };

  // Build breadcrumb
  const breadcrumbs = LEVELS.slice(0, levelIndex).map(level => ({
    label: LEVEL_LABELS[level],
    value: filters[level],
  }));

  return (
    <DashboardLayout title="Análise UTM">
      {/* Breadcrumb */}
      {breadcrumbs.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <button onClick={resetAll} className="text-xs text-primary hover:underline">Início</button>
          {breadcrumbs.map((b, i) => (
            <span key={i} className="flex items-center gap-1 text-xs text-muted-foreground">
              <ChevronRight className="h-3 w-3" />
              <span className="text-foreground">{b.value}</span>
            </span>
          ))}
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs font-medium text-primary">{LEVEL_LABELS[currentLevel]}</span>
        </div>
      )}

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard title="Total Vendas" value={formatNumber(totals.vendas)} />
        <KPICard title="Faturamento" value={formatCurrency(totals.faturamento)} />
        <KPICard title="Taxa Aprovação" value={formatPercent(avgTaxa)} />
        <KPICard title="Ticket Médio" value={formatCurrency(avgTicket)} />
      </div>

      {/* Back button */}
      {levelIndex > 0 && (
        <button onClick={goBack} className="flex items-center gap-1 text-xs text-primary hover:underline mb-4">
          <ArrowLeft className="h-3 w-3" /> Voltar para {LEVEL_LABELS[LEVELS[levelIndex - 1]]}
        </button>
      )}

      {/* Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-muted-foreground">Carregando...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{LEVEL_LABELS[currentLevel]}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Vendas</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Faturamento</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Taxa Aprov.</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Ticket Médio</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={i}
                    onClick={() => drillDown(row.name)}
                    className={cn(
                      "border-b border-border/50 hover:bg-secondary/50 transition-colors",
                      levelIndex < LEVELS.length - 1 && "cursor-pointer"
                    )}>
                    <td className="px-4 py-3 text-primary font-medium">{row.name}</td>
                    <td className="px-4 py-3 text-foreground">{formatNumber(row.vendas_aprovadas)}</td>
                    <td className="px-4 py-3 text-foreground">{formatCurrency(row.faturamento)}</td>
                    <td className="px-4 py-3 text-foreground">{formatPercent(row.taxa_aprovacao_pct)}</td>
                    <td className="px-4 py-3 text-foreground">{formatCurrency(row.ticket_medio)}</td>
                  </tr>
                ))}
                {data.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Nenhum dado encontrado</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
