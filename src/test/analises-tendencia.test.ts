/**
 * A view não pode discordar da tela sobre o que é PIORAR.
 *
 * `vw_rev_tendencia` (migração 20260924c) acusa métrica que piorou em três
 * janelas seguidas. Para isso ela precisa saber a direção de cada uma — CPA
 * subindo é ruim, ROAS caindo é ruim — e escreve isso em SQL:
 *
 *     cpa2  > cpa1  AND cpa3  > cpa2    -> cpa_piorando
 *     roas2 < roas1 AND roas3 < roas2   -> roas_piorando
 *
 * A mesma direção já está declarada em `LINHAS_COMPARACAO`
 * (`src/features/analises/comparacao.ts`), que é o que desenha a seta de
 * variação nas tabelas de comparação: `subirEhRuim` para CPA, `melhorEh:
 * 'maior'` para ROAS. São dois lugares dizendo a mesma coisa — a primeira
 * armadilha do CLAUDE.md — e o banco não lê TypeScript, então a duplicação é
 * inevitável enquanto a classificação tiver de existir dos dois lados.
 *
 * O dia em que alguém inverter a direção na tela e não na view, o painel passa
 * a desenhar seta verde para o que a view chama de piora. Este teste quebra
 * antes disso.
 *
 * Ele NÃO protege contra a terceira métrica: se `vw_rev_tendencia` ganhar
 * `margem_piorando` amanhã, aqui ninguém percebe. Protege as duas que existem,
 * que é o que dá para afirmar.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LINHAS_COMPARACAO } from '@/features/analises/comparacao';

const MIGRACOES = join(process.cwd(), 'supabase', 'migrations');

/** O SQL da última migração que define a view, sem comentários. */
function sqlDaView(): string {
  let achado: string | null = null;
  for (const nome of readdirSync(MIGRACOES).filter(n => n.endsWith('.sql')).sort()) {
    const bruto = readFileSync(join(MIGRACOES, nome), 'utf8');
    if (!/create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?vw_rev_tendencia\b/i.test(bruto)) continue;
    /* Sem os comentários, e a razão é cicatriz: em `o-empate-e-um-so.test.ts` a
       primeira versão casava com o número escrito no cabeçalho em vez do que
       estava no código, e passou com o defeito plantado. */
    achado = bruto.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  }
  if (!achado) throw new Error('não achei vw_rev_tendencia nas migrações — o teste ficou cego');
  return achado;
}

describe('a tendência concorda com a tela sobre o que é piorar', () => {
  const sql = sqlDaView();

  it('a extração achou as duas regras — senão o resto passa vazio', () => {
    expect(sql).toMatch(/cpa_piorando/);
    expect(sql).toMatch(/roas_piorando/);
  });

  it('CPA: a tela diz que subir é ruim, e a view acusa quando sobe', () => {
    const naTela = LINHAS_COMPARACAO.find(l => l.rotulo === 'CPA');
    expect(naTela, 'não achei a linha "CPA" em LINHAS_COMPARACAO').toBeTruthy();
    expect(
      naTela!.subirEhRuim,
      'A tela deixou de tratar CPA subindo como piora, mas a view continua ' +
        'acusando quem sobe. Uma das duas está desenhando seta para o lado errado.',
    ).toBe(true);

    /* `cpa2 > cpa1` e `cpa3 > cpa2`: subir é o que acusa. */
    expect(sql, 'a view deixou de exigir CPA subindo nas três janelas')
      .toMatch(/cpa2\s*>\s*cpa1[\s\S]{0,80}cpa3\s*>\s*cpa2/i);
  });

  it('ROAS: a tela diz que maior é melhor, e a view acusa quando cai', () => {
    const naTela = LINHAS_COMPARACAO.find(l => l.rotulo === 'ROAS do front');
    expect(naTela, 'não achei a linha "ROAS do front" em LINHAS_COMPARACAO').toBeTruthy();
    expect(
      naTela!.melhorEh,
      'A tela deixou de tratar ROAS maior como melhor, mas a view continua ' +
        'acusando quem cai.',
    ).toBe('maior');

    expect(sql, 'a view deixou de exigir ROAS caindo nas três janelas')
      .toMatch(/roas2\s*<\s*roas1[\s\S]{0,80}roas3\s*<\s*roas2/i);
  });

  it('o piso de gasto vale para as duas acusações', () => {
    /* Foi escolha dela: acusar só quando o dinheiro for relevante. Sem o piso
       em AMBAS, uma das métricas volta a gritar sobre uma venda — foi o CPA do
       REV3 saltando de 71 para 316 porque o denominador virou 1. */
    const comPiso = [...sql.matchAll(/menor_investimento\s*>=\s*1000/gi)].length;
    expect(
      comPiso,
      `o piso de R$ 1.000 aparece ${comPiso} vez(es) na view, e são duas ` +
        `acusações (cpa_piorando e roas_piorando). Uma delas ficou sem piso.`,
    ).toBeGreaterThanOrEqual(2);
  });
});
