import { useNavigate } from 'react-router-dom';

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center space-y-3">
        <h1 className="text-6xl font-bold text-muted-foreground/40">404</h1>
        <p className="text-lg font-medium text-foreground">Página não encontrada</p>
        <p className="text-sm text-muted-foreground">O endereço que você tentou acessar não existe.</p>
        <button
          onClick={() => navigate('/')}
          className="mt-4 inline-flex items-center gap-2 text-sm text-primary hover:underline"
        >
          Voltar ao início
        </button>
      </div>
    </div>
  );
}
