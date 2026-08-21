import { describe, it, expect } from 'vitest';
import {
  calcularResultado,
  ratearCustoFixo,
  participacao,
  ticketMedio,
  roas,
  cpa,
  taxaPlataformaPct,
} from '@/lib/financeiro';

describe('cascata do pago ao lucro', () => {
  it('desconta na ordem e fecha o lucro operacional', () => {
    const r = calcularResultado({
      receita: 1000,
      taxaPlataforma: 60,
      reembolsos: 40,
      impostoSimples: 100,
      impostoMeta: 50,
      investimento: 300,
      custoFixo: 200,
    });

    expect(r.lucroOperacional).toBe(450);
    expect(r.lucroComCustoFixo).toBe(250);
  });

  it('o faturamento líquido para na taxa e no Simples, sem tocar em ads', () => {
    const r = calcularResultado({
      receita: 1000,
      taxaPlataforma: 60,
      reembolsos: 40,
      impostoSimples: 100,
      impostoMeta: 50,
      investimento: 300,
      custoFixo: 200,
    });

    // 1000 − 60 − 100. Reembolso, imposto Meta e investimento ficam de fora.
    expect(r.faturamentoLiquido).toBe(840);
  });

  it('mede a margem sobre a receita, não sobre o pago pelo cliente', () => {
    const r = calcularResultado({
      receita: 1000,
      taxaPlataforma: 0,
      reembolsos: 0,
      impostoSimples: 0,
      impostoMeta: 0,
      investimento: 750,
      custoFixo: 0,
    });

    // Se o denominador fosse o pago (receita + juros), a margem sairia menor.
    expect(r.margemPct).toBe(25);
  });

  it('separa a margem antes e depois do custo fixo', () => {
    const r = calcularResultado({
      receita: 1000,
      taxaPlataforma: 0,
      reembolsos: 0,
      impostoSimples: 0,
      impostoMeta: 0,
      investimento: 0,
      custoFixo: 400,
    });

    expect(r.margemPct).toBe(100);
    expect(r.margemComCustoFixoPct).toBe(60);
  });

  it('deixa o prejuízo negativo em vez de zerar', () => {
    // O segmento Tráfego carrega 100% do investimento e só parte da receita, então
    // margem negativa é um estado real da tela — não pode virar zero no caminho.
    const r = calcularResultado({
      receita: 100,
      taxaPlataforma: 6,
      reembolsos: 0,
      impostoSimples: 10,
      impostoMeta: 12,
      investimento: 200,
      custoFixo: 30,
    });

    expect(r.lucroOperacional).toBe(-128);
    expect(r.lucroComCustoFixo).toBe(-158);
    expect(r.margemPct).toBe(-128);
  });

  it('devolve zero, e não NaN, quando não houve receita', () => {
    const r = calcularResultado({
      receita: 0,
      taxaPlataforma: 0,
      reembolsos: 0,
      impostoSimples: 0,
      impostoMeta: 0,
      investimento: 500,
      custoFixo: 100,
    });

    // O prejuízo continua real; só o percentual não tem base para existir.
    expect(r.lucroOperacional).toBe(-500);
    expect(r.margemPct).toBe(0);
    expect(Number.isNaN(r.margemPct)).toBe(false);
  });
});

describe('rateio do custo fixo', () => {
  it('divide o mês por 30 e multiplica pelos dias do período', () => {
    expect(ratearCustoFixo(24000, 30)).toBe(24000);
    expect(ratearCustoFixo(24000, 1)).toBe(800);
  });

  it('cobra mais que um mês cheio num período de 31 dias', () => {
    // Não é arredondamento errado: o filtro é livre e 31 dias custam 31 dias.
    expect(ratearCustoFixo(24000, 31)).toBe(24800);
  });

  it('não inventa custo sem custo cadastrado nem sem período', () => {
    expect(ratearCustoFixo(0, 30)).toBe(0);
    expect(ratearCustoFixo(24000, 0)).toBe(0);
    expect(ratearCustoFixo(24000, -5)).toBe(0);
  });
});

