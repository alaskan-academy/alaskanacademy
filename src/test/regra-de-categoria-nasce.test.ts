/**
 * O `onConflict` de um upsert tem que casar com o índice único do banco.
 *
 * ── O que custou 27 dias ───────────────────────────────────────────────────
 *
 * Em 01/09/2026 a migração `20260901b` recriou `uq_regras_categoria_padrao`
 * como `(padrao, tipo_match, sinal)`. A tela de Revisão continuou mandando
 * `onConflict: 'padrao,tipo_match'`.
 *
 * O Postgres responde `42P10` — "no unique or exclusion constraint matching the
 * ON CONFLICT specification". E aquele era o ÚNICO dos três upserts da função
 * que não conferia `error`, então a tela mostrava "Transação categorizada" e
 * nenhuma regra nascia.
 *
 * Medido em 28/09, com as duas formas lado a lado num bloco desfeito:
 *
 *     duas colunas → 42P10
 *     três colunas → PASSOU
 *
 * E o tamanho do estrago: 113 regras, a última de 01/09, ZERO desde então,
 * contra 266 transações importadas no período. Como as regras também
 * categorizam sozinhas na importação do extrato, o trabalho vinha sendo feito
 * duas vezes — a regra não nascia e, por isso, nunca se aplicava.
 *
 * ── O limite honesto deste arquivo ─────────────────────────────────────────
 *
 * Teste de repositório não conversa com o banco, então ele não consegue afirmar
 * que as colunas do `onConflict` são as do índice de hoje. O que ele consegue —
 * e é o que teria evitado os 27 dias — é exigir que as duas listas estejam
 * ESCRITAS no mesmo repositório e casem entre si: a da migração e a da tela.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = process.cwd();
const MIGRACOES = join(RAIZ, 'supabase', 'migrations');
const TELA = 'src/features/financeiro/pages/FinanceiroRevisaoPage.tsx';

const semComentariosSql = (s: string) =>
  s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const semComentariosTs = (s: string) =>
  s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** As colunas do último `create unique index uq_regras_categoria_padrao` do repositório. */
function colunasDoIndice(): string[] {
  const arquivos = readdirSync(MIGRACOES).filter(n => n.endsWith('.sql')).sort();
  let ultimo: string[] | null = null;
  for (const nome of arquivos) {
    const sql = semComentariosSql(readFileSync(join(MIGRACOES, nome), 'utf8'));
    for (const m of sql.matchAll(
      /create\s+unique\s+index[^;]*?uq_regras_categoria_padrao[^;]*?\(([^)]*)\)/gi,
    )) {
      ultimo = m[1].split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
    }
  }
  return ultimo ?? [];
}

/** As colunas do `onConflict` do upsert de `regras_categoria` na tela. */
function colunasDoUpsert(): string[] {
  const tsx = semComentariosTs(readFileSync(join(RAIZ, TELA), 'utf8'));
  const bloco = tsx.match(/from\('regras_categoria'\)[\s\S]*?onConflict:\s*'([^']+)'/);
  return bloco ? bloco[1].split(',').map(c => c.trim().toLowerCase()).filter(Boolean) : [];
}

describe('a regra de categoria consegue nascer', () => {
  it('o índice único está declarado em alguma migração', () => {
    expect(colunasDoIndice(), 'não achei o create unique index de uq_regras_categoria_padrao')
      .not.toEqual([]);
  });

  it('a tela faz upsert de regras_categoria com onConflict', () => {
    expect(colunasDoUpsert(), `não achei o onConflict do upsert em ${TELA}`).not.toEqual([]);
  });

  it('as colunas do onConflict são EXATAMENTE as do índice', () => {
    const indice = colunasDoIndice();
    const upsert = colunasDoUpsert();
    expect(
      upsert,
      `o upsert de \`regras_categoria\` manda [${upsert.join(', ')}] e o índice ` +
        `\`uq_regras_categoria_padrao\` é [${indice.join(', ')}]. Divergindo, o ` +
        `Postgres responde 42P10 e NENHUMA regra nasce — foi assim entre ` +
        `01/09 e 28/09/2026, com a tela dizendo "Transação categorizada".`,
    ).toEqual(indice);
  });

  it('o erro do upsert é conferido, em vez de engolido', () => {
    /* Era o único dos três upserts da função sem `if (error)`. Sem isso, a
       próxima divergência volta a durar semanas: a tela continua dizendo que
       deu certo. */
    const tsx = semComentariosTs(readFileSync(join(RAIZ, TELA), 'utf8'));
    const bloco = tsx.match(/from\('regras_categoria'\)[\s\S]{0,700}?\}\);([\s\S]{0,200})/);
    expect(bloco, 'não achei o upsert de regras_categoria').toBeTruthy();
    expect(
      /if\s*\(\s*error\s*\)/.test(bloco![1]),
      'o upsert de regras_categoria não confere `error` — a tela volta a dizer "categorizada" sem ter criado nada',
    ).toBe(true);
  });

  it('a regra nasce com a direção da transação que a ensinou', () => {
    /*
     * `sinal` nulo vale nos DOIS sentidos. Mandar nulo faria o upsert
     * funcionar e reintroduziria o caso que criou a coluna: em 01/09 um PIX de
     * R$ 2.000 ENTRANDO na conta da Aeliss virou "Retirada de Lucro", porque
     * uma regra aprendida das SAÍDAS da Alaskan casou pelo nome.
     *
     * Os dois erros não custam igual: regra direcionada demais deixa a
     * transação sem categoria, e ela aparece na própria fila de Revisão; regra
     * ampla demais categoriza errado, calada.
     */
    const tsx = semComentariosTs(readFileSync(join(RAIZ, TELA), 'utf8'));
    expect(
      tsx,
      'a regra não carimba `sinal` a partir do valor da transação',
    ).toMatch(/sinal\s*=\s*selected\.valor\s*>=\s*0\s*\?\s*'entrada'\s*:\s*'saida'/);
    expect(
      /from\('regras_categoria'\)[\s\S]{0,700}?\bsinal\b/.test(tsx),
      'o `sinal` não está indo no corpo do upsert',
    ).toBe(true);
  });

  it('a mensagem do erro chega à tela', () => {
    /* "Erro ao salvar" sozinho não distingue rede caída de 42P10 — e foi por
       não distinguir que ninguém soube o que perguntar durante 27 dias. */
    const tsx = semComentariosTs(readFileSync(join(RAIZ, TELA), 'utf8'));
    expect(
      /catch\s*\(\s*\w+\s*\)\s*\{[\s\S]{0,400}?description:/.test(tsx),
      'o catch descarta a mensagem do erro',
    ).toBe(true);
  });
});
