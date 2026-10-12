/**
 * Uma parcela não fecha o mês do Simples.
 *
 * ── O que a tela mostrava em 12/10/2026 ───────────────────────────────────
 *
 * Financeiro → Resultado, setembro/2026:
 *
 *     Simples sobre a receita deste mês    R$ 575,54    fonte: extrato
 *
 * Sobre uma base de R$ 215.315,73. Uma alíquota de **0,27%**, apresentada
 * como fato consumado porque a fonte dizia "extrato". O correto é ~R$ 14.9
 * mil, e o resultado de setembro aparecia cerca de **R$ 13,9 mil maior do
 * que é** — numa tela usada para decidir contratação.
 *
 * A causa era uma linha: `if (pago > 0) return fato`. Qualquer lançamento de
 * "Impostos e Tributos" no mês seguinte fechava a conta. Em 06/10 saiu um de
 * R$ 575,54, e pronto.
 *
 * Ela deu as duas peças que faltavam, nas palavras dela:
 *
 *     "setembro - imposto ainda não foi pago, por isso, falta pagar
 *      este valor foi apenas uma parcela"
 *     "Imposto é sempre pago no mês seguinte dia 20"
 *
 * ── Por que são DUAS condições e não uma ──────────────────────────────────
 *
 * A regra do dia 20 sozinha consertaria hoje e criaria um defeito pior em
 * nove dias: em 21/10 setembro passaria a "vencido", os R$ 575,54 virariam o
 * DAS inteiro, e uma alíquota de 0,27% entraria na média de três meses —
 * contaminando a estimativa de outubro, novembro e dezembro.
 *
 * Por isso o piso: 4% é o primeiro degrau do Anexo I, e nenhum anexo do
 * Simples começa abaixo. Alíquota implícita menor que isso não é alíquota, é
 * pagamento incompleto. O número mora em `configuracoes`, que é quem o lado
 * SQL lê, e um teste aqui embaixo exige que os dois lados não divirjam.
 *
 * ── E não era um acidente de um dia ───────────────────────────────────────
 *
 * TODO mês, do dia 1 até o DAS cair, o mês anterior mostrava lucro que não
 * existe. É o que o último teste deste arquivo trava.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  agruparCaixa, simplesDoMes, janelaDeMeses, vencimentoDoSimples,
  ALIQUOTA_MINIMA_PCT,
  type Competencia, type LinhaTransacao,
} from '@/features/financeiro/lib/resultado';

/** Só `baseSimples` importa aqui; o resto da competência não entra na conta. */
function comp(baseSimples: number): Competencia {
  return {
    pagoPelosClientes: 0, perdaReembolso: 0, perdaChargeback: 0,
    coproducao: 0, vendasSemDadoCoproducao: 0, vendas: 0, juros: 0,
    receita: baseSimples, baseSimples, taxaPayt: 0, investMeta: 0, impostoMeta: 0,
  };
}

/* Os números reais de 12/10/2026, lidos de vw_aliquota_simples_mes. */
const competencia = new Map<string, Competencia>([
  ['2026-07', comp(121_055.93)],
  ['2026-08', comp(202_571.25)],
  ['2026-09', comp(215_315.73)],
]);

const PAGAMENTOS: LinhaTransacao[] = [
  { data: '2026-08-20', valor:  -8_486.88, categoria: 'Impostos e Tributos' }, // DAS de julho
  { data: '2026-09-20', valor: -13_245.50, categoria: 'Impostos e Tributos' }, // DAS de agosto
  { data: '2026-10-06', valor:    -575.54, categoria: 'Impostos e Tributos' }, // PARCELA de setembro
];

const caixa = agruparCaixa(PAGAMENTOS);
const meses = janelaDeMeses('2026-09', 12);

describe('o DAS vence dia 20 do mês seguinte', () => {
  it('é sempre o dia 20, e sempre do mês seguinte', () => {
    expect(vencimentoDoSimples('2026-09')).toBe('2026-10-20');
    expect(vencimentoDoSimples('2026-12')).toBe('2027-01-20'); // vira o ano
    expect(vencimentoDoSimples('2026-01')).toBe('2026-02-20');
  });

  it('antes do dia 20 o mês é presumido, mesmo com dinheiro já no extrato', () => {
    const s = simplesDoMes('2026-09', caixa, competencia, meses, { hoje: '2026-10-12' });

    expect(s.presumido, 'setembro ainda não venceu em 12/10').toBe(true);
    expect(s.emAtraso).toBe(false);
    expect(s.vencimento).toBe('2026-10-20');

    // (8.486,88 + 13.245,50) / (121.055,93 + 202.571,25) = 6,7152%
    expect(s.pct).toBeCloseTo(6.7152, 3);
    expect(s.baseMeses).toEqual(['2026-07', '2026-08']);
    expect(s.valor).toBeCloseTo(215_315.73 * 0.067152, 0);

    // O que a tela precisa dizer: quanto já saiu e quanto falta.
    expect(s.pagoParcial).toBeCloseTo(575.54, 2);
    expect(
      s.valor - s.pagoParcial,
      'é o buraco que a tela escondia: ~R$ 13,9 mil de lucro que não existe',
    ).toBeGreaterThan(13_000);
  });

  it('o defeito que estava na tela: R$ 575,54 NÃO é o imposto de setembro', () => {
    const s = simplesDoMes('2026-09', caixa, competencia, meses, { hoje: '2026-10-12' });
    expect(s.valor, 'voltou a tomar a parcela como o DAS inteiro').not.toBeCloseTo(575.54, 2);
    expect(s.valor).toBeGreaterThan(10_000);
  });
});

