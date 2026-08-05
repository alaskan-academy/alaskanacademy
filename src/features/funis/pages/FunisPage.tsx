import { useCallback, useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Funil, Projeto, SubOferta, FunilSuboferta, Dominio, TesteFunil, getStatusDisplay } from '../types';
import { AlertaBanner } from '../components/AlertaBanner';
import { FunisTab } from '../components/FunisTab';
import { DominiosTab } from '../components/DominiosTab';
import { TestesTab } from '../components/TestesTab';

type Tab = 'funis' | 'dominios' | 'testes';

interface State {
  funis: Funil[];
  projetos: Projeto[];
  subOfertas: SubOferta[];
  funilSubofertas: FunilSuboferta[];
  dominios: Dominio[];
  testes: TesteFunil[];
  loading: boolean;
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'funis',    label: 'Funis' },
  { key: 'dominios', label: 'Domínios' },
  { key: 'testes',   label: 'Testes' },
];

export default function FunisPage() {
  const [activeTab, setActiveTab] = useState<Tab>('funis');
  const [state, setState] = useState<State>({
    funis: [], projetos: [], subOfertas: [], funilSubofertas: [],
    dominios: [], testes: [], loading: true,
  });

  const load = useCallback(async () => {
    const [f, p, s, fs, d, t] = await Promise.all([
      supabase.from('funis').select('*').order('nome'),
      supabase.from('ofertas_editores').select('id,nome,empresa_id,ativo').order('nome'),
      supabase.from('ofertas').select('id,nome,tipo').order('nome'),
      supabase.from('funil_subofertas').select('*'),
      supabase.from('dominios').select('*').order('nome'),
      supabase.from('testes_funis').select('*').order('created_at', { ascending: false }),
    ]);
    setState({
      funis:           (f.data ?? []) as Funil[],
      projetos:        (p.data ?? []) as Projeto[],
      subOfertas:      (s.data ?? []) as SubOferta[],
      funilSubofertas: (fs.data ?? []) as FunilSuboferta[],
      dominios:        (d.data ?? []) as Dominio[],
      testes:          (t.data ?? []) as TesteFunil[],
      loading:         false,
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  // Summary counts for tab badges
  const ativosCount   = state.funis.filter(f => {
    const s = getStatusDisplay(f, state.testes);
    return s === 'ativo' || s === 'em_teste';
  }).length;
  const testesAtivos  = state.testes.filter(t => !t.data_fim).length;

  if (state.loading) {
    return (
      <DashboardLayout title="Funis">
        <div className="flex items-center justify-center py-32">
          <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="Funis">
      <div className="space-y-4">
        {/* Alert banner */}
        <AlertaBanner
          dominios={state.dominios}
          onGoToDominios={() => setActiveTab('dominios')}
        />

        {/* Summary pills */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            {ativosCount} funil{ativosCount !== 1 ? 's' : ''} ativo{ativosCount !== 1 ? 's' : ''}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-flex h-2 w-2 rounded-full bg-amber-500" />
            {testesAtivos} teste{testesAtivos !== 1 ? 's' : ''} em andamento
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-flex h-2 w-2 rounded-full bg-blue-500" />
            {state.dominios.filter(d => d.ativo).length} domínio{state.dominios.filter(d => d.ativo).length !== 1 ? 's' : ''} ativo{state.dominios.filter(d => d.ativo).length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Tab nav */}
        <div className="flex gap-1 border-b border-border">
          {TABS.map(tab => {
            const badge = tab.key === 'testes' && testesAtivos > 0 ? testesAtivos : null;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'relative px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
                  activeTab === tab.key
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
                {badge && (
                  <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-400">
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div>
          {activeTab === 'funis' && (
            <FunisTab
              funis={state.funis}
              projetos={state.projetos}
              subOfertas={state.subOfertas}
              funilSubofertas={state.funilSubofertas}
              dominios={state.dominios}
              testes={state.testes}
              onReload={load}
            />
          )}
          {activeTab === 'dominios' && (
            <DominiosTab
              dominios={state.dominios}
              funis={state.funis}
              onReload={load}
            />
          )}
          {activeTab === 'testes' && (
            <TestesTab
              testes={state.testes}
              funis={state.funis}
              projetos={state.projetos}
              onReload={load}
            />
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
