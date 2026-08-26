import { useState, useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/DashboardLayout';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { Plus } from 'lucide-react';
import type { ProducaoNivel, Funil, Perfil } from '../components/types';
import { MeuPainelView } from '../components/MeuPainelView';
import { CalendarioView } from '../components/CalendarioView';
import { PainelAprovacaoView } from '../components/PainelAprovacaoView';
import { CriativoDrawer } from '../components/CriativoDrawer';
import { CriativoFormModal } from '../components/CriativoFormModal';
import { supabase } from '@/lib/supabase';
import { useFases, fasesDoSetor } from '../useFases';
/*
 * `FASES_CALENDARIO_SETOR` morava aqui — o terceiro dos quatro mapas de
 * setor→fases. Vem da tabela agora, ligado por `setor_id`.
 */

/**
 * As abas, com um apelido curto para a URL.
 *
 * A aba vivia só em `useState`: não dava para mandar "olha o painel de
 * aprovação" para alguém, e recarregar voltava para "Meu Painel" no meio do
 * trabalho. Na URL, o link funciona e o F5 não perde o lugar.
 */
const TABS: { chave: string; label: string; niveis: ProducaoNivel[] }[] = [
  { chave: 'painel',    label: 'Meu Painel',          niveis: ['socio', 'head', 'membro'] },
  { chave: 'calendario', label: 'Calendário Geral',    niveis: ['socio'] },
  { chave: 'setor',     label: 'Calendário do Setor',  niveis: ['head'] },
  { chave: 'aprovacao', label: 'Painel de Aprovação',  niveis: ['socio', 'head'] },
];

export default function ProducaoPage() {
  const { user, perfil } = useAuth();
  const location = useLocation();
  const [params, setParams] = useSearchParams();

  // setor_id já está no perfil carregado pelo AuthContext — sem query extra necessária
  const setorId = perfil?.setor_id ?? null;

  // Deriva nível a partir do cargo real
  const nivel: ProducaoNivel = (() => {
    if (perfil?.is_admin) return 'socio';
    if (perfil?.cargo?.pode_aprovar) return 'head';
    return 'membro';
  })();

  const [novoItemOpen, setNovoItemOpen] = useState(false);

  const userId = user?.id ?? '';
  const setor  = perfil?.setor ?? null;
  const tabs   = TABS.filter(t => t.niveis.includes(nivel));

  // A aba pedida na URL, se ela existir para este nível. Um link de "aprovação"
  // recebido por quem não aprova cai no painel em vez de dar tela em branco.
  const pedida    = params.get('aba');
  const activeTab = tabs.find(t => t.chave === pedida)?.chave ?? tabs[0]?.chave ?? 'painel';

  const irPara = (chave: string) => {
    const p = new URLSearchParams(params);
    p.set('aba', chave);
    // `replace`: trocar de aba não é navegação para o botão Voltar. Sem isso,
    // sair da página exigiria um Voltar para cada aba visitada.
    setParams(p, { replace: true });
  };

  // Abrir um criativo direto pela notificação. `?criativo=` na URL e não
  // `location.state`: o state morre no F5, e o link do e-mail deixaria de
  // funcionar ao recarregar.
  const notifCriativoId = params.get('criativo')
    ?? (location.state as { criativoId?: string } | null)?.criativoId
    ?? null;

  const fecharCriativo = () => {
    const p = new URLSearchParams(params);
    p.delete('criativo');
    setParams(p, { replace: true });
  };

  const { fases } = useFases();
  const fasesDoMeuSetor = fasesDoSetor(fases, setorId);

  // As listas que o drawer da notificação precisa, buscadas só quando há um
  // criativo para abrir — não em toda visita à página.
  const [funis, setFunis]   = useState<Funil[]>([]);
  const [perfis, setPerfis] = useState<Perfil[]>([]);
  const [, setRecarregar]   = useState(0);

  useEffect(() => {
    if (!notifCriativoId || funis.length || perfis.length) return;
    (async () => {
      const [{ data: f }, { data: p }] = await Promise.all([
        supabase.from('funis').select('id,nome,produto,ativo').order('nome'),
        supabase.from('perfis').select('id,nome,is_admin').order('nome'),
      ]);
      setFunis(f ?? []);
      setPerfis(p ?? []);
    })();
  }, [notifCriativoId, funis.length, perfis.length]);

  return (
    <DashboardLayout title="Produção" hideFilters hideTitle>
      {/* In-page tab nav */}
      <div className="flex items-center gap-1 mb-6 flex-wrap">
        {tabs.map(tab => (
          <button
            key={tab.chave}
            onClick={() => irPara(tab.chave)}
            className={cn(
              'px-4 py-1.5 rounded-full text-sm font-medium transition-colors',
              activeTab === tab.chave
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent',
            )}
          >
            {tab.label}
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

      {activeTab === 'painel' && (
        <MeuPainelView nivel={nivel} setorId={setorId} userId={userId} setor={setor} />
      )}
      {activeTab === 'calendario' && (
        <CalendarioView nivel={nivel} setorId={setorId} userId={userId} />
      )}
      {activeTab === 'setor' && (
        <CalendarioView
          nivel={nivel}
          setorId={setorId}
          userId={userId}
          somenteSetor
          fasesVisiveis={fasesDoMeuSetor.length ? fasesDoMeuSetor : undefined}
        />
      )}
      {activeTab === 'aprovacao' && (
        <PainelAprovacaoView nivel={nivel} setor={setor} userId={userId} />
      )}

      {/* Abre criativo diretamente a partir de notificação.
          `funis` e `perfis` vinham como listas VAZIAS: quem chegava por
          notificação abria um drawer com os seletores em branco, e não dava
          para trocar responsável nem funil. E `onUpdate` era uma função vazia,
          então editar por ali não atualizava nada na tela. */}
      {notifCriativoId && (
        <CriativoDrawer
          criativoId={notifCriativoId}
          onClose={fecharCriativo}
          onUpdate={() => setRecarregar(n => n + 1)}
          nivel={nivel}
          userId={userId}
          funis={funis}
          perfis={perfis}
        />
      )}
    </DashboardLayout>
  );
}
