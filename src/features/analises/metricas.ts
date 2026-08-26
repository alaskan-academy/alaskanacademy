/**
 * As métricas de um REV, e como lê-las honestamente.
 *
 * O tipo espelha o que `fn_metricas_do_rev` devolve. Fica separado do
 * componente porque o retrato gravado em `analise_itens.metricas` é lido de
 * volta com o mesmo formato — se as duas leituras divergirem, uma análise
 * antiga passa a renderizar errado.
 */

export interface ItemVendido {
  nome: string;
  tipo: string;
  qtd: number;
  faturamento: number;
  adesao_pct: number | null;
}

export interface BlocoMetricas {
  dias: number;

  // Venda
  vendas: number;
  vendas_de_anuncio: number;
  vendas_organicas: number;
  faturamento: number;
  receita: number;
  ticket_medio: number | null;

  // Ofertas
  bump_qtd: number;
  bump_faturamento: number;
  bump_adesao_pct: number | null;
  upsell_qtd: number;
  upsell_faturamento: number;
  itens: ItemVendido[];

  // Tráfego
  investimento: number;
  investimento_e_piso: boolean;
  impressoes: number;
  cliques: number;
  visitas: number;
  checkouts_iniciados: number;
  /** A contagem do próprio Meta, para conferir a nossa contra uma segunda fonte. */
  compras_meta: number;
  faturamento_meta: number;
  roas: number | null;
  /** Da CONTA inteira, não deste REV. Ver o comentário da função no banco. */
  cobertura_geral_pct: number | null;

  // Conversões
  connect_rate_pct: number | null;
  conv_pagina_pct: number | null;
  conv_checkout_pct: number | null;
  taxa_checkout_pct: number | null;

  // Custo e ganho por etapa
  cpm: number | null;
  cpc: number | null;
  cpv: number | null;
  cpa: number | null;
  epc: number | null;
  margem_por_clique: number | null;

  // Resultado
  taxa_plataforma: number;
  juros_plataforma: number;
  reembolsos: number;
  imposto: number;
  lucro: number;
  margem_pct: number | null;
}

export interface MetricasDoRev {
  dias: number;
  inicio: string;
  fim: string;
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
 * O quanto a nossa contagem de vendas destoa da que o Meta reporta.
 *
 * Não é enfeite: foi esta conta que denunciou um CPA de R$ 198 num REV que dava
 * lucro. Quando `ad_id_meta` some da venda, tudo que usasse só a venda marcada
 * saía várias vezes errado — e com cara de número exato.
 *
 * Devolve `null` quando não há investimento na janela: sem anúncio rodando não
 * há atribuição para comparar, e alertar ali seria alarme falso.
 */
export function distanciaDoMeta(b: BlocoMetricas): number | null {
  if (b.investimento <= 0 || b.compras_meta === 0) return null;
  return Math.abs(b.vendas - b.compras_meta) / b.compras_meta;
}

/** Acima disto, os números por venda merecem desconfiança explícita na tela. */
export const LIMITE_DISTANCIA = 0.25;

/**
 * Se o período anterior não serve de linha de base para o que é pago.
 *
 * Acontece quando os anúncios do REV mal rodaram antes: o REV3 gastou R$ 63,50
 * num único dia da janela anterior e R$ 20.221 na atual. O ROAS "antes" dá 475
 * — aritmeticamente correto e analiticamente vazio, porque não havia tráfego
 * pago para comparar. Sem este aviso, a tela mostraria "ROAS caiu 99,5%" para
 * uma campanha que simplesmente começou.
 *
 * Não afeta venda, faturamento ou oferta: esses existiam nos dois períodos.
 */
export function baseAnteriorFragil(atual: BlocoMetricas, anterior: BlocoMetricas): boolean {
  if (atual.investimento <= 0) return false;
  return anterior.investimento < atual.investimento * 0.05;
}
