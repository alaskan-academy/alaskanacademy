import { paraYmd } from '@/lib/datas';
/**
 * A janela que a rodada analisa.
 *
 * Termina ONTEM, e não hoje, de propósito: o dia corrente está pela metade, e
 * comparar meio dia contra o período anterior inteiro faria toda métrica de
 * volume parecer em queda no início da manhã. A tela diz as datas em voz alta
 * para que ninguém precise deduzir isso.
 */

export interface Janela {
  inicio: string; // yyyy-MM-dd
  fim: string;    // yyyy-MM-dd, inclusivo
}


export const PERIODOS = [
  { dias: 7,  label: 'Últimos 7 dias' },
  { dias: 14, label: 'Últimos 14 dias' },
  { dias: 30, label: 'Últimos 30 dias' },
  { dias: 60, label: 'Últimos 60 dias' },
  { dias: 90, label: 'Últimos 90 dias' },
];

export const PERSONALIZADO = 'personalizado';

// A conversão local morava aqui, escrita à mão. Era a primeira de três cópias
// da mesma correção espalhadas pelo projeto — agora todas vêm de `lib/datas`.
const iso = paraYmd;

export function janelaDeDias(dias: number): Janela {
  const fim = new Date();
  fim.setDate(fim.getDate() - 1);
  const inicio = new Date(fim);
  inicio.setDate(inicio.getDate() - (dias - 1));
  return { inicio: iso(inicio), fim: iso(fim) };
}

/**
 * A janela anterior, do mesmo tamanho e colada nesta.
 *
 * O SQL calcula a dele por dentro; isto existe para a retenção de VSL, que vem
 * do VTurb e precisa das duas datas explícitas. As duas contas têm que dar a
 * mesma janela, senão a retenção compararia um período e os números outro.
 */
export function janelaAnterior(j: Janela): Janela {
  const dias = diasDaJanela(j);
  const fim = new Date(`${j.inicio}T00:00:00`);
  fim.setDate(fim.getDate() - 1);
  const inicio = new Date(fim);
  inicio.setDate(inicio.getDate() - (dias - 1));
  return { inicio: iso(inicio), fim: iso(fim) };
}

/** Quantos dias a janela cobre, contando as duas pontas. */
export function diasDaJanela(j: Janela): number {
  const ms = new Date(`${j.fim}T00:00:00`).getTime() - new Date(`${j.inicio}T00:00:00`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export function formatarData(iso: string): string {
  return iso.split('-').reverse().join('/');
}
