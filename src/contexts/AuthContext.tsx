import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export const PAGINAS = [
  // `inicio` vem primeiro de propósito: quando alguém não tem acesso à página
  // que pediu, o ProtectedRoute manda para a primeira desta lista que ele possa
  // ver. Antes isso significava cair no Resumo financeiro, ou em Meta Ads, ou
  // no que estivesse por acaso no topo — dependia do que estava marcado no
  // Acessos, e ninguém tinha decidido.
  { key: 'inicio',        path: '/',              label: 'Início' },
  { key: 'overview',      path: '/resumo',        label: 'Resumo' },
  { key: 'meta-ads',      path: '/meta-ads',      label: 'Meta Ads' },
  { key: 'vendas',        path: '/vendas',        label: 'Vendas' },
  // 'UTM' e nao 'Analise UTM': ela vive no grupo de dashboards, onde tudo e
  // analise -- o prefixo so criava colisao com o modulo de Analises.
  { key: 'utm',           path: '/utm',           label: 'UTM' },
  { key: 'tendencias',    path: '/tendencias',    label: 'Tendências' },
  { key: 'clientes',      path: '/clientes',      label: 'Clientes' },
  { key: 'editores',      path: '/editores',      label: 'Editores' },
  { key: 'configuracoes', path: '/configuracoes', label: 'Configurações' },
  { key: 'laboratorio',   path: '/laboratorio',   label: 'Laboratório' },
  { key: 'processos',     path: '/processos',     label: 'Processos' },
  { key: 'acessos',      path: '/acessos',      label: 'Acessos'      },
  { key: 'producao',     path: '/producao',     label: 'Produção'     },
  { key: 'copywriters',  path: '/copywriters',  label: 'Copywriters'  },
  { key: 'analises',     path: '/analises',     label: 'Análises'     },
] as const;

export type PaginaKey = (typeof PAGINAS)[number]['key'];

/**
 * As páginas que aparecem no Acessos para ligar e desligar.
 *
 * O Início fica de fora porque `canAccess` sempre o libera: mostrar um botão
 * que não muda nada seria mentir na tela. Ele continua em `PAGINAS` porque é
 * de lá que saem a rota e o destino de quem cai numa página sem permissão.
 */
export const PAGINAS_CONFIGURAVEIS = PAGINAS.filter(p => p.key !== 'inicio');

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
  /** Preenchido quando o backend não respondeu a tempo. Null quando está tudo bem. */
  falhaDeConexao: string | null;
  tentarDeNovo: () => void;
  canAccess: (key: string) => boolean;
  reloadPermissions: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

/**
 * `cargo` e `setor` chegam do PostgREST como vínculo embutido, e ele devolve
 * array mesmo quando a relação é para-um. O tipo aqui diz "objeto", então quem
 * lê `perfil.cargo.pode_aprovar` pegaria `undefined` se viesse array — e todo
 * Head viraria membro em silêncio, sem erro nenhum na tela.
 *
 * Normalizar na fronteira aceita as duas formas e mata o `as` que escondia a
 * divergência do tsc.
 */
