import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { useFilters } from '@/contexts/FilterContext';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/formatters';

interface FunnelStep {
  label: string;
  key: string;
  value: number;
}

export default function FunnelPage() {
  const { startDateStr, endDateStr, product } = useFilters();
  const [funnelData, setFunnelData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      let q = supabase.from('vw_funil').select('*');
      if (startDateStr && endDateStr) q = q.gte('data', startDateStr).lte('data', endDateStr);
      if (product !== 'todos') q = q.eq('produto', product);
      const { data } = await q;

      if (data && data.length > 0) {
        const agg = data.reduce((acc: any, row: any) => {
          acc.impressoes += row.impressoes || 0;
          acc.cliques += row.cliques || 0;
          acc.visualizacoes += row.visualizacoes || 0;
          acc.checkouts += row.checkouts_iniciados || 0;
          acc.vendas += row.vendas_aprovadas || 0;
          acc.obs += row.obs_convertidos || 0;
          acc.investimento += row.investimento || 0;
          return acc;
        }, { impressoes: 0, cliques: 0, visualizacoes: 0, checkouts: 0, vendas: 0, obs: 0, investimento: 0 });
        setFunnelData(agg);
      } else {
        setFunnelData(null);
      }
      setLoading(false);
    };
    fetchData();
  }, [startDateStr, endDateStr, product]);

  if (loading) return <DashboardLayout title="Funil"><div className="flex items-center justify-center h-64 text-muted-foreground">Carregando...</div></DashboardLayout>;
  if (!funnelData) return <DashboardLayout title="Funil"><div className="flex items-center justify-center h-64 text-muted-foreground">Nenhum dado encontrado</div></DashboardLayout>;

  const steps: FunnelStep[] = [
    { label: 'Impressões', key: 'impressoes', value: funnelData.impressoes },
    { label: 'Cliques', key: 'cliques', value: funnelData.cliques },
    { label: 'Visualizações', key: 'visualizacoes', value: funnelData.visualizacoes },
    { label: 'Checkouts', key: 'checkouts', value: funnelData.checkouts },
    { label: 'Vendas Aprovadas', key: 'vendas', value: funnelData.vendas },
    { label: 'OBs Convertidos', key: 'obs', value: funnelData.obs },
  ];

  const maxVal = Math.max(...steps.map(s => s.value), 1);
  const inv = funnelData.investimento || 1;

  const metricsTable = [
    { label: 'CPL (Custo/Clique)', value: formatCurrency(funnelData.cliques > 0 ? inv / funnelData.cliques : 0) },
    { label: 'CPV (Custo/Visualização)', value: formatCurrency(funnelData.visualizacoes > 0 ? inv / funnelData.visualizacoes : 0) },
    { label: 'CPA (Custo/Aprovação)', value: formatCurrency(funnelData.vendas > 0 ? inv / funnelData.vendas : 0) },
    { label: 'ROAS', value: `${funnelData.vendas > 0 ? ((funnelData.vendas * (inv / funnelData.vendas)) / inv).toFixed(2) : '0.00'}x` },
    { label: 'Taxa IC', value: formatPercent(funnelData.visualizacoes > 0 ? (funnelData.checkouts / funnelData.visualizacoes) * 100 : 0) },
    { label: 'Taxa Conv. Final', value: formatPercent(funnelData.cliques > 0 ? (funnelData.vendas / funnelData.cliques) * 100 : 0) },
  ];

  return (
    <DashboardLayout title="Funil">
      <div className="bg-card border border-border rounded-lg p-6 mb-6">
        <h3 className="text-sm font-medium text-muted-foreground mb-6">Funil de Conversão</h3>
        <div className="space-y-3 max-w-2xl mx-auto">
          {steps.map((step, i) => {
            const width = Math.max((step.value / maxVal) * 100, 8);
            const convRate = i > 0 && steps[i - 1].value > 0
              ? ((step.value / steps[i - 1].value) * 100).toFixed(1) : null;
            return (
              <div key={step.key} className="relative">
                {convRate && <div className="text-xs text-muted-foreground text-center mb-1">↓ {convRate}%</div>}
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-32 text-right shrink-0">{step.label}</span>
                  <div className="flex-1 relative">
                    <div className="h-10 rounded-md flex items-center px-3 transition-all"
                      style={{ width: `${width}%`, backgroundColor: `hsl(239, 84%, ${67 - i * 6}%)` }}>
                      <span className="text-xs font-semibold text-primary-foreground">{formatNumber(step.value)}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {metricsTable.map(m => (
                <th key={m.label} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{m.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {metricsTable.map(m => (
                <td key={m.label} className="px-4 py-3 text-foreground font-medium">{m.value}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </DashboardLayout>
  );
}
