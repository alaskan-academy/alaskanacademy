/**
 * Paginação sem desempate perde linha — e repete outra.
 *
 * ── O que estava acontecendo ──────────────────────────────────────────────
 *
 * `/criativos` buscava os cards postados de mil em mil, ordenando **só por
 * `nome`**. O console acusava chave duplicada
 * (`71169210-25d8-4460-9e8e-0f7d3eaeaa82`), e o banco explica por quê:
 *
 *     3.073 cards postados
 *     2.087 nomes distintos
 *       456 nomes repetidos
 *     1.442 linhas empatadas  (47% do total)
 *        16 vezes o mesmo "AD 001 H03 V01"
 *
 * Quando o critério de ordenação empata, o Postgres **não garante** a mesma
 * ordem entre duas consultas separadas — e `range(0,999)` e `range(1000,1999)`
 * são duas consultas separadas. Um card que estava na fronteira aparece no fim
 * da página 1 **e** no começo da página 2; outro não aparece em lugar nenhum.
 *
 * O que torna isto pior que um aviso de console: **a contagem continua
 * parecendo certa**. Some um card e aparece outro duas vezes, o total não
 * muda, e nada na tela denuncia. É a tela onde se decide o que foi validado.
 *
 * ── O conserto ───────────────────────────────────────────────────────────
 *
 * Um desempate único no fim da ordenação: `.order('nome').order('id')`. Uma
 * linha em cada um dos três lugares que paginam.
 *
 * `PorAnguloView` era o pior dos três: ordenava por `angulo`, que tem
 * pouquíssimos valores distintos, então quase tudo empatava.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');

/** Todo arquivo .ts/.tsx sob src/, recursivo. */
function arquivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return arquivos(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

function semComentarios(bruto: string) {
  return bruto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
}

/** As chaves de ordenação de um arquivo, na ordem em que aparecem. */
function chavesDeOrdem(fonte: string): string[] {
  return [...fonte.matchAll(/\.order\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
}

/** Serve de desempate? Só coluna única serve. */
const ehUnica = (chave: string) => chave === 'id' || /_id$/.test(chave);

describe('quem pagina desempata a ordenação', () => {
  const quePaginam = arquivos(SRC)
    .filter(p => !p.includes(`${require('node:path').sep}test${require('node:path').sep}`))
    .map(p => ({ p, fonte: semComentarios(readFileSync(p, 'utf8')) }))
    .filter(a => a.fonte.includes('todasAsLinhas') && !a.p.endsWith('supabase.ts'));

  it('há arquivos paginando — senão este teste passa por nada', () => {
    expect(quePaginam.length, 'ninguém usa todasAsLinhas').toBeGreaterThan(0);
  });

  it('todo arquivo que pagina ordena por alguma coluna única', () => {
    const culpados = quePaginam
      .filter(a => !chavesDeOrdem(a.fonte).some(ehUnica))
      .map(a => a.p.replace(SRC, 'src'));

    expect(
      culpados,
      'Arquivo que pagina sem nenhuma ordenação por coluna única. Com empate no ' +
      'critério, o Postgres não garante a mesma ordem entre duas chamadas de ' +
      '`range()`: uma linha vem duas vezes e outra não vem — e o total continua ' +
      'parecendo certo.',
    ).toEqual([]);
  });

  /* Os três lugares concretos que tinham o defeito. Nomeados de propósito: a
     checagem genérica acima passa se o arquivo tiver UM order por id em
     qualquer lugar, e estes três precisam dele na consulta paginada. */
  const CASOS = [
    { arquivo: 'src/features/criativos/components/AvaliacaoView.tsx',     par: ["nome", "id"] },
    { arquivo: 'src/features/criativos/components/DesempenhoAdsView.tsx', par: ["nome", "id"] },
    { arquivo: 'src/features/criativos/components/PorAnguloView.tsx',     par: ["angulo", "producao_id"] },
  ];

  it.each(CASOS)('$arquivo desempata logo depois da chave que repete', ({ arquivo, par }) => {
    const fonte = semComentarios(readFileSync(join(process.cwd(), arquivo), 'utf8'));
    const [primeira, desempate] = par;

    const seguidas = new RegExp(
      `\\.order\\(\\s*['"]${primeira}['"]\\s*\\)\\s*\\.order\\(\\s*['"]${desempate}['"]\\s*\\)`,
    );

    expect(
      seguidas.test(fonte),
      `${arquivo} ordena por "${primeira}" sem o desempate "${desempate}" logo ` +
      `em seguida. Em producoes, 1.442 de 3.073 cards postados têm nome ` +
      `empatado; sem desempate a paginação perde card e repete card.`,
    ).toBe(true);
  });
});
