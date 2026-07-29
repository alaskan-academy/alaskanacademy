import { supabase } from './supabase';

type CacheEntry<T> = { promise: Promise<T>; ts: number };
const TTL = 5 * 60 * 1000; // 5 min
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const store: Record<string, CacheEntry<any>> = {};

function cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  if (store[key] && now - store[key].ts < TTL) return store[key].promise as Promise<T>;
  store[key] = { promise: fetcher(), ts: now };
  return store[key].promise as Promise<T>;
}

export function invalidateCache(key?: string) {
  if (key) delete store[key];
  else Object.keys(store).forEach(k => delete store[k]);
}

export const fetchFunis = () =>
  cached('funis', async () => {
    const { data } = await supabase
      .from('funis').select('id,nome,produto,ativo').eq('ativo', true).order('nome');
    return data ?? [];
  });

export const fetchPerfis = () =>
  cached('perfis', async () => {
    const { data } = await supabase
      .from('perfis').select('id,nome,is_admin').eq('ativo', true).order('nome');
    return data ?? [];
  });

export const fetchProjetos = () =>
  cached('projetos', async () => {
    const { data } = await supabase
      .from('ofertas_editores').select('id,nome').eq('ativo', true).order('nome');
    return data ?? [];
  });
