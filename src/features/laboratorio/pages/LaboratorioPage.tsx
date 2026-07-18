import { useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { cn } from '@/lib/utils';
import { RadarContent } from '@/features/radar/pages/RadarPage';
import { ReferenciasContent } from '@/features/referencias/pages/ReferenciasPage';

type Tab = 'radar' | 'referencias';

const TABS: { id: Tab; label: string }[] = [
  { id: 'radar',      label: 'Radar'       },
  { id: 'referencias', label: 'Referências' },
];

export default function LaboratorioPage() {
  const [active, setActive] = useState<Tab>('radar');

  return (
    <DashboardLayout title="Laboratório">
      <div className="flex gap-1 p-1 bg-secondary/50 rounded-lg w-fit mb-6">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={cn(
              'px-4 py-1.5 text-sm rounded-md transition-colors font-medium',
              active === tab.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {active === 'radar'      && <RadarContent />}
      {active === 'referencias' && <ReferenciasContent />}
    </DashboardLayout>
  );
}
