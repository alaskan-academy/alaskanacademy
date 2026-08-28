import { NavLink, useLocation } from 'react-router-dom';
import {
  Home, LayoutDashboard, TrendingUp, Activity, ShoppingCart,
  Settings, ChevronLeft, ChevronRight, Link2, BarChart3, X, GraduationCap, Wallet, FlaskConical, KeyRound, Film, PenLine, Layers, Clapperboard, LineChart,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSidebarState } from '@/contexts/SidebarContext';
import { useFilters } from '@/contexts/FilterContext';
import { useAuth } from '@/contexts/AuthContext';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { MarcaAlaskan } from '@/components/MarcaAlaskan';

/**
 * O menu, agrupado pelo MOTIVO de abrir cada tela.
 *
 * POR QUE "GERAL" DEIXOU DE EXISTIR
 *
 * Resumo, Meta Ads, Vendas, UTM e Tendências moravam dentro de um item
 * "Geral" que abria e fechava. Ele não era uma área: era o SELETOR DE
 * DASHBOARD — o lugar onde se escolhia entre "Geral" e cada funil. Os funis
 * saíram da barra faz tempo (o recorte por conta virou filtro no cabeçalho,
 * junto do período), e o seletor ficou com uma opção só: um nível de
 * profundidade a mais para escolher entre uma coisa.
 *
 * A própria CLAUDE.md diz que a sidebar é chapada e que sub-item aninhado é
 * exceção reservada ao seletor de dashboard. Sem o seletor, a exceção perdeu o
 * motivo — e as cinco telas sobem para o mesmo nível de todas as outras.
 *
 * OS GRUPOS SÃO PERGUNTAS, NÃO TIPOS DE CONTEÚDO
 *
 * O grupo "Dados" juntava coisas que ninguém junta na cabeça: quanto sobrou no
 * mês (Financeiro) e qual anúncio está caro (Meta Ads) são a mesma categoria
 * só para quem classifica por "é número". Quem abre está atrás de uma resposta
 * diferente em cada caso, então o grupo passa a ser a pergunta:
 *
 *   RESULTADO   quanto entrou e quanto sobrou
 *   AQUISIÇÃO   de onde vêm as vendas e o que a mídia está fazendo
 *   OPERAÇÃO    o trabalho do dia
 *   ESTRUTURA   como as coisas são definidas — cadastro, acesso, parâmetro
 *
 * Dentro de cada grupo a ordem vai do geral para o específico: em Resultado,
 * Resumo (o total) antes de Vendas (venda a venda) antes de Financeiro (a
 * empresa inteira, além das vendas). Em Aquisição, Meta Ads (o que se paga)
 * antes de UTM (de onde chegou) antes de Criativos e Análises, que são a
 * decisão em cima disso.
 *
 * O Início fica fora de qualquer grupo, sozinho no topo: é a porta de entrada
 * de todo mundo, e porta de entrada não pertence a categoria nenhuma.
 *
 * O mapa é o mesmo para todo mundo: o que muda por pessoa é o que ela alcança,
 * não onde as coisas ficam. Já tentei mover item de grupo conforme o perfil e
 * ela cortou, com razão — um menu igual para todos é mais fácil de explicar.
 */
