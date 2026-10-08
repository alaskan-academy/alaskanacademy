/**
 * O card de período do calendário de Produção não pode voltar a espremer as
 * linhas umas por cima das outras.
 *
 * ── O que acontecia ───────────────────────────────────────────────────────
 *
 * O card tinha altura fixa (para as faixas alinharem entre si) e um
 * `flex flex-col` dentro. Num flex em coluna o filho ENCOLHE abaixo do próprio
 * conteúdo quando falta espaço — mas o texto não encolhe junto: ele transborda
 * a caixa e cai por cima da linha de baixo.
 *
 * Com seis linhas num espaço de quatro, o resultado era ilegível. Medido na
 * tela antes do conserto: 41 linhas espremidas, com o título renderizado a
 * 9,3px precisando de 13.
 *
 * ── Por que ler o código, e não renderizar ────────────────────────────────
 *
 * Porque o defeito é de LAYOUT, e jsdom não calcula layout: um `render()` aqui
 * passaria verde com as linhas em cima umas das outras. O que dá para fixar é
 * a causa — e a causa são quatro decisões no código.
 *
 * O texto é lido SEM COMENTÁRIOS. A primeira versão deste teste reprovou
 * sozinha, porque proíbe `h-[58px]` e o comentário que explica o conserto cita
 * `h-[58px]`. Teste que tropeça na própria documentação é teste que alguém
 * desliga.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ARQUIVO = 'src/features/producao/components/CalendarioView.tsx';
const bruto = readFileSync(join(__dirname, '..', '..', ARQUIVO), 'utf-8');

/** O código sem os comentários — o que o navegador vê. */
const codigo = bruto
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

/** O trecho que desenha o card de período, do laço até o fim dele. */
function cardDePeriodo(): string {
  const i = codigo.indexOf('spanEntries.map');
  expect(i, 'não achei o laço dos cards de período').toBeGreaterThan(-1);
  const j = codigo.indexOf('{/* Day cells */}', i);
  return codigo.slice(i, j > i ? j : i + 6000);
}

describe('o card de período não espreme as linhas', () => {
  it('as linhas não encolhem abaixo do próprio conteúdo', () => {
    /* `shrink-0` é o que impede o texto de transbordar a caixa. Vai no
       container e não em cada span, para a linha que alguém acrescentar
       amanhã já nascer protegida. */
    expect(cardDePeriodo(), 'o container das linhas perdeu o shrink-0')
      .toMatch(/\[&>\*\]:shrink-0/);
  });

  it('a altura vem do cálculo, não cravada no className', () => {
    const bloco = cardDePeriodo();
    expect(bloco, 'voltou a ter altura fixa em pixels no card de período')
      .not.toMatch(/h-\[\d+px\]/);
    expect(bloco, 'o card não está usando a altura calculada')
      .toMatch(/height:\s*ALTURA_CARD/);
  });

  it('centralizar é SAFE, senão o título é cortado por cima', () => {
    /* Com overflow, `justify-center` corta pelas DUAS pontas e comeria o nome
       do criativo. `safe center` centraliza enquanto cabe e alinha pelo topo
       quando não cabe — e navegador que não entenda `safe` ignora a
       declaração e cai em `flex-start`, que é o mesmo lado seguro. */
    const bloco = cardDePeriodo();
    expect(bloco).toMatch(/\[justify-content:safe_center\]/);
    expect(bloco, 'voltou o justify-center cru, que corta o título por cima')
      .not.toMatch(/flex-col[^'"]*\bjustify-center\b/);
  });

  it('a altura conta a MESMA lista que o card desenha', () => {
    /* Enquanto eram duas contagens, a altura podia dizer cinco linhas e o card
       desenhar seis — a primeira armadilha em forma de layout. */
    expect(codigo).toMatch(/function linhasDoCardDePeriodo/);
    expect(codigo, 'a altura da faixa não deriva das linhas do card')
      .toMatch(/maxLinhas[\s\S]{0,300}?linhasDoCardDePeriodo\(/);
    expect(cardDePeriodo(), 'o card não desenha a partir da lista')
      .toMatch(/linhasDoCardDePeriodo\([\s\S]{0,40}?\)\.map\(/);
  });

  it('as medidas do cálculo são as mesmas do CSS', () => {
    /* `alturaDoCard` multiplica 10.5 e 9.5 por 1.25 (`leading-tight`). Se
       alguém mudar o tamanho da fonte e esquecer da constante, a faixa volta a
       ficar curta — em silêncio, que é exatamente como isto apareceu. */
    expect(codigo).toMatch(/LINHA_TITULO\s*=\s*10\.5\s*\*\s*1\.25/);
    expect(codigo).toMatch(/LINHA_RESTO\s*=\s*9\.5\s*\*\s*1\.25/);

    // Os tamanhos que a lista de linhas usa de verdade, lidos dela mesma.
    const lista = codigo.slice(
      codigo.indexOf('function linhasDoCardDePeriodo'),
      codigo.indexOf('function linhasDoCardDePeriodo') + 1200,
    );
    const tamanhos = [...new Set([...lista.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map(m => m[1]))];
    expect(tamanhos.sort(), 'apareceu um tamanho de fonte que a conta de altura não conhece')
      .toEqual(['10.5', '9.5']);
  });
});
