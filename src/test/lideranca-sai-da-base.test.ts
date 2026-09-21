/**
 * A liderança sai da BASE do supervisionado, e o ajuste manual é um campo.
 *
 * ── As duas regras, e o que cada uma custou ────────────────────────────────
 *
 * 1. O bônus de liderança é uma fatia do que a equipe PRODUZIU — `bonus_estimado`,
 *    a soma pura dos critérios. Não do total dela.
 *
 *    `bonus_total` já vem multiplicado, e o multiplicador é individual: premia
 *    o desempenho daquela pessoa, não trabalho que passou pela supervisão de
 *    ninguém. Em agosto/2026 a supervisionada teve o primeiro multiplicador
 *    diferente de 1 e a liderança saiu R$ 10,56 maior do que devia
 *    (R$ 116,16 sobre R$ 580,80, quando o certo era R$ 105,60 sobre R$ 528,00).
 *    `bonus_total` ainda carrega ajuste manual e, se o supervisionado fosse ele
 *    próprio líder, abriria liderança em cascata.
 *
 * 2. Se o total foi digitado à mão, isso é um FATO gravado, não uma dedução.
 *
 *    Até 21/09/2026 o sistema adivinhava, comparando o total gravado com o
 *    recálculo. A inferência morre no instante em que a liderança muda: a
 *    partir daí um valor digitado e um valor velho ficam idênticos aos olhos da
 *    comparação, e o gatilho que mantém o líder em dia sobrescreveria
 *    lançamento feito a mão. Hoje são 5 das 16 avaliações, com ajustes de
 *    R$ 152 a R$ 194.
 *
 * Ver a migração `20260921a`.
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

/** Um comentário explicando a regra não pode fazer o teste passar. */
function semComentarios(conteudo: string): string {
  return conteudo
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

const ARQUIVOS = arquivosDe('src').filter(f => !f.includes('test'));

describe('liderança sai da base, e ajuste manual é campo', () => {
  it('nenhuma conta de liderança usa o total do supervisionado', () => {
    /*
      A janela é a linha e as duas seguintes: o `.reduce()` que soma a liderança
      costuma caber aí. Se `bonus_total` aparecer perto de algo que fala de
      liderança ou de supervisionados, é a conta errada voltando.
    */
    const LIDERANCA = /lideranc|lideranç|responsaveis|responsáveis|supervisionad/i;
    const suspeitos: string[] = [];

    for (const arquivo of ARQUIVOS) {
      const linhas = semComentarios(readFileSync(arquivo, 'utf8')).split('\n');
      for (let i = 0; i < linhas.length; i++) {
        if (!LIDERANCA.test(linhas[i])) continue;
        const janela = linhas.slice(i, i + 3).join(' ');
        if (/\bbonus_total\b/.test(janela) && /\*|reduce|sum/.test(janela)) {
          suspeitos.push(`${arquivo}:${i + 1} — liderança calculada sobre bonus_total`);
        }
      }
    }

    expect(suspeitos.join(' | ')).toEqual('');
  });

  it('a liderança é somada a partir de bonus_estimado', () => {
    /*
      A regra acima proíbe o errado; esta exige o certo. Sem ela, apagar a conta
      inteira faria as duas passarem.
    */
    const fonte = semComentarios(
      readFileSync('src/features/editores/components/AvaliacoesTab.tsx', 'utf8'));
    const reducer = fonte.match(/const bonusResponsaveis[\s\S]*?\n\s*\}, \[/)?.[0] ?? '';
    expect(reducer).not.toEqual('');
    expect(/bonus_estimado/.test(reducer)).toBe(true);
    expect(/bonus_total/.test(reducer)).toBe(false);
  });

  it('o ajuste manual vem do campo, e não de uma comparação de totais', () => {
    /*
      `bonus_total_override` só pode ser preenchido a partir de
      `bonus_total_manual`. Qualquer `!==` entre o total gravado e um total
      recalculado é a adivinhação voltando.
    */
    const suspeitos: string[] = [];

    for (const arquivo of ARQUIVOS) {
      const codigo = semComentarios(readFileSync(arquivo, 'utf8'));
      if (!codigo.includes('bonus_total_override')) continue;

      codigo.split('\n').forEach((linha, i) => {
        if (!/bonus_total_override\s*:/.test(linha)) return;
        /* Checagem de nulo não é comparação de totais — `a.bonus_total != null`
           é legítimo e a primeira versão desta regra o acusava. */
        const semNulos = linha.replace(/[!=]==?\s*(null|undefined)/g, '');
        if (/!==|===|!=|==/.test(semNulos)) {
          suspeitos.push(`${arquivo}:${i + 1} — adivinha o ajuste manual comparando totais`);
        }
      });

      /* E quem grava precisa gravar o fato junto. */
      if (/bonus_total\s*:/.test(codigo) && !codigo.includes('bonus_total_manual')) {
        suspeitos.push(`${arquivo} — grava bonus_total sem gravar bonus_total_manual`);
      }
    }

    expect(suspeitos.join(' | ')).toEqual('');
  });
});
