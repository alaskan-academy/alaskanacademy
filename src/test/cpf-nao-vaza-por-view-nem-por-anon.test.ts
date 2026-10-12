/**
 * O CPF não vaza por view nem por `anon`.
 *
 * ── O que aconteceu em 12/10/2026 ──────────────────────────────────────────
 *
 * A migração `20261012d` guardou o CPF em `clientes.cpf` e trancou a coluna do
 * jeito certo: `revoke select on clientes from authenticated` e regrant coluna
 * a coluna, menos `cpf`. A trava é de PRIVILÉGIO DE COLUNA, não de RLS — e é
 * isso que faz duas coisas darem errado em silêncio se ninguém vigiar.
 *
 * ── 1. Uma view não consegue ler a coluna, e a saída fácil é desastrosa ────
 *
 * Toda view nova é obrigada a nascer `with (security_invoker = on)` — regra do
 * CLAUDE.md, com a catraca em `view-nova-nao-fura-a-rls.test.ts`. View invoker
 * roda com os direitos de QUEM CONSULTA, e quem consulta é `authenticated`,
 * que não tem a coluna. Então uma view que toque `clientes.cpf` devolve
 * `permission denied for column cpf` para TODO usuário do painel — inclusive o
 * admin, porque `is_current_user_admin()` é checagem de perfil da aplicação e
 * não concede privilégio de coluna.
 *
 * O jeito de "resolver" isso é criar a view sem o invoker. Aí ela passa a
 * rodar como `postgres` e o CPF de 12.786 pessoas fica legível por `anon` —
 * exatamente o buraco que `20260925a` fechou em 40 views depois de
 * `vw_clientes_listagem` devolver nome, e-mail e telefone de 12.590 pessoas.
 * Por isso a regra aqui é a mais simples possível: **nenhuma view lê `cpf`.**
 * Quem precisa contar por CPF usa função `SECURITY DEFINER` que devolve só o
 * agregado — é o que `fn_pessoas_distintas` faz.
 *
 * ── 2. Revogar de `anon` sozinho não revoga nada ──────────────────────────
 *
 * `20261012d` escreveu `revoke execute on function fn_cpf_do_cliente from
 * anon` e acreditou ter fechado. Não fechou: a ACL ficou `=X/postgres`, o
 * grant a PUBLIC, do qual `anon` é membro. Medido em 12/10:
 * `has_function_privilege('anon', 'fn_cpf_do_cliente(uuid)', 'EXECUTE')` =
 * **true**.
 *
 * E revogar só de PUBLIC também não basta, porque o Supabase concede
 * `anon=X` NOMINALMENTE a toda função nova de `public`, por
 * `ALTER DEFAULT PRIVILEGES`. A primeira versão de `20261012h` revogou só de
 * PUBLIC e a prova dela reprovou com "anon consegue executar".
 *
 * São dois caminhos independentes, e fechar um deixa o outro aberto. Tem de
 * ser `revoke ... from public, anon`. `20261012h` fez isso nas duas funções e
 * consertou a ACL de `fn_cpf_do_cliente` de quebra.
 *
 * O estrago real foi pequeno — `fn_cpf_do_cliente` confere admin ANTES de ler,
 * então `anon` recebia exceção e não CPF. Mas uma defesa que se acredita ter e
 * não se tem é pior que uma que se sabe não ter, e é por isso que isto virou
 * teste em vez de virar conserto silencioso.
 *
 * ── Por que a catraca começa em 20261012h ─────────────────────────────────
 *
 * `20261012d` é anterior ao conserto e o arquivo dela registra o que de fato
 * rodou — migração aplicada não se reescreve. Começar a catraca antes dela
 * faria este teste nascer vermelho, e teste que nasce vermelho é teste que
 * alguém desliga. A ACL que ela deixou torta já foi corrigida em `20261012h`;
 * daqui para a frente, arquivo novo nasce fechado.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRACOES = join(process.cwd(), 'supabase', 'migrations');

/** A coluna `cpf` nasceu em 20261012d; a catraca vale do conserto em diante. */
const A_PARTIR_DE = '20261012h';

