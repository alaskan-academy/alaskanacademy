import { describe, it, expect } from 'vitest';
import { sanitizarHtml } from '@/lib/sanitizar';

/**
 * O sanitizador do bloco de HTML dos Processos.
 *
 * Aqui a regra do projeto — "só testa o que já falhou na tela" — não vale, e de
 * propósito: código de segurança que nunca foi testado é código em que não se
 * confia. O que se prende aqui é o conjunto de ataques conhecidos de XSS por
 * HTML colado, cada um com o motivo de existir.
 */

describe('o que executa código não passa', () => {
  it('mata o script inteiro, não só a tag', () => {
    // Trocar `<script>` pelo conteúdo dele deixaria o código como TEXTO --
    // inofensivo hoje, e uma bomba se algum dia alguém renderizar de novo.
    const r = sanitizarHtml('<p>oi</p><script>alert(1)</script>');
    expect(r).not.toContain('alert');
    expect(r).toContain('oi');
  });

  it('tira o onerror da imagem', () => {
    // O clássico: não precisa de <script>, basta uma imagem que falha.
    const r = sanitizarHtml('<img src="x" onerror="alert(1)">');
    expect(r).not.toContain('onerror');
    expect(r).not.toContain('alert');
  });

  it('tira qualquer on*, e não só os que alguém lembrou de listar', () => {
    for (const attr of ['onclick', 'onload', 'onmouseover', 'onfocus', 'onanimationstart']) {
      const r = sanitizarHtml(`<div ${attr}="alert(1)">x</div>`);
      expect(r).not.toContain(attr);
    }
  });

  it('recusa javascript: no href', () => {
    const r = sanitizarHtml('<a href="javascript:alert(1)">clique</a>');
    expect(r).not.toContain('javascript');
    expect(r).toContain('clique');
  });

  it('recusa javascript: disfarçado de maiúscula e espaço', () => {
    // `JaVaScRiPt:` e `java\tscript:` passam por comparação ingênua de string.
    for (const url of ['JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)']) {
      const r = sanitizarHtml(`<a href="${url}">x</a>`);
      expect(r.toLowerCase()).not.toContain('alert');
    }
  });

  it('recusa data: no src, que roda HTML dentro do iframe', () => {
    const r = sanitizarHtml('<iframe src="data:text/html,<script>alert(1)</script>"></iframe>');
    expect(r).not.toContain('data:');
  });

  it('não se engana com tag aninhada dentro do nome da tag', () => {
    // O furo classico de sanitizador escrito com regex: tirar "<script>" do
    // meio deixa as pontas se juntarem e formarem a tag de novo.
    const r = sanitizarHtml('<scr<script>ipt>alert(1)</scr</script>ipt>');
    expect(r).not.toContain('alert(1)</scr');
    expect(r.toLowerCase()).not.toMatch(/<script/);
  });

  it('tira style, que posiciona coisa por cima da página', () => {
    const r = sanitizarHtml('<div style="position:fixed;inset:0;z-index:9999">x</div>');
    expect(r).not.toContain('position');
  });
});

describe('o que é conteúdo de verdade continua', () => {
  it('mantém a formatação de texto', () => {
    const r = sanitizarHtml('<h2>Título</h2><p><strong>a</strong> e <em>b</em></p><ul><li>x</li></ul>');
    expect(r).toContain('<h2>Título</h2>');
    expect(r).toContain('<strong>a</strong>');
    expect(r).toContain('<li>x</li>');
  });

  it('mantém a tabela, que é o motivo de o bloco de HTML existir', () => {
    const r = sanitizarHtml('<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>');
    expect(r).toContain('<th>A</th>');
    expect(r).toContain('<td>1</td>');
  });

  it('mantém o embed em https', () => {
    const r = sanitizarHtml('<iframe src="https://player.pandavideo.com.br/x" allowfullscreen></iframe>');
    expect(r).toContain('https://player.pandavideo.com.br/x');
    expect(r).toContain('allowfullscreen');
  });

  it('mantém o texto de uma tag desconhecida, em vez de apagar junto', () => {
    // Colar de um site traz `<section>`, `<article>`, `<font>`. Perder a moldura
    // e manter o texto e o certo -- apagar tudo faria o embed sumir calado.
    const r = sanitizarHtml('<section><p>importante</p></section>');
    expect(r).toContain('importante');
  });

  it('força noopener no link externo', () => {
    // Sem isso a pagina de destino consegue trocar o endereco desta.
    const r = sanitizarHtml('<a href="https://exemplo.com">x</a>');
    expect(r).toContain('rel="noopener noreferrer"');
    expect(r).toContain('target="_blank"');
  });

  it('aceita link relativo e mailto', () => {
    expect(sanitizarHtml('<a href="/processos">x</a>')).toContain('/processos');
    expect(sanitizarHtml('<a href="mailto:a@b.com">x</a>')).toContain('mailto:');
  });

  it('não quebra com entrada vazia', () => {
    expect(sanitizarHtml('')).toBe('');
  });
});
