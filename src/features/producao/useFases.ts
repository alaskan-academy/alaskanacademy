import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * As fases da produção, lidas do banco uma vez por sessão.
 *
 * Substitui cinco listas que viviam no frontend e já discordavam entre si:
 * `FASES`, `FASES_POR_TIPO`, `FASES_MEUPAINEL`, `FASES_CALENDARIO_SETOR`,
 * `FASES_APROVACAO` e `getFieldForSetor`. O desencontro não era teórico —
 * `FASES_CALENDARIO_SETOR` dava 'aprovado' ao Editor e `FASES_MEUPAINEL` não,
 * e `FASES_APROVACAO` dizia que o Gestor de Tráfego aprova revisão de edição.
 *
 * E todas eram chaveadas pelo NOME do setor. Renomear "Copy" no banco quebrava
 * as cinco de uma vez, em silêncio. Aqui a ligação é por `setor_id`.
 */

export interface Fase {
  chave: string;
  rotulo: string;
  ordem: number;
  setor_id: string | null;
  /** Qual coluna de `producoes` guarda o dono do trabalho nesta fase. */
  campo_dono: 'responsavel_id' | 'copy_id' | 'gestor_id' | 'especialista_id' | null;
  e_revisao: boolean;
  somente_socio: boolean;
  /** Fora do fluxo novo, mas ainda válida para o que já existe. */
  ativa: boolean;
  /** Prazo vencido aqui não é atraso: o trabalho terminou. */
  concluida: boolean;
  /** Para quais tipos de item esta fase existe. */
  tipos: string[];
}

/**
 * Cache de módulo: a lista muda quando alguém edita a tabela, o que é raro, e
 * cada tela da Produção precisaria dela. Sem isto, abrir a página dispararia
 * quatro consultas iguais.
 */
let cache: Fase[] | null = null;
let carregando: Promise<Fase[]> | null = null;

async function buscar(): Promise<Fase[]> {
  const [{ data: fases }, { data: tipos }] = await Promise.all([
    supabase.from('producao_fases').select('*').order('ordem'),
    supabase.from('producao_fases_tipo').select('fase_chave, tipo'),
  ]);
  const porFase = new Map<string, string[]>();
  for (const t of (tipos ?? []) as { fase_chave: string; tipo: string }[]) {
    porFase.set(t.fase_chave, [...(porFase.get(t.fase_chave) ?? []), t.tipo]);
  }
  return ((fases ?? []) as Omit<Fase, 'tipos'>[])
    .map(f => ({ ...f, tipos: porFase.get(f.chave) ?? [] }));
}

export function useFases() {
  const [fases, setFases] = useState<Fase[]>(cache ?? []);
  const [carregou, setCarregou] = useState(cache !== null);

  useEffect(() => {
    if (cache) return;
    let vivo = true;
    carregando ??= buscar();
    carregando.then(r => {
      cache = r;
      if (vivo) { setFases(r); setCarregou(true); }
    });
    return () => { vivo = false; };
  }, []);

  return { fases, carregou };
}

// ── Perguntas que as telas fazem ───────────────────────────────────────────
//
// Funções puras sobre a lista, para o mesmo raciocínio não ser reescrito em
// cada componente — que foi exatamente como as cinco listas nasceram.

/** O rótulo de uma fase. Fase desconhecida devolve a própria chave, e não vazio:
 *  card com fase que ninguém cadastrou tem que APARECER, não sumir. */
export function rotuloDaFase(fases: Fase[], chave: string): string {
  return fases.find(f => f.chave === chave)?.rotulo ?? chave;
}

/** As fases de um setor — as que ele TRABALHA, sem as de revisão de outros. */
export function fasesDoSetor(fases: Fase[], setorId: string | null): string[] {
  if (!setorId) return [];
  return fases.filter(f => f.setor_id === setorId).map(f => f.chave);
}

/** As revisões que um head daquele setor aprova. */
export function fasesQueAprova(fases: Fase[], setorId: string | null, ehSocio: boolean): string[] {
  if (ehSocio) return fases.filter(f => f.e_revisao).map(f => f.chave);
  if (!setorId) return [];
  return fases.filter(f => f.e_revisao && f.setor_id === setorId).map(f => f.chave);
}

/** Qual coluna de `producoes` diz "isto é meu" para quem é deste setor. */
export function campoDonoDoSetor(fases: Fase[], setorId: string | null): string {
  if (!setorId) return 'responsavel_id';
  return fases.find(f => f.setor_id === setorId && f.campo_dono)?.campo_dono ?? 'responsavel_id';
}

/** Prazo vencido nestas não é atraso. */
export function fasesConcluidas(fases: Fase[]): Set<string> {
  return new Set(fases.filter(f => f.concluida).map(f => f.chave));
}

/** Vizinhas no fluxo daquele tipo, para os botões de avançar e voltar. */
export function fasesVizinhas(fases: Fase[], tipo: string, atual: string) {
  const fluxo = fases
    .filter(f => f.tipos.includes(tipo) && !['bloqueado', 'arquivado'].includes(f.chave))
    .sort((a, b) => a.ordem - b.ordem);
  const i = fluxo.findIndex(f => f.chave === atual);
  return {
    prev: i > 0 ? fluxo[i - 1].chave : null,
    next: i >= 0 && i < fluxo.length - 1 ? fluxo[i + 1].chave : null,
  };
}
