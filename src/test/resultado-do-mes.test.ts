/**
 * A cascata do Resultado do mês.
 *
 * Os casos aqui são os que a base real tinha em 01/09/2026 — não hipóteses:
 * junho sem pagamento nenhum de imposto, janeiro com razão de 48% por causa de
 * uma receita minúscula, e a fatura do cartão da Meta dentro dos custos do
 * extrato esperando para ser contada duas vezes.
 */
import { describe, it, expect } from 'vitest';
import {
  agruparCaixa, simplesDoMes, montarResultado, janelaDeMeses,
  mesAnterior, mesSeguinte,
  type Competencia, type LinhaTransacao,
} from '@/features/financeiro/lib/resultado';

/** Atalho dos testes: o valor passado e a RECEITA (sem juros), que e a base de
 *  tudo. `pagoPelosClientes` so e exibido, entao os casos aqui o deixam igual a
 *  receita, menos onde o juros e o proprio assunto. */
const comp = (receita: number, resto: Partial<Competencia> = {}): Competencia => ({
  pagoPelosClientes: receita, juros: 0, receita,
  taxaPayt: 0, reembolsos: 0, investMeta: 0, impostoMeta: 0, ...resto,
});

describe('janela de meses', () => {
  it('vira o ano nos dois sentidos', () => {
    expect(mesAnterior('2026-01')).toBe('2025-12');
    expect(mesSeguinte('2026-12')).toBe('2027-01');
    expect(janelaDeMeses('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('agrupamento do extrato', () => {
  const linhas: LinhaTransacao[] = [
    { data: '2026-08-05', valor: -50_000, categoria: 'Anúncios (Facebook ADs)' },
    { data: '2026-08-20', valor:  -8_486, categoria: 'Impostos e Tributos' },
    { data: '2026-08-10', valor:  -1_200, categoria: 'Aplicativos e Ferramentas' },
    { data: '2026-08-11', valor:  -2_000, categoria: 'Retirada de Lucro' },
    { data: '2026-08-15', valor:  -3_500, categoria: 'Pró-labore' },
    { data: '2026-08-12', valor: -10_000, categoria: 'Reserva de Caixa' },
    { data: '2026-08-13', valor:  30_000, categoria: 'Produtos' },
    { data: '2026-08-14', valor:  10_000, categoria: 'Retirada do Caixa' },
  ];
  const caixa = agruparCaixa(linhas);
  const ago = caixa.get('2026-08')!;

  it('tira anúncio dos custos — a linha do Meta já o representa', () => {
    expect(ago.custosPagos).toBe(1_200);
  });

  it('tira imposto dos custos e o guarda em separado', () => {
    expect(ago.impostosPagos).toBe(8_486);
  });

  it('soma as retiradas de sócio, que `ehCustoOperacional` recusa', () => {
    // 2.000 de retirada de lucro + 3.500 de pró-labore
    expect(ago.retiradasSocios).toBe(5_500);
    // e elas não vazam para os custos operacionais
    expect(ago.custosPagos).toBe(1_200);
  });

  it('não conta retirada de sócio nem transferência entre contas próprias na saída de caixa', () => {
    // 50.000 + 8.486 + 1.200, sem os 5.500 de sócio e sem os 10.000 de reserva.
    expect(ago.saiu).toBe(59_686);
  });

  it('não conta a volta da reserva como receita', () => {
    expect(ago.entrou).toBe(30_000);
  });

  it('aporte de sócio não vira receita nem reduz retirada', () => {
    const comAporte = agruparCaixa([
      ...linhas,
      { data: '2026-08-18', valor: 2_000, categoria: 'Aporte de Sócio' },
    ]).get('2026-08')!;
    expect(comAporte.retiradasSocios).toBe(5_500);
    expect(comAporte.entrou).toBe(30_000);
  });
});

describe('o Simples do mês', () => {
  /* A série real. O pagamento de um mês cobre a receita do mês ANTERIOR, então
     o imposto de julho sai em agosto. Junho não teve pagamento nenhum — o que
     deixa MAIO sem valor real. */
  const competencia = new Map<string, Competencia>([
    ['2025-12', comp(20_000)],
    ['2026-01', comp(7_822.19)],
    ['2026-02', comp(50_872.58)],
    ['2026-03', comp(90_415.70)],
    ['2026-04', comp(73_569.72)],
    ['2026-05', comp(105_902.65)],
    ['2026-06', comp(58_281.43)],
    ['2026-07', comp(116_968.43)],
    ['2026-08', comp(204_254.92)],
  ]);
  const pagamentos: LinhaTransacao[] = [
    { data: '2026-02-20', valor: -3_754.71, categoria: 'Impostos e Tributos' },
    { data: '2026-03-20', valor: -2_867.06, categoria: 'Impostos e Tributos' },
    { data: '2026-04-20', valor: -6_014.57, categoria: 'Impostos e Tributos' },
    { data: '2026-05-20', valor: -4_729.02, categoria: 'Impostos e Tributos' },
    // junho: nada — logo MAIO fica sem imposto pago
    { data: '2026-07-20', valor: -4_756.25, categoria: 'Impostos e Tributos' },
    { data: '2026-08-20', valor: -8_486.88, categoria: 'Impostos e Tributos' },
  ];
  const caixa = agruparCaixa(pagamentos);
  const meses = janelaDeMeses('2026-09', 14);

  it('o imposto do mês é o pago no mês SEGUINTE, não o pago dentro dele', () => {
    // Julho: R$ 8.486,88 saiu em agosto. O que saiu em julho (4.756,25) é de junho.
    const jul = simplesDoMes('2026-07', caixa, competencia, meses);
    expect(jul.presumido).toBe(false);
    expect(jul.valor).toBe(8_486.88);

    const jun = simplesDoMes('2026-06', caixa, competencia, meses);
    expect(jun.valor).toBe(4_756.25);
  });

  it('agosto fica PREVISTO: só vence em setembro', () => {
    const s = simplesDoMes('2026-08', caixa, competencia, meses);
    expect(s.presumido).toBe(true);
    // (4.756,25 + 8.486,88) / (58.281,43 + 116.968,43) = 7,5567%
    expect(s.pct).toBeCloseTo(7.5567, 3);
    expect(s.baseMeses).toEqual(['2026-06', '2026-07']);
    // e incide sobre a receita de AGOSTO, não sobre a de julho
    expect(s.valor).toBeCloseTo(204_254.92 * 0.075567, 0);
  });

  it('pula o mês sem pagamento em vez de deixá-lo zerar a média', () => {
    // Maio não tem imposto pago (junho não pagou nada), então cai na estimativa
    // e a base precisa saltar por cima dele.
    const s = simplesDoMes('2026-05', caixa, competencia, meses);
    expect(s.presumido).toBe(true);
    expect(s.baseMeses).toEqual(['2026-03', '2026-04']);
  });

  it('a ponderação impede o mês pequeno de explodir a alíquota', () => {
    /* O 48% real é o imposto de JANEIRO (R$ 3.754,71, pago em fevereiro) sobre
       uma receita de R$ 7.822,19 — pequena demais para a razão significar algo.
       Aqui só jan e fev têm imposto pago, e março pergunta. */
    const soPequenos = agruparCaixa(pagamentos.filter(p => p.data < '2026-04'));
    const s = simplesDoMes('2026-03', soPequenos, competencia, meses);

    expect(s.presumido).toBe(true);
    expect(s.baseMeses).toEqual(['2026-01', '2026-02']);
    // média simples de 48,00% e 5,64% daria 26,8%; a ponderada dá 11,28%
    // (3.754,71 + 2.867,06) / (7.822,19 + 50.872,58)
    expect(s.pct).toBeCloseTo(11.2818, 3);
  });

  it('sem nenhuma base, devolve zero dizendo que é previsto — não inventa alíquota', () => {
    const s = simplesDoMes('2025-12', caixa, competencia, meses);
    expect(s.presumido).toBe(true);
    expect(s.pct).toBeNull();
    expect(s.valor).toBe(0);
  });
});

describe('a cascata', () => {
  const competencia = new Map<string, Competencia>([
    ['2026-07', comp(116_968.43)],
    ['2026-08', comp(204_254.92, {
      taxaPayt: 10_000, reembolsos: 2_000, investMeta: 60_000, impostoMeta: 8_400,
    })],
  ]);
  const caixa = agruparCaixa([
    { data: '2026-08-05', valor: -55_000, categoria: 'Anúncios (Facebook ADs)' },
    { data: '2026-09-20', valor:  -9_000, categoria: 'Impostos e Tributos' },
    { data: '2026-08-10', valor:  -1_200, categoria: 'Aplicativos e Ferramentas' },
    { data: '2026-08-11', valor:  -7_000, categoria: 'Retirada de Lucro' },
  ]);
  const r = montarResultado('2026-08', competencia, caixa, janelaDeMeses('2026-08', 12));

  it('não conta o anúncio duas vezes', () => {
    // A fatura de R$ 55.000 do extrato NÃO entra; quem representa anúncio é o
    // investimento de R$ 60.000 vindo do Meta.
    expect(r.custosPagos).toBe(1_200);
    expect(r.investMeta).toBe(60_000);
  });

  it('usa o imposto pago em setembro, que é o de agosto', () => {
    expect(r.simples.presumido).toBe(false);
    expect(r.simples.valor).toBe(9_000);
  });

  it('desce de faturamento a resultado subtraindo cada linha uma vez', () => {
    // 204.254,92 − 10.000 − 2.000 − 60.000 − 8.400 − 9.000 − 1.200
    expect(r.resultado).toBeCloseTo(113_654.92, 2);
  });

  it('a retirada de sócio fica FORA do resultado e entra depois dele', () => {
    expect(r.retiradasSocios).toBe(7_000);
    expect(r.sobrouDepoisDasRetiradas).toBeCloseTo(113_654.92 - 7_000, 2);
    // a margem não muda com o que os sócios sacaram
    expect(r.margem).toBeCloseTo((113_654.92 / 204_254.92) * 100, 2);
  });

  it('mês sem nada não quebra e não divide por zero', () => {
    const vazio = montarResultado('2026-01', new Map(), new Map(), ['2026-01']);
    expect(vazio.resultado).toBe(0);
    expect(vazio.margem).toBe(0);
    expect(vazio.sobrouDepoisDasRetiradas).toBe(0);
  });

  it('não marca falta de dado quando o Meta respondeu', () => {
    expect(r.semDadosDeAnuncio).toBe(false);
  });
});

describe('a cadeia de saldos', () => {
  /* Agosto/2026 real. A cadeia so serve se os elos FECHAREM: cada saldo tem de
     ser o anterior menos o que foi deduzido no bloco. Um total decorativo, que
     nao bate com as parcelas acima dele, e pior que total nenhum. */
  const competencia = new Map<string, Competencia>([
    ['2026-07', comp(114_554.38)],
    ['2026-08', {
      pagoPelosClientes: 204_254.92, juros: 5_403.26, receita: 198_851.66,
      taxaPayt: 12_380.57, reembolsos: 2_815.24,
      investMeta: 118_939.04, impostoMeta: 16_651.48,
    }],
  ]);
  const caixa = agruparCaixa([
    { data: '2026-08-10', valor: -12_372.86, categoria: 'Aplicativos e Ferramentas' },
    { data: '2026-08-11', valor:  -9_000.00, categoria: 'Retirada de Lucro' },
    { data: '2026-07-20', valor:  -8_486.88, categoria: 'Impostos e Tributos' },
  ]);
  const r = montarResultado('2026-08', competencia, caixa, janelaDeMeses('2026-08', 12));

  it('pago menos juros da a receita', () => {
    expect(r.pagoPelosClientes - r.juros).toBeCloseTo(r.receita, 2);
  });

  it('impostos e taxas soma as TRES parcelas, e nada mais', () => {
    expect(r.impostosETaxas)
      .toBeCloseTo(r.taxaPayt + r.impostoMeta + r.simples.valor, 2);
  });

  it('reembolso NAO entra em impostos e taxas', () => {
    // Se entrasse, o indicador misturaria venda que voltou atras com tributo.
    expect(r.impostosETaxas).not.toBeCloseTo(
      r.taxaPayt + r.impostoMeta + r.simples.valor + r.reembolsos, 2);
    expect(r.reembolsos).toBeGreaterThan(0);
  });

  it('receita menos impostos e taxas da a sobra', () => {
    expect(r.receita - r.impostosETaxas).toBeCloseTo(r.sobraAposImpostos, 2);
  });

  it('a sobra menos o bloco de operacao da o resultado', () => {
    expect(r.sobraAposImpostos - r.reembolsos - r.investMeta - r.custosPagos)
      .toBeCloseTo(r.resultado, 2);
  });

  it('o resultado menos as retiradas fecha a cadeia', () => {
    expect(r.resultado - r.retiradasSocios).toBeCloseTo(r.sobrouDepoisDasRetiradas, 2);
  });
});

describe('os juros de parcelamento', () => {
  /* Agosto/2026 real: o cliente pagou R$ 204.254,92 e a empresa faturou
     R$ 198.851,66. Os R$ 5.403,26 de diferença sao da adquirente, e a serie
     cresce com o parcelamento: 547,88 em maio, 2.414,05 em julho. */
  const competencia = new Map<string, Competencia>([
    ['2026-07', comp(114_554.38)],
    ['2026-08', {
      pagoPelosClientes: 204_254.92, juros: 5_403.26, receita: 198_851.66,
      taxaPayt: 12_380.57, reembolsos: 2_815.24,
      investMeta: 118_939.04, impostoMeta: 16_651.48,
    }],
  ]);
  const caixa = agruparCaixa([
    { data: '2026-08-10', valor: -12_372.86, categoria: 'Aplicativos e Ferramentas' },
    { data: '2026-07-20', valor:  -8_486.88, categoria: 'Impostos e Tributos' },
  ]);
  const r = montarResultado('2026-08', competencia, caixa, janelaDeMeses('2026-08', 12));

  it('nao entram no resultado: nunca foram da operacao', () => {
    // 198.851,66 (e nao 204.254,92) menos cada linha
    const semImposto = 198_851.66 - 12_380.57 - 2_815.24 - 118_939.04 - 16_651.48 - 12_372.86;
    expect(r.resultado).toBeCloseTo(semImposto - r.simples.valor, 2);
  });

  it('a margem e sobre a receita, nao sobre o que o cliente pagou', () => {
    expect(r.margem).toBeCloseTo((r.resultado / 198_851.66) * 100, 6);
    // se fosse sobre o pago, daria menos — e a diferenca cresce com o parcelamento
    expect(r.margem).toBeGreaterThan((r.resultado / 204_254.92) * 100);
  });

  it('o imposto estimado incide sobre a receita, nao sobre o pago', () => {
    expect(r.simples.presumido).toBe(true);
    const pct = r.simples.pct! / 100;
    expect(r.simples.valor).toBeCloseTo(198_851.66 * pct, 2);
    // a diferenca que o defeito causava: imposto sobre dinheiro da adquirente
    expect(204_254.92 * pct - r.simples.valor).toBeCloseTo(5_403.26 * pct, 2);
  });

  it('os dois valores continuam visiveis, para ninguem perder o de cima', () => {
    expect(r.pagoPelosClientes).toBe(204_254.92);
    expect(r.juros).toBe(5_403.26);
    expect(r.pagoPelosClientes - r.juros).toBeCloseTo(r.receita, 2);
  });
});

describe('mês sem dado do Meta', () => {
  /* Abril/2026, real: R$ 43.685,98 de anúncio pagos no cartão e NENHUMA linha
     em `metricas_meta`, que só começa em 01/05/2026. Sem a bandeira, a tela
     mostrava 65,6% de margem — o mesmo defeito que derrubou o Fechamento. */
  const competencia = new Map<string, Competencia>([['2026-04', comp(73_569.72)]]);
  const caixa = agruparCaixa([
    { data: '2026-04-10', valor: -43_685.98, categoria: 'Anúncios (Facebook ADs)' },
    { data: '2026-05-20', valor:  -4_729.02, categoria: 'Impostos e Tributos' },
  ]);
  const r = montarResultado('2026-04', competencia, caixa, ['2026-04']);

  it('acusa que a maior saída está faltando', () => {
    expect(r.investMeta).toBe(0);
    expect(r.semDadosDeAnuncio).toBe(true);
  });

  it('a bandeira é derivada, não uma data escrita no código', () => {
    // O mesmo mês, sem fatura de anúncio no extrato, não acusa nada: não há o
    // que faltar. É isso que faz a bandeira sumir sozinha quando a base ganhar
    // cobertura, em vez de precisar de manutenção.
    const semAnuncio = agruparCaixa([
      { data: '2026-05-20', valor: -4_729.02, categoria: 'Impostos e Tributos' },
    ]);
    expect(montarResultado('2026-04', competencia, semAnuncio, ['2026-04']).semDadosDeAnuncio)
      .toBe(false);
  });
});
