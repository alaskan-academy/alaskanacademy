import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { useFilters } from '@/contexts/FilterContext';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format } from 'date-fns';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';

const statusStyles: Record<string, string> = {
  aprovada: 'bg-success/20 text-success border-success/30',
  pendente: 'bg-warning/20 text-warning border-warning/30',
  cancelada: 'bg-muted text-muted-foreground border-border',
  reembolsada: 'bg-destructive/20 text-destructive border-destructive/30',
};

const chartTooltipStyle = {
  contentStyle: { backgroundColor: 'hsl(0,0%,10%)', border: '1px solid hsl(0,0%,16%)', borderRadius: '8px', color: '#fff' },
  labelStyle: { color: '#aaa' }
};

export default function SalesPage() {
  const { startDateStr, endDateStr, product } = useFilters();
  const [salesData, setSalesData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSale, setSelectedSale] = useState<any>(null);
  const [saleItems, setSaleItems] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('todos');
  const [paymentData, setPaymentData] = useState<any[]>([]);
  const [placementData, setPlacementData] = useState<any[]>([]);
  const [hourlyData, setHourlyData] = useState<any[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const productFilter = product !== 'todos' ? product : null;

      let q = supabase.from('vendas').select('*, clientes(nome, email, telefone)')
        .not('pedido_id', 'like', 'TEST%')
        .not('pedido_id', 'like', 'LC-%')
        .order('data_venda', { ascending: false });
      if (startDateStr && endDateStr) q = q.gte('data_venda', startDateStr).lte('data_venda', endDateStr);
      if (productFilter) q = q.eq('produto', productFilter);
      if (statusFilter !== 'todos') q = q.eq('status', statusFilter);

      let q2 = supabase.from('vw_vendas_por_pagamento').select('*');
      if (productFilter) q2 = q2.eq('produto', productFilter);

      let q3 = supabase.from('vw_vendas_por_placement').select('*');
      if (productFilter) q3 = q3.eq('produto', productFilter);

      let q4 = supabase.from('vw_vendas_por_horario').select('*');
      if (productFilter) q4 = q4.eq('produto', productFilter);

      const [r1, r2, r3, r4] = await Promise.all([q, q2, q3, q4]);
      setSalesData(r1.data || []);
      setPaymentData(r2.data || []);
      setPlacementData(r3.data || []);
      setHourlyData((r4.data || []).sort((a: any, b: any) => (a.hora || 0) - (b.hora || 0)));
      setLoading(false);
    };
    fetchData();
  }, [startDateStr, endDateStr, product, statusFilter]);

  const openDetail = async (sale: any) => {
    setSelectedSale(sale);
    const { data: items } = await supabase.from('venda_itens').select('*').eq('venda_id', sale.id);
    setSaleItems(items || []);
  };

  const statuses = ['todos', 'aprovada', 'pendente', 'cancelada', 'reembolsada'];

  const displayPedidoId = (sale: any) => {
    if (sale.pedido_id?.startsWith('LC-')) return 'Carrinho Abandonado';
    return sale.pedido_id;
  };

  const peakHour = hourlyData.reduce((max, r) => (r.vendas_aprovadas || 0) > (max?.vendas_aprovadas || 0) ? r : max, hourlyData[0]);

  const taxaBadge = (taxa: number) => taxa > 70 ? 'text-success' : taxa >= 50 ? 'text-warning' : 'text-destructive';

  return (
    <DashboardLayout title="Vendas">
      <Tabs defaultValue="lista" className="space-y-4">
        <TabsList className="bg-secondary border border-border">
          <TabsTrigger value="lista" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Lista</TabsTrigger>
          <TabsTrigger value="pagamento" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Por Pagamento</TabsTrigger>
          <TabsTrigger value="placement" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Por Placement</TabsTrigger>
          <TabsTrigger value="horario" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Por Horário</TabsTrigger>
        </TabsList>

        {/* Lista Tab */}
        <TabsContent value="lista">
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="flex items-center gap-1 bg-secondary rounded-lg p-1">
              {statuses.map(s => (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className={cn("px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize",
                    statusFilter === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  )}>
                  {s}
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
                      {['Pedido', 'Data', 'Cliente', 'Produto', 'Status', 'Total', 'Pagamento', 'UTM Source'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {salesData.map((sale) => (
                      <tr key={sale.id} onClick={() => openDetail(sale)}
                        className="border-b border-border/50 hover:bg-secondary/50 transition-colors cursor-pointer">
                        <td className="px-4 py-3 text-foreground font-mono text-xs">{displayPedidoId(sale)}</td>
                        <td className="px-4 py-3 text-foreground whitespace-nowrap">{sale.data_venda ? format(new Date(sale.data_venda), 'dd/MM/yy HH:mm') : '-'}</td>
                        <td className="px-4 py-3 text-foreground">{sale.clientes?.nome || '-'}</td>
                        <td className="px-4 py-3 text-foreground capitalize">{sale.produto || '-'}</td>
                        <td className="px-4 py-3">
                          <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium border", statusStyles[sale.status] || 'bg-muted text-muted-foreground')}>{sale.status}</span>
                        </td>
                        <td className="px-4 py-3 text-foreground font-medium">{formatCurrency(sale.valor_total || 0)}</td>
                        <td className="px-4 py-3 text-foreground">{sale.meio_pagamento || '-'}</td>
                        <td className="px-4 py-3 text-foreground text-xs">{sale.utm_source || '-'}</td>
                      </tr>
                    ))}
                    {salesData.length === 0 && (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Nenhuma venda encontrada</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Payment Tab */}
        <TabsContent value="pagamento">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Taxa de Aprovação por Pagamento</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={paymentData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,16%)" />
                  <XAxis type="number" stroke="#555" tick={{ fontSize: 11 }} domain={[0, 100]} />
                  <YAxis type="category" dataKey="meio_pagamento" stroke="#555" tick={{ fontSize: 11 }} width={120} />
                  <Tooltip {...chartTooltipStyle} />
                  <Bar dataKey="taxa_aprovacao_pct" radius={[0, 4, 4, 0]}>
                    {paymentData.map((entry: any, i: number) => (
                      <Cell key={i} fill={entry.taxa_aprovacao_pct > 70 ? 'hsl(142,71%,45%)' : entry.taxa_aprovacao_pct >= 50 ? 'hsl(38,92%,50%)' : 'hsl(0,72%,51%)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border">
                  {['Pagamento', 'Tentativas', 'Aprovadas', 'Canceladas', 'Expiradas', 'Faturamento', 'Taxa Aprov.', 'Ticket Médio'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {paymentData.map((r: any, i: number) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-secondary/50">
                      <td className="px-4 py-3 text-foreground">{r.meio_pagamento}</td>
                      <td className="px-4 py-3 text-foreground">{formatNumber(r.total_tentativas || 0)}</td>
                      <td className="px-4 py-3 text-foreground">{formatNumber(r.aprovadas || 0)}</td>
                      <td className="px-4 py-3 text-foreground">{formatNumber(r.canceladas || 0)}</td>
                      <td className="px-4 py-3 text-foreground">{formatNumber(r.expiradas || 0)}</td>
                      <td className="px-4 py-3 text-foreground">{formatCurrency(r.faturamento || 0)}</td>
                      <td className={cn("px-4 py-3 font-medium", taxaBadge(r.taxa_aprovacao_pct || 0))}>{formatPercent(r.taxa_aprovacao_pct || 0)}</td>
                      <td className="px-4 py-3 text-foreground">{formatCurrency(r.ticket_medio || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* Placement Tab */}
        <TabsContent value="placement">
          <div className="bg-card border border-border rounded-lg p-5 mb-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">Faturamento por Placement</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={placementData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,16%)" />
                <XAxis type="number" stroke="#555" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="placement" stroke="#555" tick={{ fontSize: 11 }} width={150} />
                <Tooltip {...chartTooltipStyle} />
                <Bar dataKey="faturamento" fill="hsl(160,60%,45%)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border">
                  {['Placement', 'Vendas', 'Faturamento', 'Ticket Médio', 'Taxa Aprov.'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {placementData.map((r: any, i: number) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-secondary/50">
                      <td className="px-4 py-3 text-foreground">{r.placement}</td>
                      <td className="px-4 py-3 text-foreground">{formatNumber(r.vendas_aprovadas || 0)}</td>
                      <td className="px-4 py-3 text-foreground">{formatCurrency(r.faturamento || 0)}</td>
                      <td className="px-4 py-3 text-foreground">{formatCurrency(r.ticket_medio || 0)}</td>
                      <td className="px-4 py-3 text-foreground">{formatPercent(r.taxa_aprovacao_pct || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* Hourly Tab */}
        <TabsContent value="horario">
          <div className="bg-card border border-border rounded-lg p-5 mb-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">
              Vendas por Hora {peakHour && <span className="text-primary ml-2">| Pico: {peakHour.hora}h ({formatNumber(peakHour.vendas_aprovadas || 0)} vendas)</span>}
            </h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,16%)" />
                <XAxis dataKey="hora" stroke="#555" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}h`} />
                <YAxis stroke="#555" tick={{ fontSize: 11 }} />
                <Tooltip {...chartTooltipStyle} />
                <Bar dataKey="vendas_aprovadas" radius={[4, 4, 0, 0]}>
                  {hourlyData.map((entry: any, i: number) => (
                    <Cell key={i} fill={peakHour && entry.hora === peakHour.hora ? 'hsl(38,92%,50%)' : 'hsl(239,84%,67%)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border">
                  {['Hora', 'Vendas', 'Faturamento', 'Taxa Aprov.'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {hourlyData.map((r: any, i: number) => (
                    <tr key={i} className={cn("border-b border-border/50 hover:bg-secondary/50",
                      peakHour && r.hora === peakHour.hora && "bg-warning/10"
                    )}>
                      <td className="px-4 py-3 text-foreground font-medium">{r.hora}h</td>
                      <td className="px-4 py-3 text-foreground">{formatNumber(r.vendas_aprovadas || 0)}</td>
                      <td className="px-4 py-3 text-foreground">{formatCurrency(r.faturamento || 0)}</td>
                      <td className="px-4 py-3 text-foreground">{formatPercent(r.taxa_aprovacao_pct || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={!!selectedSale} onOpenChange={() => setSelectedSale(null)}>
        <DialogContent className="max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Detalhes da Venda</DialogTitle>
          </DialogHeader>
          {selectedSale && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Pedido:</span> <span className="text-foreground ml-1">{displayPedidoId(selectedSale)}</span></div>
                <div><span className="text-muted-foreground">Status:</span> <span className={cn("ml-1 px-2 py-0.5 rounded-full text-xs font-medium border", statusStyles[selectedSale.status])}>{selectedSale.status}</span></div>
                <div><span className="text-muted-foreground">Produto:</span> <span className="text-foreground ml-1 capitalize">{selectedSale.produto}</span></div>
                <div><span className="text-muted-foreground">Total:</span> <span className="text-foreground ml-1 font-medium">{formatCurrency(selectedSale.valor_total || 0)}</span></div>
                <div><span className="text-muted-foreground">Cliente:</span> <span className="text-foreground ml-1">{selectedSale.clientes?.nome}</span></div>
                <div><span className="text-muted-foreground">Email:</span> <span className="text-foreground ml-1">{selectedSale.clientes?.email}</span></div>
              </div>
              {saleItems.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">Itens (Order Bumps)</h4>
                  <div className="space-y-2">
                    {saleItems.map((item: any) => (
                      <div key={item.id} className="flex justify-between items-center bg-secondary rounded-md px-3 py-2 text-sm">
                        <span className="text-foreground">{item.nome_item || item.oferta_id}</span>
                        <span className="text-foreground font-medium">{formatCurrency(item.valor || 0)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