const GRUPOS = [
  {
    titulo: null,   // Início não tem cabeçalho: é a porta, não uma seção.
    itens: [
      { path: '/', label: 'Início', icon: Home, key: 'inicio', adminOnly: false, sectorOnly: null },
    ],
  },
  {
    titulo: 'Resultado',
    itens: [
      { path: '/resumo',     label: 'Resumo',     icon: LayoutDashboard, key: 'overview',   adminOnly: false, sectorOnly: null },
      { path: '/vendas',     label: 'Vendas',     icon: ShoppingCart,    key: 'vendas',     adminOnly: false, sectorOnly: null },
      { path: '/financeiro', label: 'Financeiro', icon: Wallet,          key: 'financeiro', adminOnly: false, sectorOnly: null },
    ],
  },
  {
    titulo: 'Aquisição',
    itens: [
      { path: '/meta-ads',   label: 'Meta Ads',   icon: TrendingUp,   key: 'meta-ads',   adminOnly: false, sectorOnly: null },
      // "UTM" e não "Análise UTM": ela vive no grupo de aquisição, onde tudo é
      // análise — o prefixo só criava colisão com o módulo de Análises.
      { path: '/utm',        label: 'UTM',        icon: Link2,        key: 'utm',        adminOnly: false, sectorOnly: null },
      { path: '/tendencias', label: 'Tendências', icon: Activity,     key: 'tendencias', adminOnly: false, sectorOnly: null },
      // Dado sobre a operação, e só sócio alcança: Desempenho e Por Projeto são
      // leitura, e a Avaliação que escreve é o julgamento de quem já veio ler.
      { path: '/criativos',  label: 'Criativos',  icon: Clapperboard, key: 'criativos',  adminOnly: true,  sectorOnly: null },
      { path: '/analises',   label: 'Análises',   icon: LineChart,    key: 'analises',   adminOnly: true,  sectorOnly: null },
    ],
  },
  {
    titulo: 'Operação',
    itens: [
      { path: '/producao',    label: 'Produção',    icon: Film,          key: 'producao',    adminOnly: false, sectorOnly: null },
      // Operação para todo mundo, e não um grupo por perfil. A sócia abre para
      // avaliar criativo e conferir NF; o editor abre para ver a performance
      // dele e lançar a NF dele. Os motivos são diferentes, mas os dois têm
      // tarefa dentro.
      { path: '/editores',    label: 'Editores',    icon: BarChart3,     key: 'editores',    adminOnly: false, sectorOnly: null },
      { path: '/copywriters', label: 'Copywriters', icon: PenLine,       key: 'copywriters', adminOnly: false, sectorOnly: 'Copy' },
      { path: '/laboratorio', label: 'Laboratório', icon: FlaskConical,  key: 'laboratorio', adminOnly: false, sectorOnly: null },
      { path: '/processos',   label: 'Processos',   icon: GraduationCap, key: 'processos',   adminOnly: false, sectorOnly: null },
    ],
  },
  {
    titulo: 'Estrutura',
    itens: [
      { path: '/funis-gestao',  label: 'Funis',         icon: Layers,   key: 'funis-gestao',  adminOnly: false, sectorOnly: null },
      { path: '/acessos',       label: 'Acessos',       icon: KeyRound, key: 'acessos',       adminOnly: false, sectorOnly: null },
      { path: '/configuracoes', label: 'Configurações', icon: Settings, key: 'configuracoes', adminOnly: true,  sectorOnly: null },
    ],
  },
];


const prodColors: Record<string, string> = {
  velas: 'bg-orange-500/20 text-orange-400',
  saponaria: 'bg-green-500/20 text-green-400',
  cosmeticos: 'bg-pink-500/20 text-pink-400',
  hormonal: 'bg-purple-500/20 text-purple-400',
  velaroma: 'bg-blue-500/20 text-blue-400',
};

const WEBHOOK_BASE = 'https://prtkfwwqpcziexgipoqk.supabase.co/functions/v1/payt-webhook/';

