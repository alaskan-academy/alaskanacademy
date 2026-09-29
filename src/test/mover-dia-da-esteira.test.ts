/**
 * Mover um dia inteiro da esteira de teste.
 *
 * O gestor marca o teste com antecedência e nem sempre sobe no dia marcado.
 * Sem um jeito de mover o bloco, remarcar oito ADs era abrir oito cards, um a
 * um — e o que acontecia na prática era o dia ficar mentindo: a esteira dizia
 * 21/09 e os anúncios subiram no 28.
 *
 * ── Por que NÃO deu para reusar o que já existia ──────────────────────────
 *
 * `fn_enviar_para_esteira` parece servir: ela recebe ids, uma data e grava.
 * Só que o WHERE dela é `fase = 'aprovado'`, e estes cards já estão em
 * `esteira_teste`. Rodá-la aqui devolveria 0 sem erro nenhum: o botão
 * pareceria funcionar, o toast diria "movido" e nada mudaria.
 *
 * Daí a função nova, `fn_remarcar_esteira`, com duas travas medidas contra o
 * banco em 28/09/2026: card em `edicao` devolve 0 e não tem a data alterada;
 * lista vazia devolve 0 sem explodir.
 *
 * ── E a trava que mora no frontend ────────────────────────────────────────
 *
 * A função pode devolver 0 legitimamente — todo mundo já estava naquela data,
 * ou nenhum id estava na esteira. Sem checar isso antes do toast de sucesso, a
 * tela mente exatamente como mentiria com a função errada. É o mesmo defeito,
 * só que um nível acima, e é esse o teste que importa aqui.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ler = (p: string) =>
  readFileSync(join(process.cwd(), p), 'utf8')
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')
    .replace(/\/\/[^\n]*/g, '');

const PAINEL  = 'src/features/producao/components/gestor/PainelGestorView.tsx';
const ESTEIRA = 'src/features/producao/components/gestor/EsteiraPorDia.tsx';
const painel  = ler(PAINEL);
const esteira = ler(ESTEIRA);

describe('mover um dia da esteira', () => {
  it('usa a função própria, e não a de enviar para a esteira', () => {
    expect(painel, `${PAINEL}: sumiu a chamada de fn_remarcar_esteira`).toMatch(
      /rpc\(\s*'fn_remarcar_esteira'/,
    );
    // `fn_enviar_para_esteira` continua existindo para a FILA. O que não pode
    // é ela virar o caminho do remarcar: lá o WHERE é `fase = 'aprovado'`.
    const trecho = painel.slice(painel.indexOf('remarcarDia'));
    const ateOFim = trecho.slice(0, trecho.indexOf('if (carregando)'));
    expect(ateOFim, 'remarcar não pode chamar a função da fila').not.toMatch(
      /fn_enviar_para_esteira/,
    );
  });

  it('não diz que moveu quando o banco devolveu zero', () => {
    // A trava central. `fn_remarcar_esteira` devolve 0 quando nenhum id casa,
    // e 0 com toast de sucesso é a tela mentindo.
    const trecho = painel.slice(painel.indexOf("rpc('fn_remarcar_esteira'"));
    const ateOToast = trecho.slice(0, trecho.indexOf('void carregar()'));
    expect(ateOToast, `${PAINEL}: falta a guarda contra o zero silencioso`).toMatch(
      /if\s*\(\s*!n\s*\)/,
    );
    // E a guarda tem de sair ANTES do toast de sucesso, não depois.
    expect(
      ateOToast.indexOf('if (!n)'),
      'a guarda precisa vir antes do toast de sucesso',
    ).toBeLessThan(ateOToast.lastIndexOf('toast('));
  });

  it('mover data não é ação destrutiva', () => {
    /*
      `useConfirm` pinta o botão de vermelho por padrão, porque quase todo
      chamador dele é exclusão: `opts.destructive !== false`. Aqui não se perde
      nada, a data volta com outro clique. Vermelho é marca e prejuízo — se ele
      aparece onde não há prejuízo, deixa de avisar onde há.
    */
    const trecho = painel.slice(painel.indexOf('remarcarDia'));
    const ateOConfirm = trecho.slice(0, trecho.indexOf('if (!ok) return'));
    expect(ateOConfirm, `${PAINEL}: o confirm de mover voltou a ser destrutivo`).toMatch(
      /destructive:\s*false/,
    );
  });

  it('manda o dia inteiro, e não só o primeiro card', () => {
    // O alvo é o BLOCO. Mandar `cards[0]` moveria um card e deixaria sete
    // parados no dia errado, sem nada na tela denunciando.
    expect(esteira, `${ESTEIRA}: o bloco parou de mandar todos os cards`).toMatch(
      /onRemarcar\([^)]*d\.cards\.map\(c => c\.id\)/,
    );
  });

  it('o confirm diz quantos cards se movem e para onde', () => {
    // Ação em lote sem o número é a pessoa apostando. O CLAUDE.md pede
    // confirmação em ação em lote, e confirmação vaga não confirma nada.
    const trecho = painel.slice(painel.indexOf('remarcarDia'));
    const ateOConfirm = trecho.slice(0, trecho.indexOf('if (!ok) return'));
    expect(ateOConfirm, 'o confirm precisa citar a quantidade').toMatch(/ids\.length/);
    expect(ateOConfirm, 'o confirm precisa citar a data de destino').toMatch(/nomePara/);
  });
});
