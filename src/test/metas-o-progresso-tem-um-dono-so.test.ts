/**
 * O progresso de uma meta tem um dono só.
 *
 * ── O que quase aconteceu em 12/10/2026 ───────────────────────────────────
 *
 * A pergunta que a tela de Metas responde é "estou indo bem?", e a resposta
 * sai de comparar dois percursos: quanto do caminho andou (da base real até o
 * alvo) contra quanto do prazo já passou. Uma meta está atrasada quando o
 * caminho fica mais de 15 pontos atrás do relógio.
 *
 * Esse número, 0,15, precisa existir em exatamente um lugar. Ele nasceu em
 * dois: `fn_metas_alertas` comparava do lado do SQL e a tela ia comparar de
 * novo em TypeScript para pintar a etiqueta. São dois campos dizendo a mesma
 * coisa — a primeira armadilha do CLAUDE.md, com outra roupa — e o sintoma
 * seria cruel: a etiqueta verde "no caminho" com um aviso âmbar logo acima
 * dizendo que a meta está atrasada, sem jeito de saber qual dos dois mente.
 *
 * `20261012n` resolveu movendo a classificação para dentro de
 * `fn_metas_progresso`, que devolve `situacao` pronta. O aviso lê a coluna; a
 * tela lê a coluna. Este teste existe para que ninguém traga a conta de volta
 * para a tela quando quiser "só um ajustezinho no limiar".
 *
 * ── E o campo de feito, que também era dois ───────────────────────────────
 *
 * `plano_acoes` guarda `feito_em timestamptz` e NADA mais. A versão óbvia
 * seria `feito boolean` + `feito_em`, e os dois divergiriam na primeira
 * gravação parcial. Nulo é o não feito, e a data é a própria marca.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRACOES = join(process.cwd(), 'supabase', 'migrations');
const FONTE     = join(process.cwd(), 'src', 'features', 'metas');

/** Sem comentários: os cabeçalhos destas migrações EXPLICAM o 0,15 em prosa,
 *  e casar com o texto explicativo daria reprovação falsa. */
