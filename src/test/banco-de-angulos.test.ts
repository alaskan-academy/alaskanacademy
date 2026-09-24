/**
 * A prateleira não pode oferecer ad que já foi testado, nem esconder estado.
 *
 * `vw_criativo_por_angulo` (migração 20260924d) existe para reencontrar o ad
 * que já foi feito — o que nunca rodou e o que foi descartado contra a página
 * errada. Duas coisas a quebram em silêncio:
 *
 * 1. A PRECEDÊNCIA. O `CASE` classifica pelo VEREDITO antes da FASE, porque um
 *    card marcado "Não validado" rodou, em qualquer fase que tenha parado.
 *    Invertendo a ordem, card com veredito cairia em `pronto` e a tela passaria
 *    a oferecer para testar o que já foi testado — com cara de novidade.
 *
 * 2. O VOCABULÁRIO. `ESTADO` em `PorAnguloView.tsx` dá rótulo e cor a cada
 *    estado. Um estado novo na view sem entrada lá vira `undefined` no
 *    `ESTADO[c.estado].selo` e derruba a tela — ou, pior, some da contagem e o
 *    card desaparece da prateleira, que é exatamente o que ela não pode fazer.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRACOES = join(process.cwd(), 'supabase', 'migrations');
const VIEW = join(process.cwd(), 'src', 'features', 'criativos', 'components', 'PorAnguloView.tsx');

/** O SQL da última migração que define a view, sem comentários. */
function sqlDaView(): string {
  let achado: string | null = null;
  for (const nome of readdirSync(MIGRACOES).filter(n => n.endsWith('.sql')).sort()) {
    const bruto = readFileSync(join(MIGRACOES, nome), 'utf8');
    if (!/create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?vw_criativo_por_angulo\b/i.test(bruto)) continue;
    achado = bruto.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  }
  if (!achado) throw new Error('não achei vw_criativo_por_angulo nas migrações — o teste ficou cego');
  return achado;
}

describe('o banco de ângulos', () => {
  const sql = sqlDaView();

  /** O bloco `CASE … END AS estado`. */
  const bloco = (() => {
    const fim = sql.search(/END\s+AS\s+estado\b/i);
    expect(fim, 'não achei o CASE de `estado` na view').toBeGreaterThan(-1);
    const inicio = sql.slice(0, fim).toUpperCase().lastIndexOf('CASE');
    return sql.slice(inicio, fim);
  })();

  /** Os estados que a view PRODUZ — só o que vem depois de THEN/ELSE. */
  const estados = (() => {
    const achadas = new Set<string>();
    for (const parte of bloco.split(/\b(?:THEN|ELSE)\b/i).slice(1)) {
      const ate = parte.split(/\bWHEN\b|\bEND\b/i)[0];
      for (const m of ate.matchAll(/'([a-z_]+)'/g)) achadas.add(m[1]);
    }
    return [...achadas];
  })();

  it('a extração achou os estados — senão o resto passa vazio', () => {
    expect(estados.length, `só extraí [${estados.join(', ')}]`).toBeGreaterThanOrEqual(5);
    expect(estados).toContain('pronto');
    expect(estados).toContain('descartado');
  });

  it('o veredito é avaliado ANTES da fase', () => {
    /* Card "Não validado" rodou, em qualquer fase. Se a fase vier primeiro, um
       descartado que parou em `aprovado` viraria `pronto` e a tela ofereceria
       para testar o que já foi testado. */
    const posVeredito = bloco.search(/WHEN\s+p\.avaliacao/i);
    const posFase     = bloco.search(/WHEN\s+p\.fase/i);
    expect(posVeredito, 'a view não classifica por avaliacao').toBeGreaterThan(-1);
    expect(posFase, 'a view não classifica por fase').toBeGreaterThan(-1);
    expect(
      posVeredito,
      'A view passou a olhar a FASE antes do VEREDITO. Card com "Não validado" ' +
        'que parou em fase `aprovado` volta a ser oferecido como pronto, e a ' +
        'prateleira passa a mandar testar de novo o que já foi descartado.',
    ).toBeLessThan(posFase);
  });

  it('todo estado da view tem rótulo e cor na tela', () => {
    const tsx = readFileSync(VIEW, 'utf8');
    const mapa = tsx.match(/const\s+ESTADO\s*=\s*\{([\s\S]*?)\}\s*as\s+const/);
    expect(mapa, 'não achei o mapa ESTADO em PorAnguloView.tsx').toBeTruthy();
    const comRotulo = [...mapa![1].matchAll(/^\s*([a-z_]+)\s*:/gm)].map(m => m[1]);

    const semRotulo = estados.filter(e => !comRotulo.includes(e));
    expect(
      semRotulo,
      `${semRotulo.join(', ')} sai de vw_criativo_por_angulo e não tem entrada em ` +
        `ESTADO. Sem rótulo, \`ESTADO[c.estado].selo\` explode ou o card some da ` +
        `prateleira — e sumir é o oposto do que esta tela existe para fazer.`,
    ).toEqual([]);
  });

  it('a ordem de exibição cobre todos os estados', () => {
    const tsx = readFileSync(VIEW, 'utf8');
    const m = tsx.match(/const\s+ORDEM\s*=\s*\[([^\]]*)\]/);
    expect(m, 'não achei ORDEM em PorAnguloView.tsx').toBeTruthy();
    const naOrdem = [...m![1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]);

    const foraDaOrdem = estados.filter(e => !naOrdem.includes(e));
    expect(
      foraDaOrdem,
      `${foraDaOrdem.join(', ')} não está em ORDEM — o card não entra na contagem ` +
        `de chips do ângulo e some da tela sem erro nenhum.`,
    ).toEqual([]);
  });
});
