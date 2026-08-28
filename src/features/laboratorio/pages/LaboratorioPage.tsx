import { useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RadarContent } from '@/features/radar/pages/RadarPage';
import { ReferenciasContent } from '@/features/referencias/pages/ReferenciasPage';

const tabCls = 'data-[state=active]:bg-primary data-[state=active]:text-primary-foreground';

const ABAS = [
  { chave: 'radar',       label: 'Radar' },
  { chave: 'referencias', label: 'Referências' },
];

export default function LaboratorioPage() {
  /**
   * A aba vivia num `useState`: não dava para mandar "olha as Referências"
   * para alguém, e um F5 no meio do trabalho voltava para o Radar.
   */
  const [params, setParams] = useSearchParams();
  const pedida = params.get('aba');
  const aba = ABAS.some(a => a.chave === pedida) ? pedida! : 'radar';

  const irPara = (chave: string) => {
    const p = new URLSearchParams(params);
    p.set('aba', chave);
    // `replace`: trocar de aba não é navegação para o botão Voltar.
    setParams(p, { replace: true });
  };

  return (
    /*
      `hideFilters` porque NENHUMA das duas abas lê o filtro global — conferido
      com um grep por `useFilters` nas duas páginas, que não devolve nada. Ele
      oferecia conta e período que não mudavam coisa alguma, e cada aba tem o
      próprio filtro de data logo abaixo: eram dois "Hoje" na mesma tela
      querendo dizer coisas diferentes.

      `hideTitle` porque cada aba já se apresenta no corpo, como em
      Copywriters, Editores, Processos e Produção.
    */
    <DashboardLayout title="Laboratório" hideFilters hideTitle>
      <Tabs value={aba} onValueChange={irPara} className="space-y-4">
        <TabsList className="bg-secondary border border-border flex-wrap h-auto">
          {ABAS.map(a => (
            <TabsTrigger key={a.chave} value={a.chave} className={tabCls}>{a.label}</TabsTrigger>
          ))}
        </TabsList>

        {/*
          `forceMount` fica de fora de propósito: as duas abas carregam a lista
          inteira do banco ao montar, e manter as duas vivas dobraria a consulta
          para ver uma só.
        */}
        <TabsContent value="radar"><RadarContent /></TabsContent>
        <TabsContent value="referencias"><ReferenciasContent /></TabsContent>
      </Tabs>
    </DashboardLayout>
  );
}
