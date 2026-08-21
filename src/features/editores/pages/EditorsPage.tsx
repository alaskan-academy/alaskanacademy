import { useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PerfisTab } from '@/features/editores/components/PerfisTab';
import { AvaliacoesTab } from '@/features/editores/components/AvaliacoesTab';
import { DesempenhoTab } from '@/features/editores/components/DesempenhoTab';
import { CriativosMetaTab } from '@/features/editores/components/CriativosMetaTab';

const tabCls = 'data-[state=active]:bg-primary data-[state=active]:text-primary-foreground';

/**
 * O filtro de período e conta no cabeçalho só existe para a aba Criativos Meta — as
 * outras três não olham para ele. Deixá-lo sempre visível fazia a página oferecer um
 * controle que não muda nada em três das quatro telas, que é pior do que não ter: quem
 * mexe e não vê efeito conclui que a tela está quebrada.
 */
export default function EditorsPage() {
  const [aba, setAba] = useState('perfis');

  return (
    <DashboardLayout title="Performance de Editores" hideFilters={aba !== 'criativos'}>
      <Tabs value={aba} onValueChange={setAba} className="space-y-4">
        <TabsList className="h-auto flex-wrap border border-border bg-secondary">
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
