/**
 * A alíquota do Simples é MEDIDA, não digitada — e ninguém pode voltar a
 * digitá-la sem perceber.
 *
 * ── O que estava errado ───────────────────────────────────────────────────
 *
 * `configuracoes.imposto_simples_nacional_pct` estava em 9% para as duas
 * empresas. Medido contra a base legal, o que se paga é 6,94%: o painel
 * mostrava R$ 4.119/mês de lucro A MENOS do que o real.
 *
 * E não é um número que se conserta uma vez. A alíquota sobe com a faixa do
 * Simples, que depende do faturamento acumulado de 12 meses — trocar 9 por
 * 6,94 à mão só adia o erro para o mês da próxima faixa. Terceira armadilha:
 * lista fixa no código (aqui, número fixo no banco) que envelhece em silêncio.
 *
 * ── O que a derivação precisa respeitar, e este teste cobra ───────────────
 *
 * Nenhuma destas é verificável sem banco, então o teste lê as migrações — é o
 * mesmo caminho de `analises-tendencia` e `o-empate-e-um-so`, e é por isso que
 * o CLAUDE.md proíbe migração sem arquivo.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const raiz = join(__dirname, '..', '..');
const migracoes = (() => {
  const dir = join(raiz, 'supabase', 'migrations');
  return readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
    .map(f => ({ nome: f, sql: readFileSync(join(dir, f), 'utf-8') }));
})();

/** A migração mais recente que (re)define um objeto com este nome. */
function ultimaQueDefine(objeto: string): string {
  let achado = '';
  for (const m of migracoes) {
    if (new RegExp(`create (or replace )?(view|function)\\s+(public\\.)?${objeto}\\b`, 'i').test(m.sql)) {
      achado = m.sql;
    }
  }
  expect(achado, `nenhuma migração define ${objeto}`).not.toBe('');
  return achado;
}

describe('a alíquota do Simples é medida', () => {
  it('existe a view que mede, e ela divide pago por base', () => {
    const sql = ultimaQueDefine('vw_aliquota_simples_mes');
    expect(sql).toMatch(/Impostos e Tributos/);
    expect(sql, 'a medida não usa a base do Simples').toMatch(/vw_base_simples_mes/);
  });

  it('o imposto de M é dividido pela base de M-1, não pela do próprio mês', () => {
    /* A regra legal, e a que o CLAUDE.md destaca: o Simples é pago sobre a
       receita do mês ANTERIOR. Dividir pelo mesmo mês dá quase metade, e
       convidaria a baixar a alíquota e inflar o lucro. */
    const sql = ultimaQueDefine('vw_aliquota_simples_mes');
    expect(sql, 'a medida não desloca o mês de pagamento').toMatch(
      /mes_pagamento\s*=\s*\(\s*b\.mes\s*\+\s*interval\s*'1 month'/,
    );
  });

  it('mês cujo pagamento ainda não venceu NÃO entra na medida', () => {
    /* Sem isto, todo dia 1º a alíquota despencaria para perto de zero (o DAS
       vence dia 20) e voltaria depois. Uma alíquota que oscila com o
       calendário é pior que o número fixo que ela substituiu. */
    const sql = ultimaQueDefine('vw_aliquota_simples_mes');
    expect(sql).toMatch(/pagamento_fechado/);
    expect(sql, 'não há comparação com o mês corrente para saber se fechou')
      .toMatch(/date_trunc\('month',\s*\(now\(\)/);
  });

  it('a janela é de 3 meses, não de um', () => {
    /* Mês a mês a medida oscila entre 6,00% e 8,16%, e a oscilação é o DIA do
       pagamento, não a faixa. */
    expect(ultimaQueDefine('vw_aliquota_simples_mes'))
      .toMatch(/rows between 2 preceding and current row/i);
  });

  it('`configuracoes` sobrou como fallback, e só', () => {
    /* Empresa nova não tem histórico — a Aeliss só terá medida em novembro.
       Mas o configurado não pode voltar a mandar onde há medida, senão são
       dois campos dizendo a alíquota. */
    const fn = ultimaQueDefine('fn_aliquota_simples');
    const ordem = fn.replace(/\s+/g, ' ');
    const posMedida = ordem.indexOf('aliquota_vigente');
    const posConfig = ordem.indexOf("fn_config('imposto_simples_nacional_pct'");
    expect(posMedida, 'a função não consulta a medida').toBeGreaterThan(-1);
    expect(posConfig, 'a função não tem o fallback').toBeGreaterThan(-1);
    expect(posMedida, 'o configurado vem ANTES da medida no coalesce')
      .toBeLessThan(posConfig);
  });

  it('a view de faturamento usa a medida, não o fn_config direto', () => {
    const sql = ultimaQueDefine('vw_faturamento_liquido');
    expect(sql, 'a view não junta a alíquota medida').toMatch(/vw_aliquota_simples_mes/);
    expect(sql, 'a view perdeu a coluna que diz de onde veio a alíquota')
      .toMatch(/simples_medido/);
  });

  it('a tela de parâmetros diz qual alíquota está valendo', () => {
    /* Um campo editável que não manda em nada é a primeira armadilha em estado
       puro: quem digita acredita no que digitou. E a prévia da tela tem de usar
       a mesma alíquota do produto, senão ela convida a ajustar o campo até
       "bater" com um número que não vai mudar. */
    const tela = readFileSync(
      join(raiz, 'src/features/admin/pages/SettingsPage.tsx'), 'utf-8');
    expect(tela, 'a tela não consulta a alíquota em vigor')
      .toMatch(/vw_aliquota_simples_mes/);
    expect(tela, 'a prévia voltou a calcular pelo campo digitado')
      .not.toMatch(/baseSimples\s*\*\s*\(\s*form\.imposto_simples_nacional_pct/);
    expect(tela, 'a prévia não usa a alíquota em vigor')
      .toMatch(/baseSimples\s*\*\s*\(\s*simplesPct/);
  });
});
