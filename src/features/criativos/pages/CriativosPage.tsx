import { useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { AvaliacaoView } from '../components/AvaliacaoView';
import { DesempenhoAdsView } from '../components/DesempenhoAdsView';
import { PorProjetoView } from '@/features/producao/components/PorProjetoView';

const TABS = ['Avaliação', 'Por Projeto', 'Desempenho'] as const;
type Tab = typeof TABS[number];

export default function CriativosPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('Avaliação');
  const userId = user?.id ?? '';

  return (
    <DashboardLayout title="Criativos" hideFilters>
      <div className="flex items-center gap-1 mb-6 flex-wrap">
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

      {activeTab === 'Avaliação'   && <AvaliacaoView userId={userId} />}
      {activeTab === 'Por Projeto' && <PorProjetoView nivel="socio" userId={userId} />}
      {activeTab === 'Desempenho'  && <DesempenhoAdsView />}
    </DashboardLayout>
  );
}
