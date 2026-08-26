/**
 * As métricas de um REV, e como lê-las honestamente.
 *
 * O tipo espelha o que `fn_metricas_do_rev` devolve. Fica separado do
 * componente porque o retrato gravado em `analise_itens.metricas` é lido de
 * volta com o mesmo formato — se as duas leituras divergirem, uma análise
 * antiga passa a renderizar errado.
 */

export interface BlocoMetricas {
  vendas: number;
  faturamento: number;
  receita: number;
  ticket_medio: number | null;

  bump_qtd: number;
  bump_faturamento: number;
  bump_adesao_pct: number | null;

  upsell_qtd: number;
  upsell_faturamento: number;

  investimento: number;
  investimento_e_piso: boolean;
  roas: number | null;
  /** Da CONTA inteira, não deste REV. Ver o comentário da função no banco. */
  cobertura_geral_pct: number | null;

  vendas_de_anuncio: number;
  vendas_organicas: number;
}

export interface MetricasDoRev {
  dias: number;
  atual: BlocoMetricas;
  anterior: BlocoMetricas;
}

export type Direcao = 'subiu' | 'caiu' | 'igual';

/**
 * Variação entre os dois períodos.
 *
 * Devolve `null` quando não há base de comparação — e `null` NÃO é zero. Um REV
 * que não existia no período anterior tem variação indefinida, não "0%", e
 * mostrar 0% ali faria parecer estabilidade onde não há histórico.
 */
export function variacao(atual: number | null, anterior: number | null): {
  pct: number | null;
  direcao: Direcao;
} {
  if (atual == null || anterior == null || anterior === 0) {
    return { pct: null, direcao: 'igual' };
  }
  const pct = ((atual - anterior) / anterior) * 100;
  return {
    pct,
    // 1% de folga: variação abaixo disso é ruído de arredondamento, e pintar
    // seta de alta para 0,3% treina a pessoa a ignorar a seta.
    direcao: Math.abs(pct) < 1 ? 'igual' : pct > 0 ? 'subiu' : 'caiu',
  };
}

/**
 * Se o ROAS deste REV merece confiança.
 *
 * Não é sobre a cobertura da conta: é sobre ESTE REV. Um REV cuja maioria das
 * vendas é orgânica tem um ROAS calculado sobre uma fração pequena — o número
 * existe, mas descreve outra coisa que não o REV inteiro.
 */
export function roasEhConfiavel(b: BlocoMetricas): boolean {
  const total = b.vendas_de_anuncio + b.vendas_organicas;
  if (total === 0 || b.investimento <= 0) return false;
  return b.vendas_de_anuncio / total >= 0.6;
}
