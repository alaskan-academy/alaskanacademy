import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { KPICard } from '@/components/KPICard';
import { useFilters } from '@/contexts/FilterContext';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/formatters';
import {
  DollarSign, ShoppingBag, Target, TrendingUp, BarChart3,
  RefreshCcw, Clock, Percent, Receipt, BadgeDollarSign
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar
} from 'recharts';
import { cn } from '@/lib/utils';

export default function OverviewPage() {
  const { startDateStr, endDateStr, product } = useFilters();
  const [kpis, setKpis] = useState<any>({});
  const [fatData, setFatData] = useState<any[]>([]);
  const [temporal, setTemporal] = useState<any[]>([]);
  const [byPayment, setByPayment] = useState<any[]>([]);
  const [byPlacement, setByPlacement] = useState<any[]>([]);
  const [byProduct, setByProduct] = useState<any[]>([]);
  const [obsData, setObsData] = useState<any[]>([]);
  const [upsellData, setUpsellData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const productFilter = product !== 'todos' ? product : null;

      let q1 = supabase.from('vw_faturamento_liquido').select('*');
      if (startDateStr && endDateStr) q1 = q1.gte('data', startDateStr).lte('data', endDateStr);
      if (productFilter) q1 = q1.eq('produto', productFilter);

      let q2 = supabase.from('vw_conversao_obs').select('*');
      if (productFilter) q2 = q2.eq('produto', productFilter);

      let q3 = supabase.from('vw_conversao_upsell').select('*');
      if (productFilter) q3 = q3.eq('produto', productFilter);

      let q4 = supabase.from('vw_vendas_temporal').select('*');
      if (startDateStr && endDateStr) q4 = q4.gte('data', startDateStr).lte('data', endDateStr);
      if (productFilter) q4 = q4.eq('produto', productFilter);

      let q5 = supabase.from('vw_vendas_por_pagamento').select('*');
      if (productFilter) q5 = q5.eq('produto', productFilter);

      let q6 = supabase.from('vw_vendas_por_placement').select('*');
      if (productFilter) q6 = q6.eq('produto', productFilter);

      let q7 = supabase.from('vendas').select('valor_total,produto')
        .eq('status', 'aprovada')
        .not('pedido_id', 'like', 'TEST%')
        .not('pedido_id', 'like', 'LC-%');
      if (startDateStr && endDateStr) q7 = q7.gte('data_venda', startDateStr).lte('data_venda', endDateStr);
      if (productFilter) q7 = q7.eq('produto', productFilter);

      let q8 = supabase.from('vendas').select('valor_total')
        .eq('status', 'pendente')
        .not('pedido_id', 'like', 'TEST%')
        .not('pedido_id', 'like', 'LC-%');
      if (startDateStr && endDateStr) q8 = q8.gte('data_venda', startDateStr).lte('data_venda', endDateStr);
      if (productFilter) q8 = q8.eq('produto', productFilter);

      const [r1, r2, r3, r4, r5, r6, r7, r8] = await Promise.all([q1, q2, q3, q4, q5, q6, q7, q8]);

      const fatRows = r1.data || [];
      setFatData(fatRows);
      const fatLiquido = fatRows.reduce((s: number, r: any) => s + (r.faturamento_liquido || 0), 0);
      const fatBruto = fatRows.reduce((s: number, r: any) => s + (r.faturamento_bruto || 0), 0);
      const taxaPlat = fatRows.reduce((s: number, r: any) => s + (r.taxa_plataforma || 0), 0);
      const reembolsos = fatRows.reduce((s: number, r: any) => s + (r.reembolsos || 0), 0);
      const impostoSimples = fatRows.reduce((s: number, r: any) => s + (r.imposto_simples || 0), 0);
      const impostoMeta = fatRows.reduce((s: number, r: any) => s + (r.imposto_meta_ads || 0), 0);
      const investimento = fatRows.reduce((s: number, r: any) => s + (r.investimento_meta || 0), 0);
      const custoFixo = fatRows.reduce((s: number, r: any) => s + (r.custo_fixo || 0), 0);
      const margemPct = fatBruto > 0 ? (fatLiquido / fatBruto) * 100 : 0;
      const roas = investimento > 0 ? fatBruto / investimento : 0;
      const simplesPct = fatRows.length > 0 ? (fatRows[0].simples_pct || 0) : 0;
      const metaPct = fatRows.length > 0 ? (fatRows[0].meta_pct || 0) : 0;

      const vendasAprovadas = r7.data?.length || 0;
      const ticketMedio = vendasAprovadas > 0 ? fatLiquido / vendasAprovadas : 0;

      const pendentes = r8.data || [];
      const pendentesValor = pendentes.reduce((s: number, r: any) => s + (r.valor_total || 0), 0);

      const obsRows = r2.data || [];
      const taxaOb = obsRows.length > 0
        ? obsRows.reduce((s: number, r: any) => s + (r.taxa_conversao_pct || 0), 0) / obsRows.length
        : 0;
      setObsData(obsRows);

      const upsellRows = r3.data || [];
      const taxaUpsell = upsellRows.length > 0
        ? upsellRows.reduce((s: number, r: any) => s + (r.taxa_conversao_pct || 0), 0) / upsellRows.length
        : 0;
      setUpsellData(upsellRows);

      setKpis({
        fatLiquido, fatBruto, taxaPlat, reembolsos, impostoSimples, impostoMeta,
        investimento, custoFixo, margemPct, roas, simplesPct, metaPct,
        vendasAprovadas, ticketMedio, taxaOb, taxaUpsell,
        pendentesQtd: pendentes.length, pendentesValor,
      });

      setTemporal(r4.data || []);
      setByPayment(r5.data || []);
      setByPlacement(r6.data || []);

      const prodMap: Record<string, number> = {};
      (r7.data || []).forEach((v: any) => {
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

  const margemBadge = kpis.margemPct > 30 ? 'text-success' : kpis.margemPct >= 15 ? 'text-warning' : 'text-destructive';

  return (
    <DashboardLayout title="Visão Geral">
      {loading ? (
        <div className="flex items-center justify-center h-64 text-muted-foreground">Carregando...</div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <KPICard title="Faturamento Líquido" value={formatCurrency(kpis.fatLiquido || 0)} icon={<DollarSign className="h-4 w-4" />} />
            <KPICard title="Vendas Aprovadas" value={formatNumber(kpis.vendasAprovadas || 0)} icon={<ShoppingBag className="h-4 w-4" />} />
            <KPICard title="Ticket Médio" value={formatCurrency(kpis.ticketMedio || 0)} icon={<Target className="h-4 w-4" />} />
            <KPICard title="ROAS" value={`${(kpis.roas || 0).toFixed(2)}x`} icon={<BarChart3 className="h-4 w-4" />} />
            <KPICard title="Investimento Meta" value={formatCurrency(kpis.investimento || 0)} icon={<TrendingUp className="h-4 w-4" />} />
            <div className="bg-card rounded-lg border border-border p-5 transition-colors hover:border-primary/30">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Margem %</span>
                <Percent className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className={cn("text-2xl font-bold", margemBadge)}>{formatPercent(kpis.margemPct || 0)}</div>
            </div>
            <KPICard title="Imposto Simples" value={formatCurrency(kpis.impostoSimples || 0)} icon={<Receipt className="h-4 w-4" />} />
            <KPICard title="Imposto Meta Ads" value={formatCurrency(kpis.impostoMeta || 0)} icon={<BadgeDollarSign className="h-4 w-4" />} />
            <KPICard title="Taxa OB" value={formatPercent(kpis.taxaOb || 0)} icon={<Target className="h-4 w-4" />} />
            <KPICard title="Taxa Upsell" value={formatPercent(kpis.taxaUpsell || 0)} icon={<TrendingUp className="h-4 w-4" />} />
            <KPICard title="Reembolsos" value={formatCurrency(kpis.reembolsos || 0)} icon={<RefreshCcw className="h-4 w-4" />} />
            <KPICard title="Vendas Pendentes" value={formatCurrency(kpis.pendentesValor || 0)} subtitle={`${kpis.pendentesQtd} pendentes`} icon={<Clock className="h-4 w-4" />} />
          </div>

          {/* Margin Breakdown Card */}
          <div className="bg-card border border-border rounded-lg p-5 mb-6 max-w-md">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">Margem Detalhada</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Faturamento bruto</span><span className="text-foreground">{formatCurrency(kpis.fatBruto || 0)}</span></div>
              <div className="flex justify-between"><span className="text-destructive">(-) Taxa plataforma Payt</span><span className="text-destructive">{formatCurrency(kpis.taxaPlat || 0)}</span></div>
              <div className="flex justify-between"><span className="text-destructive">(-) Reembolsos</span><span className="text-destructive">{formatCurrency(kpis.reembolsos || 0)}</span></div>
              <div className="flex justify-between"><span className="text-destructive">(-) Simples Nacional ({formatPercent(kpis.simplesPct || 0)})</span><span className="text-destructive">{formatCurrency(kpis.impostoSimples || 0)}</span></div>
              <div className="flex justify-between"><span className="text-destructive">(-) Imposto Meta Ads ({formatPercent(kpis.metaPct || 0)})</span><span className="text-destructive">{formatCurrency(kpis.impostoMeta || 0)}</span></div>
              <div className="flex justify-between"><span className="text-destructive">(-) Investimento Meta</span><span className="text-destructive">{formatCurrency(kpis.investimento || 0)}</span></div>
              {kpis.custoFixo > 0 && (
                <div className="flex justify-between"><span className="text-destructive">(-) Custo fixo</span><span className="text-destructive">{formatCurrency(kpis.custoFixo || 0)}</span></div>
              )}
              <div className="border-t border-border pt-2 flex justify-between font-semibold">
                <span className="text-foreground">(=) Faturamento líquido</span><span className="text-foreground">{formatCurrency(kpis.fatLiquido || 0)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span className="text-foreground">Margem</span><span className={margemBadge}>{formatPercent(kpis.margemPct || 0)}</span>
              </div>
            </div>
          </div>

          {/* Conversion Tables side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <h3 className="text-sm font-medium text-muted-foreground px-5 pt-5 mb-3">Conversão OBs</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border">
                    {['OB', 'Convertidos', 'Receita', 'Taxa'].map(h => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {obsData.map((r, i) => (
                      <tr key={i} className="border-b border-border/50 hover:bg-secondary/50">
                        <td className="px-4 py-2 text-foreground">{r.nome_ob}</td>
                        <td className="px-4 py-2 text-foreground">{formatNumber(r.total_convertidos || 0)}</td>
                        <td className="px-4 py-2 text-foreground">{formatCurrency(r.receita_total_ob || 0)}</td>
                        <td className="px-4 py-2 text-foreground">{formatPercent(r.taxa_conversao_pct || 0)}</td>
                      </tr>
                    ))}
                    {obsData.length === 0 && <tr><td colSpan={4} className="px-4 py-4 text-center text-muted-foreground">Sem dados</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <h3 className="text-sm font-medium text-muted-foreground px-5 pt-5 mb-3">Conversão Upsells</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border">
                    {['Upsell', 'Convertidos', 'Receita', 'Taxa'].map(h => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {upsellData.map((r, i) => (
                      <tr key={i} className="border-b border-border/50 hover:bg-secondary/50">
                        <td className="px-4 py-2 text-foreground">{r.nome_upsell}</td>
                        <td className="px-4 py-2 text-foreground">{formatNumber(r.total_upsells || 0)}</td>
                        <td className="px-4 py-2 text-foreground">{formatCurrency(r.receita_total || 0)}</td>
                        <td className="px-4 py-2 text-foreground">{formatPercent(r.taxa_conversao_pct || 0)}</td>
                      </tr>
                    ))}
                    {upsellData.length === 0 && <tr><td colSpan={4} className="px-4 py-4 text-center text-muted-foreground">Sem dados</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Vendas por Meio de Pagamento</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={byPayment} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,16%)" />
                  <XAxis type="number" stroke="#555" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="meio_pagamento" stroke="#555" tick={{ fontSize: 11 }} width={100} />
                  <Tooltip {...chartTooltipStyle} />
                  <Bar dataKey="faturamento" fill="hsl(239,84%,67%)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Vendas por Placement</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={byPlacement}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,16%)" />
                  <XAxis dataKey="placement" stroke="#555" tick={{ fontSize: 11 }} />
                  <YAxis stroke="#555" tick={{ fontSize: 11 }} />
                  <Tooltip {...chartTooltipStyle} />
                  <Bar dataKey="faturamento" fill="hsl(160,60%,45%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
