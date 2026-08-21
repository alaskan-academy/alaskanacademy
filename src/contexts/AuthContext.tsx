import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export const PAGINAS = [
  { key: 'overview',      path: '/',              label: 'Resumo' },
  { key: 'meta-ads',      path: '/meta-ads',      label: 'Meta Ads' },
  { key: 'funil',         path: '/funil',         label: 'Funil' },
  { key: 'vendas',        path: '/vendas',        label: 'Vendas' },
  { key: 'utm',           path: '/utm',           label: 'Análise UTM' },
  { key: 'tendencias',    path: '/tendencias',    label: 'Tendências' },
  { key: 'clientes',      path: '/clientes',      label: 'Clientes' },
  { key: 'editores',      path: '/editores',      label: 'Editores' },
  { key: 'configuracoes', path: '/configuracoes', label: 'Configurações' },
  { key: 'laboratorio',   path: '/laboratorio',   label: 'Laboratório' },
  { key: 'processos',     path: '/processos',     label: 'Processos' },
  { key: 'acessos',      path: '/acessos',      label: 'Acessos'      },
  { key: 'producao',     path: '/producao',     label: 'Produção'     },
  { key: 'copywriters',  path: '/copywriters',  label: 'Copywriters'  },
] as const;

export type PaginaKey = (typeof PAGINAS)[number]['key'];

interface Cargo {
  id: string;
  nome: string;
  ordem: number;
  pode_aprovar: boolean;
}

interface Setor {
  id: string;
  nome: string;
}

export interface Perfil {
  nome: string;
  is_admin: boolean;
  ativo: boolean;
  radar_pode_criar: boolean;
  cargo_id: string | null;
  setor_id: string | null;
  cargo: Cargo | null;
  setor: Setor | null;
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
      .select('nome, is_admin, ativo, radar_pode_criar, cargo_id, setor_id, cargo:cargos(id,nome,ordem,pode_aprovar), setor:setores(id,nome)')
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

    // Fetch perfil e permissions em paralelo — economiza um round trip
    const [{ data: perfilData }, { data: permsData }] = await Promise.all([
      supabase
        .from('perfis')
        .select('nome, is_admin, ativo, radar_pode_criar, cargo_id, setor_id, cargo:cargos(id,nome,ordem,pode_aprovar), setor:setores(id,nome)')
        .eq('id', u.id)
        .single(),
      supabase
        .from('permissoes_paginas')
        .select('pagina, permitido')
        .eq('usuario_id', u.id),
    ]);

    setPerfil(perfilData ?? null);

    if (perfilData?.ativo === false) {
      await supabase.auth.signOut();
      return;
    }

    if (perfilData?.is_admin || !permsData || permsData.length === 0) {
      setAllowed(new Set(PAGINAS.map(p => p.key)));
    } else {
      setAllowed(new Set(permsData.filter(r => r.permitido).map(r => r.pagina)));
    }

    setLoading(false);
  };

  useEffect(() => {
    // onAuthStateChange dispara INITIAL_SESSION sozinho — getSession() seria redundante
    // e causaria boot() duplo (dobrando as queries no startup)
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
