/**
 * A recuperação de checkout tem uma regra só, e ela mora no banco.
 *
 * ── O que este arquivo guarda ──────────────────────────────────────────────
 *
 * Em 12/10/2026 o Resumo e as Metas respondiam "quanto a gente recupera?" com
 * réguas diferentes, e ninguém podia comparar as duas:
 *
 *     Resumo    cliente_id + produto_nome, ±7 dias    634 casos, 201 recuperados
 *     Metas     CPF + produto,              30 dias   632 casos, 224 recuperados
 *
 * A regra passou a morar em `fn_checkout_perdido()`, e a JANELA virou pergunta
 * de quem lê — 7 dias no Resumo (decisão dela: a tela é recortada por período
 * e 30 dias olhariam para fora do recorte), 30 nas Metas.
 *
 * Unificar encontrou cinco defeitos, cada um com uma asserção aqui:
 *
 *   1. `sum(valor)` por caso somava todas as tentativas do mesmo carrinho.
 *      Em setembro: 789 tentativas para 632 casos, +R$ 17,7 mil de prejuízo
 *      que não existia — e era o denominador da meta.
 *   2. O recorte por meio de pagamento apagou maio inteiro, onde o campo é
 *      nulo em 466 de 660 linhas. 569 casos viraram 166 em silêncio.
 *   3. A janela do Resumo era `BETWEEN -7 AND +7 days`: contava como
 *      "recuperada" uma compra feita ANTES do checkout abandonado.
 *   4. `rows between 1 following` tratava como "depois" uma aprovação do
 *      MESMO instante, desempatada por id. São 110 linhas assim em maio e
 *      zero de junho em diante — artefato da importação antiga.
 *   5. A regra nasceu como VIEW `security_invoker`, e view invoker roda com
 *      os direitos de quem consulta: como `authenticated` não tem privilégio
 *      na coluna do documento, o Resumo INTEIRO passou a responder
 *      `permission denied` para todo usuário do painel. As provas passavam
 *      verdes porque rodavam como dono.
 *
 * O defeito 5 é a razão de este arquivo existir nesta forma: ele não tem como
 * rodar SQL, então guarda a FORMA da solução — função definer com chave
 * opaca, nunca view, nunca hash do documento.
 *
 * Lê as MIGRAÇÕES, não o banco, pela razão do CLAUDE.md: migração aplicada
 * sem arquivo é invisível para a catraca, e ela continua verde sobre a
 * definição antiga.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = process.cwd();
const MIGRACOES = join(RAIZ, 'supabase', 'migrations');

const semComentarios = (s: string) =>
  s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** O SQL (sem comentários) da última migração que casa com o padrão. */
function ultimaQue(padrao: RegExp): { arquivo: string; sql: string } {
  let achado = { arquivo: '', sql: '' };
  for (const n of readdirSync(MIGRACOES).filter(x => x.endsWith('.sql')).sort()) {
    const bruto = readFileSync(join(MIGRACOES, n), 'utf8');
    if (padrao.test(semComentarios(bruto))) achado = { arquivo: n, sql: semComentarios(bruto) };
  }
  return achado;
}

const PERDIDO = /create\s+or\s+replace\s+function\s+public\.fn_checkout_perdido/i;
const RECUPERADO = /create\s+or\s+replace\s+function\s+public\.fn_checkout_recuperado/i;

/**
 * Só o corpo da função pedida, do `create` até o `$function$;` que a fecha.
 *
 * A primeira versão deste arquivo procurava os termos na migração INTEIRA e
 * reprovava — porque a mensagem de erro da própria prova fala do meio de
 * pagamento. O teste acusava o guardião do defeito, que é o jeito mais rápido
 * de alguém desligá-lo.
 */
