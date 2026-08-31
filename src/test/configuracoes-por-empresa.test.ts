/**
 * `configuracoes` deixou de ter uma linha por chave.
 *
 * Desde 31/08/2026 a tabela aceita uma linha GERAL (`empresa_id` nulo) e uma
 * linha por empresa que sobrepõe. Isso quebra silenciosamente todo código
 * escrito quando `chave` era única:
 *
 *   .eq('chave', x).maybeSingle()   → erro assim que existir uma sobreposição
 *   .select('chave,valor')          → mapa fica com a última linha, e qual é a
 *                                     última é sorteio do Postgres
 *   .update(...).eq('chave', x)     → sobrescreve a linha da OUTRA empresa
 *
 * O terceiro é o caro: ajustar a alíquota geral apagaria a alíquota própria da
 * Aeliss sem ninguém pedir, e o DRE dela mudaria sozinho.
 *
 * Nenhum dos três dá erro hoje, porque ainda não existe nenhuma sobreposição —
 * eles só aparecem no dia em que ela criar a primeira. Teste que roda contra o
 * banco não pegaria: o banco está "certo". Por isso este lê o CÓDIGO.
 *
 * A regra: quem toca `configuracoes` direto tem de dizer o que quer de
 * `empresa_id`. Quem não quiser pensar nisso usa `fn_config(chave, empresa)`,
 * que é onde a regra "a específica ganha" mora.
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
 * Precisa vir antes da busca por dois motivos, e o segundo é o que importa: um
 * comentário explicando `empresa_id` faria o teste dar por cumprida uma regra
 * que o código não cumpre. Teste que passa por causa de um comentário é pior
 * que teste nenhum — ele dá a sensação de guarda sem guardar nada.
 *
 * O primeiro motivo é prosaico: sem os comentários a cadeia fica curta, e a
 * janela de leitura não precisa adivinhar tamanho de explicação.
 */
function semComentarios(conteudo: string): string {
  return conteudo
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // blocos
    .replace(/^\s*\/\/.*$/gm, ' ');      // linha inteira; não pega o // de https://
}

/** Onde a tabela é acessada, com a vizinhança suficiente para ver a cadeia. */
function acessos(conteudo: string): string[] {
  const limpo = semComentarios(conteudo);
  const achados: string[] = [];
  const re = /from\(\s*['"]configuracoes['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(limpo))) {
    // Sem comentários no meio, 400 caracteres cobrem qualquer
    // `.select().eq().is().maybeSingle()` com folga larga.
    achados.push(limpo.slice(m.index, m.index + 400));
  }
  return achados;
}

describe('quem lê ou escreve em `configuracoes`', () => {
  const arquivos = arquivosDe('src').filter(f => !f.includes('test'));

  it('sempre diz o que quer de `empresa_id`', () => {
    const faltando: string[] = [];

    for (const arquivo of arquivos) {
      for (const trecho of acessos(readFileSync(arquivo, 'utf8'))) {
        if (!trecho.includes('empresa_id')) faltando.push(arquivo);
      }
    }

    expect(
      faltando,
      'Estes acessos a `configuracoes` não filtram por empresa. Com a linha ' +
      'geral e a de uma empresa convivendo, eles pegam a linha errada — ou, ' +
      'num update, escrevem por cima da empresa errada. Use ' +
      '`.is("empresa_id", null)` para a geral, ou `fn_config(chave, empresa)`.',
    ).toEqual([]);
  });

  /*
    O caso que realmente perde dado. Um update sem `empresa_id` alcança todas as
    linhas da chave, e isso não devolve erro nenhum: devolve sucesso, tendo
    apagado o parâmetro de outra empresa.
  */
  it('nunca faz update por `chave` sozinha', () => {
    const perigosos: string[] = [];

    for (const arquivo of arquivos) {
      for (const trecho of acessos(readFileSync(arquivo, 'utf8'))) {
        const ate = trecho.indexOf('.select(');
        const cadeia = ate > 0 ? trecho.slice(0, ate) : trecho;
        if (cadeia.includes('.update(') && !cadeia.includes('empresa_id')) {
          perigosos.push(arquivo);
        }
      }
    }

    expect(
      perigosos,
      'Update em `configuracoes` sem restringir `empresa_id` sobrescreve o ' +
      'parâmetro de TODAS as empresas de uma vez, e devolve sucesso.',
    ).toEqual([]);
  });
});
