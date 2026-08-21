/**
 * As contas que decidem se o negócio dá lucro.
 *
 * Moravam dentro do `fetchData` da Visão Geral, misturadas com montagem de query,
 * e por isso nenhuma tinha teste. Extraídas aqui como funções puras: elas não
 * conhecem Supabase, período nem segmento — recebem números e devolvem números.
 *
 * Duas decisões atravessam o arquivo inteiro:
 *
 * 1. **Tudo parte da receita sem juros.** O juro de parcelamento é pago pelo
 *    cliente e recebido pela adquirente; nunca foi dinheiro da casa. Contá-lo como
 *    receita inflava ticket médio, margem e ROAS de uma vez só.
 * 2. **Divisor zero devolve zero, nunca `NaN` nem `Infinity`.** Um `NaN` que
 *    escapa para a tela vira "R$ NaN" ou some no `formatCurrency`, e some é pior:
 *    o número desaparece sem que ninguém saiba que havia um número ali.
 */

/** Divisão que devolve 0 quando não há base para dividir. */
function razao(numerador: number, denominador: number): number {
  return denominador > 0 ? numerador / denominador : 0;
}

export interface EntradaResultado {
  /**
   * Receita sem juros de parcelamento, só de vendas aprovadas.
   *
   * Note que reembolso e chargeback **não** entram como dedução em lugar nenhum, e
   * isso é proposital: a venda estornada deixa de ter status `aprovada`, então já
   * saiu daqui. Descontá-la de novo contaria a mesma perda duas vezes.
   *
   * A consequência é que um estorno reduz retroativamente a receita do mês em que a
   * venda aconteceu, não do mês em que foi estornada. É o mesmo critério do export
   * da Payt, contra o qual esses números são conciliados.
   */
  receita: number;
  taxaPlataforma: number;
  impostoSimples: number;
  impostoMeta: number;
  investimento: number;
  /** Já rateado para o período e o segmento. Ver {@link ratearCustoFixo}. */
  custoFixo: number;
}

export interface Resultado {
  /** Receita menos taxa e Simples. Não desconta ads nem custo fixo. */
  faturamentoLiquido: number;
  lucroOperacional: number;
  lucroComCustoFixo: number;
  margemPct: number;
  margemComCustoFixoPct: number;
}

/**
 * A cascata do pago ao lucro.
 *
 * A margem usa o lucro operacional sobre a receita — não sobre o faturamento
 * bruto. Sobre o bruto, o juro de parcelamento entraria no denominador e faria a
 * margem parecer menor do que é.
 */
export function calcularResultado(e: EntradaResultado): Resultado {
  const faturamentoLiquido = e.receita - e.taxaPlataforma - e.impostoSimples;

  const lucroOperacional =
    e.receita -
    e.taxaPlataforma -
    e.impostoSimples -
    e.impostoMeta -
    e.investimento;

  const lucroComCustoFixo = lucroOperacional - e.custoFixo;

  return {
    faturamentoLiquido,
    lucroOperacional,
    lucroComCustoFixo,
    margemPct: razao(lucroOperacional, e.receita) * 100,
    margemComCustoFixoPct: razao(lucroComCustoFixo, e.receita) * 100,
  };
}

/**
 * Custo fixo mensal rateado pelos dias do período.
 *
 * Usa mês de 30 dias por convenção, não o mês-calendário: o filtro é livre e pode
 * cobrir 5 dias, 45 dias ou pedaços de dois meses. Um período de 31 dias custa
 * mais que um mês cheio — é o esperado, e não um arredondamento errado.
 */
export function ratearCustoFixo(mensal: number, dias: number): number {
  if (!mensal || dias <= 0) return 0;
  return (mensal / 30) * dias;
}

/**
 * Fatia que um recorte representa no total do período, entre 0 e 1.
 *
 * Serve para ratear o que só existe no total — imposto, reembolso, custo fixo —
 * quando a tela mostra só um segmento ou um funil.
 *
 * Quando o total é zero mas a parte não é, devolve 1: significa que não há
 * denominador confiável e o recorte responde por tudo que se sabe. Devolver 0 aí
 * zeraria os custos e mostraria lucro onde não há.
 */
export function participacao(parte: number, total: number): number {
  if (total > 0) return Math.min(parte / total, 1);
  return parte > 0 ? 1 : 0;
}

/** Receita média por venda aprovada, sem juros. */
export function ticketMedio(receita: number, vendas: number): number {
  return razao(receita, vendas);
}

/** Quanto de receita cada real investido em anúncio trouxe. */
export function roas(receita: number, investimento: number): number {
  return razao(receita, investimento);
}

/** Custo de anúncio por venda aprovada. */
export function cpa(investimento: number, vendas: number): number {
  return razao(investimento, vendas);
}

/**
 * Taxa da plataforma como percentual da receita, não do pago pelo cliente.
 *
 * Sobre o pago, o juro de parcelamento entra no denominador e a taxa aparece
 * menor do que a Payt de fato cobra.
 */
export function taxaPlataformaPct(taxa: number, receita: number): number {
  return razao(taxa, receita) * 100;
}