/** Sem comentários: o cabeçalho destas migrações FALA de `cpf` e de `anon`
 *  parágrafos inteiros, e casar com o texto explicativo daria passe falso —
 *  foi a lição de `view-nova-nao-fura-a-rls`. */
function semComentarios(bruto: string) {
  return bruto.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const novas = readdirSync(MIGRACOES)
  .filter(n => n.endsWith('.sql'))
  .filter(n => n.slice(0, 9) >= A_PARTIR_DE)
  .sort();

describe('o CPF não vaza por view nem por anon', () => {
  it('há migrações a cobrir — senão o teste passa por nada', () => {
    expect(novas.length, `nenhuma migração a partir de ${A_PARTIR_DE}`).toBeGreaterThan(0);
  });

  it('nenhuma view lê clientes.cpf', () => {
    const culpadas: string[] = [];

    for (const nome of novas) {
      const sql = semComentarios(readFileSync(join(MIGRACOES, nome), 'utf8'));

      /* Cada `CREATE [OR REPLACE] VIEW ...` até o `;` que a fecha. O corpo da
         view é o que interessa: é ali que um `c.cpf` entraria. */
      for (const bloco of sql.match(/create\s+(or\s+replace\s+)?(materialized\s+)?view[\s\S]*?;/gi) ?? []) {
        /* `cpf_hash` é coluna morta de outra era e não é o documento. */
        const semHash = bloco.replace(/cpf_hash/gi, '');
        if (/\bcpf\b/i.test(semHash)) {
          culpadas.push(`${nome}: ${bloco.slice(0, 120).replace(/\s+/g, ' ')}…`);
        }
      }
    }

    expect(
      culpadas,
      'View não consegue ler clientes.cpf: com security_invoker dá permission denied ' +
      'para todo mundo, e sem ele o CPF fica legível por anon. Conte por CPF numa ' +
      'função SECURITY DEFINER que devolva só o agregado, como fn_pessoas_distintas.',
    ).toEqual([]);
  });

  it('toda função SECURITY DEFINER nova fixa o search_path', () => {
    const faltando: string[] = [];

    for (const nome of novas) {
      const sql = semComentarios(readFileSync(join(MIGRACOES, nome), 'utf8'));

      for (const bloco of sql.match(/create\s+(or\s+replace\s+)?function[\s\S]*?\$function\$[\s\S]*?\$function\$/gi) ?? []) {
        if (!/security\s+definer/i.test(bloco)) continue;
        if (!/set\s+search_path/i.test(bloco)) {
          const nomeFn = bloco.match(/function\s+([\w.]+)/i)?.[1] ?? '(?)';
          faltando.push(`${nome}: ${nomeFn}`);
        }
      }
    }

    expect(
      faltando,
      'Função SECURITY DEFINER sem search_path fixo é um buraco: quem chama escolhe ' +
      'de qual schema vêm as tabelas que ela lê.',
    ).toEqual([]);
  });

  it('função SECURITY DEFINER que toca o CPF é revogada de PUBLIC e de anon', () => {
    const problemas: string[] = [];

    for (const nome of novas) {
      const sql = semComentarios(readFileSync(join(MIGRACOES, nome), 'utf8'));
      if (!/security\s+definer/i.test(sql)) continue;
      if (!/\bcpf\b/i.test(sql.replace(/cpf_hash/gi, ''))) continue;

      const revokes = sql.match(/revoke[\s\S]*?;/gi) ?? [];
      const tiraDePublic = revokes.some(r => /on\s+function[\s\S]*\bfrom\b[\s\S]*\bpublic\b/i.test(r));
      const tiraDeAnon   = revokes.some(r => /on\s+function[\s\S]*\bfrom\b[\s\S]*\banon\b/i.test(r));

      if (!tiraDePublic || !tiraDeAnon) {
        problemas.push(
          `${nome}: revoga de PUBLIC=${tiraDePublic}, de anon=${tiraDeAnon}`,
        );
      }
    }

    expect(
      problemas,
      'São dois caminhos independentes até a função: o grant a PUBLIC (do qual anon é ' +
      'membro) e o grant NOMINAL que o Supabase dá a anon por default privileges. ' +
      'Revogar de um só deixa o outro aberto — use `revoke all on function ... from public, anon`.',
    ).toEqual([]);
  });
});
