/**
 * O sumário do artigo precisa existir abaixo de 1280px.
 *
 * ── O que estava assim ─────────────────────────────────────────────────────
 *
 *     <aside className="w-52 shrink-0 hidden xl:block">
 *
 * `xl` é 1280px. Abaixo disso o sumário não ficava menor nem mudava de lugar:
 * ele simplesmente não existia, e com ele sumia a navegação INTEIRA do artigo.
 *
 * Num texto de oito seções com nove subseções, como a Segunda Criativa, isso
 * obriga a rolar o documento todo para achar o passo 3. E some justamente para
 * quem tem a tela menor, que é quem mais precisa pular direto.
 *
 * Nada na tela denunciava: não havia botão, não havia link, não havia um
 * espaço vazio onde ele deveria estar. Quem nunca abriu num monitor grande não
 * sabia que existia sumário.
 *
 * ── O conserto ────────────────────────────────────────────────────────────
 *
 * Um segundo sumário, `xl:hidden`, no topo do conteúdo. Nasce FECHADO, porque
 * aberto empurraria o texto para baixo da dobra em quem já tem pouca tela, e
 * fecha ao escolher uma seção, porque no celular a lista aberta cobriria o
 * começo da seção para onde a pessoa acabou de ir.
 *
 * Os dois leem o MESMO `toc`, que vem de `sumarioDosBlocos`. É a primeira
 * armadilha do CLAUDE.md evitada de propósito: duas listas montadas por contas
 * diferentes divergiriam no dia em que alguém mexesse numa só.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TELA = 'src/features/processos/pages/ProcessosArtigoPage.tsx';
const codigo = readFileSync(join(process.cwd(), TELA), 'utf8');
const semComentarios = codigo
  .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')
  .replace(/\/\/[^\n]*/g, '');

describe('o sumário do artigo alcança tela pequena', () => {
  it('existe um sumário que aparece justamente onde a lateral some', () => {
    // A lateral continua sendo `hidden xl:block`. O que não pode é ser a
    // ÚNICA: precisa haver o par `xl:hidden` cobrindo o outro lado.
    expect(semComentarios, `${TELA}: a lateral deixou de ser xl:block`).toMatch(
      /hidden xl:block/,
    );
    expect(semComentarios, `${TELA}: sem \`xl:hidden\`, abaixo de 1280px não sobra sumário nenhum`).toMatch(
      /xl:hidden/,
    );
  });

  it('o sumário de cima navega de verdade, e não é só um rótulo', () => {
    // Um bloco `xl:hidden` que não leve a lugar nenhum seria decoração:
    // mostraria os títulos sem rolar para eles.
    const trecho = semComentarios.slice(semComentarios.indexOf('xl:hidden'));
    const ateOArtigo = trecho.slice(0, trecho.indexOf('<BlocosRenderer'));
    expect(ateOArtigo, `${TELA}: não achei o bloco xl:hidden antes do conteúdo`).not.toBe('');
    expect(ateOArtigo, 'o sumário de cima precisa pedir o destino').toMatch(
      /setIrPara\(item\.id\)/,
    );
    expect(ateOArtigo, 'precisa percorrer o mesmo toc da lateral').toMatch(
      /toc\.map\(/,
    );
  });

  it('fecha a lista ANTES de rolar, e não no mesmo instante', () => {
    /*
      Fechar encurta a página acima do destino. Rolando no mesmo clique, o
      `scrollIntoView` mede a posição de antes e o alvo sobe depois: medido em
      28/09/2026, parava 513px além do título, já dentro da seção seguinte.

      Por isso o clique só GUARDA o destino, e quem rola é o efeito, com o DOM
      já sem a lista. Se alguém voltar a chamar `scrollToHeading` direto no
      onClick do sumário de cima, o erro volta calado.
    */
    const trecho = semComentarios.slice(semComentarios.indexOf('xl:hidden'));
    const ateOArtigo = trecho.slice(0, trecho.indexOf('<BlocosRenderer'));
    expect(ateOArtigo, 'o sumário de cima não pode rolar dentro do próprio clique').not.toMatch(
      /scrollToHeading\(/,
    );
    expect(semComentarios, 'falta o efeito que rola depois do DOM atualizar').toMatch(
      /useEffect\(\(\) => \{\s*if \(!irPara\) return;\s*scrollToHeading\(irPara\);/,
    );
  });

  it('os dois sumários leem a mesma lista', () => {
    // Se alguém montar uma segunda lista por outra conta, elas divergem no
    // primeiro dia em que uma for alterada sozinha. Armadilha 1.
    const fontes = semComentarios.match(/sumarioDosBlocos\(/g) ?? [];
    expect(fontes.length, `${TELA}: o sumário passou a ser calculado em mais de um lugar`).toBe(1);
    expect((semComentarios.match(/toc\.map\(/g) ?? []).length,
      'esperado exatamente dois consumidores do mesmo toc').toBe(2);
  });
});
