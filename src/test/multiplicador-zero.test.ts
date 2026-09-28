/**
 * Zero é um multiplicador, não a ausência de um.
 *
 * ── O defeito ──────────────────────────────────────────────────────────────
 *
 * `parseFloat(x) || 1` estava duplicado em duas telas de cargo (`SetoresTab`, a
 * viva, e `CargosTab`, que já não era montada por ninguém e foi removida). O
 * `||` não distingue "não informado" de "informado como zero", porque zero é
 * falsy: `parseFloat('0')` dá `0`, e `0 || 1` dá `1`. Digitar 0 salvava 1, sem
 * erro, sem aviso, e a prévia "Valor atual" mentia junto — dizia 1.00x.
 *
 * O zero tinha TRÊS esconderijos, não dois, e o terceiro sobreviveu ao primeiro
 * conserto: o pré-preenchimento do formulário em `SetoresTab`. Ver o teste
 * "usa `multiplicador` como condição de ternário", lá embaixo.
 *
 * Zero é legítimo: o contratado em período de teste não ganha comissão. O banco
 * já aceitava (`numeric NOT NULL DEFAULT 1.0`, sem CHECK) e o campo também
 * (`min="0"`). Quem recusava era só o `|| 1`.
 *
 * ── O buraco maior que apareceu junto ──────────────────────────────────────
 *
 * Ao conferir para onde o número ia, `cargos.multiplicador` não multiplicava
 * NADA: `AvaliacoesTab` caía no literal `1` quando não havia multiplicador
 * individual, em três lugares, e nenhuma view ou função do banco lê a coluna.
 * Enquanto isso `UsuarioPerfisTab` escreve "(padrão do cargo: 1.20x)" ao lado
 * do campo. Zerar o cargo "Novato" mostraria 0.00x na tela e pagaria cheio na
 * conta — mentir sobre dinheiro é pior que recusar.
 *
 * `multiplicadorEfetivo` é esse degrau que faltava: individual → cargo → 1.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  lerMultiplicador,
  fmtMult,
  multiplicadorEfetivo,
  MULT_PADRAO,
} from '@/features/admin/multiplicador';

describe('zero é um multiplicador', () => {
  it('zero é lido como zero, não como 1', () => {
    expect(lerMultiplicador('0')).toEqual({ valor: 0, erro: null });
    expect(lerMultiplicador(0)).toEqual({ valor: 0, erro: null });
    expect(lerMultiplicador('0.00')).toEqual({ valor: 0, erro: null });
    expect(lerMultiplicador('0,00')).toEqual({ valor: 0, erro: null });
  });

  it('a prévia da tela mostra 0.00x, e não 1.00x', () => {
    /* Este era o segundo estrago: mesmo antes de salvar, o "Valor atual" já
       dizia 1.00x para quem tinha digitado 0. */
    expect(fmtMult('0')).toBe('0.00x');
    expect(fmtMult(0)).toBe('0.00x');
  });

  it('vazio e lixo continuam caindo no neutro — era o que o `|| 1` fazia certo', () => {
    expect(lerMultiplicador('')).toEqual({ valor: MULT_PADRAO, erro: null });
    expect(lerMultiplicador(null)).toEqual({ valor: MULT_PADRAO, erro: null });
    expect(lerMultiplicador(undefined)).toEqual({ valor: MULT_PADRAO, erro: null });
    expect(lerMultiplicador('abc')).toEqual({ valor: MULT_PADRAO, erro: null });
  });

  it('negativo é recusado em voz alta, não convertido em silêncio', () => {
    /* Virar 1 calado seria repetir o mesmo erro por outro caminho: o número
       que a pessoa vê depois não é o que ela digitou. */
    const r = lerMultiplicador('-1');
    expect(r.erro).toBeTruthy();
    expect(r.erro).toMatch(/negativ/i);
  });

  it('os números normais continuam passando', () => {
    expect(lerMultiplicador('1.2').valor).toBe(1.2);
    expect(lerMultiplicador('0.7').valor).toBe(0.7);
    expect(fmtMult('1.4')).toBe('1.40x');
  });
});

