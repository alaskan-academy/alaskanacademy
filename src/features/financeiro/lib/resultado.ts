/**
 * O resultado real do mês — e por que ele precisa de duas bases.
 *
 * ── O problema que esta conta resolve ────────────────────────────────────
 *
 * O painel tinha duas telas e nenhuma respondia "quanto sobrou este mês":
 *
 *   /resumo               competência pura (Payt + Meta), impostos por alíquota
 *   /financeiro/caixa     caixa puro (só extrato)
 *
 * O Fechamento era caixa puro por CONSERTO: antes ele somava receita da Payt
 * com custo do banco, e em agosto/2026 mostrava 57,1% de margem contra 3,2% no
 * extrato. Misturar bases sem dizer quais custou esse erro.
 *
 * Mas a cura criou outra doença. O que entra na conta bancária é repasse da
 * Payt e fatura de cartão — dinheiro do mês PASSADO chegando agora, e o deste
 * mês chegando no que vem. Chamar isso de "receita bruta do mês" é tão errado
 * quanto o híbrido antigo, só que em silêncio.
 *
 * ── A regra ─────────────────────────────────────────────────────────────
 *
 * Cada linha vem da fonte que sabe aquilo, e a tela DIZ qual é:
 *
 *   faturamento, taxa, reembolso   Payt      o que foi vendido no mês
 *   investimento, imposto do Meta  Meta      o cartão mistura meses
 *   Simples                        extrato   é pagamento, tem data
 *   demais custos                  extrato   idem
 *
 * O que derrubou a versão antiga não foi a mistura — foi a mistura MUDA, com
 * uma parcela faltando. Aqui cada linha carrega a origem, e a tira de
 * conciliação mostra o mesmo mês em caixa puro ao lado.
 *
 * ── A dupla contagem que este arquivo evita ─────────────────────────────
 *
 * `ehCustoOperacional` é aberta ("toda saída é custo, exceto sócio e
 * reserva"), então a fatura do cartão da Meta ESTÁ nos custos do extrato. Se
 * ela ficasse lá junto com a linha do Meta, o anúncio entraria duas vezes, em
 * dois meses diferentes — o defeito antigo invertido: aquele EXCLUÍA anúncio e
 * perdeu R$ 92.849; este duplicaria.
 *
 * Por isso `custosPagos` tira anúncio e imposto. Nenhum dos dois some: cada um
 * tem a sua própria linha, vindo da fonte certa.
 *
 * E o imposto sai INTEIRO, pela categoria — não separando "Simples" de
 * municipal pela descrição. `Impostos e Tributos` mistura MINISTERIO DA FAZENDA
 * com MUNICIPIO DE GUARATUBA, e uma regra que lê texto de banco envelhece
 * calada. A categoria inteira vira a linha de imposto: nada duplica, nada
 * desaparece, e não há regra para manter.
 */

import { ehCustoOperacional, ehReceita, CAT_ANUNCIOS, CAT_IMPOSTOS } from '../constants';

export interface LinhaTransacao {
  data: string;
  valor: number;
  categoria: string | null;
}

/** O que a Payt e o Meta dizem sobre o mês. Um registro por mês `yyyy-MM`. */
export interface Competencia {
  fatBruto: number;
  taxaPayt: number;
  reembolsos: number;
  investMeta: number;
  impostoMeta: number;
}

/** O que saiu e entrou na conta no mês. */
export interface Caixa {
  /** `Impostos e Tributos` — federal e municipal juntos, de propósito. */
  impostosPagos: number;
  /**
   * A fatura do cartão da Meta. Sai dos custos (a linha do Meta a representa),
   * mas é guardada porque é ela que denuncia mês sem dado do Meta — ver
   * `semDadosDeAnuncio`.
   */
  anunciosPagos: number;
  /** Custo do extrato JÁ sem anúncio e sem imposto: os dois têm linha própria. */
  custosPagos: number;
  /** Para a tira de conciliação: o mês em caixa puro, sem nenhuma exclusão. */
  entrou: number;
  saiu: number;
}

