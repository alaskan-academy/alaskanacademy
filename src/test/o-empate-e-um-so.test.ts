/**
 * O empate é UM número, e agora ele mora numa linha de tabela.
 *
 * ── A história deste teste, que é a história do problema ──────────────────
 *
 * O empate é o ROAS em que o anúncio se paga. Ele nasceu numa constante do
 * React (`CRIVO.empate` em `AvaliacaoView.tsx`), ganhou uma segunda cópia em
 * `vw_ad_morrendo` (`roas_7 < 1.6`, migração 20260924b) e uma terceira em prosa
 * na tela do Meta Ads ("abaixo do empate de 1,6"). Três cópias do mesmo número,
 * a primeira armadilha do CLAUDE.md — e o gatilho que as faria divergir estava
 * escrito no próprio comentário do CRIVO: "se a taxa da Payt, o Simples ou o
 * custo fixo mudarem, o 1,6 muda junto".
 *
 * **E mudaram.** Em 20261008i a alíquota do Simples foi remedida: 9% → 6,9359%.
 * O empate real virou **1,56**. As três cópias continuariam dizendo 1,6.
 *
 * A versão anterior deste teste comparava a tela com a view e exigia que fossem
 * iguais. Resolvia metade, e estava **cega nos dois sentidos**:
 *
 * 1. `daView()` guardava o último `roas_7 < [num]` encontrado e **não zerava
 *    entre migrações**. Uma migração nova que redefinisse a view sem o literal
 *    deixava o valor da migração ANTERIOR no lugar — o teste comparava a tela
 *    com um número morto e passava verde.
 * 2. Ele lia só `empate:`. Trocar `CRIVO.linhas` — os níveis de validação, que
 *    são outros números — passava sem ninguém notar.
 * 3. E a terceira cópia, a da prosa do Meta Ads, não era vigiada por nada:
 *    estava em texto corrido.
 *
 * ── O que mudou no desenho, e o que este teste cobra agora ───────────────
 *
 * Desde 20261009a o empate mora em `crivo_versoes.empate`, uma linha imutável
 * que carrega junto a justificativa. `vw_ad_morrendo` o lê de
 * `vw_crivo_vigente` (20261009e), a tela de avaliação também, e a frase do Meta
 * Ads deixou de citar o número.
 *
 * Então a invariante deixou de ser "os dois são iguais" e passou a ser mais
 * forte: **o número existe em UM lugar só**. É isso que está cobrado aqui.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MIGRACOES = join(process.cwd(), 'supabase', 'migrations');
const SRC = join(process.cwd(), 'src');

/** Os arquivos de migração, em ordem. */
const migracoes = readdirSync(MIGRACOES)
  .filter(n => n.endsWith('.sql'))
  .sort()
  .map(nome => ({ nome, sql: readFileSync(join(MIGRACOES, nome), 'utf8') }));

/**
 * O SQL sem comentários.
 *
 * Não é detalhe: a primeira versão deste teste casava com a linha
 * `--   roas_7 < 1.6   o EMPATE medido em...` do cabeçalho da migração, que vem
 * ANTES do WHERE. Plantei a isca — troquei o 1.6 do WHERE por 1.4 — e ela
 * passou, porque estava conferindo a DOCUMENTAÇÃO contra a tela. Um teste que
 * lê o comentário concorda com qualquer coisa que o comentário diga.
 */
function semComentarios(sql: string): string {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Todo `.ts`/`.tsx` de `src`, menos os testes. */
function fontes(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) fontes(caminho, acc);
    else if (/\.tsx?$/.test(nome)) acc.push(caminho);
  }
  return acc;
}
const FONTES = fontes(SRC).filter(f => !f.includes('test'));

