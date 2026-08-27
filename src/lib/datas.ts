/**
 * Datas no fuso de quem está usando o dashboard, que é o Brasil.
 *
 * `toISOString()` converte para UTC antes de cortar os dez primeiros
 * caracteres. Parece a forma óbvia de escrever "yyyy-MM-dd" e está errada
 * aqui: às 21h de Brasília o UTC já virou o dia seguinte, e a data sai um dia
 * adiantada. À noite. Todo dia. Sem nada na tela denunciando.
 *
 * O erro é pior quando a hora não é meia-noite. Um fim de mês montado com
 * `setHours(23, 59, 59)` vira 02:59 UTC do dia 1º — a janela inteira escorrega
 * um dia, e o mês passa a incluir um dia que não é dele.
 *
 * Este arquivo existe porque a mesma correção já tinha sido escrita duas vezes
 * em cantos diferentes do projeto (`analises/periodo.ts` e `funis/testes.ts`),
 * cada uma resolvendo só onde doeu, enquanto o resto seguia com o defeito.
 * É a primeira armadilha do CLAUDE.md: a regra em vários lugares diverge.
 * Aqui ela tem um lugar só.
 *
 * Nada disto vale para `timestamptz`. Um instante gravado em `criado_em` deve
 * mesmo ir como `new Date().toISOString()`, com o Z: ali o fuso é do dado, não
 * de quem lê.
 */

/** Uma data qualquer como `yyyy-MM-dd`, lendo os componentes LOCAIS. */
export function paraYmd(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Hoje, no fuso de quem está olhando. */
export function hoje(): string {
  return paraYmd(new Date());
}

/**
 * Um `yyyy-MM-dd` de volta para `Date`, na meia-noite LOCAL.
 *
 * `new Date('2026-08-26')` sozinho é interpretado como UTC e, no Brasil, cai
 * às 21h do dia 25 — o dia anterior. O `T00:00:00` sem sufixo força a leitura
 * local, que é a que faz o calendário mostrar o dia certo.
 */
export function deYmd(ymd: string): Date {
  return new Date(ymd + 'T00:00:00');
}

/** Hoje mais (ou menos) N dias, ainda em fuso local. */
export function emDias(delta: number, base = new Date()): string {
  const d = new Date(base);
  d.setDate(d.getDate() + delta);
  return paraYmd(d);
}

/** O primeiro dia do mês de uma data. */
export function primeiroDiaDoMes(d = new Date()): string {
  return paraYmd(new Date(d.getFullYear(), d.getMonth(), 1));
}

/**
 * O último dia do mês de uma data.
 *
 * Dia 0 do mês seguinte é o último do atual, e o construtor com componentes
 * cria à meia-noite local — sem `setHours(23,59,59)`, que é justamente o que
 * empurrava a data para o dia 1º em UTC.
 */
export function ultimoDiaDoMes(d = new Date()): string {
  return paraYmd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/**
 * Dias corridos entre duas datas `yyyy-MM-dd`.
 *
 * Conta entre as MEIAS-NOITES locais, não entre instantes: contra `Date.now()`
 * o resultado mudaria ao longo do dia, e algo iniciado às 23h envelheceria um
 * dia inteiro em uma hora.
 */
export function diasEntre(de: string, ate: string): number {
  return Math.round((deYmd(ate).getTime() - deYmd(de).getTime()) / 86400000);
}
