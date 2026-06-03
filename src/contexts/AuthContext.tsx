import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export const PAGINAS = [
  { key: 'overview',      path: '/',              label: 'Resumo' },
  { key: 'meta-ads',      path: '/meta-ads',      label: 'Meta Ads' },
  { key: 'funil',         path: '/funil',         label: 'Funil' },
  { key: 'vendas',        path: '/vendas',        label: 'Vendas' },
  { key: 'utm',           path: '/utm',           label: 'Análise UTM' },
  { key: 'clientes',      path: '/clientes',      label: 'Clientes' },
  { key: 'editores',      path: '/editores',      label: 'Editores' },
  { key: 'configuracoes', path: '/configuracoes', label: 'Configurações' },
  { key: 'radar',         path: '/radar',         label: 'Radar Alaskan' },
  { key: 'ativos',        path: '/ativos',        label: 'Ativos Meta' },
] as const;

export type PaginaKey = (typeof PAGINAS)[number]['key'];

interface Perfil {
  nome: string;
  is_admin: boolean;
  radar_pode_criar: boolean;
}

interface AuthContextType {
  user: User | null;
  perfil: Perfil | null;
  loading: boolean;
  canAccess: (key: string) => boolean;
  reloadPermissions: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]           = useState<User | null>(null);
  const [perfil, setPerfil]       = useState<Perfil | null>(null);
  const [allowed, setAllowed]     = useState<Set<string>>(new Set(PAGINAS.map(p => p.key)));
  const [loading, setLoading]     = useState(true);

  const loadPerfil = async (uid: string) => {
    const { data } = await supabase
      .from('perfis')
      .select('nome, is_admin')
      .eq('id', uid)
      .single();
    setPerfil(data ?? null);
    return data;
  };

  const loadPermissions = async (uid: string, isAdmin: boolean) => {
    if (isAdmin) {
      setAllowed(new Set(PAGINAS.map(p => p.key)));
      return;
    }
    const { data } = await supabase
      .from('permissoes_paginas')
      .select('pagina, permitido')
      .eq('usuario_id', uid);

    if (!data || data.length === 0) {
      // sem entradas → acesso total por padrão
      setAllowed(new Set(PAGINAS.map(p => p.key)));
    } else {
      setAllowed(new Set(data.filter(r => r.permitido).map(r => r.pagina)));
    }
  };

  const reloadPermissions = async () => {
    if (!user || !perfil) return;
    await loadPermissions(user.id, perfil.is_admin);
  };

  const boot = async (u: User | null) => {
    setUser(u);
    if (!u) { setPerfil(null); setLoading(false); return; }
    const p = await loadPerfil(u.id);
    await loadPermissions(u.id, p?.is_admin ?? false);
    setLoading(false);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => boot(data.session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_ev, session) => {
      boot(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string): Promise<string | null> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const canAccess = (key: string) => {
    if (!user) return false;
    if (perfil?.is_admin) return true;
    return allowed.has(key);
  };

  return (
    <AuthContext.Provider value={{ user, perfil, loading, canAccess, reloadPermissions, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
