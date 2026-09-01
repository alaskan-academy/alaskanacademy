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
  agruparCaixa, simplesDoMes, montarResultado, janelaDeMeses, mesAnterior,
  type Competencia, type LinhaTransacao,
} from '@/features/financeiro/lib/resultado';

const comp = (fatBruto: number, resto: Partial<Competencia> = {}): Competencia => ({
  fatBruto, taxaPayt: 0, reembolsos: 0, investMeta: 0, impostoMeta: 0, ...resto,
});

describe('janela de meses', () => {
  it('vira o ano para trás', () => {
    expect(mesAnterior('2026-01')).toBe('2025-12');
    expect(janelaDeMeses('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('agrupamento do extrato', () => {
  const linhas: LinhaTransacao[] = [
    { data: '2026-08-05', valor: -50_000, categoria: 'Anúncios (Facebook ADs)' },
    { data: '2026-08-20', valor:  -8_486, categoria: 'Impostos e Tributos' },
    { data: '2026-08-10', valor:  -1_200, categoria: 'Aplicativos e Ferramentas' },
    { data: '2026-08-11', valor:  -2_000, categoria: 'Retirada de Lucro' },
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

  it('não conta retirada de sócio nem transferência entre contas próprias', () => {
    // 50.000 + 8.486 + 1.200, sem os 2.000 de sócio e sem os 10.000 de reserva.
    expect(ago.saiu).toBe(59_686);
  });

  it('não conta a volta da reserva como receita', () => {
    expect(ago.entrou).toBe(30_000);
  });
});

describe('o Simples do mês', () => {
  /* A série real: junho sem pagamento, e janeiro com receita pequena demais
     para a sua própria razão significar alguma coisa. */
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
    // junho: nada
    { data: '2026-07-20', valor: -4_756.25, categoria: 'Impostos e Tributos' },
    { data: '2026-08-20', valor: -8_486.88, categoria: 'Impostos e Tributos' },
  ];
  const caixa = agruparCaixa(pagamentos);
  const meses = janelaDeMeses('2026-09', 12);

  it('usa o pagamento quando ele existe, sem estimar nada', () => {
    const s = simplesDoMes('2026-08', caixa, competencia, meses);
    expect(s.presumido).toBe(false);
    expect(s.valor).toBe(8_486.88);
    expect(s.pct).toBeNull();
  });

  it('presume quando o mês ainda não pagou, e diz que presumiu', () => {
    const s = simplesDoMes('2026-09', caixa, competencia, meses);
    expect(s.presumido).toBe(true);
    // (4.756,25 + 8.486,88) / (58.281,43 + 116.968,43) = 7,5567%
    expect(s.pct).toBeCloseTo(7.5567, 3);
    expect(s.baseMeses).toEqual(['2026-07', '2026-08']);
    // aplicado sobre a receita de agosto, que é a base legal do pagamento de setembro
    expect(s.valor).toBeCloseTo(204_254.92 * 0.075567, 0);
  });

  it('pula o mês sem pagamento em vez de deixá-lo zerar a média', () => {
    // Julho não pagou nada em junho; a base tem de saltar para maio e abril.
    const s = simplesDoMes('2026-06', caixa, competencia, meses);
    expect(s.baseMeses).toEqual(['2026-04', '2026-05']);
    expect(s.pct).toBeGreaterThan(0);
  });

  it('a ponderação impede o mês pequeno de explodir a alíquota', () => {
    /* O 48% real é o pagamento de FEVEREIRO (R$ 3.754,71) sobre a receita de
       JANEIRO (R$ 7.822,19) — um mês pequeno demais para a própria razão
       significar algo. Aqui só fevereiro e março pagaram, e abril pergunta. */
    const soPequenos = agruparCaixa(pagamentos.filter(p => p.data < '2026-04'));
    const s = simplesDoMes('2026-04', soPequenos, competencia, meses);

    expect(s.presumido).toBe(true);
    expect(s.baseMeses).toEqual(['2026-02', '2026-03']);
    // média simples de 48,00% e 5,64% daria 26,8%; a ponderada dá 11,28%
    // (3.754,71 + 2.867,06) / (7.822,19 + 50.872,58)
    expect(s.pct).toBeCloseTo(11.2818, 3);
  });

  it('sem nenhuma base, devolve zero dizendo que é presumido — não inventa alíquota', () => {
    const s = simplesDoMes('2026-01', caixa, competencia, meses);
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
    { data: '2026-08-20', valor:  -8_486.88, categoria: 'Impostos e Tributos' },
    { data: '2026-08-10', valor:  -1_200, categoria: 'Aplicativos e Ferramentas' },
  ]);
  const r = montarResultado('2026-08', competencia, caixa, janelaDeMeses('2026-08', 12));

  it('não conta o anúncio duas vezes', () => {
    // A fatura de R$ 55.000 do extrato NÃO entra; quem representa anúncio é o
    // investimento de R$ 60.000 vindo do Meta.
    expect(r.custosPagos).toBe(1_200);
    expect(r.investMeta).toBe(60_000);
  });

  it('desce de faturamento a resultado subtraindo cada linha uma vez', () => {
    // 204.254,92 − 10.000 − 2.000 − 60.000 − 8.400 − 8.486,88 − 1.200
    expect(r.resultado).toBeCloseTo(114_168.04, 2);
  });

  it('a margem é sobre o faturamento da Payt, não sobre o que entrou na conta', () => {
    expect(r.margem).toBeCloseTo((114_168.04 / 204_254.92) * 100, 2);
  });

  it('mês sem nada não quebra e não divide por zero', () => {
    const vazio = montarResultado('2026-01', new Map(), new Map(), ['2026-01']);
    expect(vazio.resultado).toBe(0);
    expect(vazio.margem).toBe(0);
  });

  it('não marca falta de dado quando o Meta respondeu', () => {
    expect(r.semDadosDeAnuncio).toBe(false);
  });
});

describe('mês sem dado do Meta', () => {
  /* Abril/2026, real: R$ 43.685,98 de anúncio pagos no cartão e NENHUMA linha
     em `metricas_meta`, que só começa em 01/05/2026. Sem a bandeira, a tela
     mostrava 65,6% de margem — o mesmo defeito que derrubou o Fechamento. */
  const competencia = new Map<string, Competencia>([['2026-04', comp(73_569.72)]]);
  const caixa = agruparCaixa([
    { data: '2026-04-10', valor: -43_685.98, categoria: 'Anúncios (Facebook ADs)' },
    { data: '2026-04-20', valor:  -6_014.57, categoria: 'Impostos e Tributos' },
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
      { data: '2026-04-20', valor: -6_014.57, categoria: 'Impostos e Tributos' },
    ]);
    expect(montarResultado('2026-04', competencia, semAnuncio, ['2026-04']).semDadosDeAnuncio)
      .toBe(false);
  });
});