/** O código sem comentários — o que o navegador vê. */
function codigoDe(arquivo: string): string {
  return readFileSync(arquivo, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
}

describe('o empate é um só', () => {
  /**
   * A ÚLTIMA migração que define `vw_ad_morrendo`, e só ela.
   *
   * O bug da versão anterior era não zerar: aqui a função devolve a definição
   * da última migração que a (re)cria, e as asserções olham só essa. Se alguém
   * acrescentar uma migração nova com o literal de volta, é essa que é lida.
   */
  function ultimaDefinicaoDaView(): { nome: string; sql: string } {
    let achado: { nome: string; sql: string } | null = null;
    for (const m of migracoes) {
      if (/create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?vw_ad_morrendo\b/i.test(m.sql)) {
        achado = { nome: m.nome, sql: semComentarios(m.sql) };
      }
    }
    if (!achado) throw new Error('nenhuma migração define vw_ad_morrendo — o teste ficou cego');
    return achado;
  }

  it('a view do anúncio morrendo NÃO tem o empate escrito nela', () => {
    const { nome, sql } = ultimaDefinicaoDaView();

    /* O corte de ROAS tem de vir de uma coluna, não de um número. Cobrimos as
       duas notações porque uma das quatro cópias antigas escapava justamente
       por estar com vírgula (no `COMMENT ON VIEW`). */
    expect(sql, `${nome} voltou a comparar roas_7 com um número literal`)
      .not.toMatch(/roas_7\s*<\s*[0-9]/);

    expect(sql, `${nome} define vw_ad_morrendo sem ler o empate de vw_crivo_vigente`)
      .toMatch(/vw_crivo_vigente/);
  });

  it('o empate vem de uma tabela versionada, com justificativa junto', () => {
    /* A tabela existe, e carrega a prosa na MESMA linha do número. É isso que
       impede os dois de divergirem: não há duas coisas para editar. */
    const criacao = migracoes.find(m =>
      /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.crivo_versoes\b/i.test(m.sql));
    expect(criacao, 'nenhuma migração cria crivo_versoes').toBeTruthy();

    const sql = semComentarios(criacao!.sql);
    expect(sql, 'crivo_versoes não tem a coluna empate').toMatch(/\bempate\s+numeric/i);
    expect(sql, 'crivo_versoes não guarda a justificativa junto do número')
      .toMatch(/justificativa\s+text\[\]/i);
    /* `medido_em` anulável é o que permite dizer "decidida, não medida" em vez
       de inventar uma data de apuração para uma escolha. */
    expect(sql, 'crivo_versoes não tem medido_em').toMatch(/\bmedido_em\s+date/i);
  });

  it('a semente tem DUAS versões: a medida e a decidida', () => {
    /* Guardar a v1 não é zelo: a medição dos 782 ADs e R$ 242.143 é a única
       régua que foi apurada de verdade neste projeto, e é contra ela que daqui
       a uns meses se pergunta qual das duas acertou mais. Uma tabela de versões
       com uma linha só é um retrato — quarta armadilha. */
    const semente = migracoes.find(m => /insert\s+into\s+public\.crivo_versoes/i.test(m.sql));
    expect(semente, 'nenhuma migração semeia crivo_versoes').toBeTruthy();

    const sql = semComentarios(semente!.sql);
    const datas = [...sql.matchAll(/'(\d{4}-\d{2}-\d{2})'/g)].map(m => m[1]);
    const distintas = [...new Set(datas)];
    expect(distintas.length, `a semente tem ${distintas.length} data(s) distintas, esperava ao menos 2`)
      .toBeGreaterThanOrEqual(2);
  });

  it('nenhuma tela escreve o empate como número', () => {
    /*
      A cópia que mais custou foi a que ninguém vigiava: "abaixo do empate de
      1,6", em prosa, dentro do aviso de anúncio morrendo do Meta Ads
      (`MetaAdsPage.tsx:306`). Prosa com número envelhece igual a código com
      número — e pior, porque nenhum teste olha.

      A regra: a palavra "empate" pode aparecer na tela; um NÚMERO ao lado dela,
      não. O que o usuário vê tem de vir de `vw_crivo_vigente`.
    */
    const suspeitos: string[] = [];

    for (const arquivo of FONTES) {
      const codigo = codigoDe(arquivo);
      const linhas = codigo.split('\n');
      for (let i = 0; i < linhas.length; i++) {
        if (!/empate/i.test(linhas[i])) continue;
        /* Número com casa decimal na mesma linha da palavra "empate". Inteiro
           não conta: `empate` aparece em nomes de coluna e em contagens. */
        if (/\d+[.,]\d/.test(linhas[i])) {
          suspeitos.push(`${arquivo.replace(SRC, 'src')}:${i + 1} — ${linhas[i].trim()}`);
        }
      }
    }

    expect(suspeitos.join(' | ')).toEqual('');
  });

  it('nenhuma tela escreve os níveis da régua como número', () => {
    /*
      O segundo buraco da versão anterior: ela lia só `empate:` e deixava
      `CRIVO.linhas` passar. Os níveis (vendas mínimas e ROAS mínimo de cada
      nota) são a régua que DECIDE a avaliação — desde 09/10/2026 a máquina
      escreve por ela —, e eles mudaram junto: Validado virou
      (10 vendas e ROAS ≥ 1,65) ou (5 e > 2), Escalado virou (15 e > 1,8).

      Um número desses no front seria pior que o empate duplicado: a tela
      mostraria uma régua e o banco aplicaria outra, sem erro em lugar nenhum.
    */
    const suspeitos: string[] = [];

    for (const arquivo of FONTES) {
      const codigo = codigoDe(arquivo);
      const linhas = codigo.split('\n');
      for (let i = 0; i < linhas.length; i++) {
        const l = linhas[i];
        /*
          A forma exata da constante antiga:

            { nivel: 'Validado', vendas: 6,  roas: '1,6', ... }

          Duas peneiras, e as duas precisam ser estreitas. `vendas: 0` aparece
          em acumuladores em meia dúzia de telas (UTM, Tendências, Financeiro) e
          não é régua nenhuma — por isso o limiar de vendas só conta quando vem
          acompanhado de `nivel` ou de `roas` na mesma linha. E o limiar de ROAS
          exige casa decimal, o que já descarta `roas: 0` de acumulador.
        */
        const limiarDeRoas = /\broas\s*:\s*['"]?\d+[.,]\d/.test(l);
        const limiarDeVendas = /\bvendas\s*:\s*\d+/.test(l)
          && (/\bnivel\s*:/.test(l) || /\broas\s*:/.test(l));
        if (limiarDeRoas || limiarDeVendas) {
          suspeitos.push(`${arquivo.replace(SRC, 'src')}:${i + 1} — ${l.trim()}`);
        }
      }
    }

    expect(suspeitos.join(' | ')).toEqual('');
  });

  it('a tela de avaliação lê a régua do banco', () => {
    /* A ponta positiva: não basta não ter número, tem de ter fonte. Sem isto o
       teste passaria numa tela que simplesmente deixou de mostrar a régua. */
    const crivo = codigoDe(join(SRC, 'features', 'criativos', 'crivo.tsx'));
    expect(crivo, 'crivo.tsx não consulta vw_crivo_vigente').toMatch(/vw_crivo_vigente/);
    expect(crivo, 'crivo.tsx não consulta as cláusulas dos níveis')
      .toMatch(/vw_crivo_niveis_vigentes/);

    const tela = codigoDe(join(SRC, 'features', 'criativos', 'components', 'AvaliacaoView.tsx'));
    expect(tela, 'a tela de avaliação deixou de renderizar a régua')
      .toMatch(/TabelaDoCrivo/);
  });
});
