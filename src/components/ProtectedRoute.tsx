import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, PAGINAS } from '@/contexts/AuthContext';

export function ProtectedRoute({ children, pageKey }: { children: ReactNode; pageKey?: string }) {
  const { user, loading, canAccess } = useAuth();
  const location = useLocation();

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
