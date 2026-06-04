import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/DashboardLayout';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

import { GerenciarUsuariosTab } from '@/components/GerenciarUsuariosTab';
import { CargosTab }            from '@/components/admin/CargosTab';
import { AvaliarCriativoTab }   from '@/components/editores/AvaliarCriativoTab';
import { EmpresasOfertasTab }   from '@/components/editores/EmpresasOfertasTab';
import { ConfiguracaoTab }      from '@/components/editores/ConfiguracaoTab';
import { ParametrosFiscaisTab } from '@/components/admin/ParametrosFiscaisTab';
import { RadarConfigTab }       from '@/components/radar/RadarConfigTab';
import { NotasTab }             from '@/components/admin/NotasTab';

import {
  Users, Award, Star, Building2, ListChecks,
  Calculator, Radar, StickyNote,
} from 'lucide-react';

type TabId =
  | 'usuarios' | 'cargos'
  | 'criativos' | 'empresas' | 'criterios'
  | 'fiscal' | 'radar' | 'notas';

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ElementType;
  group: string;
}

const TABS: TabDef[] = [
  { group: 'Pessoas',    id: 'usuarios',  label: 'Usuários',           icon: Users       },
  { group: 'Pessoas',    id: 'cargos',    label: 'Cargos',             icon: Award       },
  { group: 'Operações',  id: 'criativos', label: 'Avaliar Criativos',  icon: Star        },
  { group: 'Operações',  id: 'empresas',  label: 'Empresas e Ofertas', icon: Building2   },
  { group: 'Operações',  id: 'criterios', label: 'Critérios',          icon: ListChecks  },
  { group: 'Sistema',    id: 'fiscal',    label: 'Parâmetros Fiscais', icon: Calculator  },
  { group: 'Sistema',    id: 'radar',     label: 'Radar',              icon: Radar       },
  { group: 'Sistema',    id: 'notas',     label: 'Notas',              icon: StickyNote  },
];

const GROUPS = ['Pessoas', 'Operações', 'Sistema'];

export default function AdminPage() {
  const { perfil } = useAuth();
  const navigate   = useNavigate();
  const [active, setActive] = useState<TabId>('usuarios');

  // Redireciona não-admins imediatamente
  if (!perfil?.is_admin) {
    navigate('/');
    return null;
  }

  const renderContent = () => {
    switch (active) {
      case 'usuarios':  return <GerenciarUsuariosTab />;
      case 'cargos':    return <CargosTab />;
      case 'criativos': return <AvaliarCriativoTab />;
      case 'empresas':  return <EmpresasOfertasTab />;
      case 'criterios': return <ConfiguracaoTab />;
      case 'fiscal':    return <ParametrosFiscaisTab />;
      case 'radar':     return <RadarConfigTab />;
      case 'notas':     return <NotasTab />;
    }
  };

  return (
    <DashboardLayout title="Administrativo">
      <div className="flex gap-6 min-h-[600px]">

        {/* Nav lateral */}
        <nav className="w-48 shrink-0">
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {GROUPS.map((group, gi) => {
              const groupTabs = TABS.filter(t => t.group === group);
              return (
                <div key={group}>
                  {gi > 0 && <div className="border-t border-border" />}
                  <div className="px-3 pt-3 pb-1">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                      {group}
                    </p>
                  </div>
                  <div className="pb-2 px-1.5 space-y-0.5">
                    {groupTabs.map(tab => {
                      const Icon    = tab.icon;
                      const isActive = active === tab.id;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => setActive(tab.id)}
                          className={cn(
                            'flex items-center gap-2.5 w-full rounded-md px-2.5 py-2 text-sm transition-colors text-left',
                            isActive
                              ? 'bg-primary/15 text-primary font-medium'
                              : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="truncate">{tab.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </nav>

        {/* Conteúdo */}
        <div className="flex-1 min-w-0">
          {renderContent()}
        </div>
      </div>
    </DashboardLayout>
  );
}
