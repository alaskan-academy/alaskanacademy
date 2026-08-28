import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/contexts/SidebarContext";
import { FilterProvider } from "@/contexts/FilterContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { ConfirmProvider } from "@/hooks/use-confirm";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { CommandPalette } from "@/components/CommandPalette";

// Carregamento eager apenas para login/setup (crítico para auth)
import LoginPage from "./features/auth/pages/LoginPage";
import SetupPage from "./features/auth/pages/SetupPage";

// Todas as páginas autenticadas carregam sob demanda
const InicioPage               = lazy(() => import("./features/inicio/pages/InicioPage"));
const OverviewPage             = lazy(() => import("./features/dashboard/pages/OverviewPage"));
const MetaAdsPage              = lazy(() => import("./features/ads/pages/MetaAdsPage"));
const TendenciasPage           = lazy(() => import("./features/dashboard/pages/TendenciasPage"));
const FunnelPage               = lazy(() => import("./features/dashboard/pages/FunnelPage"));
const SalesPage                = lazy(() => import("./features/dashboard/pages/SalesPage"));
const UTMPage                  = lazy(() => import("./features/ads/pages/UTMPage"));
const ClientsPage              = lazy(() => import("./features/dashboard/pages/ClientsPage"));
const EditorsPage              = lazy(() => import("./features/editores/pages/EditorsPage"));
const SettingsPage             = lazy(() => import("./features/admin/pages/SettingsPage"));
const AdminPage                = lazy(() => import("./features/admin/pages/AdminPage"));
const LaboratorioPage          = lazy(() => import("./features/laboratorio/pages/LaboratorioPage"));
const ProcessosPage            = lazy(() => import("./features/processos/pages/ProcessosPage"));
const ProcessosCategoriaPage   = lazy(() => import("./features/processos/pages/ProcessosCategoriaPage"));
const ProcessosArtigoPage      = lazy(() => import("./features/processos/pages/ProcessosArtigoPage"));
const FinanceiroRevisaoPage    = lazy(() => import("./features/financeiro/pages/FinanceiroRevisaoPage"));
const FinanceiroFechamentoPage = lazy(() => import("./features/financeiro/pages/FinanceiroFechamentoPage"));
const FinanceiroConciliacaoPage = lazy(() => import("./features/financeiro/pages/FinanceiroConciliacaoPage"));
const FinanceiroNotasFiscaisPage = lazy(() => import("./features/financeiro/pages/FinanceiroNotasFiscaisPage"));
const FinanceiroCaixaPage      = lazy(() => import("./features/financeiro/pages/FinanceiroCaixaPage"));
const FinanceiroGastosPage     = lazy(() => import("./features/financeiro/pages/FinanceiroGastosPage"));
const AcessosPage              = lazy(() => import("./features/acessos/pages/AcessosPage"));
const ProducaoPage             = lazy(() => import("./features/producao/pages/ProducaoPage"));
const CopywritersPage          = lazy(() => import("./features/copywriters/pages/CopywritersPage"));
const FunisPage                = lazy(() => import("./features/funis/pages/FunisPage"));
const AnalisesPage             = lazy(() => import("./features/analises/pages/AnalisesPage"));
const AnalisesHistoricoPage    = lazy(() => import("./features/analises/pages/HistoricoPage"));
const AnalisesCompararPage     = lazy(() => import("./features/analises/pages/CompararPage"));
const CriativosPage            = lazy(() => import("./features/criativos/pages/CriativosPage"));
const NotFound                 = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
    },
  },
});

