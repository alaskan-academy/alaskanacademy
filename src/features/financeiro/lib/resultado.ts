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
 * `receita` é o que vale para PERFORMANCE: é ela o denominador da margem e de
 * todo percentual da tela. É a mesma convenção de `vw_faturamento_liquido` e a
 * do `/resumo`, que mostra "Pago pelos clientes", desconta os juros e chama o
 * resto de "Receita". Uma versão antiga desta tela usou o valor COM juros como
 * denominador dos percentuais; nada dava erro, o número só ficava maior do que
 * a empresa faturou.
 *
 * ── E por que o IMPOSTO não sai dela ────────────────────────────────────
 *
 * "Quanto a empresa faturou" e "sobre quanto o fisco cobra" são perguntas
 * diferentes, com respostas diferentes — por isso `baseSimples` existe ao lado
 * de `receita`. A contabilidade confirmou em 17/09/2026: o Simples incide
 * sobre o montante BRUTO, juros do parcelamento inclusos. A empresa paga
 * imposto sobre dinheiro que nunca viu. Desagradável, e verdade.
 *
 * Isto derruba o parágrafo que estava aqui até 17/09/2026, que dizia que o
 * Simples incidia sobre a receita e chamava de defeito os ~R$ 408 a mais que
 * agosto dava. Aqueles R$ 408 eram devidos. Fica escrito porque a versão
 * anterior era plausível — e alguém vai querer "consertar" isto de volta.
 *
 * O número vem de `vw_faturamento_liquido.base_simples`, e não de
 * `receita + juros` somado aqui: a regra mora num lugar só, senão as cópias
 * divergem. Ver a migração 20260917a.
 */
export interface Simples {
  valor: number;
  presumido: boolean;
  /** Alíquota usada quando presumido. Nula quando o valor é pagamento real. */
  pct: number | null;
  /** Quais meses formaram a alíquota — para a tela poder mostrar e alguém conferir. */
  baseMeses: string[];
  /**
   * Quanto já saiu do extrato para o imposto DESTE mês, tenha ou não fechado
   * a conta. Existe porque o caso real não é "pago ou não pago": em 06/10
   * saíram R$ 575,54 de um DAS de setembro que vale ~R$ 14.934, e ela
   * resumiu assim — "este valor foi apenas uma parcela". Sem este campo a
   * tela só conseguiria dizer "presumido" e esconderia que parte já saiu.
   */
  pagoParcial: number;
  /** Dia 20 do mês seguinte, em `YYYY-MM-DD`. */
  vencimento: string;
  /** Já passou do vencimento e ainda não foi pago por inteiro. */
  emAtraso: boolean;
}

/**
 * Quando o DAS deste mês vence: **dia 20 do mês seguinte**.
 *
 * Regra dela, 12/10/2026: "Imposto é sempre pago no mês seguinte dia 20".
 * A mesma conta está em `vw_aliquota_simples_mes.vencimento`
 * (`20261012u`), e há teste exigindo que as duas não divirjam.
 */
export const mesDe = (data: string): string => data.slice(0, 7);

export function mesSeguinte(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

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
export interface Resultado {
  mes: string;
  pagoPelosClientes: number;
  perdaReembolso: number;
  perdaChargeback: number;
  /** As duas somadas — a linha que fecha o bloco de perdas. */
  perdas: number;
  coproducao: number;
  vendasSemDadoCoproducao: number;
  vendas: number;
  juros: number;
  receita: number;
  taxaPayt: number;
  investMeta: number;
  impostoMeta: number;
  simples: Simples;
  custosPagos: number;
  resultado: number;
  margem: number;
  /**
   * Taxa da Payt + imposto sobre o anúncio + Simples.
   *
   * Existe porque a soma responde uma pergunta que nenhuma das três responde
   * sozinha: quanto da receita vai embora antes de a operação começar. Em
   * agosto/2026 foram R$ 44.329,89 — 22,3% da receita, mais que o dobro do
   * resultado do mês.
   *
   * Reembolso fica FORA: não é taxa nem imposto, é venda que voltou atrás.
   * Somá-lo aqui inflaria o indicador com uma grandeza de outra natureza, e a
   * pessoa que olhasse "22,3% de imposto e taxa" estaria lendo errado.
   */
  impostosETaxas: number;
  /** Saldo corrente logo após o bloco de impostos e taxas. */
  sobraAposImpostos: number;
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

