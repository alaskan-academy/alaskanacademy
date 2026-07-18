import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mountain } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function SetupPage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed]   = useState(false);
  const [nome, setNome]         = useState('');
  const [email, setEmail]       = useState('');
  const [senha, setSenha]       = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [done, setDone]         = useState(false);

  useEffect(() => {
    (async () => {
      // Só permite setup se não houver usuários na tabela perfis
      const { count } = await supabase.from('perfis').select('id', { count: 'exact', head: true });
      if ((count ?? 0) === 0) setAllowed(true);
      setChecking(false);
    })();
  }, []);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome || !email || !senha) return;
    setError('');
    setLoading(true);

    const { data, error: fnErr } = await supabase.functions.invoke('setup-admin', {
      body: { nome, email, password: senha },
    });

    setLoading(false);

    if (fnErr || data?.error) {
      setError(data?.error ?? fnErr?.message ?? 'Erro ao criar conta');
      return;
    }

    setDone(true);
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground text-sm animate-pulse">Verificando...</p>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center space-y-2">
          <p className="text-foreground font-medium">Setup já concluído</p>
          <p className="text-muted-foreground text-sm">Esta página só está disponível na primeira configuração.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/login')}>Ir para o login</Button>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <Mountain className="h-8 w-8 text-primary mx-auto" />
          <p className="text-foreground font-semibold text-lg">Conta admin criada!</p>
          <p className="text-muted-foreground text-sm">Agora você pode fazer login com as credenciais cadastradas.</p>
          <Button className="mt-2" onClick={() => navigate('/login')}>Ir para o login</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-8">
          <Mountain className="h-7 w-7 text-primary" />
          <span className="text-2xl font-semibold text-foreground tracking-tight">Alaskan</span>
        </div>

        <div className="bg-card border border-border rounded-xl p-8 shadow-sm">
          <h1 className="text-lg font-semibold text-foreground mb-1">Configuração inicial</h1>
          <p className="text-xs text-muted-foreground mb-6">Crie a conta de administrador do dashboard.</p>

          <form onSubmit={handleSetup} className="space-y-4">
            <div>
              <Label htmlFor="nome" className="text-xs">Nome</Label>
              <Input id="nome" value={nome} onChange={e => setNome(e.target.value)} required className="mt-1" placeholder="Seu nome" />
            </div>
            <div>
              <Label htmlFor="email" className="text-xs">Email</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required className="mt-1" placeholder="seu@email.com" />
            </div>
            <div>
              <Label htmlFor="senha" className="text-xs">Senha</Label>
              <Input id="senha" type="password" value={senha} onChange={e => setSenha(e.target.value)} required minLength={6} className="mt-1" placeholder="Mínimo 6 caracteres" />
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Criando...' : 'Criar conta admin'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
