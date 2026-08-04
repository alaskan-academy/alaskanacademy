import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OffersTab } from './OffersTab';
import { HooksTab } from './HooksTab';
import { AdSwipeTab } from './AdSwipeTab';

const tabCls = 'text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground';

export function CopyTrackTab() {
  return (
    <Tabs defaultValue="ads" className="space-y-4">
      <TabsList className="bg-secondary border border-border h-auto flex-wrap">
        <TabsTrigger value="ads"     className={tabCls}>Ad Swipe</TabsTrigger>
        <TabsTrigger value="hooks"   className={tabCls}>Hooks</TabsTrigger>
        <TabsTrigger value="ofertas" className={tabCls}>Ofertas</TabsTrigger>
      </TabsList>

      <TabsContent value="ads">
        <AdSwipeTab />
      </TabsContent>

      <TabsContent value="hooks">
        <HooksTab />
      </TabsContent>

      <TabsContent value="ofertas">
        <OffersTab />
      </TabsContent>
    </Tabs>
  );
}
