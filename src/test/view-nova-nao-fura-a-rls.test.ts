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

      /*
        Cada `CREATE [OR REPLACE] VIEW <nome>` e o que vem até o `AS`.

        O `(?![.\w])` depois do nome não é enfeite. Sem ele, a regex casava com
        `create or replace view public.%I as %s` — o `format()` da migração
        20260925b, que recria views dinamicamente — e, como `public\.` era
        opcional, ela voltava atrás e lia o NOME da view como "public". Acusava
        uma migração que na verdade preserva as reloptions e prova isso.

        Falso positivo aqui é caro: este teste existe para ser levado a sério
        depois de eu ter aberto três buracos de RLS num dia. Teste que acusa
        inocente é teste que alguém desliga.

        ── O buraco que isto tinha até 16/10/2026 ───────────────────────────

        O qualificador era `(?:public\.)?`, literal. Numa view de OUTRO schema
        — `create view tracking.vw_x as …` — o `public\.` não casa, o grupo do
        nome pega "tracking", o `(?![.\w])` vê o ponto e falha, e não há como
        retroceder: qualquer prefixo menor deixa um `\w` logo adiante. A regex
        inteira não casa e **a view sai da checagem em silêncio**.

        O schema `tracking` nasceu em 13/10 com seis views. As seis estão
        certas — conferido no banco, todas com `reloptions =
        {security_invoker=on}` —, mas esse acerto não estava sendo guardado
        por ninguém. E o CLAUDE.md da raiz avisa que `CREATE OR REPLACE VIEW`
        REDEFINE as reloptions: omitir a cláusula APAGA a que estava lá.

        A correção é trocar o `public` fixo por um schema qualquer. Ela NÃO
        reabre o falso positivo do `format()`: em `create or replace view
        public.%I as %s`, o schema casa "public.", o nome tenta casar `%I` e
        falha porque `%` não é `[a-z_]`; aí retrocede, lê "public" como nome,
        e o `(?![.\w])` barra no ponto. Nenhuma das duas saídas casa — que é
        o que se quer.
      */
      for (const m of sql.matchAll(
        /create\s+(?:or\s+replace\s+)?view\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)(?![.\w])([\s\S]*?)\bas\b/gi,
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

  it('a regra enxerga view de QUALQUER schema, e continua cega ao format()', () => {
    /* Um teste para o teste, e ele existe porque a regra acima passou um ano
       cega para `tracking.*` sem ninguém notar — view fora do `public` sumia
       da checagem em silêncio, que é o pior jeito de uma catraca falhar.

       Os dois casos do `format()` ficam aqui junto porque são a razão de o
       `(?![.\w])` existir: se alguém "simplificar" a regex um dia, este caso
       é que vai gritar. */
    const REGRA =
      /create\s+(?:or\s+replace\s+)?view\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)(?![.\w])([\s\S]*?)\bas\b/gi;
    const pega = (sql: string) => [...sql.matchAll(REGRA)].map((m) => m[1]);

    expect(pega('create view vw_a as select 1'), 'sem schema').toEqual(['vw_a']);
    expect(pega('create or replace view public.vw_b as select 1'), 'public').toEqual(['vw_b']);
    expect(pega('create or replace view tracking.vw_c as select 1'), 'outro schema').toEqual(['vw_c']);
    expect(
      pega("create view tracking.vw_d with (security_invoker = on) as select 1"),
      'outro schema COM a cláusula — tem de ser visto, para a cláusula poder ser conferida',
    ).toEqual(['vw_d']);

    /* O `format()` da 20260925b: não pode casar por nenhum dos dois caminhos. */
    expect(pega('create or replace view public.%I as %s'), 'format() dinâmico').toEqual([]);
    expect(pega('create or replace view %I.%I as %s'), 'format() com schema').toEqual([]);
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