describe('ler o que está gravado não é o mesmo que decidir o que gravar', () => {
  /*
   * ── O defeito que o próprio remédio tinha ─────────────────────────────────
   *
   * `fmtMult` e `multiplicadorEfetivo` chamavam `lerMultiplicador`, que RECUSA
   * negativo devolvendo o neutro. Como o `.erro` era descartado nesse caminho,
   * um `-1` gravado aparecia na tela como **1.00x**.
   *
   * E chegar ao banco era fácil: `UsuarioPerfisTab` salvava com `parseFloat`
   * cru, e não há CHECK em `editores_remuneracao` nem em `cargos` (medido).
   * Banco com -1, tela com 1,00 — a forma exata do defeito que estes commits
   * foram matar, sobrevivendo dentro da correção. Achado em revisão
   * adversarial em 28/09.
   *
   * As duas perguntas são diferentes e agora têm respostas diferentes:
   *   "posso gravar isto?" -> lerMultiplicador, que recusa
   *   "o que está lá?"     -> o número, inclusive quando está errado
   *
   * Mascarar valor ruim é pior que mostrá-lo: enquanto -1 aparece como 1.00x,
   * ninguém conserta, porque ninguém vê.
   */
  it('um negativo gravado APARECE, em vez de virar 1.00x', () => {
    expect(fmtMult(-1)).toBe('-1.00x');
    expect(fmtMult('-0.5')).toBe('-0.50x');
  });

  it('e chega à conta como negativo, sem ser normalizado no caminho', () => {
    expect(multiplicadorEfetivo(-1, 1.2)).toBe(-1);
    expect(multiplicadorEfetivo(null, -2)).toBe(-2);
  });

  it('mas gravar um negativo continua sendo recusado', () => {
    /* A recusa é trabalho de quem ESCREVE. Se ela também morasse na leitura,
       a tela mentiria sobre o que está no banco — que é justamente o defeito. */
    expect(lerMultiplicador(-1).erro).toBeTruthy();
    expect(lerMultiplicador('-0.5').erro).toBeTruthy();
  });

  it('texto que não é número continua caindo no neutro, não em NaN', () => {
    expect(fmtMult('abc')).toBe('1.00x');
    expect(fmtMult(null)).toBe('1.00x');
    expect(multiplicadorEfetivo('abc', null)).toBe(MULT_PADRAO);
  });
});

describe('o multiplicador do cargo vale para quem não tem individual', () => {
  it('individual ganha do cargo', () => {
    expect(multiplicadorEfetivo(1.1, 1.2)).toBe(1.1);
  });

  it('sem individual, vale o do cargo — era aqui que caía no literal 1', () => {
    expect(multiplicadorEfetivo(null, 0.7)).toBe(0.7);
    expect(multiplicadorEfetivo(undefined, '1.2')).toBe(1.2);
    expect(multiplicadorEfetivo('', 1.3)).toBe(1.3);
  });

  it('cargo zerado zera de verdade — é o pedido inteiro num caso só', () => {
    expect(multiplicadorEfetivo(null, 0)).toBe(0);
    expect(multiplicadorEfetivo(null, '0')).toBe(0);
  });

  it('individual zero também vale, mesmo com o cargo cheio', () => {
    expect(multiplicadorEfetivo(0, 1.4)).toBe(0);
  });

  it('sem nenhum dos dois, o neutro', () => {
    expect(multiplicadorEfetivo(null, null)).toBe(MULT_PADRAO);
    expect(multiplicadorEfetivo(undefined, undefined)).toBe(MULT_PADRAO);
  });
});

