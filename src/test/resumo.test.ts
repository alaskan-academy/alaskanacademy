/**
 * As três contas do Resumo que dependem do recorte.
 *
 * Elas nunca tiveram teste porque moravam soltas dentro do `fetchData` da
 * página, e as três estavam erradas ao mesmo tempo. Cada bloco aqui embaixo
 * guarda um desses erros com o número real que ele produziu — teste que só diz
 * "não deu erro" não teria pego nenhum dos três, porque nenhum dos três dava
 * erro: davam número, com cara de número certo.
 */
import { describe, it, expect } from 'vitest';
import { impostoSobre, diasDoCustoFixo, lucroPorDia } from '@/lib/resumo';
import { calcularResultado } from '@/lib/financeiro';

describe('impostoSobre', () => {
  it('é o percentual sobre a base, e nada mais', () => {
    expect(impostoSobre(43_915.63, 12.5)).toBeCloseTo(5_489.45, 2);
    expect(impostoSobre(64_050.95, 10)).toBeCloseTo(6_405.095, 3);
  });

  it('base zero não gera imposto — é o segmento Back-end', () => {
    expect(impostoSobre(0, 12.5)).toBe(0);
  });

  /*
    A regressão do defeito real: a conta Saponaria, agosto de 2026.

    A tela ratear o imposto TOTAL do Meta pela participação da conta no
    faturamento dava R$ 4.687,18 sobre um gasto de R$ 43.915,63 — 10,67%, num
    rótulo que dizia 12,50%. R$ 802,27 de lucro a mais do que existe.
  */
  it('o imposto do Meta bate com o percentual do próprio rótulo', () => {
    const gasto = 43_915.63;
    const pct = 12.5;
    const imposto = impostoSobre(gasto, pct);

    expect(imposto).toBeCloseTo(5_489.45, 2);
    expect((imposto / gasto) * 100).toBeCloseTo(pct, 6);

    const rateadoPelaReceita = 4_687.18; // o que a tela mostrava
    expect(imposto - rateadoPelaReceita).toBeCloseTo(802.27, 2);
  });
});

describe('diasDoCustoFixo', () => {
  it('com filtro de data, é a extensão do filtro, inclusiva nas duas pontas', () => {
    expect(diasDoCustoFixo('2026-08-01', '2026-08-28', null, null)).toBe(28);
    expect(diasDoCustoFixo('2026-08-10', '2026-08-10', null, null)).toBe(1);
  });

  it('sem filtro, mede o que existe de venda em vez de chutar 30', () => {
    // Era este o defeito: "Todos" cobrava um mês de custo fixo sobre um ano de
    // histórico, e o comentário no código já admitia a aproximação ruim.
    expect(diasDoCustoFixo(undefined, undefined, '2026-01-01', '2026-08-28')).toBe(240);
  });

  it('o filtro tem preferência sobre o dado', () => {
    expect(diasDoCustoFixo('2026-08-01', '2026-08-07', '2026-01-01', '2026-08-28')).toBe(7);
  });

  it('sem filtro e sem venda, cai nos 30 dias — não há o que medir', () => {
    expect(diasDoCustoFixo(undefined, undefined, null, null)).toBe(30);
  });

  it('fim antes do começo não vira número negativo', () => {
    expect(diasDoCustoFixo('2026-08-28', '2026-08-01', null, null)).toBe(30);
  });
});

describe('lucroPorDia', () => {
  const dias = [
    { dia: '2026-08-01', faturamento: 10_000, vendas: 100, taxa: 600, investimento: 4_000 },
    { dia: '2026-08-02', faturamento: 0,      vendas: 0,   taxa: 0,   investimento: 3_000 },
    { dia: '2026-08-03', faturamento: 8_000,  vendas: 80,  taxa: 480, investimento: 2_000 },
  ];
  const opcoes = { simplesPct: 10, metaPct: 12.5, contarAds: true };

  it('o dia é receita menos taxa, Simples, imposto de mídia e a própria mídia', () => {
    const [d1] = lucroPorDia(dias, opcoes);
    // 10.000 − 600 − 1.000 − 500 − 4.000
    expect(d1.lucro).toBeCloseTo(3_900, 2);
  });

  /*
    O dia com gasto e sem venda é o motivo de tudo isto existir.

    Ele não aparecia no gráfico, porque a lista de dias saía das vendas. E a
    linha antiga não conseguiria mostrá-lo nem se ele aparecesse: era o
    faturamento vezes a margem do período, então dia sem faturamento dava lucro
    zero — nunca prejuízo.
  */
  it('dia com gasto e sem venda dá prejuízo, e não zero', () => {
    const [, d2] = lucroPorDia(dias, opcoes);
    expect(d2.lucro).toBeCloseTo(-3_375, 2); // −3.000 de mídia −375 de imposto
    expect(d2.lucro).toBeLessThan(0);
  });

  it('a soma dos dias é o lucro operacional do período', () => {
    const somaDias = lucroPorDia(dias, opcoes).reduce((s, d) => s + d.lucro, 0);

    const receita = dias.reduce((s, d) => s + d.faturamento, 0);
    const taxa = dias.reduce((s, d) => s + d.taxa, 0);
    const investimento = dias.reduce((s, d) => s + d.investimento, 0);

    const periodo = calcularResultado({
      receita,
      taxaPlataforma: taxa,
      impostoSimples: impostoSobre(receita, 10),
      impostoMeta: impostoSobre(investimento, 12.5),
      investimento,
      custoFixo: 0,
    });

    expect(somaDias).toBeCloseTo(periodo.lucroOperacional, 2);
  });

  it('no Back-end não há mídia, nem imposto sobre ela', () => {
    const [d1, d2] = lucroPorDia(dias, { ...opcoes, contarAds: false });
    expect(d1.lucro).toBeCloseTo(8_400, 2); // 10.000 − 600 − 1.000
    expect(d2.lucro).toBe(0);               // dia que era só gasto some do vermelho
    expect(d2.investimento).toBe(0);
  });

  it('o rótulo do eixo é dia/mês', () => {
    expect(lucroPorDia(dias, opcoes).map(d => d.rotulo)).toEqual(['01/08', '02/08', '03/08']);
  });

  it('lista vazia não quebra', () => {
    expect(lucroPorDia([], opcoes)).toEqual([]);
  });
});