function corpo(padrao: RegExp): string {
  const { sql } = ultimaQue(padrao);
  const i = sql.search(padrao);
  expect(i, 'não achei o create da função para recortar').toBeGreaterThanOrEqual(0);
  const fim = sql.indexOf('$function$;', sql.indexOf('$function$', i) + 1);
  const texto = sql.slice(i, fim > i ? fim : undefined);
  expect(texto.length, 'o recorte da função saiu vazio ou curto demais').toBeGreaterThan(600);
  return texto;
}

describe('a regra do casamento mora numa função, não numa view', () => {
  it('existe uma migração que define fn_checkout_perdido', () => {
    expect(ultimaQue(PERDIDO).arquivo, 'nenhuma migração define fn_checkout_perdido').not.toBe('');
  });

  it('é SECURITY DEFINER com search_path fixo — e nunca uma view', () => {
    /* Defeito 5. View `security_invoker` roda com os direitos de quem
       consulta, e `authenticated` não tem a coluna do documento: o Resumo
       inteiro respondia `permission denied for table clientes`. Tirar o
       invoker seria pior — o documento de 12.786 pessoas ficaria legível por
       `anon`, cuja chave está no bundle. A saída é função definer. */
    const c = corpo(PERDIDO);
    expect(c, 'fn_checkout_perdido deixou de ser SECURITY DEFINER').toMatch(/security\s+definer/i);
    expect(c, 'SECURITY DEFINER sem search_path fixo').toMatch(/set\s+search_path\s+to\s+'public'/i);

    const { sql } = ultimaQue(PERDIDO);
    expect(
      /create\s+(or\s+replace\s+)?view[\s\S]{0,200}checkout_perdido/i.test(sql),
      'a regra voltou a ser uma view: com invoker quebra o painel, sem invoker vaza o documento',
    ).toBe(false);
  });

  it('não devolve o documento nem hash dele — devolve um caso opaco', () => {
    /* Hash não serviria: são 11 dígitos, 10^11 combinações e força bruta de
       fim de semana. O que sai é um `dense_rank()` sobre (pessoa, produto),
       que é tudo que quem lê precisa — saber quais linhas são do mesmo caso. */
    const c = corpo(PERDIDO);
    expect(c, 'a função deixou de expor o caso como inteiro opaco').toMatch(
      /dense_rank\(\)\s+over\s+\(order by v\.pessoa, v\.produto\)::bigint\s+as caso/i,
    );

    const devolvidas = c.slice(c.search(/returns table/i), c.search(/\$function\$/));
    for (const proibido of [/\bcpf\b/i, /md5/i, /encode\s*\(/i, /digest\s*\(/i, /\bpessoa\b/i]) {
      expect(
        proibido.test(devolvidas),
        `a assinatura de fn_checkout_perdido voltou a devolver algo derivado do ` +
          `documento (${proibido}); a chave que sai tem de ser o inteiro opaco`,
      ).toBe(false);
    }
  });

  it('é revogada de PUBLIC e de anon, nos dois caminhos', () => {
    /* São dois grants independentes: o de PUBLIC (do qual anon é membro) e o
       nominal que o Supabase dá a anon por ALTER DEFAULT PRIVILEGES. */
    const { sql } = ultimaQue(PERDIDO);
    expect(sql, 'fn_checkout_perdido não é revogada de public e anon').toMatch(
      /revoke all on function public\.fn_checkout_perdido\(\) from public\s*,\s*anon/i,
    );
    expect(sql, 'fn_checkout_recuperado não é revogada de public e anon').toMatch(
      /revoke all on function public\.fn_checkout_recuperado\(uuid, date, int\) from public\s*,\s*anon/i,
    );
  });

  it('casa por CPF e pelo produto — não por cliente_id nem por produto_nome', () => {
    const c = corpo(PERDIDO);
    /* `produto_nome` é texto livre e muda quando alguém renomeia uma oferta;
       `cliente_id` conta duas vezes quem tem duas contas. Medido: a diferença
       entre casar pelo enum e pelo nome é 632/209 contra 633/206 — ruído. */
    expect(c, 'a função deixou de usar o documento como chave da pessoa').toMatch(/c\.cpf/);
    expect(c, 'a função deixou de casar pelo enum `produto`').toMatch(/v\.produto::text/);
    expect(
      /produto_nome/i.test(c),
      'a função voltou a casar por `produto_nome`, que é texto livre',
    ).toBe(false);
  });

  it('não filtra por meio de pagamento — foi isso que apagou maio', () => {
    const c = corpo(PERDIDO);
    expect(
      /meio_pagamento/i.test(c),
      'a função voltou a filtrar por `meio_pagamento`. O campo só passou a ser ' +
        'preenchido em junho/26: em maio ele é nulo em 466 de 660 linhas, e o ' +
        'filtro descarta as 466 sem dizer nada (569 casos viram 166).',
    ).toBe(false);
    /* O que define "não aprovada" é o STATUS, que não depende de campo
       opcional e já cobre o boleto do dia em que ele existir. */
    expect(c, 'a função deixou de recortar por status').toMatch(
      /status in \(\s*'pendente',\s*'cancelada',\s*'expirada'\s*\)/i,
    );
  });

  it('"depois" é data estritamente maior: GROUPS, nunca ROWS', () => {
    const c = corpo(PERDIDO);
    /* `rows between 1 following` ordena por (data_venda, id) e chama de
       "depois" uma linha do MESMO instante que só desempatou pelo id. São 110
       casos assim em maio e zero de junho em diante — a importação antiga
       carimbou hora grosseira. `groups` conta grupos de valores iguais, então
       "1 grupo adiante" é literalmente `data_venda > a minha`. */
    const janelas = c.match(/\b(rows|groups)\s+between/gi) ?? [];
    expect(janelas.length, 'a função perdeu as janelas de vizinhança').toBeGreaterThanOrEqual(3);
    expect(
      janelas.filter(j => /rows/i.test(j)),
      'voltou a usar ROWS: aprovação do mesmo instante volta a contar como ' +
        'recuperação (maio salta de 15,8% para 23,7%)',
    ).toEqual([]);
  });
});

describe('a janela é parâmetro de quem pergunta, não uma segunda regra', () => {
  it('fn_checkout_recuperado recebe a janela em dias', () => {
    const c = corpo(RECUPERADO);
    expect(c, 'a função perdeu o parâmetro de janela').toMatch(/p_dias\s+int\s+default\s+30/i);
    expect(c, 'a janela virou constante de novo em vez de usar p_dias').toMatch(
      /make_interval\(days\s*=>\s*p_dias\)/i,
    );
  });

  it('a função lê fn_checkout_perdido — não reimplementa o casamento', () => {
    const c = corpo(RECUPERADO);
    expect(c, 'fn_checkout_recuperado deixou de ler fn_checkout_perdido()').toMatch(
      /from\s+public\.fn_checkout_perdido\(\)/i,
    );
    expect(
      /join\s+clientes/i.test(c),
      'a função voltou a montar a própria chave de pessoa em vez de ler a regra',
    ).toBe(false);
  });

  it('o valor perdido é o da última tentativa, não a soma delas', () => {
    const c = corpo(RECUPERADO);
    /* 102 pessoas geraram cobrança mais de uma vez para o mesmo produto em
       setembro. Somar as 789 tentativas em vez dos 632 carrinhos inflava o
       prejuízo em R$ 17.732,15 — e era o denominador da meta. */
    expect(c, 'o valor perdido deixou de ser o da última tentativa').toMatch(
      /array_agg\(p\.valor\s+order by p\.data_venda desc, p\.venda_id desc\)\)\[1\]\s+as perdido/i,
    );
    expect(
      /sum\(\s*p?\.?valor\s*\)\s+as\s+perdido/i.test(c),
      'o prejuízo voltou a somar todas as tentativas do mesmo carrinho',
    ).toBe(false);
  });

  it('fn_overview passou a ler a mesma regra, com 7 dias', () => {
    const { arquivo, sql } = ultimaQue(/fn_checkout_perdido\(\) p ON p\.venda_id = b\.id/i);
    expect(arquivo, 'nenhuma migração faz fn_overview ler fn_checkout_perdido()').not.toBe('');

    expect(sql, 'o Resumo deixou de usar a janela de 7 dias').toMatch(
      /aprovada_em <= p\.data_venda \+ interval '7 days'/i,
    );
    /* O bloco continua lendo `base`, e não a função direto, porque `base` é
       quem respeita o filtro de conta de anúncio, de empresa e de segmento. */
    expect(sql, 'o bloco deixou de passar por `base` e perdeu os filtros da tela').toMatch(
      /FROM base b JOIN fn_checkout_perdido\(\) p/i,
    );
  });

  it('ninguém deixou para trás a régua antiga do Resumo', () => {
    /* A versão anterior casava `a.cliente_id = n.cliente_id` com
       `a.produto_nome IS NOT DISTINCT FROM n.produto_nome` numa janela
       `BETWEEN -7 AND +7 days`. Se reaparecer em qualquer migração a partir de
       hoje, voltaram a ser duas definições. */
    const culpadas: string[] = [];
    for (const n of readdirSync(MIGRACOES).filter(x => x.endsWith('.sql')).sort()) {
      if (n.slice(0, 8) < '20261012') continue;
      if (n.startsWith('20261012za')) continue; // é ela que descreve o defeito
      const sql = semComentarios(readFileSync(join(MIGRACOES, n), 'utf8'));
      if (/produto_nome IS NOT DISTINCT FROM/i.test(sql)) culpadas.push(n);
    }
    expect(culpadas, 'voltou a existir casamento por produto_nome').toEqual([]);
  });
});

describe('o card de Perdas desconta as duas coisas, separadas', () => {
  const TELA = join(RAIZ, 'src', 'features', 'dashboard', 'pages', 'OverviewPage.tsx');
  const codigo = readFileSync(TELA, 'utf8')
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')
    .replace(/^\s*\/\/[^\n]*$/gm, '');

  it('subtrai o recuperado E quem já era dono do produto', () => {
    /* São grandezas diferentes de propósito: quem voltou é recuperação (e é o
       que a meta mede); quem já tinha o produto nunca esteve em risco. Somar
       as duas numa só inflaria a taxa com mérito que não existe. */
    expect(codigo, 'o card parou de descontar quem já tinha comprado').toMatch(
      /const perdido = Math\.max\(total - recuperado - jaComprado, 0\)/,
    );
    expect(codigo, 'a tela não lê ja_comprado_valor').toMatch(/d\.recuperadas\?\.ja_comprado_valor/);
  });

  it('não reimplementa a janela de 7 dias no TypeScript', () => {
    /* A janela é do SQL. Se alguém recalcular aqui, voltam a ser duas regras —
       e a de cá não enxerga nem o documento nem as vendas fora do período. */
    expect(
      /7\s*\*\s*24\s*\*\s*60|addDays\(.*7\)|diffDays/i.test(codigo),
      'apareceu conta de 7 dias no TypeScript do Resumo',
    ).toBe(false);
  });

  it('não chama de "tentativas" um número que vem deduplicado', () => {
    /* O rótulo dizia "632 tentativas" sobre o total de CARRINHOS. As duas
       contagens agora existem e aparecem, e a diferença entre elas é quem
       insistiu. */
    expect(codigo, 'a tela não lê o total de tentativas').toMatch(/d\.tentativas_nao_aprovadas/);
    expect(
      /\{formatNumber\(qtdTotal\)\} tentativas/.test(codigo),
      'o número de carrinhos voltou a ser rotulado como "tentativas"',
    ).toBe(false);
  });
});
