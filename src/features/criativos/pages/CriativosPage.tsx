import { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { fetchFunis } from '@/lib/dataCache';
import { MultiFilter } from '@/features/producao/components/MultiFilter';
import { AvaliacaoView } from '../components/AvaliacaoView';
import { DesempenhoAdsView } from '../components/DesempenhoAdsView';
import { PorProjetoView } from '@/features/producao/components/PorProjetoView';
import type { Funil } from '@/features/producao/components/types';

const TABS = ['Avaliação', 'Por Projeto', 'Desempenho'] as const;
type Tab = typeof TABS[number];

export default function CriativosPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('Avaliação');
  const userId = user?.id ?? '';

  const [funis, setFunis]           = useState<Funil[]>([]);
  const [filtroFunil, setFiltroFunil] = useState<string[]>([]);

  useEffect(() => {
    fetchFunis().then(fs => setFunis(fs as Funil[]));
  }, []);

  return (
    <DashboardLayout title="Criativos" hideFilters>
      {/* Filtro global de funil + tabs */}
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-4 py-1.5 rounded-full text-sm font-medium transition-colors',
                activeTab === tab
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
              )}
            >
              {tab}
            </button>
          ))}
        </div>

        {funis.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Funil:</span>
            <MultiFilter
              label="Todos os funis"
              options={funis.map(f => ({ id: f.id, nome: f.nome }))}
              value={filtroFunil}
              onChange={setFiltroFunil}
              width="w-48"
            />
          </div>
        )}
      </div>

      {activeTab === 'Avaliação'   && <AvaliacaoView userId={userId} filtroFunil={filtroFunil} />}
      {activeTab === 'Por Projeto' && <PorProjetoView nivel="socio" userId={userId} filtroFunil={filtroFunil} />}
      {activeTab === 'Desempenho'  && <DesempenhoAdsView filtroFunil={filtroFunil} funisList={funis} />}
    </DashboardLayout>
  );
}
