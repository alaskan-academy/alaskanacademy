/**
 * O multiplicador de comissão, lido de um campo de texto.
 *
 * ── Por que isto existe ────────────────────────────────────────────────────
 *
 * Porque `parseFloat(x) || 1` estava em duas telas de cargo — a viva,
 * `SetoresTab`, e uma segunda que ninguém montava e foi removida junto — e as
 * duas tinham o mesmo defeito: **zero é falsy**. `parseFloat('0')` dá `0`, e
 * `0 || 1` dá `1`. Digitar 0 salvava 1, sem erro e sem aviso, e a prévia
 * "Valor atual" mentia junto.
 *
 * Havia um TERCEIRO esconderijo, que sobreviveu ao primeiro conserto por não
 * ter a forma `|| 1`: o pré-preenchimento do formulário,
 * `initial?.multiplicador ? String(...) : '1.00'`. O card mostrava 0.00x e o
 * formulário abria com 1,00 — quem editasse a cor e salvasse zerava a correção
 * sem ver. É por isso que a guarda em `multiplicador-zero.test.ts` proíbe usar
 * `multiplicador` como condição sozinho, e não só as duas formas conhecidas.
 *
 * Isso importa porque zero É um valor legítimo: o contratado em período de
 * teste não ganha comissão. O campo até aceitava (`min="0"` no input); quem
 * recusava era o `|| 1`.
 *
 * ── A distinção que o `||` não sabe fazer ──────────────────────────────────
 *
 * O `|| 1` existia por um motivo real: campo vazio ou texto inválido precisa
 * cair em algum valor, e 1 (neutro) é o certo. O que faltava era separar
 * "não informado" de "informado como zero" — e é isso que `Number.isFinite`
 * faz e o `||` não.
 *
 * ── Negativo não é zero ────────────────────────────────────────────────────
 *
 * Multiplicador negativo faria a comissão virar desconto, o que ninguém quis
 * digitar de propósito. Em vez de silenciosamente virar 1 — que seria o mesmo
 * erro de novo, só que de outro jeito — ele é RECUSADO, e quem chama avisa.
 */
export const MULT_PADRAO = 1;

export interface MultiplicadorLido {
  /** O número a gravar. Só é válido quando `erro` é nulo. */
  valor: number;
  /** O que dizer a quem digitou, quando não dá para aceitar. */
  erro: string | null;
}

export function lerMultiplicador(texto: string | number | null | undefined): MultiplicadorLido {
  const n = parseFloat(String(texto ?? '').replace(',', '.'));

  /* Vazio ou inválido cai no neutro — é o comportamento que o `|| 1` tinha e
     que continua certo. Zero NÃO entra aqui: `Number.isFinite(0)` é true. */
  if (!Number.isFinite(n)) return { valor: MULT_PADRAO, erro: null };

  if (n < 0) {
    return { valor: MULT_PADRAO, erro: 'Multiplicador não pode ser negativo — use 0 para "sem comissão".' };
  }

  return { valor: n, erro: null };
}

/**
 * O número que ESTÁ GRAVADO, para ler e para calcular.
 *
 * ── Por que não é `lerMultiplicador` ───────────────────────────────────────
 *
 * Porque as duas funções respondem perguntas diferentes, e usar uma no lugar
 * da outra reintroduz o defeito que este arquivo existe para matar.
 *
 *   `lerMultiplicador` responde "posso GRAVAR isto?" — e por isso recusa
 *   negativo, devolvendo o neutro junto com um `erro` para quem chamou avisar.
 *
 *   `valorGravado` responde "o que está LÁ?" — e aí o negativo tem que
 *   aparecer. Uma revisão adversarial em 28/09 mediu o estrago da confusão:
 *   `UsuarioPerfisTab` gravava com `parseFloat` cru, então um `-1` digitado
 *   chegava ao banco (não há CHECK em `editores_remuneracao` nem em `cargos`);
 *   e a tela, lendo por `lerMultiplicador`, mostrava **1.00x**. Banco com -1,
 *   tela com 1,00 — exatamente a forma do defeito de hoje de manhã, só que
 *   com o meu próprio remédio.
 *
 * Mascarar um valor ruim é pior que mostrá-lo: enquanto -1 aparece como 1.00x,
 * ninguém conserta, porque ninguém vê.
 */
function valorGravado(m: string | number | null | undefined): number {
  const n = parseFloat(String(m ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : MULT_PADRAO;
}

/**
 * Como o multiplicador aparece na tela.
 *
 * Estava duplicado em TRÊS arquivos, idêntico — `SetoresTab`,
 * `UsuarioPerfisTab` e a tela de cargos já removida — e foi lado a lado com a
 * duplicação do `|| 1` que o defeito nasceu duas vezes.
 *
 * Mostra o que está gravado, inclusive quando está errado. Ver `valorGravado`.
 */
export function fmtMult(m: string | number | null | undefined): string {
  return `${valorGravado(m).toFixed(2)}x`;
}

/**
 * Qual multiplicador vale para uma pessoa: o individual, o do cargo, ou 1.
 *
 * ── O buraco que isto fecha ────────────────────────────────────────────────
 *
 * `UsuarioPerfisTab` escreve, ao lado do campo, "(padrão do cargo: 1.20x)", e
 * usa esse número como placeholder. Mas o cálculo NUNCA olhava o cargo: quem
 * não tinha multiplicador individual caía no literal `1`, em três lugares de
 * `AvaliacoesTab`. O rótulo dizia "padrão" de uma coisa que não era padrão de
 * nada — e `cargos.multiplicador`, a coluna inteira, não multiplicava nada em
 * lugar nenhum do sistema. É a segunda armadilha do CLAUDE.md: campo cadastrado
 * sem nada do outro lado medindo se ele vale.
 *
 * Isso ficou visível ao atender o pedido do multiplicador ZERO. Zerar o cargo
 * "Novato" para o contratado em período de teste não ia zerar comissão
 * nenhuma: sem valor individual, a conta usaria 1 e pagaria cheio, em silêncio
 * e com a tela mostrando 0.00x. Mentir sobre dinheiro é pior que recusar.
 *
 * ── Por que a ordem é individual → cargo → 1 ───────────────────────────────
 *
 * Individual ganha porque é o ajuste fino de uma pessoa; o cargo é a regra da
 * faixa; e 1 (neutro) é o que sobra quando não há nem cargo. `!= null` em vez
 * de `||` nos dois degraus — senão zero, que É o valor que motivou tudo isto,
 * escorregaria para o degrau seguinte.
 *
 * Medido em 28/09/2026 antes de mudar: 2 editores, os dois com multiplicador
 * individual, e 0 cargos zerados. Nenhuma avaliação existente muda de valor —
 * as 8 sem snapshot pertencem a esses mesmos dois. A mudança só passa a valer
 * no dia da próxima contratação, que é exatamente quando ela precisa valer.
 */
export function multiplicadorEfetivo(
  individual: number | string | null | undefined,
  doCargo: number | string | null | undefined,
): number {
  /* `valorGravado`, não `lerMultiplicador`: aqui a pergunta é o que ESTÁ
     gravado, e um valor ruim tem que chegar à conta e à tela em vez de virar
     1 no caminho. Recusar negativo é trabalho de quem GRAVA. */
  if (individual != null && individual !== '') return valorGravado(individual);
  if (doCargo != null && doCargo !== '') return valorGravado(doCargo);
  return MULT_PADRAO;
}
