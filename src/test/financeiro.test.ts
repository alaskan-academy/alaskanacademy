import { describe, it, expect } from 'vitest';
import {
  calcularResultado,
  ratearCustoFixo,
  participacao,
  ticketMedio,
  roas,
  cpa,
  taxaPlataformaPct,
  coproducaoNaoAtribuida,
} from '@/lib/financeiro';

describe('cascata do pago ao lucro', () => {
  it('desconta na ordem e fecha o lucro operacional', () => {
    const r = calcularResultado({
      receita: 1000,
      taxaPlataforma: 60,
      impostoSimples: 100,
      impostoMeta: 50,
      investimento: 300,
      custoFixo: 200,
    });

    // 1000 − 60 − 100 − 50 − 300
    expect(r.lucroOperacional).toBe(490);
    expect(r.lucroComCustoFixo).toBe(290);
  });

  it('o faturamento líquido para na taxa e no Simples, sem tocar em ads', () => {
    const r = calcularResultado({
      receita: 1000,
      taxaPlataforma: 60,
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

  it('não desconta reembolso, porque a venda estornada já saiu da receita', () => {
    // A venda reembolsada perde o status `aprovada`, e a receita só soma aprovadas.
    // Descontar o estorno de novo contaria a mesma perda duas vezes — era o que a
    // cascata fazia, e ficou visível quando a classificação de reembolso foi
    // corrigida e o valor saltou de R$ 594 para R$ 1.714.
    //
    // Se alguém reintroduzir a dedução, a assinatura de `EntradaResultado` deixa de
    // compilar; este teste guarda o raciocínio.
    const semEstorno = calcularResultado({
      receita: 1000, taxaPlataforma: 60, impostoSimples: 100,
      impostoMeta: 50, investimento: 300, custoFixo: 0,
    });

    // Mês com 200 de estorno: a receita já chega 200 menor, e nada mais é subtraído.
    const comEstorno = calcularResultado({
      receita: 800, taxaPlataforma: 60, impostoSimples: 100,
      impostoMeta: 50, investimento: 300, custoFixo: 0,
    });

    expect(semEstorno.lucroOperacional).toBe(490);
    expect(comEstorno.lucroOperacional).toBe(290);
    // A perda aparece uma vez só: exatamente os 200 que saíram da receita.
    expect(semEstorno.lucroOperacional - comEstorno.lucroOperacional).toBe(200);
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

  it('assume tudo tambem quando nao ha parte NEM total', () => {
    /* Este caso devolvia 0 e custou o custo fixo da Aeliss: empresa nova, sem
       venda nenhuma no periodo, recebia rateio zero — e o cartao "depois do
       custo fixo" sumia da tela, com R$ 5.000/mes configurados em
       Configuracoes. Custo fixo existe tenha havido venda ou nao; e isso que o
       torna fixo. */
    expect(participacao(0, 0)).toBe(1);
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

    // 128.236,46 − 7.776,21 − 12.823,66 − 9.193,15 − 73.545,06
    expect(r.lucroOperacional).toBeCloseTo(24898.38, 2);
    expect(r.lucroComCustoFixo).toBeCloseTo(8898.38, 2);
    expect(r.margemPct).toBeCloseTo(19.416, 2);
    expect(r.margemComCustoFixoPct).toBeCloseTo(6.939, 2);
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

describe('a coprodução que não caiu em nenhum produto', () => {
  /* A lista por produto do /resumo exclui upsell e venda sem oferta principal.
     A coprodução é da VENDA, não da oferta principal dela — então os dois
     recortes podem divergir, e é a subtração que denuncia quando divergem. */

  it('agosto/2026 da Alaskan fecha: nada sobra', () => {
    // 13 vendas do Desafios, todas oferta principal. Números reais.
    const linhas = [
      { produto: 'Curso Saponaria Brasil', coproducao: 0 },
      { produto: 'Workshop Desafios na Sala de Aula', coproducao: 377.5 },
      { produto: 'Fábrica das Velas de Lembrancinha', coproducao: 0 },
    ];
    expect(coproducaoNaoAtribuida(377.5, linhas)).toBe(0);
  });

  it('denuncia o upsell de produto coproduzido', () => {
    /* O dia em que o Desafios for vendido como upsell: a cascata conta a
       coprodução dele, a lista por produto não. Sem esta conta, R$ 90,00
       sumiriam da tela sem nenhum aviso. */
    const linhas = [{ produto: 'Workshop Desafios na Sala de Aula', coproducao: 377.5 }];
    expect(coproducaoNaoAtribuida(467.5, linhas)).toBeCloseTo(90, 2);
  });

  it('não confunde ruído de ponto flutuante com dinheiro', () => {
    const linhas = [{ coproducao: 0.1 }, { coproducao: 0.2 }];
    // 0.1 + 0.2 = 0.30000000000000004 em ponto flutuante.
    expect(coproducaoNaoAtribuida(0.3, linhas)).toBe(0);
  });

  it('lista vazia devolve o total inteiro, não zero', () => {
    // Mês com coprodução e sem nenhum produto listado é anomalia, não silêncio.
    expect(coproducaoNaoAtribuida(377.5, [])).toBeCloseTo(377.5, 2);
  });

  it('aguenta linha sem o campo', () => {
    expect(coproducaoNaoAtribuida(0, [{ produto: 'x' } as { coproducao?: number }])).toBe(0);
  });
});
