import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { KPICard } from '@/components/KPICard';
import { useFilters } from '@/contexts/FilterContext';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/formatters';
import {
  DollarSign, ShoppingBag, Target, TrendingUp, BarChart3,
  RefreshCcw, Clock
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, Legend
} from 'recharts';

export default function OverviewPage() {
  const { startDateStr, endDateStr, product } = useFilters();
  const [kpis, setKpis] = useState<any>({});
  const [temporal, setTemporal] = useState<any[]>([]);
  const [byPayment, setByPayment] = useState<any[]>([]);
  const [byPlacement, setByPlacement] = useState<any[]>([]);
  const [byProduct, setByProduct] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);

      const productFilter = product !== 'todos' ? product : null;

      // Faturamento líquido
      let q1 = supabase.from('vw_faturamento_liquido').select('*')
        .gte('data', startDateStr).lte('data', endDateStr);
      if (productFilter) q1 = q1.eq('produto', productFilter);

      // Conversão OBs
      let q2 = supabase.from('vw_conversao_obs').select('*')
        .gte('data', startDateStr).lte('data', endDateStr);
      if (productFilter) q2 = q2.eq('produto', productFilter);

      // Reembolsos
      let q3 = supabase.from('vw_reembolsos').select('*')
        .gte('data', startDateStr).lte('data', endDateStr);
      if (productFilter) q3 = q3.eq('produto', productFilter);

      // Temporal
      let q4 = supabase.from('vw_vendas_temporal').select('*')
        .gte('data', startDateStr).lte('data', endDateStr);
      if (productFilter) q4 = q4.eq('produto', productFilter);

      // Por pagamento
      let q5 = supabase.from('vw_vendas_por_pagamento').select('*')
        .gte('data', startDateStr).lte('data', endDateStr);
      if (productFilter) q5 = q5.eq('produto', productFilter);

      // Por placement
      let q6 = supabase.from('vw_vendas_por_placement').select('*')
        .gte('data', startDateStr).lte('data', endDateStr);
      if (productFilter) q6 = q6.eq('produto', productFilter);

      // Meta investment
      let q7 = supabase.from('metricas_meta').select('investimento,faturamento_atribuido')
        .gte('data', startDateStr).lte('data', endDateStr);

      // Vendas pendentes
      let q8 = supabase.from('vendas').select('valor_total')
        .eq('status', 'pendente')
        .gte('data_venda', startDateStr).lte('data_venda', endDateStr);
      if (productFilter) q8 = q8.eq('produto', productFilter);

      // Vendas aprovadas count
      let q9 = supabase.from('vendas').select('valor_total,produto')
        .eq('status', 'aprovada')
        .gte('data_venda', startDateStr).lte('data_venda', endDateStr);
      if (productFilter) q9 = q9.eq('produto', productFilter);

      const [r1, r2, r3, r4, r5, r6, r7, r8, r9] = await Promise.all([
        q1, q2, q3, q4, q5, q6, q7, q8, q9
      ]);

      // KPI calculations
      const fatLiquido = (r1.data || []).reduce((s: number, r: any) => s + (r.faturamento_liquido || 0), 0);
      const vendasAprovadas = r9.data?.length || 0;
      const ticketMedio = vendasAprovadas > 0 ? fatLiquido / vendasAprovadas : 0;

      const investimento = (r7.data || []).reduce((s: number, r: any) => s + (r.investimento || 0), 0);
      const fatAtribuido = (r7.data || []).reduce((s: number, r: any) => s + (r.faturamento_atribuido || 0), 0);
      const roas = investimento > 0 ? fatAtribuido / investimento : 0;

      const obsData = r2.data || [];
      const totalItens = obsData.reduce((s: number, r: any) => s + (r.qtd_itens || 0), 0);
      const totalVendasObs = obsData.reduce((s: number, r: any) => s + (r.qtd_vendas || 0), 0);
      const taxaOb = totalVendasObs > 0 ? (totalItens / totalVendasObs) * 100 : 0;

      const reembolsoValor = (r3.data || []).reduce((s: number, r: any) => s + (r.valor_reembolso || 0), 0);
      const reembolsoQtd = r3.data?.length || 0;

      const vendasPendentes = r8.data || [];
      const pendentesValor = vendasPendentes.reduce((s: number, r: any) => s + (r.valor_total || 0), 0);

      setKpis({
        fatLiquido, vendasAprovadas, ticketMedio, investimento, roas,
        taxaOb, reembolsoValor, reembolsoQtd, pendentesQtd: vendasPendentes.length, pendentesValor,
      });

      setTemporal(r4.data || []);
      setByPayment(r5.data || []);
      setByPlacement(r6.data || []);

      // Group by product
      const prodMap: Record<string, number> = {};
      (r9.data || []).forEach((v: any) => {
        const p = v.produto || 'Outros';
        prodMap[p] = (prodMap[p] || 0) + (v.valor_total || 0);
      });
      setByProduct(Object.entries(prodMap).map(([name, value]) => ({ name, value })));

      setLoading(false);
    };
    fetchData();
  }, [startDateStr, endDateStr, product]);

  const COLORS = ['hsl(239,84%,67%)', 'hsl(160,60%,45%)', 'hsl(38,92%,50%)', 'hsl(0,72%,51%)', 'hsl(280,65%,60%)'];

  const chartTooltipStyle = {
    contentStyle: { backgroundColor: 'hsl(0,0%,10%)', border: '1px solid hsl(0,0%,16%)', borderRadius: '8px', color: '#fff' },
    labelStyle: { color: '#aaa' }
  };

  return (
    <DashboardLayout title="Visão Geral">
      {loading ? (
        <div className="flex items-center justify-center h-64 text-muted-foreground">Carregando...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <KPICard title="Faturamento Líquido" value={formatCurrency(kpis.fatLiquido || 0)} icon={<DollarSign className="h-4 w-4" />} />
            <KPICard title="Vendas Aprovadas" value={formatNumber(kpis.vendasAprovadas || 0)} icon={<ShoppingBag className="h-4 w-4" />} />
            <KPICard title="Ticket Médio" value={formatCurrency(kpis.ticketMedio || 0)} icon={<Target className="h-4 w-4" />} />
            <KPICard title="Investimento Meta" value={formatCurrency(kpis.investimento || 0)} icon={<TrendingUp className="h-4 w-4" />} />
            <KPICard title="ROAS" value={`${(kpis.roas || 0).toFixed(2)}x`} icon={<BarChart3 className="h-4 w-4" />} />
            <KPICard title="Taxa OB" value={formatPercent(kpis.taxaOb || 0)} icon={<Target className="h-4 w-4" />} />
            <KPICard title="Reembolsos" value={formatCurrency(kpis.reembolsoValor || 0)} subtitle={`${kpis.reembolsoQtd} reembolsos`} icon={<RefreshCcw className="h-4 w-4" />} />
            <KPICard title="Vendas Pendentes" value={formatCurrency(kpis.pendentesValor || 0)} subtitle={`${kpis.pendentesQtd} pendentes`} icon={<Clock className="h-4 w-4" />} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Faturamento por dia */}
            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Faturamento por Dia</h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={temporal}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,16%)" />
                  <XAxis dataKey="data" stroke="#555" tick={{ fontSize: 11 }} />
                  <YAxis stroke="#555" tick={{ fontSize: 11 }} />
                  <Tooltip {...chartTooltipStyle} />
                  <Line type="monotone" dataKey="faturamento" stroke="hsl(239,84%,67%)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Faturamento por produto */}
            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Faturamento por Produto</h3>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={byProduct} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {byProduct.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip {...chartTooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Vendas por pagamento */}
            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Vendas por Meio de Pagamento</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={byPayment} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,16%)" />
                  <XAxis type="number" stroke="#555" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="meio_pagamento" stroke="#555" tick={{ fontSize: 11 }} width={100} />
                  <Tooltip {...chartTooltipStyle} />
                  <Bar dataKey="total" fill="hsl(239,84%,67%)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Vendas por placement */}
            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Vendas por Placement</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={byPlacement}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,16%)" />
                  <XAxis dataKey="placement" stroke="#555" tick={{ fontSize: 11 }} />
                  <YAxis stroke="#555" tick={{ fontSize: 11 }} />
                  <Tooltip {...chartTooltipStyle} />
                  <Bar dataKey="total" fill="hsl(160,60%,45%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
