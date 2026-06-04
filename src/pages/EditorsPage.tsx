import { DashboardLayout } from '@/components/DashboardLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PerfisTab } from '@/components/editores/PerfisTab';
import { AvaliacoesTab } from '@/components/editores/AvaliacoesTab';
import { DesempenhoTab } from '@/components/editores/DesempenhoTab';
import { CriativosMetaTab } from '@/components/editores/CriativosMetaTab';

const tabCls = "data-[state=active]:bg-primary data-[state=active]:text-primary-foreground";

export default function EditorsPage() {
  return (
    <DashboardLayout title="Performance de Editores">
      <Tabs defaultValue="perfis" className="space-y-4">
        <TabsList className="bg-secondary border border-border flex-wrap h-auto">
          <TabsTrigger value="perfis"     className={tabCls}>Perfis</TabsTrigger>
          <TabsTrigger value="avaliacoes" className={tabCls}>Avaliações</TabsTrigger>
          <TabsTrigger value="desempenho" className={tabCls}>Desempenho</TabsTrigger>
          <TabsTrigger value="criativos"  className={tabCls}>Criativos Meta</TabsTrigger>
        </TabsList>

        <TabsContent value="perfis">    <PerfisTab /></TabsContent>
        <TabsContent value="avaliacoes"><AvaliacoesTab /></TabsContent>
        <TabsContent value="desempenho"><DesempenhoTab /></TabsContent>
        <TabsContent value="criativos"> <CriativosMetaTab /></TabsContent>
      </Tabs>
    </DashboardLayout>
  );
}
