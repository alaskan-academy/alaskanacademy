/**
 * As fases da produção vivem em `producao_fases`, não numa lista no código.
 *
 * ── O que este teste está impedindo de voltar ──────────────────────────────
 *
 * Em 31/08/2026 o banco tinha 14 fases e o código tinha 10. A diferença eram
 * exatamente Bloqueado e Arquivado, e o preço foi este:
 *
 *  · 741 cards arquivados abriam o drawer com o campo Fase EM BRANCO, porque a
 *    fase deles não estava entre as opções do seletor;
 *  · não existia caminho nenhum na interface para arquivar um card.
 *
 * Nada disso deu erro. A lista estava sintaticamente perfeita; ela só estava
 * desatualizada. É a terceira armadilha do CLAUDE.md — lista fixa no código
 * que envelhece em silêncio — e o único jeito de ela não voltar é um teste que
 * falhe quando alguém escrever a próxima.
 *
 * ── E a segunda regra, sobre o motivo ──────────────────────────────────────
 *
 * Arquivar passou a pedir uma explicação escrita. Isso vale para TODO caminho
 * que grava fase — hoje o seletor do drawer e o lote do Calendário. Pedir em
 * um dos dois é pior que não pedir em nenhum: aí o campo existe, parece
 * confiável, e está vazio de vez em quando. É por isto que a regra é um teste
 * e não um combinado: o próximo caminho que alguém escrever cai aqui.
 *
 * Por isso o teste lê o CÓDIGO em vez do banco: contra o banco os dois defeitos
 * são invisíveis, porque o banco está certo nos dois casos.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function arquivosDe(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivosDe(caminho, acc);
    else if (/\.tsx?$/.test(nome)) acc.push(caminho);
  }
  return acc;
}

/**
 * O código sem os comentários.
 *
 * Um comentário citando `motivo` faria o teste dar por cumprida uma regra que
 * o código não cumpre — e este arquivo mesmo cita as chaves de fase várias
 * vezes na explicação acima.
 */
function semComentarios(conteudo: string): string {
  return conteudo
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

const ARQUIVOS = arquivosDe('src').filter(f => !f.includes(`${'test'}`));

describe('a lista de fases não volta para o código', () => {
  /**
   * As chaves que uma lista literal de fases teria. Três juntas num mesmo
   * literal é assinatura de fluxo escrito à mão — uma sozinha pode ser uma
   * comparação legítima (`fase === 'edicao'`), e essa continua permitida.
   */
  const CHAVES = [
    'producao_copy', 'revisao_copy', 'gravacao', 'revisao_gravacao',
    'edicao', 'revisao_edicao', 'alteracao', 'aprovado', 'esteira_teste',
    'postado', 'na_plataforma', 'bloqueado', 'arquivado',
  ];

  /*
    Aqui existiu um `DIVIDA_CONHECIDA` com duas exceções, e ele durou meio dia.

    Eram `FASES_CONCLUIDAS` e `FASES_REQUER_LINK`. Eu as declarei como dívida
    porque as duas eram lidas por `CriativoCard`, e achei que puxar o hook num
    componente-folha renderizado centenas de vezes custaria mais do que a
    divergência que evitava.

    A premissa estava errada, e só apareceu quando fui consertar: `CriativoCard`
    era renderizado apenas pelo Kanban, que já estava fora de rota desde julho e
    foi apagado. Ninguém o renderizava — nem centenas de vezes, nem uma. O peso
    que justificava a exceção não existia.

    Fica o registro porque a lição não é sobre estas duas listas: uma exceção
    baseada em custo que ninguém mediu é palpite com aparência de decisão. Se
    outra precisar entrar aqui, que venha com o número junto.
  */

  it('nenhum arquivo escreve um fluxo de fases à mão', () => {
    const culpados: string[] = [];

    for (const arquivo of ARQUIVOS) {
      const limpo = semComentarios(readFileSync(arquivo, 'utf8'));

      // Um array literal com três ou mais chaves de fase dentro.
      for (const [literal] of limpo.matchAll(/\[[^[\]]{0,400}?\]/g)) {
        const quantas = CHAVES.filter(c => literal.includes(`'${c}'`) || literal.includes(`"${c}"`)).length;
        if (quantas < 3) continue;
        culpados.push(`${arquivo}: ${literal.slice(0, 90)}`);
      }
    }

    expect(culpados, [
      'Uma lista de fases voltou para o código.',
      'Ela vai divergir do banco — foi assim que 741 cards arquivados ficaram',
      'sem opção no seletor. Use `fasesDoTipo(fases, tipo)` de `useFases`.',
    ].join(' ')).toEqual([]);
  });

  it('`fasesVizinhas` pergunta à tabela quem está fora do fluxo', () => {
    // Antes eram as chaves 'bloqueado' e 'arquivado' escritas dentro da função:
    // a próxima saída que alguém cadastrasse entraria no avançar/voltar sem
    // ninguém perceber.
    const fonte = semComentarios(readFileSync('src/features/producao/useFases.ts', 'utf8'));
    expect(fonte).toContain('fora_do_fluxo');
    expect(fonte).not.toContain("'bloqueado'");
    expect(fonte).not.toContain("'arquivado'");
  });
});

describe('quem grava fase pergunta o motivo', () => {
  /**
   * Onde uma linha de fase é escrita no histórico, com vizinhança suficiente
   * para ver se `motivo` acompanha.
   */
  function gravacoesDeFase(conteudo: string): string[] {
    const limpo = semComentarios(conteudo);
    const achados: string[] = [];
    const re = /campo_alterado:\s*['"]fase['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(limpo))) {
      // O objeto do insert acaba bem antes disso; 300 caracteres cobrem o
      // resto das chaves com folga.
      achados.push(limpo.slice(m.index, m.index + 300));
    }
    return achados;
  }

  it('toda escrita de fase no histórico carrega `motivo`', () => {
    const culpados: string[] = [];

    for (const arquivo of ARQUIVOS) {
      for (const trecho of gravacoesDeFase(readFileSync(arquivo, 'utf8'))) {
        if (!trecho.includes('motivo')) culpados.push(`${arquivo}: ${trecho.slice(0, 80)}`);
      }
    }

    expect(culpados, [
      'Um caminho grava fase sem passar o motivo.',
      'Arquivar pede explicação; um caminho que não pede deixa o campo vazio',
      'de vez em quando, e um campo assim é pior que campo nenhum.',
      'Use `usePedirMotivo()` antes de gravar.',
    ].join(' ')).toEqual([]);
  });
});
