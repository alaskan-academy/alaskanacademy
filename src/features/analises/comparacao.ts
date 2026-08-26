import { BlocoMetricas } from './metricas';
import { formatCurrency, formatNumber } from '@/lib/formatters';

/**
 * As linhas da comparação lado a lado.
 *
 * Aqui a tabela vira transposta: cada linha é uma métrica e cada coluna é um
 * REV. É o desenho certo para a pergunta "qual funil eu corto", porque a
 * comparação acontece na horizontal — o olho corre a linha do ROAS e vê os
 * quatro de uma vez, em vez de descer quatro telas guardando números.
 *
 * `melhorEh` marca a coluna vencedora de cada linha, e é `null` de propósito em
 * volume: investir mais não é melhor nem pior, e pintar de verde o REV que mais
 * gastou ensinaria a ler errado. Só marca onde existe direção de verdade.
 *
 * Os order bumps individuais NÃO entram: funis diferentes vendem ofertas
 * diferentes, e comparar "Combo Mestre" com um bump que só existe noutro funil
 * seria alinhar colunas que não se tocam. Fica a adesão agregada, que é
 * comparável.
 */

export interface DefinicaoMetrica {
  grupo: string;
  rotulo: string;
  valor: (b: BlocoMetricas) => number | null;
  formato: (n: number) => string;
  /** Para a seta de variação: se subir é ruim. */
  subirEhRuim?: boolean;
  /** Qual coluna ganha a linha. `null` quando a pergunta não faz sentido. */
  melhorEh?: 'maior' | 'menor' | null;
}

const dinheiro = formatCurrency;
const inteiro  = formatNumber;
const pct1 = (n: number) => `${n.toFixed(1)}%`;
const pct2 = (n: number) => `${n.toFixed(2)}%`;
const num2 = (n: number) => n.toFixed(2);

