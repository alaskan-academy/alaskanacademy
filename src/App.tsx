import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/contexts/SidebarContext";
import { FilterProvider } from "@/contexts/FilterContext";
import OverviewPage from "./pages/OverviewPage";
import MetaAdsPage from "./pages/MetaAdsPage";
import FunnelPage from "./pages/FunnelPage";
import SalesPage from "./pages/SalesPage";
import UTMPage from "./pages/UTMPage";
import ClientsPage from "./pages/ClientsPage";
import EditorsPage from "./pages/EditorsPage";
import SettingsPage from "./pages/SettingsPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <FilterProvider>
      <SidebarProvider>
        <TooltipProvider>
          <Toaster />
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/meta-ads" element={<MetaAdsPage />} />
              <Route path="/funil" element={<FunnelPage />} />
              <Route path="/vendas" element={<SalesPage />} />
              <Route path="/utm" element={<UTMPage />} />
              <Route path="/clientes" element={<ClientsPage />} />
              <Route path="/editores" element={<EditorsPage />} />
              <Route path="/configuracoes" element={<SettingsPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </SidebarProvider>
    </FilterProvider>
  </QueryClientProvider>
);

export default App;
