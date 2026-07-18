import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/contexts/SidebarContext";
import { FilterProvider } from "@/contexts/FilterContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { ConfirmProvider } from "@/hooks/use-confirm";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import LoginPage from "./features/auth/pages/LoginPage";
import SetupPage from "./features/auth/pages/SetupPage";
import OverviewPage from "./features/dashboard/pages/OverviewPage";
import MetaAdsPage from "./features/ads/pages/MetaAdsPage";
import FunnelPage from "./features/dashboard/pages/FunnelPage";
import SalesPage from "./features/dashboard/pages/SalesPage";
import UTMPage from "./features/ads/pages/UTMPage";
import ClientsPage from "./features/dashboard/pages/ClientsPage";
import EditorsPage from "./features/editores/pages/EditorsPage";
import SettingsPage from "./features/admin/pages/SettingsPage";
import AdminPage from "./features/admin/pages/AdminPage";
import RadarPage from "./features/radar/pages/RadarPage";
import AtivosPage from "./features/ads/pages/AtivosPage";
import ReferenciasPage from "./features/referencias/pages/ReferenciasPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <FilterProvider>
        <SidebarProvider>
          <TooltipProvider>
            <ConfirmProvider>
              <Toaster />
              <BrowserRouter>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/setup" element={<SetupPage />} />
                  <Route path="/" element={<ProtectedRoute pageKey="overview"><OverviewPage /></ProtectedRoute>} />
                  <Route path="/meta-ads" element={<ProtectedRoute pageKey="meta-ads"><MetaAdsPage /></ProtectedRoute>} />
                  <Route path="/funil" element={<ProtectedRoute pageKey="funil"><FunnelPage /></ProtectedRoute>} />
                  <Route path="/vendas" element={<ProtectedRoute pageKey="vendas"><SalesPage /></ProtectedRoute>} />
                  <Route path="/utm" element={<ProtectedRoute pageKey="utm"><UTMPage /></ProtectedRoute>} />
                  <Route path="/clientes" element={<ProtectedRoute pageKey="clientes"><ClientsPage /></ProtectedRoute>} />
                  <Route path="/editores" element={<ProtectedRoute pageKey="editores"><EditorsPage /></ProtectedRoute>} />
                  <Route path="/radar" element={<ProtectedRoute pageKey="radar"><RadarPage /></ProtectedRoute>} />
                  <Route path="/ativos" element={<ProtectedRoute pageKey="ativos"><AtivosPage /></ProtectedRoute>} />
                  <Route path="/referencias" element={<ProtectedRoute pageKey="referencias"><ReferenciasPage /></ProtectedRoute>} />
                  <Route path="/configuracoes" element={<ProtectedRoute pageKey="configuracoes"><SettingsPage /></ProtectedRoute>} />
                  <Route path="/administrativo" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
                  <Route path="*" element={<ProtectedRoute><NotFound /></ProtectedRoute>} />
                </Routes>
              </BrowserRouter>
            </ConfirmProvider>
          </TooltipProvider>
        </SidebarProvider>
      </FilterProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