function PageLoader() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <FilterProvider>
        <SidebarProvider>
          <TooltipProvider>
            <ConfirmProvider>
              <Toaster />
              <BrowserRouter>
                <CommandPalette />
                <Suspense fallback={<PageLoader />}>
                  <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/setup" element={<SetupPage />} />
                    <Route path="/" element={<ProtectedRoute pageKey="inicio"><InicioPage /></ProtectedRoute>} />
                    <Route path="/resumo" element={<ProtectedRoute pageKey="overview"><OverviewPage /></ProtectedRoute>} />
                    <Route path="/meta-ads" element={<ProtectedRoute pageKey="meta-ads"><MetaAdsPage /></ProtectedRoute>} />
                    <Route path="/funil" element={<ProtectedRoute pageKey="funil"><FunnelPage /></ProtectedRoute>} />
                    <Route path="/vendas" element={<ProtectedRoute pageKey="vendas"><SalesPage /></ProtectedRoute>} />
                    <Route path="/utm" element={<ProtectedRoute pageKey="utm"><UTMPage /></ProtectedRoute>} />
                    <Route path="/tendencias" element={<ProtectedRoute pageKey="tendencias"><TendenciasPage /></ProtectedRoute>} />
                    <Route path="/clientes" element={<ProtectedRoute pageKey="clientes"><ClientsPage /></ProtectedRoute>} />
                    <Route path="/editores" element={<ProtectedRoute pageKey="editores"><EditorsPage /></ProtectedRoute>} />
                    <Route path="/laboratorio" element={<ProtectedRoute pageKey="laboratorio"><LaboratorioPage /></ProtectedRoute>} />
                    <Route path="/processos" element={<ProtectedRoute pageKey="processos"><ProcessosPage /></ProtectedRoute>} />
                    <Route path="/processos/c/:categoriaId" element={<ProtectedRoute pageKey="processos"><ProcessosCategoriaPage /></ProtectedRoute>} />
                    <Route path="/processos/:artigoId" element={<ProtectedRoute pageKey="processos"><ProcessosArtigoPage /></ProtectedRoute>} />
                    <Route path="/financeiro" element={<ProtectedRoute pageKey="financeiro"><FinanceiroRevisaoPage /></ProtectedRoute>} />
                    <Route path="/financeiro/revisao" element={<ProtectedRoute pageKey="financeiro"><FinanceiroRevisaoPage /></ProtectedRoute>} />
                    <Route path="/financeiro/fechamento" element={<ProtectedRoute pageKey="financeiro"><FinanceiroFechamentoPage /></ProtectedRoute>} />
                    <Route path="/financeiro/conciliacao" element={<ProtectedRoute pageKey="financeiro"><FinanceiroConciliacaoPage /></ProtectedRoute>} />
                    <Route path="/financeiro/notas-fiscais" element={<ProtectedRoute pageKey="financeiro"><FinanceiroNotasFiscaisPage /></ProtectedRoute>} />
                    <Route path="/financeiro/caixa" element={<ProtectedRoute pageKey="financeiro"><FinanceiroCaixaPage /></ProtectedRoute>} />
                    <Route path="/financeiro/gastos" element={<ProtectedRoute pageKey="financeiro"><FinanceiroGastosPage /></ProtectedRoute>} />
                    <Route path="/acessos"  element={<ProtectedRoute pageKey="acessos"><AcessosPage /></ProtectedRoute>} />
                    <Route path="/producao" element={<ProtectedRoute pageKey="producao"><ProducaoPage /></ProtectedRoute>} />
                    <Route path="/criativos" element={<ProtectedRoute><CriativosPage /></ProtectedRoute>} />
                    <Route path="/funis-gestao" element={<ProtectedRoute pageKey="funis-gestao"><FunisPage /></ProtectedRoute>} />
                    <Route path="/analises" element={<ProtectedRoute pageKey="analises"><AnalisesPage /></ProtectedRoute>} />
                    <Route path="/analises/comparar" element={<ProtectedRoute pageKey="analises"><AnalisesCompararPage /></ProtectedRoute>} />
                    <Route path="/analises/historico" element={<ProtectedRoute pageKey="analises"><AnalisesHistoricoPage /></ProtectedRoute>} />
                    <Route path="/copywriters" element={<ProtectedRoute pageKey="copywriters"><CopywritersPage /></ProtectedRoute>} />
                    <Route path="/configuracoes" element={<ProtectedRoute pageKey="configuracoes"><SettingsPage /></ProtectedRoute>} />
                    <Route path="/administrativo" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
                    <Route path="*" element={<ProtectedRoute><NotFound /></ProtectedRoute>} />
                  </Routes>
                </Suspense>
              </BrowserRouter>
            </ConfirmProvider>
          </TooltipProvider>
        </SidebarProvider>
      </FilterProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