export interface Simples {
  valor: number;
  presumido: boolean;
  /** Alíquota usada quando presumido. Nula quando o valor é pagamento real. */
  pct: number | null;
  /** Quais meses formaram a alíquota — para a tela poder mostrar e alguém conferir. */
  baseMeses: string[];
}

export const mesDe = (data: string): string => data.slice(0, 7);

export function mesAnterior(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Os N meses terminando em `mes`, do mais antigo para o mais novo. */
export function janelaDeMeses(mes: string, n: number): string[] {
  const saida: string[] = [];
  let atual = mes;
  for (let i = 0; i < n; i++) { saida.unshift(atual); atual = mesAnterior(atual); }
  return saida;
}

/**
 * Agrupa o extrato por mês, aplicando as exclusões da cascata.
 *
 * A classificação vem de `ehCustoOperacional`/`ehReceita` e não é reescrita
 * aqui — nem em SQL. Duas cópias da mesma regra divergem, e esta em especial já
 * mudou uma vez (de lista fechada para "toda saída é custo, exceto…") depois de
 * esconder R$ 1.841,39.
 */
export function agruparCaixa(linhas: LinhaTransacao[]): Map<string, Caixa> {
  const mapa = new Map<string, Caixa>();
  const pega = (mes: string): Caixa => {
    let c = mapa.get(mes);
    if (!c) {
      c = { impostosPagos: 0, anunciosPagos: 0, custosPagos: 0, entrou: 0, saiu: 0 };
      mapa.set(mes, c);
    }
    return c;
  };

  for (const t of linhas) {
    const c = pega(mesDe(t.data));
    const abs = Math.abs(Number(t.valor));

    if (ehReceita(t)) c.entrou += abs;
    if (!ehCustoOperacional(t)) continue;

    c.saiu += abs;
    if (t.categoria === CAT_IMPOSTOS) { c.impostosPagos += abs; continue; }
    if (t.categoria === CAT_ANUNCIOS) { c.anunciosPagos += abs; continue; }
    c.custosPagos += abs;
  }
  return mapa;
}

/**
 * O Simples do mês: o que foi pago, ou uma estimativa dizendo que é estimativa.
 *
 * ── Por que uma média móvel e não a alíquota configurada ────────────────
 *
 * Medido em 01/09/2026, o percentual efetivo sobe com o faturamento acumulado,
 * que é exatamente como a faixa do Simples funciona:
 *
 *     fev  5,64%    mar  6,65%    abr  6,43%    jun  8,16%    jul  7,26%
 *
 * Nenhum número fixo acerta uma série que anda. A configurada estava em 9%
 * (Alaskan) e 10% (Aeliss) — e como ela ainda incidia sobre a receita do mês
 * CORRENTE enquanto o pagamento é sobre o anterior, os dois erros se somavam:
 * agosto dava R$ 20.425 calculados contra R$ 8.486,88 pagos.
 *
 * ── Por que a média é PONDERADA ─────────────────────────────────────────
 *
 * A razão de um mês pequeno explode: janeiro deu 48%, porque R$ 3.754 pagos
 * caíram sobre uma receita de R$ 7.822 e cobriam mais do que aquele mês.
 * Somar pagamentos e receitas antes de dividir resolve sozinho, sem piso
 * arbitrário e sem lista de exceção:
 *
 *     média simples de jan e fev    (48,00 + 5,64) / 2  = 26,82%
 *     ponderada                     6.621,77 / 58.694,77 = 11,28%
 *
 * ── Meses sem pagamento nenhum ──────────────────────────────────────────
 *
 * Junho/2026 não teve nenhum lançamento de imposto. Isso acontece com mês
 * fechado, não só com o mês corrente — então a busca pula meses vazios em vez
 * de assumir que os dois anteriores servem.
 *
 * O pagamento de um mês é sobre a receita do mês ANTERIOR: é a base legal do
 * Simples, e é por isso que a razão usa `fatBruto` do mês anterior ao do
 * pagamento, tanto para medir quanto para aplicar.
 */
export function simplesDoMes(
  mes: string,
  caixa: Map<string, Caixa>,
  competencia: Map<string, Competencia>,
  historicoDeMeses: string[],
): Simples {
  const pago = caixa.get(mes)?.impostosPagos ?? 0;
  if (pago > 0) return { valor: pago, presumido: false, pct: null, baseMeses: [] };

  /* Os dois meses mais recentes ANTES deste que tiveram pagamento e que têm
     receita conhecida no mês anterior a eles — sem os dois lados a razão não
     significa nada. */
  const anteriores = historicoDeMeses.filter(m => m < mes).reverse();
  const base: string[] = [];
  let somaPago = 0;
  let somaReceita = 0;

  for (const m of anteriores) {
    if (base.length === 2) break;
    const p = caixa.get(m)?.impostosPagos ?? 0;
    const r = competencia.get(mesAnterior(m))?.fatBruto ?? 0;
    if (p <= 0 || r <= 0) continue;
    base.unshift(m);
    somaPago += p;
    somaReceita += r;
  }

  if (base.length === 0 || somaReceita <= 0) {
    return { valor: 0, presumido: true, pct: null, baseMeses: [] };
  }

  const pct = somaPago / somaReceita;
  const receitaBase = competencia.get(mesAnterior(mes))?.fatBruto ?? 0;
  return { valor: pct * receitaBase, presumido: true, pct: pct * 100, baseMeses: base };
}

export interface Resultado {
  mes: string;
  fatBruto: number;
  taxaPayt: number;
  reembolsos: number;
  investMeta: number;
  impostoMeta: number;
  simples: Simples;
  custosPagos: number;
  resultado: number;
  margem: number;
  /** O mesmo mês em caixa puro, para a tira de conciliação. */
  caixaEntrou: number;
  caixaSaiu: number;
  /**
   * O mês teve fatura de anúncio no cartão e NENHUM dado do Meta — então a
   * maior saída está faltando na cascata e o resultado é ficção.
   *
   * Não é hipótese: `metricas_meta` só começa em 01/05/2026, e março e abril
   * daquele ano têm R$ 62.000 e R$ 43.686 pagos no cartão sem uma linha de
   * métrica. Sem esta bandeira, abril aparecia com 65,6% de margem.
   *
   * É literalmente o defeito que derrubou o Fechamento antigo — a maior saída
   * fora da conta, e a margem parecendo ótima —, e ele voltaria por outra porta.
   * A bandeira é DERIVADA (extrato tem anúncio, Meta não tem), então nasce e
   * morre sozinha conforme a base ganha ou perde cobertura: nenhuma data fixa
   * no código para envelhecer.
   */
  semDadosDeAnuncio: boolean;
}

export function montarResultado(
  mes: string,
  competencia: Map<string, Competencia>,
  caixa: Map<string, Caixa>,
  historicoDeMeses: string[],
): Resultado {
  const c = competencia.get(mes)
    ?? { fatBruto: 0, taxaPayt: 0, reembolsos: 0, investMeta: 0, impostoMeta: 0 };
  const k = caixa.get(mes)
    ?? { impostosPagos: 0, anunciosPagos: 0, custosPagos: 0, entrou: 0, saiu: 0 };
  const simples = simplesDoMes(mes, caixa, competencia, historicoDeMeses);

  const resultado =
    c.fatBruto - c.taxaPayt - c.reembolsos
    - c.investMeta - c.impostoMeta
    - simples.valor - k.custosPagos;

  return {
    mes,
    fatBruto: c.fatBruto,
    taxaPayt: c.taxaPayt,
    reembolsos: c.reembolsos,
    investMeta: c.investMeta,
    impostoMeta: c.impostoMeta,
    simples,
    custosPagos: k.custosPagos,
    resultado,
    margem: c.fatBruto > 0 ? (resultado / c.fatBruto) * 100 : 0,
    caixaEntrou: k.entrou,
    caixaSaiu: k.saiu,
    semDadosDeAnuncio: c.investMeta === 0 && k.anunciosPagos > 0,
  };
}
