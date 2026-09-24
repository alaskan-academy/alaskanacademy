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
      .from('funis').select('id,nome,produto,ativo,projeto_id').eq('ativo', true).order('nome');
    return data ?? [];
  });

export const fetchPerfis = () =>
  cached('perfis', async () => {
    const { data } = await supabase
      .from('perfis').select('id,nome,is_admin').eq('ativo', true).order('nome');
    return data ?? [];
  });

/**
 * TODOS os projetos, e não só os ativos.
 *
 * O `.eq('ativo', true)` devolvia 7 de 35 — e as telas que usam esta lista não
 * filtram a TABELA por ativo. O resultado, medido em 21/09/2026:
 *
 *   · em Criativos/Avaliação, Desempenho e Calendário, os cards dos outros 28
 *     projetos apareciam na lista e não havia como isolá-los. Velas Perfeitas
 *     (839 cards, 755 postados, 58 aprovados) e Cosmética Natural (728, 545,
 *     37) são os dois maiores estoques da casa e nenhum dos dois era opção.
 *   · em Produção/Por Projeto é pior: a lista monta as SEÇÕES, e card de
 *     projeto ausente não cai em seção nenhuma. Ele sumia da tela — não ia
 *     para "Sem projeto", porque `projeto_id` dele não é nulo.
 *
 * É a mesma armadilha do `funis.ativo × funis.status` que o CLAUDE.md conta:
 * um filtro escondendo dado sem nada na tela dizendo que escondeu.
 *
 * `ativo` vem junto para quem exibe poder marcar o encerrado, e a ordem põe os
 * ativos primeiro — 28 encerrados no topo de um seletor seria outra forma de
 * esconder os 7 que interessam no dia a dia.
 */
export const fetchProjetos = () =>
  cached('projetos', async () => {
    const { data } = await supabase
      .from('ofertas_editores').select('id,nome,ativo')
      .order('ativo', { ascending: false }).order('nome');
    return data ?? [];
  });
