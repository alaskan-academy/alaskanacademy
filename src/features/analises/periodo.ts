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

function iso(d: Date): string {
  // Componentes locais, não `toISOString()`: no fuso do Brasil o UTC já virou o
  // dia seguinte à noite, e a janela pularia um dia sozinha depois das 21h.
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dia}`;
}

export function janelaDeDias(dias: number): Janela {
  const fim = new Date();
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
