import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OffersTab } from './OffersTab';
import { HooksTab } from './HooksTab';
import { AdSwipeTab } from './AdSwipeTab';

const tabCls = 'text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground';

const SUBABAS = [
  { chave: 'ads',     label: 'Ad Swipe' },
  { chave: 'hooks',   label: 'Hooks' },
  { chave: 'ofertas', label: 'Ofertas' },
];

export function CopyTrackTab() {
  /**
   * A sub-aba também vai para a URL, com nome próprio.
   *
   * São dois níveis de aba — Copywriters › Copy Track › Ad Swipe — e nenhum
   * dos dois estava no endereço. Mandar "olha os Hooks" para alguém era
   * mandar a página inteira e explicar o caminho por escrito, e um F5 no meio
   * do trabalho voltava para o começo dos dois níveis.
   *
   * O parâmetro se chama `sub` para não brigar com o `aba` do nível de cima:
   * os dois convivem no mesmo endereço, e `?aba=copytrack&sub=hooks` abre
   * exatamente onde a pessoa estava.
   */
  const [params, setParams] = useSearchParams();
  const pedida = params.get('sub');
  const aba = SUBABAS.some(s => s.chave === pedida) ? pedida! : 'ads';

  /**
   * Cada aba só monta na primeira visita.
   *
   * Começa com a que está aberta — que agora pode vir da URL, e não é sempre
   * a `ads`. Antes o conjunto nascia fixo em `ads`: quem chegasse por um link
   * direto para Hooks montaria a lista de ads sem precisar, e a de hooks só
   * quando o efeito de visita a incluísse.
   */
  const [visitadas, setVisitadas] = useState<Set<string>>(new Set([aba]));

  const irPara = (chave: string) => {
    setVisitadas(prev => new Set([...prev, chave]));
    const p = new URLSearchParams(params);
    p.set('sub', chave);
    setParams(p, { replace: true });
  };

  return (
    <Tabs value={aba} onValueChange={irPara} className="space-y-4">
      <TabsList className="bg-secondary border border-border h-auto flex-wrap">
        {SUBABAS.map(s => (
          <TabsTrigger key={s.chave} value={s.chave} className={tabCls}>{s.label}</TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="ads">
        {visitadas.has('ads') && <AdSwipeTab />}
      </TabsContent>

      <TabsContent value="hooks">
        {visitadas.has('hooks') && <HooksTab />}
      </TabsContent>

      <TabsContent value="ofertas">
        {visitadas.has('ofertas') && <OffersTab />}
      </TabsContent>
    </Tabs>
  );
}
