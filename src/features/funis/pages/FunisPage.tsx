import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/DashboardLayout';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Funil, Projeto, FunilSuboferta, Dominio, TesteFunil, PerfilSimples, getStatusDisplay } from '../types';
import { AlertaBanner } from '../components/AlertaBanner';
import { FunisTab } from '../components/FunisTab';
import { DominiosTab } from '../components/DominiosTab';
import { TestesTab } from '../components/TestesTab';
import { semVeredito } from '../testes';
import { CheckoutsTab } from '../components/CheckoutsTab';
import { MapaTab } from '../components/MapaTab';

type Tab = 'funis' | 'mapa' | 'testes' | 'dominios' | 'checkouts';

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
  { key: 'mapa',       label: 'Mapa' },
  { key: 'funis',      label: 'Funis' },
  { key: 'testes',     label: 'Testes' },
  { key: 'dominios',   label: 'Domínios' },
  { key: 'checkouts',  label: 'Checkouts' },
];

export default function FunisPage() {
  /*
    A aba vive na URL, e não num `useState`.

    Vivia em estado local, e por isso não havia como mandar alguém para uma aba
    específica — o Radar precisa disso para abrir o teste de funil que ele
    espelha, e um F5 no meio do trabalho voltava para o Mapa.
  */
  const [params, setParams] = useSearchParams();
  const pedida = params.get('aba');
  const activeTab = (TABS.some(t => t.key === pedida) ? pedida : 'mapa') as Tab;

  const setActiveTab = (key: Tab) => {
    const p = new URLSearchParams(params);
    p.set('aba', key);
    // `replace`: trocar de aba não é navegação para o botão Voltar.
    setParams(p, { replace: true });
  };

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
  // Os rotulos seguem as COLUNAS do quadro de testes. Enquanto existiam tres
  // telas, esta pilula dizia "na esteira" -- nome de uma tela que nao existe
  // mais, e que ninguem encontraria ao procurar.
  const naFilaCount     = state.testes.filter(t => t.pipeline_status === 'planejado' || t.pipeline_status === 'produzindo' || !t.pipeline_status).length;
  const prontoCount     = state.testes.filter(t => t.pipeline_status === 'pronto_para_teste').length;
  const testesCount     = state.testes.filter(t => t.pipeline_status === 'rodando').length;
  const semVereditoCount = state.testes.filter(semVeredito).length;

  if (state.loading) {
    return (
      <DashboardLayout title="Funis" hideTitle>
        <div className="flex items-center justify-center py-32">
          <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="Funis" hideFilters hideTitle>
      <div className="space-y-4">
        {/* Alert banner */}
        <AlertaBanner
          dominios={state.dominios}
          onGoToDominios={() => setActiveTab('dominios')}
        />

        {/* As cinco pilulas que ficavam aqui contavam TESTES numa tela que
            tambem mostra REVs, dominios e checkouts, e uma delas exibia zero:
            espaco fixo para dizer que nao ha nada.

            Cada aba agora mostra a SUA pendencia, do lado de quem pode agir:
            Funis diz quantos REVs estao sem VSL, Testes diz quantos estao sem
            veredito, e Checkouts ja mostrava o progresso em vendas. */}
        {/* Tab nav */}
        <div className="flex gap-1 border-b border-border">
          {TABS.map(tab => {
            // O selo mostra o que precisa de decisão, não o que existe. Um
            // número que só cresce vira paisagem; "3 sem veredito" é ação.
            const badge = tab.key === 'testes' && semVereditoCount > 0 ? semVereditoCount : null;
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
          {activeTab === 'mapa' && <MapaTab />}
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
        </div>
      </div>
    </DashboardLayout>
  );
}
