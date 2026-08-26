import { useCallback, useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Funil, Projeto, FunilSuboferta, Dominio, TesteFunil, PerfilSimples, getStatusDisplay } from '../types';
import { AlertaBanner } from '../components/AlertaBanner';
import { FunisTab } from '../components/FunisTab';
import { DominiosTab } from '../components/DominiosTab';
import { TestesTab } from '../components/TestesTab';
import { EsteiraTab } from '../components/EsteiraTab';
import { ConcluídosTab } from '../components/ConcluídosTab';
import { GeradorUtmTab } from '../components/GeradorUtmTab';
import { CheckoutsTab } from '../components/CheckoutsTab';

type Tab = 'funis' | 'esteira' | 'testes' | 'concluidos' | 'dominios' | 'checkouts' | 'utm';

interface State {
  funis: Funil[];
  projetos: Projeto[];
  funilSubofertas: FunilSuboferta[];
  dominios: Dominio[];
  testes: TesteFunil[];
  perfis: PerfilSimples[];
  loading: boolean;
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'funis',      label: 'Funis' },
  { key: 'esteira',    label: 'Esteira' },
  { key: 'testes',     label: 'Testes' },
  { key: 'concluidos', label: 'Concluídos' },
  { key: 'dominios',   label: 'Domínios' },
  { key: 'checkouts',  label: 'Checkouts' },
  { key: 'utm',        label: 'UTM' },
];

export default function FunisPage() {
  const [activeTab, setActiveTab] = useState<Tab>('funis');
  const [state, setState] = useState<State>({
    funis: [], projetos: [], funilSubofertas: [],
    dominios: [], testes: [], perfis: [], loading: true,
  });

  const load = useCallback(async () => {
    const [f, p, fs, d, t, pf] = await Promise.all([
      supabase.from('funis').select('*').order('nome'),
      supabase.from('ofertas_editores').select('id,nome,empresa_id,ativo').eq('ativo', true).order('nome'),
      supabase.from('funil_subofertas').select('*'),
      supabase.from('dominios').select('*').order('nome'),
      supabase.from('testes_funis').select('*').eq('arquivado', false).order('created_at', { ascending: false }),
      supabase.from('perfis').select('id,nome').eq('ativo', true).order('nome'),
    ]);
    setState({
      funis:           (f.data ?? []) as Funil[],
      projetos:        (p.data ?? []) as Projeto[],
      funilSubofertas: (fs.data ?? []) as FunilSuboferta[],
      dominios:        (d.data ?? []) as Dominio[],
      testes:          (t.data ?? []) as TesteFunil[],
      perfis:          (pf.data ?? []) as PerfilSimples[],
      loading:         false,
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  // Summary counts for tab badges
  const ativosCount  = state.funis.filter(f => {
    const s = getStatusDisplay(f, state.testes);
    return s === 'ativo' || s === 'em_teste';
  }).length;
  const esteiraCount    = state.testes.filter(t => t.pipeline_status === 'planejado' || t.pipeline_status === 'produzindo' || !t.pipeline_status).length;
  const prontoCount     = state.testes.filter(t => t.pipeline_status === 'pronto_para_teste').length;
  const testesCount     = state.testes.filter(t => t.pipeline_status === 'rodando').length;
  const concluidosCount = state.testes.filter(t => t.pipeline_status === 'concluido').length;

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
    <DashboardLayout title="Funis" hideFilters>
      <div className="space-y-4">
        {/* Alert banner */}
        <AlertaBanner
          dominios={state.dominios}
          onGoToDominios={() => setActiveTab('dominios')}
        />

        {/* Summary pills */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Ativos — emerald: sinal de saúde/ativo */}
          <span className={cn(
            'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium',
            ativosCount > 0
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-muted/40 text-muted-foreground/50 border border-border/40',
          )}>
            <span className={cn('h-1.5 w-1.5 rounded-full', ativosCount > 0 ? 'bg-emerald-400' : 'bg-muted-foreground/30')} />
            {ativosCount} ativo{ativosCount !== 1 ? 's' : ''}
          </span>

          {/* Rodando — amber: atenção, em observação */}
          <span className={cn(
            'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium',
            testesCount > 0
              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              : 'bg-muted/40 text-muted-foreground/50 border border-border/40',
          )}>
            <span className={cn('h-1.5 w-1.5 rounded-full', testesCount > 0 ? 'bg-amber-400' : 'bg-muted-foreground/30')} />
            {testesCount} rodando
          </span>

          {/* Pronto para teste — teal: pronto, aguardando */}
          <span className={cn(
            'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium',
            prontoCount > 0
              ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
              : 'bg-muted/40 text-muted-foreground/50 border border-border/40',
          )}>
            <span className={cn('h-1.5 w-1.5 rounded-full', prontoCount > 0 ? 'bg-teal-400' : 'bg-muted-foreground/30')} />
            {prontoCount} pronto para teste
          </span>

          {/* Na esteira — purple: em produção */}
          <span className={cn(
            'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium',
            esteiraCount > 0
              ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
              : 'bg-muted/40 text-muted-foreground/50 border border-border/40',
          )}>
            <span className={cn('h-1.5 w-1.5 rounded-full', esteiraCount > 0 ? 'bg-purple-400' : 'bg-muted-foreground/30')} />
            {esteiraCount} na esteira
          </span>

          {/* Domínios — sky: informacional */}
          {(() => {
            const d = state.dominios.filter(d => d.ativo).length;
            return (
              <span className={cn(
                'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium',
                d > 0
                  ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                  : 'bg-muted/40 text-muted-foreground/50 border border-border/40',
              )}>
                <span className={cn('h-1.5 w-1.5 rounded-full', d > 0 ? 'bg-sky-400' : 'bg-muted-foreground/30')} />
                {d} domínio{d !== 1 ? 's' : ''} ativo{d !== 1 ? 's' : ''}
              </span>
            );
          })()}
        </div>

        {/* Tab nav */}
        <div className="flex gap-1 border-b border-border">
          {TABS.map(tab => {
            const badge =
              tab.key === 'testes'     && testesCount    > 0 ? testesCount    :
              tab.key === 'esteira'    && esteiraCount   > 0 ? esteiraCount   :
              tab.key === 'concluidos' && concluidosCount > 0 ? concluidosCount :
              null;
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
              funilSubofertas={state.funilSubofertas}
              dominios={state.dominios}
              testes={state.testes}
              onReload={load}
            />
          )}
          {activeTab === 'esteira' && (
            <EsteiraTab
              testes={state.testes}
              funis={state.funis}
              projetos={state.projetos}
              perfis={state.perfis}
              onReload={load}
            />
          )}
          {activeTab === 'checkouts' && (
            <CheckoutsTab
              funis={state.funis}
              projetos={state.projetos}
            />
          )}
          {activeTab === 'dominios' && (
            <DominiosTab
              dominios={state.dominios}
              funis={state.funis}
              projetos={state.projetos}
              onReload={load}
            />
          )}
          {activeTab === 'testes' && (
            <TestesTab
              testes={state.testes}
              funis={state.funis}
              projetos={state.projetos}
              perfis={state.perfis}
              onReload={load}
            />
          )}
          {activeTab === 'concluidos' && (
            <ConcluídosTab
              testes={state.testes}
              funis={state.funis}
              projetos={state.projetos}
              perfis={state.perfis}
              onReload={load}
            />
          )}
          {activeTab === 'utm' && <GeradorUtmTab />}
        </div>
      </div>
    </DashboardLayout>
  );
}
