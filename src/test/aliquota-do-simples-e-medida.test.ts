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

  it('a precedência é: a dela, a do grupo, o configurado', () => {
    /* Três degraus, nesta ordem. Empresa nova herda a medida da OPERAÇÃO em
       vez do número digitado — 9% não era de ninguém, e o comportamento
       medido ao lado é melhor palpite. Quando ela tiver a sua, usa a sua.

       A ordem do `coalesce` É a regra: inverter dois degraus faria a Aeliss
       continuar nos 9%, ou a Alaskan passar a usar a média do grupo. */
    const fn = ultimaQueDefine('fn_aliquota_simples').replace(/\s+/g, ' ');

    const posPropria = fn.indexOf('not a.eh_grupo');
    const posGrupo   = fn.indexOf('where a.eh_grupo');
    const posConfig  = fn.indexOf("fn_config('imposto_simples_nacional_pct'");

    expect(posPropria, 'a função não consulta a medida da empresa').toBeGreaterThan(-1);
    expect(posGrupo,   'a função não consulta a medida do grupo').toBeGreaterThan(-1);
    expect(posConfig,  'a função não tem o fallback configurado').toBeGreaterThan(-1);

    expect(posPropria, 'o grupo vem antes da medida da própria empresa').toBeLessThan(posGrupo);
    expect(posGrupo,   'o configurado vem antes da medida do grupo').toBeLessThan(posConfig);
  });

  it('a linha do GRUPO é derivada, não é um slug escrito no código', () => {
    /* Hoje o grupo É a Alaskan, e escrever 'alaskan' daria o mesmo número —
       e envelheceria no dia de uma terceira empresa, ou se a Alaskan parasse.
       Terceira armadilha. */
    const arquivo = ultimaQueDefine('vw_aliquota_simples_mes');
    expect(arquivo, 'a linha do grupo não é derivada por grouping sets')
      .toMatch(/grouping sets/i);

    /* Só a DEFINIÇÃO da view, e não o arquivo inteiro: a prova no fim da
       migração cita 'alaskan' e 'aeliss' de propósito, porque é ela que
       confere o caso real. Teste que reprova a própria prova não serve. */
    const inicio = arquivo.search(/create or replace view public\.vw_aliquota_simples_mes/i);
    const fim    = arquivo.indexOf('comment on view public.vw_aliquota_simples_mes', inicio);
    const defDaView = arquivo.slice(inicio, fim > inicio ? fim : undefined);
    expect(defDaView.length, 'não consegui recortar a definição da view').toBeGreaterThan(200);
    expect(defDaView, 'apareceu um slug de empresa escrito na view')
      .not.toMatch(/'(alaskan|aeliss|ravenna)'/i);
  });

  it('a view de faturamento distingue os três casos', () => {
    /* "medido nela" e "emprestado do grupo" não são a mesma coisa: um é fato,
       o outro é empréstimo que vai acabar. A tela precisa poder dizer qual. */
    const sql = ultimaQueDefine('vw_faturamento_liquido');
    expect(sql).toMatch(/simples_origem/);
    for (const caso of ['propria', 'grupo', 'configurado']) {
      expect(sql, `a view não sabe dizer o caso "${caso}"`).toContain(`'${caso}'`);
    }
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
