import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, PAGINAS } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { CloudOff, RotateCw } from 'lucide-react';

export function ProtectedRoute({ children, pageKey }: { children: ReactNode; pageKey?: string }) {
  const { user, loading, falhaDeConexao, tentarDeNovo, canAccess } = useAuth();
  const location = useLocation();

  /**
   * Servidor fora do ar.
   *
   * Antes disto o app ficava em "Carregando..." para sempre — foi o que
   * aconteceu em 24/08, quando a camada de conexão do Supabase travou por mais
   * de meia hora e o dash inteiro virou um spinner mudo. Quem abria não sabia
   * se esperava, se recarregava, ou se o problema era da própria máquina.
   *
   * A sessão não é derrubada: o login continua válido, o que está fora é o
   * servidor. Por isso o caminho aqui é tentar de novo, e não voltar ao login.
   */
  if (falhaDeConexao) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <CloudOff className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="font-medium text-foreground">{falhaDeConexao}</p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              O login continua válido — quem não respondeu foi o servidor. Isso costuma
              se resolver sozinho em alguns minutos.
            </p>
          </div>
          <Button size="sm" onClick={tentarDeNovo}>
            <RotateCw className="mr-1.5 h-3.5 w-3.5" /> Tentar de novo
          </Button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground text-sm animate-pulse">Carregando...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (pageKey && !canAccess(pageKey)) {
    // Redireciona para a primeira página que o usuário pode acessar
    const first = PAGINAS.find(p => canAccess(p.key));
    return <Navigate to={first?.path ?? '/login'} replace />;
  }

  return <>{children}</>;
}
