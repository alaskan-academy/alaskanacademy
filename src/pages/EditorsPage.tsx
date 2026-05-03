import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { useFilters } from '@/contexts/FilterContext';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/formatters';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { PerfisTab } from '@/components/editores/PerfisTab';
import { AvaliacoesTab } from '@/components/editores/AvaliacoesTab';
import { DesempenhoTab } from '@/components/editores/DesempenhoTab';
import { ConfiguracaoTab } from '@/components/editores/ConfiguracaoTab';

export default function EditorsPage() {
  const { startDateStr, endDateStr } = useFilters();
  const [ranking, setRanking] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editors, setEditors] = useState<any[]>([]);
  const [formData, setFormData] = useState({
    editor_id: '', ad_id_meta: '', nota: 3, status_criativo: 'testando', observacao: ''
  });

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const [r1, r2] = await Promise.all([
        supabase.from('vw_editores_performance').select('*').gte('data', startDateStr).lte('data', endDateStr),
        supabase.from('editores').select('id, nome'),
      ]);
      setRanking(r1.data || []);
      setEditors(r2.data || []);
      setLoading(false);
    };
    fetch();
  }, [startDateStr, endDateStr]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from('avaliacoes_criativos').insert({
      ...formData, nota: Number(formData.nota),
    });
    if (error) toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    else {
      toast({ title: 'Avaliação salva com sucesso!' });
      setFormData({ editor_id: '', ad_id_meta: '', nota: 3, status_criativo: 'testando', observacao: '' });
    }
  };

  const rankingCols = [
    { key: 'editor', label: 'Editor' },
    { key: 'criativos_ativos', label: 'Criativos', format: formatNumber },
    { key: 'ctr_medio', label: 'CTR Médio', format: (v: number) => formatPercent(v || 0) },
    { key: 'cpc_medio', label: 'CPC Médio', format: formatCurrency },
    { key: 'roas_medio', label: 'ROAS Médio', format: (v: number) => `${(v || 0).toFixed(2)}x` },
    { key: 'compras_geradas', label: 'Compras', format: formatNumber },
    { key: 'investimento_total', label: 'Investimento', format: formatCurrency },
  ];

  const tabCls = "data-[state=active]:bg-primary data-[state=active]:text-primary-foreground";

  return (
    <DashboardLayout title="Performance de Editores">
      <Tabs defaultValue="perfis" className="space-y-4">
        <TabsList className="bg-secondary border border-border flex-wrap h-auto">
          <TabsTrigger value="perfis" className={tabCls}>Perfis</TabsTrigger>
          <TabsTrigger value="avaliacoes" className={tabCls}>Avaliações</TabsTrigger>
          <TabsTrigger value="desempenho" className={tabCls}>Desempenho</TabsTrigger>
          <TabsTrigger value="ranking" className={tabCls}>Ranking Meta</TabsTrigger>
          <TabsTrigger value="avaliacao" className={tabCls}>Avaliar criativo</TabsTrigger>
          <TabsTrigger value="config" className={tabCls}>Configuração</TabsTrigger>
        </TabsList>
        <TabsContent value="config"><ConfiguracaoTab /></TabsContent>

        <TabsContent value="perfis"><PerfisTab /></TabsContent>
        <TabsContent value="avaliacoes"><AvaliacoesTab /></TabsContent>
        <TabsContent value="desempenho"><DesempenhoTab /></TabsContent>

        <TabsContent value="ranking">
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">Carregando...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {rankingCols.map(c => (
                        <th key={c.key} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.map((row, i) => (
                      <tr key={i} className="border-b border-border/50 hover:bg-secondary/50 transition-colors">
                        {rankingCols.map(c => (
                          <td key={c.key} className="px-4 py-3 text-foreground whitespace-nowrap">
                            {c.format ? c.format(row[c.key] || 0) : (row[c.key] || '-')}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {ranking.length === 0 && (
                      <tr><td colSpan={rankingCols.length} className="px-4 py-8 text-center text-muted-foreground">Nenhum dado encontrado</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="avaliacao">
          <div className="bg-card border border-border rounded-lg p-6 max-w-lg">
            <h3 className="text-sm font-medium text-foreground mb-4">Avaliar Criativo</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground">Editor</label>
                <select value={formData.editor_id} onChange={e => setFormData({ ...formData, editor_id: e.target.value })}
                  className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary" required>
                  <option value="">Selecione...</option>
                  {editors.map(ed => <option key={ed.id} value={ed.id}>{ed.nome}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Ad ID Meta</label>
                <input type="text" value={formData.ad_id_meta} onChange={e => setFormData({ ...formData, ad_id_meta: e.target.value })}
                  className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary" required />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Nota (1-5)</label>
                <input type="number" min={1} max={5} value={formData.nota} onChange={e => setFormData({ ...formData, nota: Number(e.target.value) })}
                  className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Status do Criativo</label>
                <select value={formData.status_criativo} onChange={e => setFormData({ ...formData, status_criativo: e.target.value })}
                  className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
                  <option value="testando">Testando</option>
                  <option value="validado">Validado</option>
                  <option value="escalado">Escalado</option>
                  <option value="pausado">Pausado</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Observação</label>
                <textarea value={formData.observacao} onChange={e => setFormData({ ...formData, observacao: e.target.value })}
                  className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary" rows={3} />
              </div>
              <Button type="submit" className="w-full">Salvar Avaliação</Button>
            </form>
          </div>
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
}
