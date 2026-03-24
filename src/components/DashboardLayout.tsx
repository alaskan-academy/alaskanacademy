import { ReactNode } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import GlobalFilters from '@/components/GlobalFilters';

export function DashboardLayout({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="min-h-screen bg-background">
      <AppSidebar />
      <div className="pl-56 transition-all duration-300">
        <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold text-foreground">{title}</h1>
            <GlobalFilters />
          </div>
        </header>
        <main className="p-6 animate-fade-in">
          {children}
        </main>
      </div>
    </div>
  );
}
