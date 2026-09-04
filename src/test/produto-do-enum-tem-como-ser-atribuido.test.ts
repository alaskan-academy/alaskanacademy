/**
 * Todo valor de `produto_tipo` precisa ter como ser atribuído.
 *
 * ── O que aconteceu ─────────────────────────────────────────────────────
 *
 * `mapear_produto_por_nome` é uma lista de palavras escrita à mão:
 *
 *     IF n LIKE '%vela%'  THEN RETURN 'velas';
 *     IF n LIKE '%sapon%' THEN RETURN 'saponaria';
 *     ...
 *     RETURN NULL;
 *
 * Em 04/09/2026 dois alarmes apontaram para o mesmo buraco: uma conta de
 * anúncio gastando R$ 354,37 sem produto, e 9 vendas de R$ 1.147,66 caindo em
 * "Outros". Eram os produtos da Aeliss, que a função não conhecia — e as
 * irmãs deles estavam marcadas como `velas`, que é a linha de velas da
 * ALASKAN. Rótulo errado, não só faltando.
 *
 * Ao consertar, apareceu o defeito maior: `hormonal`, `velaroma` e `handify`
 * existem no enum desde sempre e a função NUNCA os devolve. Valor que ninguém
 * consegue atribuir é campo que fica nulo para sempre, e nulo aqui vira
 * "Outros" na tela sem dizer por quê.
 *
 * ── Por que catraca e não zero ──────────────────────────────────────────
 *
 * Exigir cobertura total faria o teste nascer vermelho por causa dos três
 * herdados, e verificação sempre vermelha é verificação que todo mundo aprende
 * a ignorar — o mesmo raciocínio de `scripts/lint-catraca.mjs`.
 *
 * Então a regra é o MOVIMENTO: os três de hoje estão anotados como dívida
 * conhecida, e o que falha é aparecer um QUARTO. Quem ensinar a função a
 * devolver `handify` é convidado a tirá-lo da lista, e aí ele não volta.
 *
 * ── Por que ler migração e não o banco ──────────────────────────────────
 *
 * Mesma escolha de `categorias-socio-batem-com-o-banco.test.ts`: a fonte da
 * verdade é o banco VERSIONADO. Sem conexão, sem segredo, roda no CI.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'supabase', 'migrations');

/**
 * Dívida herdada: valores do enum que a função nunca devolve.
 *
 * Não é permissão para crescer — é o teto. Cada um destes é um produto que,
 * se aparecer numa venda, cai em "Outros" sem explicação.
 */
const SEM_REGRA_CONHECIDOS = ['hormonal', 'velaroma', 'handify'];

function arquivos(): string[] {
  return readdirSync(DIR).filter(n => n.endsWith('.sql')).sort();
}

/** Todo valor de `produto_tipo`, venha da criação do tipo ou de um ADD VALUE. */
function valoresDoEnum(): string[] {
  const achados = new Set<string>();
  for (const nome of arquivos()) {
    const texto = readFileSync(join(DIR, nome), 'utf8');

    // CREATE TYPE produto_tipo AS ENUM ('velas', 'saponaria', ...)
    for (const m of texto.matchAll(
      /create\s+type\s+(?:public\.)?produto_tipo\s+as\s+enum\s*\(([^)]*)\)/gi,
    )) {
      for (const v of m[1].matchAll(/'([^']+)'/g)) achados.add(v[1]);
    }
    // ALTER TYPE produto_tipo ADD VALUE [IF NOT EXISTS] 'sala_de_aula'
    for (const m of texto.matchAll(
      /alter\s+type\s+(?:public\.)?produto_tipo\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'([^']+)'/gi,
    )) {
      achados.add(m[1]);
    }
  }
  return [...achados];
}

/** O corpo da definição VIGENTE de `mapear_produto_por_nome`. */
function corpoDaFuncao(): string {
  let ultimo = '';
  for (const nome of arquivos()) {
    const texto = readFileSync(join(DIR, nome), 'utf8');
    if (/function\s+(?:public\.)?mapear_produto_por_nome/i.test(texto)) ultimo = texto;
  }
  return ultimo;
}

describe('o enum de produto', () => {
  const valores = valoresDoEnum();

  it('é lido das migrações — senão o teste não prova nada', () => {
    /* O pior defeito possível aqui: a regex parar de casar, o conjunto ficar
       vazio e tudo "passar" para sempre sem olhar nada. */
    expect(valores.length).toBeGreaterThan(3);
    expect(valores).toContain('velas');
    expect(valores).toContain('sala_de_aula');
  });

  it('tem a função de mapeamento nas migrações', () => {
    expect(corpoDaFuncao().length).toBeGreaterThan(0);
  });

  it('não ganhou valor novo sem alguém ensinar a função a devolvê-lo', () => {
    const corpo = corpoDaFuncao();
    const semRegra = valores.filter(v => !corpo.includes(`RETURN '${v}'`));
    const novos = semRegra.filter(v => !SEM_REGRA_CONHECIDOS.includes(v));

    expect(novos, `valor(es) de produto_tipo que nenhuma regra devolve: ${novos.join(', ')}. `
      + 'Produto marcado com eles cai em "Outros" na página de Vendas sem dizer por quê. '
      + 'Ensine `mapear_produto_por_nome` a devolvê-lo, ou anote em SEM_REGRA_CONHECIDOS '
      + 'com o motivo.').toEqual([]);
  });

  it('a dívida anotada é real, e não uma lista que sobrou', () => {
    /* Se alguém ensinar a função a devolver `handify`, este teste avisa para
       tirar da lista. Sem isso, a catraca afrouxa sozinha com o tempo. */
    const corpo = corpoDaFuncao();
    const jaResolvidos = SEM_REGRA_CONHECIDOS.filter(v => corpo.includes(`RETURN '${v}'`));
    expect(jaResolvidos, `já têm regra e podem sair de SEM_REGRA_CONHECIDOS: ${jaResolvidos.join(', ')}`)
      .toEqual([]);
  });
});