function semComentarios(bruto: string) {
  return bruto.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** A última definição de uma função nas migrações é a que vale no banco. */
function ultimaDefinicao(nomeFn: string): string {
  let achada = '';
  for (const nome of readdirSync(MIGRACOES).filter(n => n.endsWith('.sql')).sort()) {
    const sql = semComentarios(readFileSync(join(MIGRACOES, nome), 'utf8'));
    const re = new RegExp(
      `create\\s+(or\\s+replace\\s+)?function\\s+public\\.${nomeFn}[\\s\\S]*?\\$function\\$[\\s\\S]*?\\$function\\$`,
      'gi',
    );
    for (const bloco of sql.match(re) ?? []) achada = bloco;
  }
  return achada;
}

describe('o progresso de uma meta tem um dono só', () => {
  it('fn_metas_progresso existe e é quem guarda o limiar de 0,15', () => {
    const progresso = ultimaDefinicao('fn_metas_progresso');
    expect(progresso, 'não achei fn_metas_progresso nas migrações').not.toBe('');
    expect(
      progresso,
      'O limiar que separa "no caminho" de "atrasada" tem de morar aqui — é a ' +
      'única definição, e o aviso lê a coluna que esta função devolve.',
    ).toContain('0.15');
  });

  it('fn_metas_alertas não recalcula o limiar', () => {
    const alertas = ultimaDefinicao('fn_metas_alertas');
    expect(alertas, 'não achei fn_metas_alertas nas migrações').not.toBe('');
    expect(
      alertas,
      'fn_metas_alertas voltou a comparar caminho com tempo por conta própria. ' +
      'Ela deve filtrar por `situacao = \'atrasada\'`, que vem de ' +
      'fn_metas_progresso — senão o limiar passa a existir em dois lugares e ' +
      'eles divergem no primeiro ajuste.',
    ).not.toContain('0.15');
    expect(alertas).toMatch(/situacao\s*=\s*'atrasada'/i);
  });

  it('as telas de Metas não refazem a conta de progresso', () => {
    const culpadas: string[] = [];

    for (const pasta of ['pages', 'components']) {
      const dir = join(FONTE, pasta);
      for (const nome of readdirSync(dir).filter(n => n.endsWith('.tsx'))) {
        const tsx = readFileSync(join(dir, nome), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/[^\n]*$/gm, '');

        /* O limiar, e também a divisão que produz `caminho`: as duas são a
           conta que pertence ao banco. */
        if (/0\.15/.test(tsx))                       culpadas.push(`${nome}: limiar 0.15`);
        if (/valor_alvo\s*-\s*base_real/.test(tsx))  culpadas.push(`${nome}: recalcula caminho`);
        if (/base_em/.test(tsx) && /current|Date\.now/.test(tsx)) {
          culpadas.push(`${nome}: recalcula tempo a partir de base_em`);
        }
      }
    }

    expect(
      culpadas,
      'A tela voltou a calcular progresso. `caminho`, `tempo` e `situacao` vêm ' +
      'prontos de fn_metas_progresso justamente para que a etiqueta e o aviso ' +
      'nunca se contradigam.',
    ).toEqual([]);
  });

  it('plano_acoes guarda só feito_em, sem booleano gêmeo', () => {
    const sql = semComentarios(
      readFileSync(join(MIGRACOES, '20261012l_o_plano_ganha_prazo_e_o_prazo_ganha_aviso.sql'), 'utf8'),
    );
    const criacao = sql.match(/create\s+table\s+if\s+not\s+exists\s+public\.plano_acoes[\s\S]*?\n\);/i)?.[0] ?? '';

    expect(criacao, 'não achei a criação de plano_acoes').not.toBe('');
    expect(criacao).toMatch(/feito_em\s+timestamptz/i);
    expect(
      /\bfeito\s+boolean/i.test(criacao),
      'Voltou um `feito boolean` ao lado de `feito_em`. Os dois dizem a mesma ' +
      'coisa e sempre divergem: nulo em feito_em já É o não feito.',
    ).toBe(false);
  });

  it('toda regra do plano que não é automática explica o que falta', () => {
    const sql = semComentarios(
      readFileSync(join(MIGRACOES, '20261012l_o_plano_ganha_prazo_e_o_prazo_ganha_aviso.sql'), 'utf8'),
    );
    const criacao = sql.match(/create\s+table\s+if\s+not\s+exists\s+public\.plano_regras[\s\S]*?\n\);/i)?.[0] ?? '';

    expect(criacao, 'não achei a criação de plano_regras').not.toBe('');
    expect(
      criacao,
      'Sem a restrição, uma regra do plano pode entrar como "manual" sem dizer ' +
      'o que falta para automatizar — e regra sem dono some da tela e vira ficção.',
    ).toMatch(/check\s*\(\s*automatica\s+or\s+porque_nao\s+is\s+not\s+null\s*\)/i);
  });

  it('as funções novas de metas não ficam abertas ao anon', () => {
    const faltando: string[] = [];

    for (const fn of ['fn_metas_progresso', 'fn_metas_alertas']) {
      /* A revogação tem de citar os DOIS: só PUBLIC deixa o `anon=X` nominal
         que o Supabase concede por ALTER DEFAULT PRIVILEGES, e só anon deixa
         o grant herdado de PUBLIC. Foi o que reprovou a prova de 20261012h. */
      const re = new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${fn}\\s*\\(uuid\\)\\s+from\\s+public\\s*,\\s*anon`, 'i');
      const achou = readdirSync(MIGRACOES)
        .filter(n => n.endsWith('.sql'))
        .some(n => re.test(semComentarios(readFileSync(join(MIGRACOES, n), 'utf8'))));
      if (!achou) faltando.push(fn);
    }

    expect(
      faltando,
      'Revogar só de PUBLIC ou só de anon não fecha nada: são dois caminhos ' +
      'independentes de privilégio.',
    ).toEqual([]);
  });
});
