/**
 * O clique do sumário precisa ter para onde ir.
 *
 * ── O que estava acontecendo ──────────────────────────────────────────────
 *
 * Em 28/09/2026, os 17 títulos de "Segunda Criativa" estavam na tela SEM ID
 * NENHUM. O mesmo valia para todos os outros artigos. O sumário aparecia
 * inteiro, bonito, e clicar em qualquer item não fazia nada.
 *
 * A causa era sanitizar duas vezes:
 *
 *   htmlPorBloco = comIdsNosTitulos(sanitizarHtml(html))   ← limpa, depois marca
 *   BlocoTexto   = sanitizarHtml(html)                     ← limpa DE NOVO
 *
 * A ordem de `htmlPorBloco` estava certa. Só que o `BlocoTexto` sanitizava o
 * que já vinha limpo, e como `h2`/`h3` não tinham entrada em `ATRIBUTOS`, o
 * conjunto de permitidos era vazio e o `id` recém escrito era removido.
 *
 * E falhava CALADO: `scrollToHeading` faz `if (el)`, então sem destino ele
 * simplesmente não faz nada. Nenhum erro, nenhum aviso, nada na tela. Só o
 * clique que não leva a lugar nenhum, que foi como a Jessica encontrou.
 *
 * ── A propriedade que faltava ─────────────────────────────────────────────
 *
 * Sanitizar duas vezes tem de dar o mesmo resultado que sanitizar uma vez.
 * Enquanto isso não valer, qualquer coisa que uma etapa escreva no HTML some
 * na etapa seguinte, e some sem reclamar.
 */
import { describe, it, expect } from 'vitest';
import { sanitizarHtml } from '@/lib/sanitizar';
import { idComContador, idDoTitulo } from '@/features/processos/components/BlocosRenderer';

describe('a âncora do sumário sobrevive ao sanitizador', () => {
  it('o id do título continua lá depois de limpar', () => {
    const sujo = '<h2 id="o-que-e">O que é</h2><h3 id="1-comece-por-um-problema-real">1. Comece</h3>';
    const limpo = sanitizarHtml(sujo);
    expect(limpo, 'h2 perdeu a âncora').toContain('id="o-que-e"');
    expect(limpo, 'h3 perdeu a âncora').toContain('id="1-comece-por-um-problema-real"');
  });

  it('limpar duas vezes é igual a limpar uma', () => {
    // A propriedade de verdade. Sem ela, qualquer decoração feita entre as
    // duas passadas desaparece em silêncio.
    const html = '<h2 id="titulo-um">Um</h2><p>texto</p><h3 id="titulo-dois">Dois</h3>';
    const uma = sanitizarHtml(html);
    expect(sanitizarHtml(uma), 'sanitizar não é idempotente').toBe(uma);
  });

  it('o id que o sumário gera passa pelo filtro', () => {
    // Os dois lados precisam concordar: o sumário monta o id por uma função,
    // o sanitizador deixa passar por outra regra. Se divergirem, o clique
    // volta a morrer. Estes são títulos reais da Segunda Criativa.
    const vistos = new Map<string, number>();
    const titulos = [
      'O que é',
      'Não é folga',
      '1. Comece por um problema real',
      '3. Onde procurar: 80 dentro, 20 fora',
      '4. Poucas, fundo, e com o princípio escrito',
      'Olhar para os seus números',
    ];
    for (const t of titulos) {
      const id = idComContador(t, vistos);
      expect(id, `"${t}" gerou um id vazio`).not.toBe('');
      const limpo = sanitizarHtml(`<h2 id="${id}">${t}</h2>`);
      expect(limpo, `o sanitizador descartou o id de "${t}"`).toContain(`id="${id}"`);
    }
  });

  it('título repetido mantém âncoras diferentes depois de limpar', () => {
    // O "Checklist de Revisão de ADs" tem "Safezone" em quatro passos. Se o
    // desempate não sobreviver, os quatro cliques caem no primeiro.
    const vistos = new Map<string, number>();
    const a = idComContador('Safezone', vistos);
    const b = idComContador('Safezone', vistos);
    expect(a).not.toBe(b);
    const limpo = sanitizarHtml(`<h3 id="${a}">Safezone</h3><h3 id="${b}">Safezone</h3>`);
    expect(limpo).toContain(`id="${a}"`);
    expect(limpo).toContain(`id="${b}"`);
  });

  it('id fora do formato de âncora continua sendo descartado', () => {
    // O id é inerte para script, mas um valor arbitrário serve para sombrear
    // propriedade de `document`. Só o alfabeto do slug entra.
    const limpo = sanitizarHtml('<h2 id="cookie">A</h2><h3 id="cara feia!">B</h3>');
    expect(limpo, 'id com espaço e pontuação deveria sair').not.toContain('cara feia');
    expect(idDoTitulo('cara feia!'), 'o gerador nunca produziria esse formato').toBe('cara-feia');
  });

  it('id em tag que não é título continua proibido', () => {
    const limpo = sanitizarHtml('<p id="paragrafo">a</p><div id="caixa">b</div>');
    expect(limpo).not.toContain('id="paragrafo"');
    expect(limpo).not.toContain('id="caixa"');
  });
});
