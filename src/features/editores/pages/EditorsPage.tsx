import { useSearchParams } from 'react-router-dom';
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
/**
 * As abas, com o apelido que vai para a URL.
 *
 * A ordem é a do DONO, e não a de quem construiu: primeiro o que é meu
 * (Perfis, Criativos Meta, Notas Fiscais), depois o que é do time
 * (Avaliações, Desempenho). Um editor comum abria e via cinco portas, três
 * quase vazias para ele, sem nada dizendo quais eram as dele.
 */
const ABAS = [
  { chave: 'perfis',     label: 'Perfis' },
  { chave: 'criativos',  label: 'Criativos Meta' },
  { chave: 'notas',      label: 'Notas Fiscais' },
  { chave: 'avaliacoes', label: 'Avaliações' },
  { chave: 'desempenho', label: 'Desempenho' },
];

export default function EditorsPage() {
  /**
   * A aba vivia só em `useState`: não dava para mandar "olha o Criativos
   * Meta" para alguém, e um F5 devolvia para Perfis no meio do trabalho. Na
   * URL, o link funciona e a recarga não perde o lugar — o mesmo conserto que
   * a Produção já tinha recebido.
   */
  const [params, setParams] = useSearchParams();
  const pedida = params.get('aba');
  const aba = ABAS.some(a => a.chave === pedida) ? pedida! : 'perfis';

  const irPara = (chave: string) => {
    const p = new URLSearchParams(params);
    p.set('aba', chave);
    // `replace`: trocar de aba não é navegação para o botão Voltar. Sem isso,
    // sair da página exigiria um Voltar para cada aba visitada.
    setParams(p, { replace: true });
  };

  return (
    <DashboardLayout title="Performance de Editores" hideFilters hideTitle>
      <Tabs value={aba} onValueChange={irPara} className="space-y-4">
        <TabsList className="h-auto flex-wrap border border-border bg-secondary">
          {ABAS.map(a => (
            <TabsTrigger key={a.chave} value={a.chave} className={tabCls}>{a.label}</TabsTrigger>
          ))}
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