describe('a regra mora num lugar só', () => {
  /*
   * O defeito existiu duas vezes porque a lógica existia duas vezes, e o
   * `fmtMult` estava copiado em TRÊS arquivos. Enquanto o cálculo estiver
   * escrito à mão em cada tela, consertar um lugar não conserta os outros.
   */
  const TELAS = [
    'src/features/admin/components/SetoresTab.tsx',
    'src/features/admin/components/UsuarioPerfisTab.tsx',
    'src/features/editores/components/AvaliacoesTab.tsx',
  ];

  const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  it('nenhuma tela faz o fallback do multiplicador à mão', () => {
    const culpados: string[] = [];

    for (const tela of TELAS) {
      const src = ler(tela);
      /* Sem comentários: este arquivo e os que ele guarda EXPLICAM o `|| 1` em
         prosa, e casar com a explicação daria um passe falso — foi assim que o
         teste do empate quase passou cego em 24/09. */
      const codigo = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

      if (/multiplicador[^;\n]*\|\|\s*1\b/i.test(codigo)) {
        culpados.push(`${tela}: \`multiplicador || 1\` — zero é falsy e vira 1`);
      }
      /* O fallback ternário para o literal 1, que era o mesmo defeito escrito
         de outro jeito: `x.multiplicador != null ? Number(...) : 1`. */
      if (/multiplicador[^;\n]*\?[^;\n]*:\s*1\s*[),;]/i.test(codigo)) {
        culpados.push(`${tela}: cai no literal 1 em vez do multiplicador do cargo`);
      }
      /*
       * O terceiro esconderijo, que os dois de cima NÃO pegavam e por isso
       * sobreviveu ao conserto de 28/09: testar `multiplicador` pela
       * VERACIDADE, não por nulidade.
       *
       *   useState(initial?.multiplicador ? String(initial.multiplicador) : '1.00')
       *
       * O regex de cima procura `: 1` e aqui vem `: '1.00'` entre aspas, então
       * passava batido. Medido na tela: o card do cargo "Novato" mostrava
       * 0.00x e o formulário de edição abria com 1,00 — quem mexesse na cor e
       * salvasse zerava a correção sem ver.
       *
       * A regra geral, que não depende de adivinhar o valor do outro lado dos
       * dois-pontos: `multiplicador` nunca é condição sozinho. Sempre `!= null`
       * (ou `??`, que este regex deixa passar de propósito — nullish não engole
       * zero).
       */
      if (/multiplicador\s*\?(?![.?])/i.test(codigo)) {
        culpados.push(
          `${tela}: usa \`multiplicador\` como condição de ternário — zero é falsy. Compare com \`!= null\`.`,
        );
      }
      if (/const\s+fmtMult\s*=/.test(codigo)) {
        culpados.push(`${tela}: cópia local de \`fmtMult\` — use a de multiplicador.ts`);
      }
    }

    expect(
      culpados,
      `${culpados.join(' | ')}. A regra é uma só e mora em ` +
        `src/features/admin/multiplicador.ts: individual → cargo → 1, com ` +
        `\`!= null\` nos dois degraus para o zero não escorregar.`,
    ).toEqual([]);
  });

  it('as telas que salvam multiplicador importam a regra', () => {
    /* `UsuarioPerfisTab` entrou nesta lista em 28/09, depois de uma revisão
       adversarial mostrar que ela gravava o multiplicador INDIVIDUAL com
       `parseFloat` cru — fora da regra, e sem CHECK nenhum no banco atrás. */
    for (const tela of ['src/features/admin/components/SetoresTab.tsx',
                        'src/features/admin/components/UsuarioPerfisTab.tsx']) {
      expect(ler(tela), `${tela} não usa lerMultiplicador`).toMatch(/lerMultiplicador/);
    }

    /* E nenhuma delas pode voltar a converter texto em número por fora. */
    for (const tela of ['src/features/admin/components/SetoresTab.tsx',
                        'src/features/admin/components/UsuarioPerfisTab.tsx']) {
      const codigo = ler(tela).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(
        /parseFloat\s*\(\s*String\s*\(\s*f?\.?\w*[Mm]ultiplicador/.test(codigo),
        `${tela} converte o multiplicador com parseFloat cru, fora de lerMultiplicador`,
      ).toBe(false);
    }
    expect(
      ler('src/features/editores/components/AvaliacoesTab.tsx'),
      'AvaliacoesTab não usa multiplicadorEfetivo — o degrau do cargo sumiu',
    ).toMatch(/multiplicadorEfetivo/);
  });
});