function normalizarPerfil(linha: unknown): Perfil | null {
  if (!linha || typeof linha !== 'object') return null;
  const p = linha as Record<string, unknown>;
  const umSo = <T,>(v: unknown): T | null =>
    Array.isArray(v) ? ((v[0] ?? null) as T | null) : ((v ?? null) as T | null);
  return { ...p, cargo: umSo<Cargo>(p.cargo), setor: umSo<Setor>(p.setor) } as Perfil;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]           = useState<User | null>(null);
  const [perfil, setPerfil]       = useState<Perfil | null>(null);
  const [allowed, setAllowed]     = useState<Set<string>>(new Set(PAGINAS.map(p => p.key)));
  const [loading, setLoading]     = useState(true);
  const [falhaDeConexao, setFalhaDeConexao] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  const loadPerfil = async (uid: string) => {
    const { data } = await supabase
      .from('perfis')
      .select('nome, is_admin, ativo, radar_pode_criar, cargo_id, setor_id, cargo:cargos(id,nome,ordem,pode_aprovar), setor:setores(id,nome)')
      .eq('id', uid)
      .single();
    const perfilNormalizado = normalizarPerfil(data);
    setPerfil(perfilNormalizado);
    return perfilNormalizado;
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

  /**
    * Espera no máximo `ms` e desiste.
    *
    * Sem isto, uma indisponibilidade do backend deixa a tela em "Carregando..."
    * para sempre — foi o que aconteceu em 24/08, quando a camada de conexão do
    * Supabase travou e o dash inteiro virou um spinner sem explicação. Spinner
    * eterno é a pior mensagem de erro possível: a pessoa não sabe se espera, se
    * recarrega, ou se o problema é dela.
    */
  const comLimite = <T,>(promessa: PromiseLike<T>, ms = 15000): Promise<T> =>
    Promise.race([
      Promise.resolve(promessa),
      new Promise<T>((_, rejeita) =>
        setTimeout(() => rejeita(new Error('tempo esgotado')), ms)),
    ]);

  const boot = async (u: User | null) => {
    setUser(u);
    if (!u) { setPerfil(null); setLoading(false); setFalhaDeConexao(null); return; }

    let perfilData: Perfil | null = null;
    let permsData: { pagina: string; permitido: boolean }[] | null = null;

    try {
      // Fetch perfil e permissions em paralelo — economiza um round trip
      const [rPerfil, rPerms] = await comLimite(Promise.all([
        supabase
          .from('perfis')
          .select('nome, is_admin, ativo, radar_pode_criar, cargo_id, setor_id, cargo:cargos(id,nome,ordem,pode_aprovar), setor:setores(id,nome)')
          .eq('id', u.id)
          .single(),
        supabase
          .from('permissoes_paginas')
          .select('pagina, permitido')
          .eq('usuario_id', u.id),
      ]));
      perfilData = normalizarPerfil(rPerfil.data);
      permsData  = rPerms.data as { pagina: string; permitido: boolean }[] | null;
      setFalhaDeConexao(null);
    } catch {
      // Não desloga: a sessão pode estar boa e o servidor é que está fora.
      // Deslogar aqui faria a pessoa perder o login por causa de uma queda.
      setFalhaDeConexao('Não consegui falar com o servidor.');
      setLoading(false);
      return;
    }

    setPerfil(perfilData);

    // `setLoading(false)` ANTES do return: sem ele, quem tem o perfil desativado
    // fica preso em "Carregando..." para sempre, em vez de cair na tela de login.
    // O `signOut` limpa a sessão, mas quem destrava a interface é esta linha.
    if (perfilData?.ativo === false) {
      setPerfil(null);
      setLoading(false);
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

  // Refaz o boot quando a pessoa clica em "tentar de novo". Fica separado do
  // efeito acima porque aquele só pode rodar uma vez — reassinar o
  // onAuthStateChange a cada tentativa duplicaria os listeners.
  useEffect(() => {
    if (tentativa === 0) return;
    setLoading(true);
    setFalhaDeConexao(null);
    supabase.auth.getSession().then(({ data }) => boot(data.session?.user ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tentativa]);

  const tentarDeNovo = () => setTentativa(t => t + 1);

  const signIn = async (email: string, password: string): Promise<string | null> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const canAccess = (key: string) => {
    if (!user) return false;
    // O Inicio e a porta de entrada, nao um privilegio. Quem tem permissoes
    // explicitas gravadas em `permissoes_paginas` nao tinha `inicio` entre elas
    // -- as tres pessoas nao-admin ficariam trancadas fora justamente da pagina
    // feita para elas, e cairiam de novo na primeira pagina da lista, que e o
    // defeito que o Inicio veio consertar. Deixar isso depender de linha em
    // tabela significa que um usuario novo, ou um clique errado no Acessos,
    // reabre o problema.
    if (key === 'inicio') return true;
    if (perfil?.is_admin) return true;
    return allowed.has(key);
  };

  return (
    <AuthContext.Provider value={{ user, perfil, loading, falhaDeConexao, tentarDeNovo, canAccess, reloadPermissions, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
