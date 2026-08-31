import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RotinaCal } from '@/features/copywriters/components/RotinaCal';
import { CopyTrackTab } from '@/features/copywriters/components/copytrack/CopyTrackTab';
import { EsteiraTab } from '@/features/copywriters/components/esteira/EsteiraTab';
import type { Defasagem } from '@/features/copywriters/components/esteira/tipos';
import { supabase } from '@/lib/supabase';
import { useProjetosDaEmpresa } from '@/hooks/use-projetos-da-empresa';
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
  { chave: 'esteira',   label: 'Esteira' },
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
  const aba = ABAS.some(a => a.chave === pedida) ? pedida! : 'esteira';

  const irPara = (chave: string) => {
    const p = new URLSearchParams(params);
    p.set('aba', chave);
    // `replace`: trocar de aba não é navegação para o botão Voltar.
    setParams(p, { replace: true });
  };

  /**
   * A defasagem é buscada aqui e passada para a Esteira.
   *
   * Ela já apareceu como faixa no topo das três abas, e saiu: o aviso é de
   * quem trabalha a esteira, e repetido na Rotina e no Copy Track virava
   * mobília — o tipo de aviso que se aprende a não ver. Fica só onde se age
   * sobre ele.
   */
  const [defasagem, setDefasagem] = useState<Defasagem[]>([]);
  const [carregandoDefasagem, setCarregandoDefasagem] = useState(true);

  /*
    A defasagem também respeita a empresa escolhida.

    Foi decidido antes que ela listaria as duas juntas, porque a capacidade de
    escrever é compartilhada: quem escreve precisa ver tudo que falta. Isso
    continua valendo — em "Ambas", que é o padrão.

    O que mudou desde aquela decisão foi a TELA: agora existe um seletor no
    cabeçalho dizendo, em letras, "você está na Aeliss". Listar funil da Alaskan
    embaixo dele contradiz o que o próprio cabeçalho promete, e contradição de
    tela é lida como defeito, não como intenção.

    O filtro é no cliente porque `fn_esteira_defasagem` já devolve `projeto_id`
    e a lista tem uma dezena de linhas — mandar a empresa ao banco aqui seria um
    parâmetro a mais para não economizar nada.
  */
  const projetosDaEmpresa = useProjetosDaEmpresa();

  const carregarDefasagem = useCallback(async () => {
    if (projetosDaEmpresa === undefined) return;
    const { data, error } = await supabase.rpc('fn_esteira_defasagem');
    if (!error) {
      const todas = (data ?? []) as unknown as Defasagem[];
      setDefasagem(
        projetosDaEmpresa
          ? todas.filter(d => projetosDaEmpresa.includes(d.projeto_id))
          : todas,
      );
    }
    setCarregandoDefasagem(false);
  }, [projetosDaEmpresa]);

  useEffect(() => { if (canView) void carregarDefasagem(); }, [canView, carregarDefasagem]);

  return (
    /*
      `hideFilters` porque nenhuma aba usa CONTA nem PERÍODO. Eles apareciam
      oferecendo um recorte que não mudava coisa alguma, e a Rotina ainda tem a
      própria navegação de mês logo abaixo: eram dois "Hoje" na mesma tela
      querendo dizer coisas diferentes.

      A EMPRESA é outra história e continua aparecendo: ela mora no cabeçalho,
      fora desta fila, justamente porque não é um recorte do conteúdo — é quem
      você é enquanto olha. Desde 31/08/2026 a esteira e a defasagem a
      respeitam.

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

          <TabsContent value="esteira">
            <EsteiraTab defasagem={defasagem} carregandoDefasagem={carregandoDefasagem}
                        onRecarregar={() => void carregarDefasagem()} />
          </TabsContent>

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
