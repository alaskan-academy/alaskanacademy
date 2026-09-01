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

import {
  ehCustoOperacional, ehReceita, CAT_ANUNCIOS, CAT_IMPOSTOS, CAT_SOCIOS,
} from '../constants';

export interface LinhaTransacao {
  data: string;
  valor: number;
  categoria: string | null;
}

/**
 * O que a Payt e o Meta dizem sobre o mês. Um registro por mês `yyyy-MM`.
 *
 * ── Por que existem TRÊS valores de faturamento ─────────────────────────
 *
 * O cliente paga R$ 204.254,92; a empresa fatura R$ 198.851,66. A diferença
 * são os juros de parcelamento — dinheiro que o comprador paga à adquirente
 * pelo crédito, e que nunca foi da operação. Em agosto/2026 foram R$ 5.403,26,
 * e a série cresce: 547,88 em maio, 692,64 em junho, 2.414,05 em julho.
 *
 * `receita` é o que vale para conta: é sobre ela que o Simples incide, e é ela
 * o denominador da margem e de todo percentual da tela. É a mesma convenção de
 * `vw_faturamento_liquido`, que usa `receita_tributavel` em TODOS os cálculos
 * e só exibe o bruto, e a do `/resumo`, que mostra "Pago pelos clientes",
 * desconta os juros e chama o resto de "Receita".
 *
 * A primeira versão desta tela usou o valor COM juros como base do imposto e
 * como denominador dos percentuais. Nada dava erro — o número só ficava maior
 * do que a empresa faturou, e a estimativa de Simples cobrava imposto sobre
 * dinheiro da adquirente: ~R$ 408 a mais só em agosto.
 */
export interface Competencia {
  /** `valor_total`: o que saiu do bolso do cliente, juros inclusos. Só exibido. */
  pagoPelosClientes: number;
  juros: number;
  /** `receita_tributavel`. É esta que a conta usa, do imposto à margem. */
  receita: number;
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
  /**
   * Pró-labore, retirada de lucro e afins — o que os sócios tiraram no mês.
   *
   * `ehCustoOperacional` exclui essas categorias de propósito, e está certo:
   * retirada não é custo da operação, é distribuição do que ela produziu. Por
   * isso a linha aparece DEPOIS do resultado operacional, e não dentro dele —
   * senão a margem do mês passaria a depender de quanto os sócios sacaram.
   *
   * Só as SAÍDAS. Aporte é capital entrando, não receita: ele tem lugar no DRE
   * do Caixa, abaixo do resultado, e entrar aqui inflaria o mês.
   */
  retiradasSocios: number;
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

export function mesSeguinte(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
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
      c = { impostosPagos: 0, anunciosPagos: 0, retiradasSocios: 0, custosPagos: 0, entrou: 0, saiu: 0 };
      mapa.set(mes, c);
    }
    return c;
  };

  for (const t of linhas) {
    const c = pega(mesDe(t.data));
    const abs = Math.abs(Number(t.valor));

    if (ehReceita(t)) c.entrou += abs;

    /* Retirada de sócio: saída que `ehCustoOperacional` recusa de propósito.
       Precisa ser somada ANTES do `continue` dele, senão nunca é vista. */
    if (t.valor < 0 && (CAT_SOCIOS as readonly string[]).includes(t.categoria ?? '')) {
      c.retiradasSocios += abs;
      continue;
    }

    if (!ehCustoOperacional(t)) continue;

    c.saiu += abs;
    if (t.categoria === CAT_IMPOSTOS) { c.impostosPagos += abs; continue; }
    if (t.categoria === CAT_ANUNCIOS) { c.anunciosPagos += abs; continue; }
    c.custosPagos += abs;
  }
  return mapa;
}

