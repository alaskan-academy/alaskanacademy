import { ReactNode } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import GlobalFilters from '@/components/GlobalFilters';
import { useSidebarState } from '@/contexts/SidebarContext';
import { Menu } from 'lucide-react';

export function DashboardLayout({ children, title }: { children: ReactNode; title: string }) {
  const { collapsed, isMobile, toggle } = useSidebarState();

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar />
      <div className={`${isMobile ? 'pl-0' : collapsed ? 'pl-16' : 'pl-56'} transition-all duration-300`}>
        <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border px-4 md:px-6 py-3 md:py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {isMobile && (
                <button onClick={toggle} className="text-muted-foreground hover:text-foreground p-1">
                  <Menu className="h-5 w-5" />
                </button>
              )}
              <h1 className="text-lg md:text-xl font-semibold text-foreground truncate">{title}</h1>
            </div>
            <GlobalFilters />
          </div>
        </header>
        <main className="p-4 md:p-6 animate-fade-in">
          {children}
        </main>
      </div>
    </div>
  );
}