describe('uma parcela não fecha o mês nem depois de vencer', () => {
  it('em 21/10 setembro fica EM ATRASO, não "pago"', () => {
    const s = simplesDoMes('2026-09', caixa, competencia, meses, { hoje: '2026-10-21' });

    expect(s.presumido, 'a parcela de 0,27% não pode virar o DAS').toBe(true);
    expect(s.emAtraso, 'venceu em 20/10 e não foi pago por inteiro').toBe(true);
    expect(s.pagoParcial).toBeCloseTo(575.54, 2);
    expect(s.valor).toBeGreaterThan(10_000);
  });

  it('a parcela não entra na média que estima os meses seguintes', () => {
    /* Outubro pergunta qual alíquota usar. Se setembro entrasse com 0,27%,
       a média despencaria e outubro apareceria quase sem imposto. */
    const s = simplesDoMes('2026-10', caixa, new Map([
      ...competencia,
      ['2026-10', comp(65_112.87)],
    ]), janelaDeMeses('2026-10', 12), { hoje: '2026-10-21' });

    expect(s.baseMeses, 'setembro não pode formar alíquota com uma parcela')
      .not.toContain('2026-09');
    expect(s.baseMeses).toEqual(['2026-07', '2026-08']);
    expect(s.pct).toBeCloseTo(6.7152, 3);
  });

  it('pago por inteiro depois do dia 20, aí sim é fato', () => {
    const completo = agruparCaixa([
      ...PAGAMENTOS,
      { data: '2026-10-20', valor: -14_358.52, categoria: 'Impostos e Tributos' },
    ]);
    const s = simplesDoMes('2026-09', completo, competencia, meses, { hoje: '2026-10-21' });

    // 575,54 + 14.358,52 = 14.934,06 sobre 215.315,73 = 6,94% — alíquota de verdade.
    expect(s.presumido).toBe(false);
    expect(s.emAtraso).toBe(false);
    expect(s.valor).toBeCloseTo(14_934.06, 2);
  });
});

describe('as duas pontas da regra não podem divergir', () => {
  const MIGRACOES = join(process.cwd(), 'supabase', 'migrations');

  /** O arquivo que define a view da alíquota por último é o que vale. */
  function ultimaQueDefineAView(): string {
    let achado = '';
    for (const n of readdirSync(MIGRACOES).filter(x => x.endsWith('.sql')).sort()) {
      const sql = readFileSync(join(MIGRACOES, n), 'utf8');
      if (/create\s+or\s+replace\s+view\s+public\.vw_aliquota_simples_mes/i.test(sql)) achado = sql;
    }
    return achado;
  }

  it('o piso do TypeScript é o mesmo gravado em configuracoes', () => {
    const sql = readdirSync(MIGRACOES)
      .filter(n => n.endsWith('.sql'))
      .map(n => readFileSync(join(MIGRACOES, n), 'utf8'))
      .find(s => s.includes('simples_aliquota_minima_pct'));

    expect(sql, 'ninguém semeia simples_aliquota_minima_pct').toBeTruthy();

    const semeado = sql!.match(/'simples_aliquota_minima_pct'\s*,\s*([\d.]+)/)?.[1];
    expect(semeado, 'não achei o valor semeado').toBeTruthy();
    expect(
      Number(semeado),
      'o piso do TypeScript e o da tabela divergiram — o SQL e a tela passariam a ' +
      'discordar sobre o que é parcela',
    ).toBe(ALIQUOTA_MINIMA_PCT);
  });

  it('a regra do dia 20 está nos dois lados', () => {
    const sql = ultimaQueDefineAView();
    expect(sql, 'não achei a migração que define a view').not.toBe('');

    /* `mes` é sempre dia 1, então dia 20 do mês seguinte é +1 mês +19 dias.
       Se alguém trocar por outro dia no SQL, o TypeScript continuaria no 20 e
       a tela diria "venceu" num dia em que o banco diz que não. */
    expect(
      sql.replace(/--[^\n]*/g, ''),
      'o SQL deixou de calcular o vencimento como dia 20 do mês seguinte',
    ).toMatch(/\+\s*interval\s*'1 month'\s*\)::date\s*\+\s*19/);

    expect(vencimentoDoSimples('2026-09').slice(-2), 'o TypeScript saiu do dia 20').toBe('20');
  });
});

describe('o defeito valia para todo mês, não só setembro', () => {
  it('do dia 1 até o vencimento, o mês anterior nunca aparece como pago', () => {
    /* Era o pior do defeito: não era um caso, era uma janela de vinte dias
       que se repetia todo mês. Aqui agosto é checado em três datas. */
    const vencimentoDeAgosto = vencimentoDoSimples('2026-08'); // 2026-09-20

    for (const hoje of ['2026-09-01', '2026-09-10', '2026-09-20']) {
      const s = simplesDoMes('2026-08', caixa, competencia, meses, { hoje });
      expect(s.presumido, `em ${hoje} agosto ainda não venceu`).toBe(true);
      expect(s.vencimento).toBe(vencimentoDeAgosto);
    }

    // No dia seguinte ao vencimento, com o DAS inteiro pago, vira fato.
    const s = simplesDoMes('2026-08', caixa, competencia, meses, { hoje: '2026-09-21' });
    expect(s.presumido).toBe(false);
    expect(s.valor).toBeCloseTo(13_245.50, 2);
  });
});
