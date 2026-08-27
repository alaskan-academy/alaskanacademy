import { useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PerfisTab } from '@/features/editores/components/PerfisTab';
import { AvaliacoesTab } from '@/features/editores/components/AvaliacoesTab';
import { DesempenhoTab } from '@/features/editores/components/DesempenhoTab';
import { CriativosMetaTab } from '@/features/editores/components/CriativosMetaTab';
import { NotasFiscaisTab } from '@/features/editores/components/NotasFiscaisTab';

const tabCls = 'data-[state=active]:bg-primary data-[state=active]:text-primary-foreground';

/**
 * O filtro de período e conta só existe para a aba Criativos Meta — as outras
 * quatro não olham para ele. Antes ele morava na barra fixa do cabeçalho e
 * aparecia só nessa aba, o que resolvia metade do problema: o controle ficava
 * longe do que ele filtra, no alto da tela, separado da tabela por um banner,
 * um aviso e uma linha de busca. Agora mora dentro da própria aba, ao lado dos
 * outros filtros dela.
 *
 * `hideTitle` porque a aba já se apresenta no corpo: repetir "Performance de
 * Editores" na barra fixa gastava a faixa inteira para não dizer nada de novo —
 * e num cabeçalho estreito o texto ainda vinha cortado, "Performance de E...".
 */
export default function EditorsPage() {
  const [aba, setAba] = useState('perfis');

  return (
    <DashboardLayout title="Performance de Editores" hideFilters hideTitle>
      <Tabs value={aba} onValueChange={setAba} className="space-y-4">
        <TabsList className="h-auto flex-wrap border border-border bg-secondary">
          <TabsTrigger value="perfis"     className={tabCls}>Perfis</TabsTrigger>
          <TabsTrigger value="avaliacoes" className={tabCls}>Avaliações</TabsTrigger>
          <TabsTrigger value="desempenho" className={tabCls}>Desempenho</TabsTrigger>
          <TabsTrigger value="criativos"  className={tabCls}>Criativos Meta</TabsTrigger>
          <TabsTrigger value="notas"      className={tabCls}>Notas Fiscais</TabsTrigger>
        </TabsList>

        <TabsContent value="perfis">    <PerfisTab /></TabsContent>
        <TabsContent value="avaliacoes"><AvaliacoesTab /></TabsContent>
        <TabsContent value="desempenho"><DesempenhoTab /></TabsContent>
        <TabsContent value="criativos"> <CriativosMetaTab /></TabsContent>
        <TabsContent value="notas">     <NotasFiscaisTab /></TabsContent>
      </Tabs>
    </DashboardLayout>
  );
}
