/**
 * As métricas de um REV, e como lê-las honestamente.
 *
 * O tipo espelha o que `fn_metricas_do_rev` devolve, e a ORDEM aqui é a ordem
 * da planilha que ela já usa — resultado, ofertas, tráfego, conversões, custo
 * por etapa. Não é decoração: a tela lê esta ordem, e ler os números fora da
 * sequência em que ela pensa foi exatamente a queixa que motivou a reescrita.
 *
 * Fica separado do componente porque o retrato gravado em
 * `analise_itens.metricas` é lido de volta com o mesmo formato — se as duas
 * leituras divergirem, uma análise antiga passa a renderizar errado.
 */

export interface ItemVendido {
  nome: string;
  qtd: number;
  faturamento: number;
  adesao_pct: number | null;
}

export interface BlocoMetricas {
  dias: number;

  // ── Resultado ──────────────────────────────────────────────────────────────
  investimento: number;
  /** Já líquido de juros de parcelamento e de reembolso. */
  faturamento: number;
  resultado: number;
  vendas: number;
  roas: number | null;
  imposto_simples: number;
  imposto_meta: number;
  taxa_plataforma: number;
  /** A taxa real em percentual do faturamento — varia por meio de pagamento. */
  taxa_plataforma_pct: number | null;
  lucro_liquido: number;
  margem_pct: number | null;
  reembolsos: number;

  // ── Ofertas ────────────────────────────────────────────────────────────────
  oferta_principal_qtd: number;
  oferta_principal_valor: number;
  bump_qtd: number;
  bump_faturamento: number;
  bump_adesao_pct: number | null;
  itens: ItemVendido[];

  // ── Upsell: ao lado do resultado do front, nunca dentro dele ──────────────
  // Somar o upsell esconde front doente; tirar mata funil lucrativo. As duas
  // leituras ficam na tela com nomes diferentes. Ver `BlocoUpsell`.
  upsell_qtd: number;
  upsell_faturamento: number;
  /** A métrica que faltava para comparar um funil de 10% de up com um de 2%. */
  upsell_adesao_pct: number | null;
  faturamento_com_upsell: number;
  roas_com_upsell: number | null;
  lucro_com_upsell: number;
  margem_com_upsell_pct: number | null;
  /**
   * Se o faturamento do front já cobre o investimento.
   *
   * É a regra de decisão do módulo: front que se paga significa que o upsell é
   * lucro em cima; front que não se paga significa que o funil está de pé sobre
   * uma perna só, e a otimização é urgente mesmo com o total no azul.
   */
  front_se_paga: boolean | null;
  /** Fatia do faturamento que veio dos order bumps — o 21,59% da planilha. */
  pct_ofertas_extras: number | null;

  // ── Tráfego ────────────────────────────────────────────────────────────────
  /**
   * Em que nível o investimento foi somado. É sempre o CONJUNTO quando existe
   * um: a mesma campanha roda REVs diferentes, inclusive os de teste, e medir
   * pela campanha inflou o gasto do REV6 em quase 7× (R$ 12.936 contra os
   * R$ 1.898 reais). Cai para `anuncio` só quando o REV não tem conjunto
   * identificado.
   */
  nivel_investimento: 'conjunto' | 'anuncio';
  conjuntos: number;
  impressoes: number;
  cliques: number;
  visitas: number;
  checkouts_iniciados: number;
  /** A contagem do próprio Meta, para conferir a nossa contra uma segunda fonte. */
  compras_meta: number;
  vendas_de_anuncio: number;
  cobertura_geral_pct: number | null;

  // ── Conversões ─────────────────────────────────────────────────────────────
  conv_funil_pct: number | null;
  conv_checkout_pct: number | null;
  connect_rate_pct: number | null;
  taxa_checkout_pct: number | null;

  // ── Custo e ganho por etapa ────────────────────────────────────────────────
  cpm: number | null;
  cpc: number | null;
  cpv: number | null;
  cpi: number | null;
  cpa: number | null;
  epc: number | null;
  aov: number | null;
  epc_menos_cpv: number | null;
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
