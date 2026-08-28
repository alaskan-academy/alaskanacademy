/**
 * Clique que não confunde arrasto com clique.
 *
 * O PROBLEMA
 *
 * Linha de tabela clicável (Vendas, UTM, Financeiro, Criativos…) abre o
 * detalhe no `onClick`. Só que selecionar texto com o mouse TERMINA num
 * clique: arrastar sobre o código do pedido seleciona o texto e, no instante
 * em que se solta o botão, o modal abre, rouba o foco e cobre a tela — antes
 * de dar tempo de apertar Ctrl+C.
 *
 * O efeito para quem usa é "não consigo copiar nada do dashboard". Não era o
 * CSS: `user-select` está `auto` na cadeia inteira, e a seleção realmente
 * acontece — ela só não sobrevive ao que vem depois.
 *
 * A REGRA
 *
 * Se o ponteiro andou mais que o limiar entre apertar e soltar, foi arrasto, e
 * arrasto não abre nada. Medir deslocamento é melhor que perguntar
 * `getSelection()`: funciona também onde não há texto selecionável, e não
 * confunde uma seleção antiga feita em outro canto da tela com a intenção
 * atual.
 *
 * Os 4px são o que os próprios navegadores usam para separar clique de arrasto
 * — abaixo disso é tremida de mão, não intenção.
 */

const LIMIAR_PX = 4;

let inicioX = 0;
let inicioY = 0;

/*
  Um ouvinte só, na fase de captura, para registrar onde o clique começou.

  Em captura porque ele precisa rodar ANTES de qualquer `onMouseDown` da
  aplicação, e um por documento porque a alternativa — cada linha guardando a
  própria posição — seria o mesmo estado repetido em toda tabela do projeto.
*/
if (typeof document !== 'undefined') {
  document.addEventListener(
    'mousedown',
    (e) => {
      inicioX = e.clientX;
      inicioY = e.clientY;
    },
    true,
  );
}

/** Andou o bastante para ser arrasto? Puro, para poder ser testado. */
export function ehArrasto(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  limiar = LIMIAR_PX,
): boolean {
  return Math.abs(x1 - x0) > limiar || Math.abs(y1 - y0) > limiar;
}

/**
 * Envolve a ação de clique de uma linha: `onClick={aoClicarSemArrastar(() => abrir(x))}`.
 *
 * Teclado não passa por aqui: `clientX`/`clientY` vêm zerados num clique
 * disparado por Enter, e comparar zero com a última posição do mouse recusaria
 * o acionamento. Por isso o caso sem coordenada é tratado como clique.
 */
export function aoClicarSemArrastar<E extends { clientX: number; clientY: number; detail?: number }>(
  acao: () => void,
): (e: E) => void {
  return (e) => {
    const porTeclado = e.detail === 0 || (e.clientX === 0 && e.clientY === 0);
    if (!porTeclado && ehArrasto(inicioX, inicioY, e.clientX, e.clientY)) return;
    acao();
  };
}
