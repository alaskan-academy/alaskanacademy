import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';

export default function SettingsPage() {
  const [configs, setConfigs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const { data } = await supabase.from('configuracoes').select('*');
      setConfigs(data || []);
      setLoading(false);
    };
    fetch();
  }, []);

  const updateConfig = async (id: string, field: string, value: number) => {
    const { error } = await supabase.from('configuracoes').update({ [field]: value }).eq('id', id);
    if (error) toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    else toast({ title: 'Configuração atualizada!' });
  };

  return (
    <DashboardLayout title="Configurações">
      <div className="bg-card border border-border rounded-lg p-6 max-w-lg">
        {loading ? (
          <div className="text-muted-foreground">Carregando...</div>
        ) : configs.length === 0 ? (
          <div className="text-muted-foreground">Nenhuma configuração encontrada</div>
        ) : (
          <div className="space-y-6">
            {configs.map((config) => (
              <div key={config.id} className="space-y-4">
                <div>
                  <label className="text-xs text-muted-foreground">Imposto (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    defaultValue={config.imposto}
                    onBlur={(e) => updateConfig(config.id, 'imposto', parseFloat(e.target.value))}
                    className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Taxa Plataforma (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    defaultValue={config.taxa_plataforma}
                    onBlur={(e) => updateConfig(config.id, 'taxa_plataforma', parseFloat(e.target.value))}
                    className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
