/**
 * A deduplicação do extrato tem de considerar a FONTE, não só a referência.
 *
 * ── O defeito que este teste impede de voltar ────────────────────────────
 *
 * O id de uma transação só é único DENTRO do banco que o emitiu. As
 * referências da Conta Simples são números puros de 8 dígitos (`83765041`), e
 * nada impede o Inter ou o C6 de devolverem um id igual.
 *
 * Com a chave antiga — só `referencia_externa` — e o `ignoreDuplicates: true`
 * que o `cs-sync` usa para não reverter transação já revisada, a colisão não
 * daria erro: a transação do outro banco seria DESCARTADA. Sem exceção, sem
 * linha, sem log.
 *
 * ── Por que o teste lê o código-fonte ────────────────────────────────────
 *
 * Contra o banco de hoje a importação "está certa": ainda não existe conta do
 * Inter nem do C6 para colidir. O defeito só apareceria no dia em que a
 * primeira entrasse — que é exatamente quando ninguém está olhando para esta
 * linha. Mesmo motivo do `configuracoes-por-empresa` e do
 * `categorias-socio-batem-com-o-banco`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = process.cwd();

function ler(caminho: string) {
  return readFileSync(join(RAIZ, caminho), 'utf8');
}

describe('quem grava no extrato', () => {
  const csSync = ler('supabase/functions/cs-sync/index.ts');

  it('deduplica por (fonte, referencia_externa)', () => {
    expect(csSync).toMatch(/onConflict:\s*'fonte,referencia_externa'/);
  });

  it('não deduplica só pela referência', () => {
    // `onConflict: 'referencia_externa'` sozinho descarta a transação do outro
    // banco em silêncio, porque o upsert usa `ignoreDuplicates`.
    expect(csSync).not.toMatch(/onConflict:\s*'referencia_externa'/);
  });

  it('continua ignorando duplicata em vez de sobrescrever', () => {
    /* `ignoreDuplicates` protege `status_revisao`: sem ele, o sync devolveria
       a "pendente" toda transação que alguém já revisou. */
    expect(csSync).toMatch(/ignoreDuplicates:\s*true/);
  });

  it('toda linha gravada leva `fonte`, que agora é NOT NULL', () => {
    const gravacoes = csSync.match(/referencia_externa:\s*ref\(/g) ?? [];
    expect(gravacoes.length).toBeGreaterThan(0);
    // uma `fonte:` para cada `referencia_externa:` das linhas montadas
    const fontes = csSync.match(/^\s+fonte:\s*'/gm) ?? [];
    expect(fontes.length).toBeGreaterThanOrEqual(gravacoes.length);
  });
});

describe('a migração que criou a chave', () => {
  const arquivos = readdirSync(join(RAIZ, 'supabase', 'migrations')).filter(n => n.endsWith('.sql'));
  const sql = arquivos.map(n => ler(join('supabase', 'migrations', n))).join('\n');

  it('cria o índice único composto', () => {
    expect(sql).toMatch(/unique index[^;]*transacoes_fonte_referencia_unique[\s\S]*?\(fonte,\s*referencia_externa\)/i);
  });

  it('torna `fonte` obrigatória — sem isso o índice composto não vale nada', () => {
    // Com `fonte` nula, o índice aceitaria duplicatas sem limite (NULLS DISTINCT).
    expect(sql).toMatch(/alter column fonte set not null/i);
  });

  it('remove a constraint antiga, que era só a referência', () => {
    expect(sql).toMatch(/drop constraint if exists transacoes_referencia_externa_unique/i);
  });
});
