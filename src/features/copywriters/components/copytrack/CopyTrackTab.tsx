import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OffersTab } from './OffersTab';
import { HooksTab } from './HooksTab';
import { AdSwipeTab } from './AdSwipeTab';

const tabCls = 'text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground';

export function CopyTrackTab() {
  // Track which tabs have been visited so they only mount on first access
  const [visited, setVisited] = useState<Set<string>>(new Set(['ads']));

  const handleTabChange = (value: string) => {
    setVisited(prev => new Set([...prev, value]));
  };

  return (
    <Tabs defaultValue="ads" className="space-y-4" onValueChange={handleTabChange}>
      <TabsList className="bg-secondary border border-border h-auto flex-wrap">
        <TabsTrigger value="ads"     className={tabCls}>Ad Swipe</TabsTrigger>
        <TabsTrigger value="hooks"   className={tabCls}>Hooks</TabsTrigger>
        <TabsTrigger value="ofertas" className={tabCls}>Ofertas</TabsTrigger>
      </TabsList>

      <TabsContent value="ads">
        {visited.has('ads') && <AdSwipeTab />}
      </TabsContent>

      <TabsContent value="hooks">
        {visited.has('hooks') && <HooksTab />}
      </TabsContent>

      <TabsContent value="ofertas">
        {visited.has('ofertas') && <OffersTab />}
      </TabsContent>
    </Tabs>
  );
}
