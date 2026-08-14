import { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { Plus } from 'lucide-react';
import type { ProducaoNivel } from '../components/types';
import { MeuPainelView } from '../components/MeuPainelView';
import { CalendarioView } from '../components/CalendarioView';
import { PainelAprovacaoView } from '../components/PainelAprovacaoView';
import { CriativoFormModal } from '../components/CriativoFormModal';
const FASES_CALENDARIO_SETOR: Record<string, string[]> = {
  'Editor':             ['edicao', 'revisao_edicao', 'alteracao', 'aprovado'],
  'Copy':               ['producao_copy', 'revisao_copy', 'gravacao'],
  'Gestor de Tráfego':  ['aprovado', 'esteira_teste', 'postado'],
  'Especialista':       ['gravacao'],
};

// Tabs visíveis por nível
const TABS_POR_NIVEL: Record<ProducaoNivel, readonly string[]> = {
  socio:  ['Meu Painel', 'Calendário Geral', 'Painel de Aprovação'],
  head:   ['Meu Painel', 'Calendário do Setor', 'Painel de Aprovação'],
  membro: ['Meu Painel'],
};

export default function ProducaoPage() {
  const { user, perfil } = useAuth();
  const [activeTab, setActiveTab] = useState<string>('Meu Painel');

  // setor_id já está no perfil carregado pelo AuthContext — sem query extra necessária
  const setorId = perfil?.setor_id ?? null;

  // Deriva nível a partir do cargo real
  const nivel: ProducaoNivel = (() => {
    if (perfil?.is_admin) return 'socio';
    if (perfil?.cargo?.pode_aprovar) return 'head';
    return 'membro';
  })();

  const [novoItemOpen, setNovoItemOpen] = useState(false);

  const userId    = user?.id ?? '';
  const setor     = perfil?.setor ?? null;
  const tabs      = TABS_POR_NIVEL[nivel];

  // Garante que a tab ativa seja válida para o nível atual
  useEffect(() => {
    if (!tabs.includes(activeTab)) setActiveTab('Meu Painel');
  }, [nivel, tabs, activeTab]);

  return (
    <DashboardLayout title="Produção" hideFilters>
      {/* In-page tab nav */}
      <div className="flex items-center gap-1 mb-6 flex-wrap">
        {tabs.map(tab => (
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
        {nivel !== 'membro' && (
          <button
            onClick={() => setNovoItemOpen(true)}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Novo item
          </button>
        )}
      </div>

      <CriativoFormModal
        open={novoItemOpen}
        onClose={() => setNovoItemOpen(false)}
        onCreated={() => setNovoItemOpen(false)}
        userId={userId}
      />

      {activeTab === 'Meu Painel' && (
        <MeuPainelView nivel={nivel} setorId={setorId} userId={userId} setor={setor} />
      )}
      {activeTab === 'Calendário Geral' && (
        <CalendarioView nivel={nivel} setorId={setorId} userId={userId} />
      )}
      {activeTab === 'Calendário do Setor' && (
        <CalendarioView
          nivel={nivel}
          setorId={setorId}
          userId={userId}
          somenteSetor
          fasesVisiveis={FASES_CALENDARIO_SETOR[setor?.nome ?? ''] ?? undefined}
        />
      )}
      {activeTab === 'Painel de Aprovação' && (
        <PainelAprovacaoView nivel={nivel} setor={setor} userId={userId} />
      )}
    </DashboardLayout>
  );
}