describe('participação do recorte no total', () => {
  it('devolve a fração quando há total', () => {
    expect(participacao(50, 200)).toBe(0.25);
  });

  it('nunca passa de 1', () => {
    // Blindagem contra defasagem entre as fontes: se o recorte vier maior que o
    // total, ratear por 1,3 criaria imposto que não existe.
    expect(participacao(300, 200)).toBe(1);
  });

  it('assume tudo quando não há denominador confiável', () => {
    // Devolver 0 aqui zeraria imposto e custo fixo, mostrando lucro onde não há.
    expect(participacao(100, 0)).toBe(1);
  });

  it('devolve zero quando não há nem parte nem total', () => {
    expect(participacao(0, 0)).toBe(0);
  });
});

describe('indicadores por venda', () => {
  it('calcula ticket, ROAS e CPA', () => {
    expect(ticketMedio(1000, 10)).toBe(100);
    expect(roas(1000, 500)).toBe(2);
    expect(cpa(500, 10)).toBe(50);
  });

  it('devolve zero em vez de dividir por zero', () => {
    expect(ticketMedio(1000, 0)).toBe(0);
    expect(roas(1000, 0)).toBe(0);
    expect(cpa(500, 0)).toBe(0);
    expect(Number.isFinite(roas(1000, 0))).toBe(true);
  });
});

describe('taxa da plataforma', () => {
  it('mede sobre a receita, não sobre o que o cliente pagou', () => {
    // Pago 1.100 (100 de juros), receita 1.000, taxa 60.
    // Sobre o pago daria 5,45% e a taxa pareceria menor que a cobrada.
    expect(taxaPlataformaPct(60, 1000)).toBe(6);
  });

  it('devolve zero sem receita', () => {
    expect(taxaPlataformaPct(60, 0)).toBe(0);
  });
});

describe('regressão: agosto/2026, 01 a 20', () => {
  // Retrato tirado de `fn_overview()` depois da conciliação com o export da Payt de
  // 20/08 — 18 dos 20 dias batendo ao centavo, e diferença zero nos totais depois de
  // descontar a venda que entrou após o export ser gerado.
  //
  // Serve de âncora: estes números vieram de dados reais e conferidos, então se uma
  // fórmula mudar de sentido eles param de fechar. Um dos valores existe justamente
  // porque já esteve errado — a taxa da Payt aparecia como 11,94% enquanto os juros
  // de parcelamento entravam na base.
  const agosto = {
    receita: 128236.46,
    taxaPlataforma: 7776.21,
    reembolsos: 594.0,
    impostoSimples: 12823.66,
    impostoMeta: 9193.15,
    investimento: 73545.06,
    custoFixo: ratearCustoFixo(24000, 20),
  };
  const vendasAprovadas = 1360;

  it('rateia o custo fixo de 20 dias', () => {
    expect(agosto.custoFixo).toBe(16000);
  });

  it('fecha o lucro e a margem do período', () => {
    const r = calcularResultado(agosto);

    expect(r.lucroOperacional).toBeCloseTo(24304.38, 2);
    expect(r.lucroComCustoFixo).toBeCloseTo(8304.38, 2);
    expect(r.margemPct).toBeCloseTo(18.9528, 3);
    expect(r.margemComCustoFixoPct).toBeCloseTo(6.4758, 3);
  });

  it('mostra o custo fixo consumindo dois terços do lucro', () => {
    // A margem cai de ~19% para ~6,5%. É a diferença que o hero da tela separa em
    // dois blocos, e a razão de ele existir.
    const r = calcularResultado(agosto);
    expect(r.margemComCustoFixoPct).toBeLessThan(r.margemPct / 2);
  });

  it('mantém a taxa da Payt na faixa real, longe dos 11,94% inflados pelos juros', () => {
    const pct = taxaPlataformaPct(agosto.taxaPlataforma, agosto.receita);
    expect(pct).toBeGreaterThan(5.5);
    expect(pct).toBeLessThan(6.5);
  });

  it('confere o ticket médio das 1.360 vendas aprovadas', () => {
    expect(ticketMedio(agosto.receita, vendasAprovadas)).toBeCloseTo(94.2915, 3);
  });

  it('confere o ROAS do período', () => {
    expect(roas(agosto.receita, agosto.investimento)).toBeCloseTo(1.7437, 3);
  });
});
