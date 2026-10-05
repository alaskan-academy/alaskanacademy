/**
 * Link de um processo para outro navega pelo router, e não recarrega a página.
 *
 * ── Por que isto passou a importar em 05/10/2026 ──────────────────────────
 *
 * O SOP de Edição entrou nos Processos como CINCO artigos que apontam entre
 * si: um hub com a matriz de navegação e quatro módulos, cada um com link de
 * volta. O hub também aponta para "Nomenclatura de Arquivos" e para o
 * "Checklist de Revisão de ADs".
 *
 * O conteúdo de um artigo é HTML em string, escrito no editor. Um
 * `<a href="/processos/...">` ali dentro é âncora de verdade, não `<Link>`, e
 * âncora recarrega a aplicação inteira. Com as rotas em `lazy()`, cada pulo
 * entre módulos custava o bundle de novo, justo no lugar desenhado para ser
 * clicado o tempo todo.
 *
 * Não dá para resolver trocando por `<Link>`: ninguém escreve JSX no editor de
 * processos. Por isso o clique é interceptado uma vez, no BlocosRenderer.
 *
 * ── O que este teste protege ──────────────────────────────────────────────
 *
 * Interceptar clique é fácil de fazer DEMAIS. Quem segura ctrl para abrir em
 * outra aba, ou clica num link externo, espera o comportamento do navegador,
 * e um `preventDefault()` largo tira isso sem nada na tela explicando. Então
 * aqui estão os dois lados: o que tem de ser interceptado e o que não pode.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { BlocosRenderer, type Bloco } from '@/features/processos/components/BlocosRenderer';

/** Mostra onde o router está, para o teste ler sem espiar implementação. */
function Onde() {
  return <span data-testid="rota">{useLocation().pathname}</span>;
}

const BLOCOS: Bloco[] = [
  {
    tipo: 'texto',
    dados: {
      html:
        '<p>' +
        '<a href="/processos/abc-123">ir para o módulo</a>' +
        '<a href="https://www.canva.com/templates/x/">template no Canva</a>' +
        '<a href="//exemplo.com/fora">protocolo relativo</a>' +
        '</p>',
    },
  },
];

function montar() {
  // O teste dos modificadores monta quatro vezes seguidas dentro do mesmo
  // `it`, e sem isto as quatro cópias coexistem: `getByText` acha quatro
  // links e falha por ambiguidade, não pelo que está sendo testado.
  cleanup();
  return render(
    <MemoryRouter initialEntries={['/processos/hub']}>
      <Onde />
      <Routes>
        <Route
          path="/processos/*"
          element={<BlocosRenderer blocos={BLOCOS} titulo="SOP de Edição" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * Clica e diz se o clique foi INTERCEPTADO.
 *
 * `fireEvent` embrulha em `act()`, então a navegação do router termina de
 * renderizar antes da asserção. Com `dispatchEvent` cru o `navigate()`
 * acontecia mas a tela ainda mostrava a rota antiga, e o teste acusava um
 * defeito que não existia.
 *
 * Ele devolve `false` quando o evento foi cancelado, que é exatamente o
 * `preventDefault()` que impede o navegador de recarregar a página.
 */
function interceptou(elemento: Element, extra: MouseEventInit = {}) {
  return !fireEvent.click(elemento, { button: 0, ...extra });
}

describe('link entre processos', () => {
  it('navega pelo router em vez de recarregar', () => {
    montar();
    expect(screen.getByTestId('rota')).toHaveTextContent('/processos/hub');

    const pego = interceptou(screen.getByText('ir para o módulo'));

    // `defaultPrevented` é o que impede o navegador de recarregar.
    expect(pego, 'o clique não foi interceptado: a página recarregaria').toBe(true);
    expect(screen.getByTestId('rota')).toHaveTextContent('/processos/abc-123');
  });

  it('ctrl e cmd continuam abrindo em outra aba', () => {
    /*
      O gesto é do navegador e existe em todo lugar. Interceptá-lo faria o link
      abrir na mesma aba quando a pessoa pediu justamente o contrário, e ela
      perderia o lugar onde estava lendo.
    */
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) {
      montar();
      const pego = interceptou(screen.getByText('ir para o módulo'), mod);
      expect(pego, `${JSON.stringify(mod)} foi interceptado`).toBe(false);
      expect(screen.getByTestId('rota')).toHaveTextContent('/processos/hub');
    }
  });

  it('link externo segue sendo do navegador', () => {
    /*
      O sanitizador já põe target="_blank" e rel="noopener" em link http. Se o
      router pegasse esse clique, ele tentaria navegar para uma rota que não
      existe e a tela ficaria em branco.
    */
    montar();
    const pego = interceptou(screen.getByText('template no Canva'));
    expect(pego).toBe(false);
    expect(screen.getByTestId('rota')).toHaveTextContent('/processos/hub');
  });

  it('barra dupla é endereço de fora, não caminho interno', () => {
    /*
      `//exemplo.com` começa com barra e NÃO é interno: é o mesmo protocolo da
      página, outro domínio. Tratar como rota mandaria o router para
      "/exemplo.com/fora" e a pessoa veria um 404 do painel no lugar do site.
    */
    montar();
    const pego = interceptou(screen.getByText('protocolo relativo'));
    expect(pego).toBe(false);
    expect(screen.getByTestId('rota')).toHaveTextContent('/processos/hub');
  });
});
