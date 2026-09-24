/**
 * View nova não pode ser um caminho por fora da RLS.
 *
 * ── O que aconteceu em 24/09/2026 ──────────────────────────────────────────
 *
 * Criei três views num dia — `vw_ad_morrendo`, `vw_rev_tendencia` e
 * `vw_criativo_por_angulo` — e nenhuma com `security_invoker`. Em Postgres uma
 * view roda com os direitos do DONO (`postgres`), não de quem consulta: ela
 * passa por fora da RLS das tabelas que lê.
 *
 * Medido como `anon` antes do conserto:
 *
 *     producoes                → 0      (a RLS da tabela funciona)
 *     vendas                   → 0      (idem)
 *     vw_criativo_por_angulo   → 3.794  ← passava por fora
 *     vw_ad_morrendo           → 6      ← verba e ROAS por anúncio
 *     vw_rev_tendencia         → 10     ← faturamento por REV
 *
 * `anon` não é hipótese: a `VITE_SUPABASE_ANON_KEY` é inlinada no bundle, então
 * a chave está no navegador de qualquer visitante. Entre os 3.794 cards ia o
 * nome da editora responsável — dado pessoal.
 *
 * O projeto já sabia: 16 migrações usam `security_invoker`, e a 20260827zm
 * escreve o motivo. Eu não usei em nenhuma das cinco migrações daquele dia, e
 * o defeito só apareceu numa revisão adversarial — nenhum teste pegava.
 *
 * ── Por que a catraca começa em 24/09/2026 ─────────────────────────────────
 *
 * O linter da Supabase conta 45 views assim no projeto. Exigir a correção de
 * todas aqui faria o teste nascer vermelho, e teste que já nasce falhando é
 * teste que alguém desliga. A catraca cobre as migrações NOVAS: o que entrar de
 * hoje em diante nasce fechado, e as antigas ficam para uma varredura própria,
 * com decisão dela.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRACOES = join(process.cwd(), 'supabase', 'migrations');

/** A partir daqui, view nova nasce com o invoker. Antes disso é legado. */
const A_PARTIR_DE = '20260924';

describe('view nova não fura a RLS', () => {
  const novas = readdirSync(MIGRACOES)
    .filter(n => n.endsWith('.sql'))
    .filter(n => n.slice(0, 8) >= A_PARTIR_DE)
    .sort();

  it('a lista de migrações novas não está vazia — senão o teste passa por nada', () => {
    expect(novas.length, `nenhuma migração a partir de ${A_PARTIR_DE}`).toBeGreaterThan(0);
  });

  it('toda view criada numa migração nova declara security_invoker', () => {
    const faltando: string[] = [];

    for (const nome of novas) {
      const bruto = readFileSync(join(MIGRACOES, nome), 'utf8');
      /* Sem comentários: a migração 20260924f FALA de security_invoker no
         cabeçalho inteiro, e casar com o texto explicativo daria um passe
         falso — foi assim que o teste do empate quase passou cego hoje. */
      const sql = bruto.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

      /* Cada `CREATE [OR REPLACE] VIEW <nome>` e o que vem até o `AS`. */
      for (const m of sql.matchAll(
        /create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?([a-z_]+)([\s\S]*?)\bas\b/gi,
      )) {
        const [, view, entre] = m;
        if (/security_invoker/i.test(entre)) continue;
        faltando.push(`${nome} → ${view}`);
      }
    }

    expect(
      faltando,
      `${faltando.join(' | ')} cria view sem \`WITH (security_invoker = on)\`. ` +
        `Sem isso a view roda como \`postgres\` e devolve para \`anon\` o que a ` +
        `RLS das tabelas nega — e a chave anon está no bundle, no navegador de ` +
        `qualquer visitante.`,
    ).toEqual([]);
  });

  it('as três views daquele dia continuam declarando o invoker', () => {
    /* Nominal de propósito: são as que vazaram, e a regra acima só olha a
       migração que CRIA. Se alguém as recriar noutro arquivo sem a cláusula,
       a regra acima pega; se alguém apagar a cláusula destes arquivos, esta
       pega. */
    const alvos = [
      ['20260924b', 'vw_ad_morrendo'],
      ['20260924c', 'vw_rev_tendencia'],
      ['20260924d', 'vw_criativo_por_angulo'],
    ] as const;

    for (const [prefixo, view] of alvos) {
      const arquivo = novas.find(n => n.startsWith(prefixo));
      expect(arquivo, `sumiu a migração ${prefixo}`).toBeTruthy();
      const sql = readFileSync(join(MIGRACOES, arquivo!), 'utf8')
        .replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(
        sql,
        `${arquivo} cria ${view} sem security_invoker — a view volta a vazar ` +
          `na próxima vez que o banco for reconstruído pelas migrações.`,
      ).toMatch(new RegExp(`view\\s+public\\.${view}[\\s\\S]{0,120}?security_invoker`, 'i'));
    }
  });
});