/**
 * O imposto que ESTE mês gerou — não o que foi pago dentro dele.
 *
 * ── A diferença, e por que ela importa ──────────────────────────────────
 *
 * O Simples de um mês é pago no mês SEGUINTE. Havia duas leituras possíveis:
 *
 *   (a) o pagamento que saiu no mês   → agosto mostraria R$ 8.486,88, que é o
 *                                       imposto de JULHO
 *   (b) o imposto que a receita do mês gerou → agosto mostra o que a receita de
 *                                       agosto deve, pago ou não
 *
 * A (a) foi a primeira versão e está errada para "quanto sobrou este mês": num
 * negócio que cresce, cada mês é debitado com o imposto de um mês menor, e
 * TODO mês parece melhor do que foi. Agosto faturou R$ 204.254,92 e carregava
 * o imposto de julho, que faturou R$ 116.968,43 — quase metade.
 *
 * Agora é a (b): procura o pagamento no mês seguinte e, se ele ainda não
 * existe, presume. Como efeito colateral bom, o mês corrente para de nascer
 * com o imposto inteiro do mês anterior no dia 1 — a estimativa acompanha a
 * receita que for entrando.
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
 * Junho/2026 não teve nenhum lançamento de imposto — então maio, cujo imposto
 * sairia ali, fica sem valor real e cai na estimativa. Isso acontece com mês
 * FECHADO, não só com o corrente, e por isso a busca pula os vazios em vez de
 * assumir que os dois anteriores servem.
 *
 * `baseMeses` nomeia os meses da RECEITA que formaram a alíquota, não os do
 * pagamento: é sobre a receita que a tela vai falar com quem lê.
 */
export function simplesDoMes(
  mes: string,
  caixa: Map<string, Caixa>,
  competencia: Map<string, Competencia>,
  historicoDeMeses: string[],
): Simples {
  /* O imposto DESTE mês sai no mês seguinte. Se já saiu, é fato e acabou. */
  const pago = caixa.get(mesSeguinte(mes))?.impostosPagos ?? 0;
  if (pago > 0) return { valor: pago, presumido: false, pct: null, baseMeses: [] };

  /* Senão, a alíquota vem dos dois meses de receita mais recentes cujo imposto
     JÁ saiu — precisa dos dois lados do par, senão a razão não significa nada. */
  const anteriores = historicoDeMeses.filter(m => m < mes).reverse();
  const base: string[] = [];
  let somaPago = 0;
  let somaReceita = 0;

  for (const m of anteriores) {
    if (base.length === 2) break;
    const p = caixa.get(mesSeguinte(m))?.impostosPagos ?? 0;
    const r = competencia.get(m)?.receita ?? 0;
    if (p <= 0 || r <= 0) continue;
    base.unshift(m);
    somaPago += p;
    somaReceita += r;
  }

  if (base.length === 0 || somaReceita <= 0) {
    return { valor: 0, presumido: true, pct: null, baseMeses: [] };
  }

  const pct = somaPago / somaReceita;
  const receitaBase = competencia.get(mes)?.receita ?? 0;
  return { valor: pct * receitaBase, presumido: true, pct: pct * 100, baseMeses: base };
}

export interface Resultado {
  mes: string;
  pagoPelosClientes: number;
  juros: number;
  receita: number;
  taxaPayt: number;
  reembolsos: number;
  investMeta: number;
  impostoMeta: number;
  simples: Simples;
  custosPagos: number;
  resultado: number;
  margem: number;
  retiradasSocios: number;
  /** O que sobrou DEPOIS de os sócios tirarem. Ver `Caixa.retiradasSocios`. */
  sobrouDepoisDasRetiradas: number;
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
    ?? { pagoPelosClientes: 0, juros: 0, receita: 0,
         taxaPayt: 0, reembolsos: 0, investMeta: 0, impostoMeta: 0 };
  const k = caixa.get(mes)
    ?? { impostosPagos: 0, anunciosPagos: 0, retiradasSocios: 0, custosPagos: 0, entrou: 0, saiu: 0 };
  const simples = simplesDoMes(mes, caixa, competencia, historicoDeMeses);

  /* Parte da RECEITA, não do que o cliente pagou: os juros já são da
     adquirente antes de a empresa ver o dinheiro. */
  const resultado =
    c.receita - c.taxaPayt - c.reembolsos
    - c.investMeta - c.impostoMeta
    - simples.valor - k.custosPagos;

  return {
    mes,
    pagoPelosClientes: c.pagoPelosClientes,
    juros: c.juros,
    receita: c.receita,
    taxaPayt: c.taxaPayt,
    reembolsos: c.reembolsos,
    investMeta: c.investMeta,
    impostoMeta: c.impostoMeta,
    simples,
    custosPagos: k.custosPagos,
    resultado,
    margem: c.receita > 0 ? (resultado / c.receita) * 100 : 0,
    retiradasSocios: k.retiradasSocios,
    sobrouDepoisDasRetiradas: resultado - k.retiradasSocios,
    caixaEntrou: k.entrou,
    caixaSaiu: k.saiu,
    semDadosDeAnuncio: c.investMeta === 0 && k.anunciosPagos > 0,
  };
}
