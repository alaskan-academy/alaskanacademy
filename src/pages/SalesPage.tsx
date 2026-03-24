import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { useFilters } from '@/contexts/FilterContext';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';

const statusStyles: Record<string, string> = {
  aprovada: 'bg-success/20 text-success border-success/30',
  pendente: 'bg-warning/20 text-warning border-warning/30',
  cancelada: 'bg-muted text-muted-foreground border-border',
  reembolsada: 'bg-destructive/20 text-destructive border-destructive/30',
};

export default function SalesPage() {
  const { startDateStr, endDateStr, product } = useFilters();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSale, setSelectedSale] = useState<any>(null);
  const [saleItems, setSaleItems] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('todos');
  const [paymentFilter, setPaymentFilter] = useState('todos');

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      let q = supabase.from('vendas').select('*, clientes(nome, email, telefone)')
        .gte('data_venda', startDateStr).lte('data_venda', endDateStr)
        .order('data_venda', { ascending: false });
      if (product !== 'todos') q = q.eq('produto', product);
      if (statusFilter !== 'todos') q = q.eq('status', statusFilter);
      if (paymentFilter !== 'todos') q = q.eq('meio_pagamento', paymentFilter);

      const { data: result } = await q;
      setData(result || []);
      setLoading(false);
    };
    fetchData();
  }, [startDateStr, endDateStr, product, statusFilter, paymentFilter]);

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

  return (
    <DashboardLayout title="Vendas">
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
                  {['Pedido', 'Data', 'Cliente', 'Produto', 'Status', 'Total', 'Oferta Principal', 'OBs', 'Pagamento', 'UTM Source', 'UTM Campaign'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((sale) => (
                  <tr key={sale.id} onClick={() => openDetail(sale)}
                    className="border-b border-border/50 hover:bg-secondary/50 transition-colors cursor-pointer">
                    <td className="px-4 py-3 text-foreground font-mono text-xs">{displayPedidoId(sale)}</td>
                    <td className="px-4 py-3 text-foreground whitespace-nowrap">{sale.data_venda ? format(new Date(sale.data_venda), 'dd/MM/yy HH:mm') : '-'}</td>
                    <td className="px-4 py-3 text-foreground">{sale.clientes?.nome || '-'}</td>
                    <td className="px-4 py-3 text-foreground capitalize">{sale.produto || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium border", statusStyles[sale.status] || 'bg-muted text-muted-foreground')}>
                        {sale.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-foreground font-medium">{formatCurrency(sale.valor_total || 0)}</td>
                    <td className="px-4 py-3 text-foreground">{formatCurrency(sale.valor_oferta_principal || 0)}</td>
                    <td className="px-4 py-3 text-foreground">{formatCurrency(sale.valor_obs || 0)}</td>
                    <td className="px-4 py-3 text-foreground">{sale.meio_pagamento || '-'}</td>
                    <td className="px-4 py-3 text-foreground text-xs">{sale.utm_source || '-'}</td>
                    <td className="px-4 py-3 text-foreground text-xs">{sale.utm_campaign || '-'}</td>
                  </tr>
                ))}
                {data.length === 0 && (
                  <tr><td colSpan={11} className="px-4 py-8 text-center text-muted-foreground">Nenhuma venda encontrada</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
                <div><span className="text-muted-foreground">Pagamento:</span> <span className="text-foreground ml-1">{selectedSale.meio_pagamento}</span></div>
                <div><span className="text-muted-foreground">UTM Content:</span> <span className="text-foreground ml-1 text-xs">{selectedSale.utm_content || '-'}</span></div>
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
