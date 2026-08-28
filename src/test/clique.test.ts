import { describe, expect, it, vi } from 'vitest';
import { aoClicarSemArrastar, ehArrasto } from '@/lib/clique';

/*
  O defeito que estes testes travam: arrastar para selecionar o código de um
  pedido abria o modal da venda no instante em que o botão era solto, e a
  seleção morria antes do Ctrl+C. A regra é "andou = arrasto".
*/
describe('ehArrasto', () => {
  it('parado é clique', () => {
    expect(ehArrasto(100, 100, 100, 100)).toBe(false);
  });

  it('tremida de mão continua sendo clique', () => {
    // 4px é o limiar; até ele, inclusive, ainda é clique.
    expect(ehArrasto(100, 100, 104, 100)).toBe(false);
    expect(ehArrasto(100, 100, 100, 104)).toBe(false);
    expect(ehArrasto(100, 100, 96, 96)).toBe(false);
  });

  it('passar do limiar em qualquer eixo é arrasto', () => {
    expect(ehArrasto(100, 100, 105, 100)).toBe(true);
    expect(ehArrasto(100, 100, 100, 105)).toBe(true);
  });

  it('vale para os dois sentidos — selecionar da direita para a esquerda também', () => {
    expect(ehArrasto(200, 100, 120, 100)).toBe(true);
  });
});

describe('aoClicarSemArrastar', () => {
  /*
    Sem `mousedown` registrado, a origem é (0,0) — o estado inicial do módulo.
    Um clique longe dali é, por definição, arrasto; um clique colado na origem
    é clique. É o suficiente para exercitar os dois caminhos sem simular o DOM.
  */
  it('não dispara a ação quando o ponteiro andou', () => {
    const acao = vi.fn();
    aoClicarSemArrastar(acao)({ clientX: 300, clientY: 200, detail: 1 });
    expect(acao).not.toHaveBeenCalled();
  });

  it('dispara quando o ponteiro ficou parado', () => {
    const acao = vi.fn();
    aoClicarSemArrastar(acao)({ clientX: 2, clientY: 2, detail: 1 });
    expect(acao).toHaveBeenCalledTimes(1);
  });

  it('dispara no acionamento por teclado, que não tem coordenada', () => {
    // Enter num elemento focado manda `detail: 0` e clientX/Y zerados; recusar
    // isso tornaria a linha inalcançável para quem navega por teclado.
    const acao = vi.fn();
    aoClicarSemArrastar(acao)({ clientX: 0, clientY: 0, detail: 0 });
    expect(acao).toHaveBeenCalledTimes(1);
  });
});