export function AppSidebar() {
  const { collapsed, toggle, mobileOpen, setMobileOpen, isMobile } = useSidebarState();
  const { canAccess, perfil } = useAuth();
  const location = useLocation();

  /**
   * O que cada pessoa alcança. O GRUPO é o mesmo para todo mundo.
   *
   * A permissão continua por pessoa; o mapa, não.
   */
  const podeVer = (p: { adminOnly: boolean; sectorOnly: string | null; key: string }) => {
    if (p.adminOnly) return perfil?.is_admin;
    if (p.sectorOnly) return perfil?.is_admin || perfil?.setor?.nome === p.sectorOnly;
    return canAccess(p.key);
  };

  const grupos = GRUPOS
    .map(g => ({ ...g, itens: g.itens.filter(podeVer) }))
    .filter(g => g.itens.length > 0);

  /*
    Esta barra é só navegação.

    Saíram daqui, em duas passadas: o item "Geral" que abria e fechava (era o
    seletor de dashboard, e sobrou uma opção só), e o rodapé com nome, sino e
    sair — que agora vivem no cabeçalho, onde valem para qualquer tela. O que
    ficou de controle é o recolher, lá em cima ao lado da marca, porque ele é
    propriedade da BARRA e não da pessoa.
  */

  const showLabels = isMobile || !collapsed;


  const SidebarInner = ({ onNav }: { onNav?: () => void }) => (
    <>
      {/* Os grupos, na ordem em que a pergunta aparece: o que deu, de onde
          veio, o que fazer hoje, e como as coisas são definidas.
          `flex-1` aqui é o que empurra o rodapé para o fim da barra, e a
          rolagem vive nele porque agora é este bloco que pode passar da tela. */}
      <div className={cn("flex-1 overflow-y-auto py-2", showLabels ? "px-3" : "px-2")}>
        {grupos.map((grupo, i) => (
          <div key={grupo.titulo ?? 'inicio'} className={cn(i > 0 && 'mt-3')}>
            {/* Recolhida, a barra fica só com ícones: um título de seção ali
                viraria três letras cortadas. O espaçamento entre grupos
                continua separando, e é o suficiente sem os rótulos. */}
            {showLabels && grupo.titulo && (
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1 px-3">
                {grupo.titulo}
              </div>
            )}
            {grupo.itens.map((item) => {
              const isActive = item.path === '/financeiro'
                ? location.pathname.startsWith('/financeiro')
                : location.pathname === item.path;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={onNav}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md text-sm font-medium transition-colors mb-0.5",
                    showLabels ? "px-3 py-2" : "justify-center py-2 px-1",
                    isActive
                      ? "bg-primary/15 text-primary"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {showLabels && <span>{item.label}</span>}
                </NavLink>
              );
            })}


          </div>
        ))}
      </div>

    </>
  );

  if (isMobile) {
    return (
      <>
        {mobileOpen && <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setMobileOpen(false)} />}
        <aside className={cn(
          "fixed left-0 top-0 h-screen bg-sidebar border-r border-sidebar-border flex flex-col z-50 transition-transform duration-300 w-64",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}>
          {/* `border-border` e nao `border-sidebar-border`: esta linha ENCOSTA na do
              cabecalho principal, e os dois tons (36,36,36 contra 41,41,41)
              faziam um degrau visivel no meio do topo da tela. As outras linhas
              da sidebar continuam com o tom dela. */}
          <div className="flex items-center justify-between px-4 h-14 border-b border-border">
            {/* O símbolo "ak" do manual, e o nome na fonte da marca. Era um
                ícone de montanha do lucide — desenho de biblioteca, sem
                relação nenhuma com a identidade. */}
            <div className="flex items-center gap-2">
              <MarcaAlaskan className="h-5 w-5 text-marca" />
              <span className="font-display text-lg font-light tracking-[0.02em] text-foreground">alaskan</span>
            </div>
            <button onClick={() => setMobileOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
          {/* Sem rodapé: nome, sino e sair moram no cabeçalho, que continua na
              tela quando esta gaveta está fechada. O bloco era escrito duas
              vezes neste arquivo, uma aqui e outra na versão de computador. */}
          <SidebarInner onNav={() => setMobileOpen(false)} />
        </aside>
      </>
    );
  }

  return (
    <>
      
      <aside className={cn(
        "fixed left-0 top-0 h-screen bg-sidebar border-r border-sidebar-border flex flex-col z-50 transition-all duration-300",
        collapsed ? "w-16" : "w-56"
      )}>
        {/*
          O recolher subiu para cá, ao lado da marca.

          Ele é propriedade da BARRA, não da pessoa — e lá embaixo dividia uma
          coluna de ícones com o sino e o sair, três ações de naturezas
          diferentes desenhadas igual. Recolhida, a barra mostrava três glifos
          quase idênticos empilhados; agora mostra um.
        */}
        <div className={cn(
          "flex items-center h-14 border-b border-border",
          collapsed ? "justify-center px-2" : "gap-2 px-4",
        )}>
          {/* O vermelho é da MARCA e só dela: azul é o que se clica, vermelho
              é o que se perde. O símbolo é a exceção — logo não é estado. */}
          <MarcaAlaskan className="h-5 w-5 text-marca" />
          {!collapsed && (
            <>
              <span className="flex-1 truncate font-display text-lg font-light tracking-[0.02em] text-foreground">alaskan</span>
              <button
                onClick={toggle}
                title="Recolher a barra"
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
        {/* Recolhida, o próprio ícone da marca não cabe junto com o botão:
            a expansão vira uma faixa própria logo abaixo, que é o único
            controle da coluna. */}
        {collapsed && (
          <button
            onClick={toggle}
            title="Expandir a barra"
            className="flex h-8 items-center justify-center border-b border-sidebar-border text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
        <SidebarInner />
      </aside>
    </>
  );
}
