import { DashboardLayout } from '@/components/DashboardLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RotinaCal } from '@/features/copywriters/components/RotinaCal';
import { CopyTrackTab } from '@/features/copywriters/components/copytrack/CopyTrackTab';
import { useAuth } from '@/contexts/AuthContext';
import { Shield } from 'lucide-react';

const tabCls = 'data-[state=active]:bg-primary data-[state=active]:text-primary-foreground';

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
      <Shield className="h-8 w-8 opacity-40" />
      <p className="text-sm">Acesso restrito ao setor de Copy e administradores.</p>
    </div>
  );
}

export default function CopywritersPage() {
  const { perfil } = useAuth();

  const isCopy  = perfil?.setor?.nome === 'Copy';
  const isAdmin = perfil?.is_admin ?? false;
  const canView = isCopy || isAdmin;

  return (
    <DashboardLayout title="Copywriters">
      {!canView ? (
        <AccessDenied />
      ) : (
        <Tabs defaultValue="rotina" className="space-y-4">
          <TabsList className="bg-secondary border border-border flex-wrap h-auto">
            <TabsTrigger value="rotina"     className={tabCls}>Rotina</TabsTrigger>
            <TabsTrigger value="copytrack"  className={tabCls}>Copy Track</TabsTrigger>
          </TabsList>

          <TabsContent value="rotina">
            <RotinaCal />
          </TabsContent>

          <TabsContent value="copytrack">
            <CopyTrackTab />
          </TabsContent>
        </Tabs>
      )}
    </DashboardLayout>
  );
}
