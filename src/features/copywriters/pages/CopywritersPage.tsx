import { useSearchParams } from 'react-router-dom';
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

const ABAS = [
  { chave: 'rotina',    label: 'Rotina' },
  { chave: 'copytrack', label: 'Copy Track' },
];

export default function CopywritersPage() {
  const { perfil } = useAuth();

  /**
   * A MESMA regra que a RLS aplica no banco.
   *
   * Antes ela existia só aqui: as quatro tabelas eram `USING (true)`, então a
   * frase "acesso restrito" era uma porta pintada na parede — quem a tela
   * barrava lia e escrevia tudo pela API. Agora as duas pontas dizem o mesmo,
   * e esta linha serve para não pedir o que não pode vir.
   */
  const isCopy  = perfil?.setor?.nome === 'Copy';
  const isAdmin = perfil?.is_admin ?? false;
  const canView = isCopy || isAdmin;

  /**
   * A aba vivia em `defaultValue`: não dava para mandar "olha o Copy Track"
   * para alguém, e um F5 voltava para a Rotina no meio do trabalho.
   */
  const [params, setParams] = useSearchParams();
  const pedida = params.get('aba');
  const aba = ABAS.some(a => a.chave === pedida) ? pedida! : 'rotina';

  const irPara = (chave: string) => {
    const p = new URLSearchParams(params);
    p.set('aba', chave);
    // `replace`: trocar de aba não é navegação para o botão Voltar.
    setParams(p, { replace: true });
  };

  return (
    /*
      `hideFilters` porque NENHUMA das duas abas lê o filtro global — conferido
      com um grep por `useFilters` na área inteira, que não devolve nada. Ele
      aparecia oferecendo conta e período que não mudavam coisa alguma, e a
      Rotina ainda tem a própria navegação de mês logo abaixo: eram dois
      "Hoje" na mesma tela querendo dizer coisas diferentes.

      `hideTitle` porque cada aba já se apresenta no corpo.
    */
    <DashboardLayout title="Copywriters" hideFilters hideTitle>
      {!canView ? (
        <AccessDenied />
      ) : (
        <Tabs value={aba} onValueChange={irPara} className="space-y-4">
          <TabsList className="bg-secondary border border-border flex-wrap h-auto">
            {ABAS.map(a => (
              <TabsTrigger key={a.chave} value={a.chave} className={tabCls}>{a.label}</TabsTrigger>
            ))}
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
