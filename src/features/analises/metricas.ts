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
   * Se o faturamento do front cobre a MÍDIA. A pergunta de quem compra tráfego,
   * e por isso feita no bruto: imposto e taxa não são decisão do anúncio, e
   * cobrá-los do criativo não diz a ele o que mudar.
   */
  trafego_se_paga: boolean | null;
  /**
   * Se sobra alguma coisa DEPOIS de mídia, imposto e taxa — ou seja,
   * `lucro_liquido >= 0`. A pergunta da operação.
   *
   * É a regra de decisão do módulo: front que se paga significa que o upsell é
   * lucro em cima; front que não se paga significa que o funil está de pé sobre
   * uma perna só, e a otimização é urgente mesmo com o total no azul.
   *
   * Até 06/10/2026 este campo era o bruto (o que hoje é `trafego_se_paga`), e
   * os dois conviviam porque a coprodução entrava como receita e empurrava o
   * faturamento para cima. Com ela fora, quatro REVs apareceram com selo verde
   * e R$ 9.941,46 de prejuízo mensal somado. Ver a migração `20261006d`.
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

  // ── O que ficou de fora da conta, dito e não escondido ────────────────────
  //
  // Os três são OPCIONAIS porque os retratos gravados em
  // `analise_itens.metricas` antes de 10/10/2026 não os têm. Tratar ausente
  // como zero mentiria: "não medi" e "medi e deu zero" são coisas diferentes,
  // e é a mesma distinção que `variacao()` faz logo abaixo.
  /**
   * Conjuntos que mandaram tráfego para mais de um REV. A verba deles fica
   * fora da conta dos dois: somar nos dois conta o mesmo real duas vezes, e
   * ratear inventa número.
   */
  conjuntos_ambiguos?: number;
  investimento_ambiguo?: number;
  /**
   * Verba das contas do projeto, no período, que não está em REV nenhum.
   *
   * É o sinal que faltava em 07/10/2026, quando o conjunto `07/10 TESTE REV10`
   * gastou R$ 305,98 e o card do REV10 mostrou R$ 0,00 de investimento com
   * margem de 84,5%. Os três avisos deste módulo desligam quando o
   * investimento é zero — `distanciaDoMeta` devolve null,
   * `baseAnteriorFragil` devolve false, os dois selos viram null —, cada um
   * com razão para o caso "não há mídia rodando", e os três juntos silenciando
   * no caso em que há mídia e o que quebrou foi o vínculo. Este número não
   * depende do vínculo: ele olha a verba do projeto e pergunta onde ela foi
   * parar. Zero quando está tudo ligado.
   */
  investimento_sem_rev_no_projeto?: number;

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

/**
 * Os dois selos de um RETRATO gravado antes de 06/10/2026.
 *
 * Até ali `trafego_se_paga` não existia e `front_se_paga` respondia no bruto
 * (`faturamento >= investimento`). Os 14 retratos no banco são todos assim, e
 * **4 deles dizem verde sobre prejuízo** — a contradição que a separação dos
 * selos veio consertar, congelada no histórico.
 *
 * Os NÚMEROS do retrato não se tocam: é documento histórico, e recalculá-los
 * faria uma análise de agosto mudar sozinha quando uma venda fosse
 * recategorizada em setembro. O que se deriva é o VEREDITO, e a partir dos
 * números do próprio retrato — `faturamento`, `investimento` e `lucro_liquido`
 * estão em todos os 14.
 *
 * Derivar na leitura em vez de preencher o jsonb por backfill é de propósito:
 * carga inicial sem gatilho é a quarta armadilha do CLAUDE.md. Um retrato
 * gravado depois por código antigo voltaria a mentir, e nada na tela diria.
 */
export function selosDoRetrato(b: BlocoMetricas): BlocoMetricas {
  const cru = b as BlocoMetricas & { trafego_se_paga?: boolean | null };
  if (cru.trafego_se_paga !== undefined) return b;
  const temInvestimento = b.investimento > 0;
  return {
    ...b,
    trafego_se_paga: temInvestimento ? b.faturamento >= b.investimento : null,
    front_se_paga:   temInvestimento ? b.lucro_liquido >= 0 : null,
  };
}

/** O mesmo, para o retrato inteiro. Sem métricas gravadas não há o que derivar. */
export function retratoLegivel(m: MetricasDoRev | null | undefined): MetricasDoRev | null {
  if (!m) return null;
  return { ...m, atual: selosDoRetrato(m.atual), anterior: selosDoRetrato(m.anterior) };
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
  // Divide pelo MÓDULO do anterior, não pelo anterior.
  //
  // Com base negativa a divisão inverte o sinal, e o REV5 mostrava
  // "Lucro líquido −R$ 8.878 ↑261%" em verde: o prejuízo triplicou e a tela
  // dizia que melhorou. (−8878 − (−2459)) / (−2459) dá +2,61; dividindo por
  // 2459 dá −2,61, que é a verdade.
  const pct = ((atual - anterior) / Math.abs(anterior)) * 100;
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
