#!/usr/bin/env node
/**
 * A catraca do lint: pode descer, não pode subir.
 *
 * O projeto tem 204 erros de eslint acumulados, concentrados nas páginas mais
 * antigas. Exigir zero faria a verificação nascer vermelha, e verificação
 * sempre vermelha é verificação que todo mundo aprende a ignorar — pior do que
 * não ter, porque dá a sensação de que alguém está olhando.
 *
 * Então a regra é o movimento, não o número: a contagem de hoje vira o teto, e
 * o que falha é AUMENTAR. Quem conserta um erro é convidado a baixar o teto, e
 * aí ele não pode voltar.
 *
 * Uso:
 *   node scripts/lint-catraca.mjs            confere contra o teto
 *   node scripts/lint-catraca.mjs --gravar   grava a contagem atual como teto
 */

import { ESLint } from 'eslint';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const ARQUIVO = new URL('../.github/lint-teto.json', import.meta.url);

/* A API do eslint, e não `npx eslint`: mesma configuração, sem subprocesso e
   sem as diferenças de shell entre Windows e o runner do CI. */
const eslint = new ESLint();
const relatorio = await eslint.lintFiles(['.']);

const erros  = relatorio.reduce((s, a) => s + a.errorCount, 0);
const avisos = relatorio.reduce((s, a) => s + a.warningCount, 0);

if (process.argv.includes('--gravar')) {
  writeFileSync(ARQUIVO, JSON.stringify({ erros }, null, 2) + '\n');
  console.log(`teto gravado: ${erros} erros`);
  process.exit(0);
}

if (!existsSync(ARQUIVO)) {
  console.error('Falta .github/lint-teto.json. Rode: node scripts/lint-catraca.mjs --gravar');
  process.exit(2);
}

const teto = JSON.parse(readFileSync(ARQUIVO, 'utf8')).erros;

console.log(`eslint: ${erros} erros, ${avisos} avisos · teto ${teto}`);

if (erros > teto) {
  /* Os cinco piores, para quem chegou aqui saber por onde começar. */
  const piores = relatorio
    .filter(a => a.errorCount > 0)
    .sort((a, b) => b.errorCount - a.errorCount)
    .slice(0, 5)
    .map(a => `${String(a.errorCount).padStart(4)}  ${a.filePath.split(/[\\/]/).slice(-3).join('/')}`);

  console.error(`\n✗ ${erros - teto} erro(s) de lint a mais que o teto.`);
  console.error('  Conserte, ou suba o teto de propósito e diga por quê.\n');
  console.error('  Arquivos com mais erros:\n' + piores.join('\n'));
  process.exit(1);
}

if (erros < teto) {
  console.log(`\n✓ ${teto - erros} erro(s) a menos. Baixe o teto para travar o ganho:`);
  console.log('  node scripts/lint-catraca.mjs --gravar\n');
} else {
  console.log('\n✓ nada piorou.\n');
}
