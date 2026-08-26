import { ReactNode } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import GlobalFilters from '@/components/GlobalFilters';
import { IngestStatusBanner } from '@/components/IngestStatusBanner';
import { useSidebarState } from '@/contexts/SidebarContext';
import { useFilters } from '@/contexts/FilterContext';
import { Menu, Search } from 'lucide-react';

export function DashboardLayout({
  children,
  title,
  hideFilters,
  hideTitle,
  hideAvisos,
}: {
  children: ReactNode;
  title: string;
  hideFilters?: boolean;
  /**
   * Para a tela que já diz o próprio nome no corpo.
   *
   * Em Processos o banner anuncia "Central de Processos" logo abaixo, e na
   * categoria o nome dela aparece em tamanho grande a dois centímetros do
   * cabeçalho — repetir ali é gastar a barra fixa para não dizer nada de novo.
   * O `title` continua obrigatório porque é ele que nomeia a aba do navegador.
   */
  hideTitle?: boolean;
  /** O Início traz os mesmos avisos num painel completo; a faixa aqui seria a
   *  mesma informação duas vezes na mesma tela. */
  hideAvisos?: boolean;
}) {
  const { collapsed, isMobile, toggle } = useSidebarState();
  const { contaId } = useFilters();

  // Find selected funnel name for header context
  return (
    <div className="min-h-screen bg-background">
      <AppSidebar />
      <div className={`${isMobile ? 'pl-0' : collapsed ? 'pl-16' : 'pl-56'} transition-all duration-300`}>
        <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border px-4 md:px-6 py-3 md:py-4">
          <div className="flex items-center justify-between gap-3">
            {/* `min-w-0` para o `truncate` do h1 valer: sem ele o flex deixa o
                título crescer além do espaço e empurra a busca e os filtros
                para fora da tela — o que acontecia com título longo de artigo. */}
            <div className="flex items-center gap-3 min-w-0">
              {isMobile && (
                <button onClick={toggle} className="text-muted-foreground hover:text-foreground p-1 shrink-0">
                  <Menu className="h-5 w-5" />
                </button>
              )}
              {!hideTitle && (
                <h1 className="text-lg md:text-xl font-semibold text-foreground truncate">{title}</h1>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => document.dispatchEvent(new CustomEvent('openCommandPalette'))}
                className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border/60 rounded-md px-2.5 py-1.5 hover:bg-accent transition-colors"
              >
                <Search className="h-3.5 w-3.5" />
                <span>Buscar</span>
                <kbd className="ml-1 text-[10px] bg-muted px-1 py-0.5 rounded font-mono">Ctrl+K</kbd>
              </button>
              {!hideFilters && <GlobalFilters />}
            </div>
          </div>
        </header>
        <main className="p-4 md:p-6 animate-fade-in">
          {!hideAvisos && <IngestStatusBanner />}
          {children}
        </main>
      </div>
    </div>
  );
}
