/**
 * Sem play não há taxa, e sem taxa não há comparação.
 *
 * ── O que a tela mostrava ─────────────────────────────────────────────────
 *
 * Em 04/10/2026 o teste A/B "MicroLead 01 vs MicroLead 02" estava com ZERO
 * plays nos dois lados. A segunda fonte confirmou: a sincronização de testes
 * do próprio VTurb gravou `views: 0, plays: 0, conversoes: 0` para os dois
 * players.
 *
 * E a tela mostrava, na linha do Pitch:
 *
 *     Pitch      9.1%      23.3%      ↑ 156.7%
 *
 * em verde. Os outros campos apareciam como `—` ou `0.0%`, que se lê como
 * vazio; o verde se lê como achado. Quem olhasse só aquela linha concluiria
 * que o lado B ganhou por 156%, num teste em que ninguém assistiu a nada.
 *
 * O rodapé do bloco já promete que "diferença pequena em poucos dias é ruído".
 * A mesma regra tem de valer para nenhum dia.
 *
 * ── E o erro tinha a mesma cara do vazio ──────────────────────────────────
 *
 * A edge function do VTurb responde 200 com `{ erro }` dentro: 429 por excesso
 * de chamadas, chave vencida, formato mudado. `buscarRetencao` não lia esse
 * campo, então todas essas falhas chegavam na tela como `—` e `0.0%`,
 * indistinguíveis de "ninguém deu play".
 *
 * Eram duas situações diferentes com a mesma aparência, e descobrir qual era
 * exigia ir ao banco. Agora quem falhou diz que falhou.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ler = (p: string) =>
  readFileSync(join(process.cwd(), p), 'utf8')
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')
    .replace(/\/\/[^\n]*/g, '');

const BLOCO = 'src/features/analises/components/BlocoPagina.tsx';
const FONTE = 'src/features/analises/retencao.ts';

describe('VSL sem play não vira comparação', () => {
  it('zero play e play nulo contam como sem base', () => {
    // Nulo é "a API não disse"; zero é "disse que foi zero". Nenhum dos dois
    // sustenta uma taxa, e tratar só o zero deixaria o nulo passando.
    const codigo = ler(BLOCO);
    expect(codigo, `${BLOCO}: sumiu a regra de base`).toMatch(
      /function semBase\(r: RetencaoVsl\): boolean \{\s*return r\.plays == null \|\| r\.plays === 0;/,
    );
  });

  it('o número do lado some quando aquele lado não teve play', () => {
    // Era isso que fazia "Pitch 9,1%" aparecer sobre zero plays.
    expect(ler(BLOCO), `${BLOCO}: o valor voltou a sair sem base`).toMatch(
      /rs\.map\(r => \(semBase\(r\) \? null : r\[campo\]/,
    );
  });

  it('a seta verde exige base nos DOIS lados', () => {
    /*
      Um lado com play e outro sem não é um teste: é um lado só, com um número
      ao lado de nada. `dois` sozinho não basta como condição.
    */
    const codigo = ler(BLOCO);
    expect(codigo, `${BLOCO}: sumiu a trava da comparação`).toMatch(
      /const podeComparar = dois && rs\.every\(r => !semBase\(r\)\)/,
    );
    expect(codigo, 'a variação precisa depender de poder comparar, não só de haver dois lados')
      .toMatch(/const v = podeComparar \? variacao\(/);
  });

  it('a coluna vazia diz por que está vazia', () => {
    // Sem isto a pessoa procura o defeito no painel, que foi o que aconteceu.
    expect(ler(BLOCO), `${BLOCO}: sumiu o aviso de sem play`).toMatch(
      /sem play no período/,
    );
  });

  it('falha do VTurb é lida, e não cai no chão', () => {
    /*
      Dois caminhos: `error` é a chamada que não completou, `data.erro` é a
      edge function dizendo que o VTurb recusou — ela responde 200 com a
      mensagem dentro. Ler só um deixaria metade das falhas calada.
    */
    const codigo = ler(FONTE);
    expect(codigo, `${FONTE}: parou de ler o erro de transporte`).toMatch(
      /stats\.error\?\.message/,
    );
    expect(codigo, `${FONTE}: parou de ler o erro que vem no corpo`).toMatch(
      /\?\.erro,/,
    );
    expect(codigo, `${FONTE}: o erro deixou de ser devolvido`).toMatch(
      /^\s*erro,$/m,
    );
  });

  it('a tela mostra a falha em vez de fingir vazio', () => {
    const codigo = ler(BLOCO);
    expect(codigo, `${BLOCO}: sumiu o aviso de falha do VTurb`).toMatch(
      /O VTurb não respondeu/,
    );
    // Em ambos os blocos: o teste A/B e a VSL única têm o mesmo defeito.
    expect((codigo.match(/O VTurb não respondeu/g) ?? []).length,
      'o aviso precisa existir nos dois blocos').toBe(2);
  });
});
