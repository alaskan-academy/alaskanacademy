/**
 * A trava que impede alguém de se promover não pode sumir num DROP distraído.
 *
 * ── O que estava aberto ────────────────────────────────────────────────────
 *
 * Em 28/09/2026, qualquer pessoa logada no painel podia se tornar
 * administradora. Medido, não deduzido:
 *
 *     escalada funcionou? t
 *
 * (um `update perfis set is_admin = true` na própria linha, rodando como
 * `authenticated` com o JWT de um não-admin, dentro de uma transação desfeita)
 *
 * A causa eram três coisas que só juntas viram buraco:
 *   1. a política de UPDATE de `perfis` permite `id = auth.uid()`
 *   2. o `with_check` dela é NULO — e política de UPDATE sem WITH CHECK usa o
 *      USING para validar a linha nova, que continua sendo a da própria pessoa
 *   3. `authenticated` tem privilégio de UPDATE nas 8 colunas, `is_admin` e
 *      `cargo_id` inclusive
 *
 * A RLS dizia QUAIS LINHAS. Ninguém dizia QUAIS COLUNAS.
 *
 * ── O limite honesto deste arquivo ─────────────────────────────────────────
 *
 * Um teste que roda no repositório NÃO consegue provar o estado do banco — a
 * prova de verdade é o bloco `DO $prova$` dentro da migração 20260928a, que
 * TENTA a escalada e exige que ela falhe, e que roda toda vez que o banco for
 * reconstruído pelas migrações.
 *
 * O que este arquivo guarda é a outra metade: que a migração continue lá e que
 * nenhuma migração posterior derrube o gatilho sem recriá-lo. É a mesma forma
 * de `view-nova-nao-fura-a-rls.test.ts` — catraca sobre o que entra depois.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRACOES = join(process.cwd(), 'supabase', 'migrations');
const GATILHO = 'trg_perfil_nao_se_promove';
const FUNCAO = 'fn_perfil_nao_se_promove';
const ORIGEM = '20260928a';

const arquivos = readdirSync(MIGRACOES).filter(n => n.endsWith('.sql')).sort();
const semComentarios = (sql: string) =>
  sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('ninguém se promove sozinho', () => {
  const origem = arquivos.find(n => n.startsWith(ORIGEM));

  it('a migração que fecha a brecha continua no repositório', () => {
    expect(origem, `sumiu a migração ${ORIGEM}`).toBeTruthy();
  });

  it('ela cria a função E o gatilho — um sem o outro não protege nada', () => {
    const sql = semComentarios(readFileSync(join(MIGRACOES, origem!), 'utf8'));
    expect(sql, 'a função sumiu da migração').toMatch(
      new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${FUNCAO}`, 'i'),
    );
    expect(sql, 'o gatilho sumiu da migração').toMatch(
      new RegExp(`create\\s+trigger\\s+${GATILHO}[\\s\\S]{0,120}?before\\s+update\\s+on\\s+perfis`, 'i'),
    );
  });

  it('as cinco colunas de privilégio continuam cobertas', () => {
    /* Tirar uma da lista é o jeito silencioso de reabrir a brecha pela metade:
       `cargo_id` sozinho já vale o multiplicador de comissão e o percentual de
       liderança assim que `perfis` virar fonte única. */
    const sql = semComentarios(readFileSync(join(MIGRACOES, origem!), 'utf8'));
    for (const col of ['is_admin', 'cargo_id', 'setor_id', 'ativo', 'radar_pode_criar']) {
      expect(sql, `${col} saiu da trava`).toMatch(
        new RegExp(`NEW\\.${col}\\s+IS\\s+DISTINCT\\s+FROM\\s+OLD\\.${col}`, 'i'),
      );
    }
  });

  it('a migração prova a escalada em vez de só declarar o gatilho', () => {
    /* Sem isto a migração viraria "criei o gatilho, confie em mim". A prova
       tenta a escalada como não-admin e falha se ela passar. */
    const sql = readFileSync(join(MIGRACOES, origem!), 'utf8');
    expect(sql, 'a migração não tenta a escalada').toMatch(/set local role authenticated/i);
    expect(sql, 'a migração não falha se a escalada passar').toMatch(/A BRECHA CONTINUA ABERTA/);
  });

  it('nenhuma migração posterior reescreve a função e perde uma das colunas', () => {
    /*
     * A guarda abaixo só vigia quem APAGA o gatilho. Mas o jeito natural de
     * desfazer isto sem perceber não é apagar: é um `CREATE OR REPLACE
     * FUNCTION` mais adiante, mexendo noutra coisa, que deixe cair uma das
     * comparações. Achado por revisão adversarial em 28/09, no mesmo dia em que
     * esta guarda nasceu — ela estava vigiando a porta e não a janela.
     *
     * `cargo_id` sozinho já vale o multiplicador de comissão e o percentual de
     * liderança, então perder UMA coluna é meia brecha, não um detalhe.
     */
    const COLUNAS = ['is_admin', 'cargo_id', 'setor_id', 'ativo', 'radar_pode_criar'];
    const posteriores = arquivos.filter(n => n.slice(0, 9) > ORIGEM);
    const culpadas: string[] = [];

    for (const nome of posteriores) {
      const sql = semComentarios(readFileSync(join(MIGRACOES, nome), 'utf8'));
      if (!new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${FUNCAO}`, 'i').test(sql)) continue;
      const faltando = COLUNAS.filter(
        c => !new RegExp(`NEW\\.${c}\\s+IS\\s+DISTINCT\\s+FROM\\s+OLD\\.${c}`, 'i').test(sql),
      );
      if (faltando.length) culpadas.push(`${nome} (sem: ${faltando.join(', ')})`);
    }

    expect(
      culpadas,
      `${culpadas.join(' | ')} reescreve \`${FUNCAO}\` deixando cair coluna de ` +
        `privilégio. Cada uma que sai é um caminho de volta: \`is_admin\` dá ` +
        `administrador, \`cargo_id\` dá o multiplicador de comissão.`,
    ).toEqual([]);
  });

  it('nenhuma migração posterior derruba o gatilho sem recriá-lo', () => {
    const posteriores = arquivos.filter(n => n.slice(0, 9) > ORIGEM);
    const culpadas: string[] = [];

    for (const nome of posteriores) {
      const sql = semComentarios(readFileSync(join(MIGRACOES, nome), 'utf8'));
      const derruba = new RegExp(`drop\\s+trigger[^;]*${GATILHO}`, 'i').test(sql)
        || new RegExp(`drop\\s+function[^;]*${FUNCAO}`, 'i').test(sql);
      if (!derruba) continue;
      const recria = new RegExp(`create\\s+trigger\\s+${GATILHO}`, 'i').test(sql);
      if (!recria) culpadas.push(nome);
    }

    expect(
      culpadas,
      `${culpadas.join(', ')} derruba \`${GATILHO}\` e não o recria. Sem ele, ` +
        `qualquer pessoa logada volta a poder fazer \`update perfis set ` +
        `is_admin = true\` na própria linha — a RLS de \`perfis\` diz quais ` +
        `LINHAS, e só este gatilho diz quais COLUNAS.`,
    ).toEqual([]);
  });
});
