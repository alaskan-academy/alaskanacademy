const FUSO_OPERACAO = 'America/Sao_Paulo';

/**
 * Deslocamento do fuso da operação numa data, no formato `-03:00`.
 *
 * Calculado em vez de fixado porque o Brasil já teve horário de verão e pode
 * voltar a ter — fixar `-03:00` daria uma hora de erro em toda a base no dia
 * em que isso mudasse.
 */
function offsetNaData(dataStr: string): string {
  const meioDia = new Date(`${dataStr}T12:00:00Z`);
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: FUSO_OPERACAO,
    timeZoneName: 'longOffset',
  }).formatToParts(meioDia);

  const nome = partes.find(p => p.type === 'timeZoneName')?.value ?? '';
  const offset = nome.replace('GMT', '');
  return offset || '-03:00';
}

/**
 * Início do dia no fuso da operação, como timestamp com offset explícito.
 *
 * Necessário porque `data_venda` é `timestamptz` e o Postgres interpreta uma
 * string solta de data no fuso do servidor (UTC). Comparar com `'2026-08-20'`
 * significava `2026-08-19 21:00 BRT`, arrastando as três últimas horas do dia
 * anterior para dentro do período — cerca de 5% das vendas caem nessa faixa.
 */
export function inicioDiaBRT(dataStr: string): string {
  return `${dataStr}T00:00:00.000${offsetNaData(dataStr)}`;
}

/** Fim do dia no fuso da operação, inclusivo. Ver {@link inicioDiaBRT}. */
export function fimDiaBRT(dataStr: string): string {
  return `${dataStr}T23:59:59.999${offsetNaData(dataStr)}`;
}

/** Data (yyyy-MM-dd) de um timestamp, no fuso da operação. */
export function diaBRT(timestamp: string | Date): string {
  const d = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  return d.toLocaleDateString('en-CA', { timeZone: FUSO_OPERACAO });
}
