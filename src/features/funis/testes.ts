import { hoje, diasEntre } from '@/lib/datas';
import { TesteFunil, ImpactoTest, DificuldadeTest } from './types';

/**
 * Regras de leitura dos testes, fora do componente.
 *
 * Moram aqui porque a página e a aba precisam da MESMA definição de "teste sem
 * veredito" — se o selo da aba contasse por um critério e o quadro por outro,
 * ela clicaria em "3 sem veredito" e encontraria dois.
 */

/**
 * Depois de quantos dias um teste rodando vira dívida.
 *
 * Duas semanas é o ciclo de análise dela. Um teste que atravessou uma análise
 * inteira sem veredito não vai ganhar um sozinho — alguém precisa decidir.
 */
export const DIAS_ATE_COBRAR = 14;

/**
 * Hoje no fuso de quem está usando, e não em UTC.
 *
 * O porquê está em `lib/datas`, junto com o resto das datas do projeto. Aqui
 * a consequência específica: um teste iniciado à noite seria carimbado com a
 * data de amanhã, a contagem de dias sairia um dia curta para sempre, e como
 * `data_inicio` alimenta o aviso de teste sem veredito, o erro se propagaria
 * até a cobrança.
 */
export const hojeLocal = hoje;

/**
 * Dias corridos desde a data, no fuso local.
 *
 * Conta a diferença entre as MEIAS-NOITES locais, não entre instantes: se
 * usasse `Date.now()` direto contra a meia-noite da data, o resultado mudaria
 * ao longo do dia e um teste iniciado às 23h "envelheceria" um dia inteiro em
 * uma hora.
 */
export function diasDesde(d: string | null): number | null {
  if (!d) return null;
  return diasEntre(d, hoje());
}

export function rotuloDias(d: string | null): string | null {
  const n = diasDesde(d);
  if (n === null) return null;
  if (n <= 0) return 'iniciou hoje';
  return n === 1 ? '1 dia rodando' : `${n} dias rodando`;
}

/**
 * Rodando há tempo demais e ainda sem veredito.
 *
 * É a dívida que o Google Chat criava: registra a alteração e ninguém volta
 * para dizer no que deu. Hoje 10 dos 13 testes concluídos estão sem vencedor.
 */
export function semVeredito(t: TesteFunil): boolean {
  if (t.pipeline_status !== 'rodando' || t.vencedor) return false;
  const n = diasDesde(t.data_inicio);
  return n !== null && n >= DIAS_ATE_COBRAR;
}

/** Impacto × facilidade. Ordena a fila de quem ainda não começou. */
export function iceScore(impacto: ImpactoTest | null, dificuldade: DificuldadeTest | null): number | null {
  if (!impacto || !dificuldade) return null;
  return { alto: 3, medio: 2, baixo: 1 }[impacto] * { facil: 3, media: 2, dificil: 1 }[dificuldade];
}