export const LINHAS_COMPARACAO: DefinicaoMetrica[] = [
  // ── Resultado ──────────────────────────────────────────────────────────────
  { grupo: 'Resultado', rotulo: 'Investimento', valor: b => b.investimento,
    formato: dinheiro, subirEhRuim: true, melhorEh: null },
  { grupo: 'Resultado', rotulo: 'Faturamento', valor: b => b.faturamento,
    formato: dinheiro, melhorEh: null },
  { grupo: 'Resultado', rotulo: 'Resultado', valor: b => b.resultado,
    formato: dinheiro, melhorEh: 'maior' },
  { grupo: 'Resultado', rotulo: 'ROAS do front', valor: b => b.roas,
    formato: num2, melhorEh: 'maior' },
  { grupo: 'Resultado', rotulo: 'Imposto', valor: b => b.imposto_simples + b.imposto_meta,
    formato: dinheiro, subirEhRuim: true, melhorEh: null },
  { grupo: 'Resultado', rotulo: 'Taxa da plataforma', valor: b => b.taxa_plataforma_pct,
    formato: pct2, subirEhRuim: true, melhorEh: 'menor' },
  { grupo: 'Resultado', rotulo: 'Lucro líquido', valor: b => b.lucro_liquido,
    formato: dinheiro, melhorEh: 'maior' },
  { grupo: 'Resultado', rotulo: 'Margem', valor: b => b.margem_pct,
    formato: pct1, melhorEh: 'maior' },

  // ── Upsell ─────────────────────────────────────────────────────────────────
  { grupo: 'Com upsell', rotulo: 'Adesão ao upsell', valor: b => b.upsell_adesao_pct,
    formato: pct2, melhorEh: 'maior' },
  { grupo: 'Com upsell', rotulo: 'Faturamento do upsell', valor: b => b.upsell_faturamento,
    formato: dinheiro, melhorEh: null },
  { grupo: 'Com upsell', rotulo: 'ROAS com upsell', valor: b => b.roas_com_upsell,
    formato: num2, melhorEh: 'maior' },
  { grupo: 'Com upsell', rotulo: 'Lucro com upsell', valor: b => b.lucro_com_upsell,
    formato: dinheiro, melhorEh: 'maior' },
  { grupo: 'Com upsell', rotulo: 'Margem com upsell', valor: b => b.margem_com_upsell_pct,
    formato: pct1, melhorEh: 'maior' },

  // ── Ofertas ────────────────────────────────────────────────────────────────
  { grupo: 'Ofertas', rotulo: 'Vendas', valor: b => b.vendas,
    formato: inteiro, melhorEh: null },
  { grupo: 'Ofertas', rotulo: 'Adesão a bump', valor: b => b.bump_adesao_pct,
    formato: pct2, melhorEh: 'maior' },
  { grupo: 'Ofertas', rotulo: 'Receita de bumps', valor: b => b.bump_faturamento,
    formato: dinheiro, melhorEh: null },
  { grupo: 'Ofertas', rotulo: 'Bumps no faturamento', valor: b => b.pct_ofertas_extras,
    formato: pct2, melhorEh: 'maior' },

  // ── Funil ──────────────────────────────────────────────────────────────────
  { grupo: 'Funil', rotulo: 'Cliques no link', valor: b => b.cliques,
    formato: inteiro, melhorEh: null },
  { grupo: 'Funil', rotulo: 'Custo por clique', valor: b => b.cpc,
    formato: dinheiro, subirEhRuim: true, melhorEh: 'menor' },
  { grupo: 'Funil', rotulo: 'Checkouts iniciados', valor: b => b.checkouts_iniciados,
    formato: inteiro, melhorEh: null },
  { grupo: 'Funil', rotulo: 'Clique → checkout', valor: b => b.taxa_checkout_pct,
    formato: pct2, melhorEh: 'maior' },
  { grupo: 'Funil', rotulo: 'Custo por checkout', valor: b => b.cpi,
    formato: dinheiro, subirEhRuim: true, melhorEh: 'menor' },
  { grupo: 'Funil', rotulo: 'Checkout → venda', valor: b => b.conv_checkout_pct,
    formato: pct2, melhorEh: 'maior' },
  { grupo: 'Funil', rotulo: 'CPA', valor: b => b.cpa,
    formato: dinheiro, subirEhRuim: true, melhorEh: 'menor' },
  { grupo: 'Funil', rotulo: 'Conversão do funil', valor: b => b.conv_funil_pct,
    formato: pct2, melhorEh: 'maior' },

  // ── Por visitante ──────────────────────────────────────────────────────────
  { grupo: 'Por visitante', rotulo: 'CPV', valor: b => b.cpv,
    formato: dinheiro, subirEhRuim: true, melhorEh: 'menor' },
  { grupo: 'Por visitante', rotulo: 'EPC', valor: b => b.epc,
    formato: dinheiro, melhorEh: 'maior' },
  { grupo: 'Por visitante', rotulo: 'EPC − CPV', valor: b => b.epc_menos_cpv,
    formato: dinheiro, melhorEh: 'maior' },
  { grupo: 'Por visitante', rotulo: 'AOV', valor: b => b.aov,
    formato: dinheiro, melhorEh: 'maior' },
];

/**
 * Qual coluna ganha a linha.
 *
 * Devolve `null` quando não há disputa — uma coluna só com valor, ou empate
 * geral. Marcar vencedor de uma corrida com um corredor é ruído.
 */
export function indiceVencedor(
  valores: Array<number | null>,
  melhorEh: 'maior' | 'menor' | null | undefined,
): number | null {
  if (!melhorEh) return null;
  const validos = valores
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v != null);
  if (validos.length < 2) return null;

  const alvo = melhorEh === 'maior'
    ? validos.reduce((a, b) => (b.v > a.v ? b : a))
    : validos.reduce((a, b) => (b.v < a.v ? b : a));

  // Empate no topo não tem vencedor.
  if (validos.filter(x => x.v === alvo.v).length > 1) return null;
  return alvo.i;
}
