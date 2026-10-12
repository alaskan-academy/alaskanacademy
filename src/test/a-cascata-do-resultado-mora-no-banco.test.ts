/**
 * A cascata do resultado mora no banco, e em nenhum outro lugar.
 *
 * ── O que mudou em 12/10/2026, e o que se perdeu junto ────────────────────
 *
 * A tela Financeiro → Resultado montava a própria cascata em TypeScript:
 * `agruparCaixa` + `simplesDoMes` + `montarResultado`, com 38 testes de
 * unidade cobrindo cada regra. O módulo de Metas precisou do MESMO lucro,
 * não tinha de onde tirá-lo, e a conta virou `fn_resultado_mes` no banco.
 *
 * Enquanto as duas existiram, discordaram: setembro dava +R$ 269,52 na tela
 * e −R$ 205,55 no KPI, por causa da janela da alíquota (dois meses contra
 * três). Dois lucros no mesmo painel é a primeira armadilha do CLAUDE.md na
 * variável que mais importa.
 *
 * Então a de TypeScript foi apagada, e com ela os 38 testes — eles
 * exercitavam funções que não existem mais. **Isto é uma perda de cobertura
 * executável, e vale dizer com todas as letras:** aqueles testes rodavam a
 * conta de verdade sobre dados de mentira; estes leem o SQL e conferem que
 * ele diz o que deve dizer.
 *
 * O que compensa em parte: a prova de `20261012w` comparou a função, mês a
 * mês, com os números que a tela realmente mostrava em produção — receita e
 * custos batem nos cinco meses fechados, e o anúncio de setembro bate em
 * R$ 153.278,98. Isso os testes de unidade nunca fizeram.
 *
 * O que este arquivo guarda é a estrutura: que a cascata continue com um
 * dono só, que as exclusões não sumam, e que ninguém reconstrua a conta no
 * TypeScript quando precisar dela em outra tela.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ      = process.cwd();
const MIGRACOES = join(RAIZ, 'supabase', 'migrations');
const SRC       = join(RAIZ, 'src');

function semComentarios(bruto: string) {
  return bruto.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** O corpo da última definição de `fn_resultado_mes`, sem a prova nem o cabeçalho. */
function corpoDaFuncao(): string {
  let arquivo = '';
  for (const n of readdirSync(MIGRACOES).filter(x => x.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRACOES, n), 'utf8');
    if (/create\s+or\s+replace\s+function\s+public\.fn_resultado_mes/i.test(sql)) arquivo = sql;
  }
  expect(arquivo, 'nenhuma migração define fn_resultado_mes').not.toBe('');

  const i = arquivo.search(/create\s+or\s+replace\s+function\s+public\.fn_resultado_mes/i);
  const j = arquivo.indexOf('comment on function public.fn_resultado_mes', i);
  const corpo = semComentarios(arquivo.slice(i, j > i ? j : undefined));
  expect(corpo.length, 'não consegui recortar o corpo da função').toBeGreaterThan(1000);
  return corpo;
}

/** Todo .ts/.tsx sob src/, fora de test/. */
function fontes(): { caminho: string; texto: string }[] {
  const saida: { caminho: string; texto: string }[] = [];
  const anda = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'test') anda(p); }
      /* Sem comentários: o cabeçalho da tela CONTA a história de que a
         cascata saía de `montarResultado`, e casar com a prosa reprovaria
         o arquivo por explicar o próprio conserto. */
      else if (/\.tsx?$/.test(e.name)) {
        saida.push({
          caminho: p,
          texto: readFileSync(p, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/[^\n]*$/gm, ''),
        });
      }
    }
  };
  anda(SRC);
  return saida;
}

describe('a cascata tem um dono só', () => {
  it('a tela Resultado lê a função, não monta a conta', () => {
    const tela = readFileSync(
      join(SRC, 'features', 'financeiro', 'pages', 'FinanceiroResultadoPage.tsx'), 'utf8');

    expect(tela, 'a tela não chama fn_resultado_mes').toContain("rpc('fn_resultado_mes'");
    expect(
      /from\(\s*['"]vw_faturamento_liquido['"]/.test(tela),
      'a tela voltou a buscar vw_faturamento_liquido para montar a própria cascata',
    ).toBe(false);
  });

  it('ninguém reimplementou a cascata em TypeScript', () => {
    const proibidos = ['montarResultado', 'simplesDoMes', 'agruparCaixa'];
    const culpados: string[] = [];

    for (const f of fontes()) {
      for (const nome of proibidos) {
        if (new RegExp(`\\b${nome}\\b`).test(f.texto)) {
          culpados.push(`${f.caminho.replace(RAIZ, '.')}: ${nome}`);
        }
      }
    }

    expect(
      culpados,
      'A cascata voltou para o TypeScript. Ela mora em fn_resultado_mes desde ' +
      '12/10/2026, e duas implementações da mesma conta divergiram da última vez ' +
      'em R$ 475 num único mês.',
    ).toEqual([]);
  });
});

describe('o que a função não pode deixar de fazer', () => {
  it('a competência vem da view de faturamento, e o caixa das transações', () => {
    const c = corpoDaFuncao();
    expect(c, 'a competência deixou de sair de vw_faturamento_liquido').toMatch(/vw_faturamento_liquido/);
    expect(c, 'o caixa deixou de sair de transacoes').toMatch(/from\s+transacoes/);
  });

  it('sócio e reserva saem de categorias_centro, não de lista escrita na função', () => {
    /* `ehCustoOperacional` conhece CAT_SOCIOS e CAT_RESERVA por lista no
       código porque roda em laço sobre milhares de linhas. Em SQL não há
       essa desculpa, e lista escrita envelhece em silêncio — foi assim que
       `Aporte de Sócio` nasceu no banco, ficou fora da lista, e R$ 2.000 de
       capitalização viraram faturamento. */
    const c = corpoDaFuncao();
    expect(c, 'a função não consulta categorias_centro').toMatch(/categorias_centro/);
    expect(c).toMatch(/'socio'/);
    expect(c).toMatch(/'reserva'/);

    for (const nome of ['Pró-labore', 'Retirada de Lucro', 'Aporte de Sócio', 'Reserva de Caixa']) {
      expect(
        c.includes(`'${nome}'`),
        `o nome de categoria "${nome}" foi escrito dentro da função; ele pertence a categorias_centro`,
      ).toBe(false);
    }
  });

  it('imposto e anúncio NÃO entram nos custos — eles já são linha própria', () => {
    /* A fatura do cartão da Meta está no extrato, e a linha do Meta também
       existe na cascata. Somadas, o anúncio entra duas vezes e em dois meses
       diferentes. Mesma coisa com Impostos e Tributos. */
    const c = corpoDaFuncao();
    const custos = c.match(/as\s+custos_pagos[\s\S]{0,40}/i);
    expect(custos, 'não achei o cálculo de custos_pagos').not.toBeNull();
    expect(c, 'custos_pagos deixou de excluir imposto e anúncio')
      .toMatch(/not in\s*\(\s*'Impostos e Tributos'\s*,\s*'Anúncios \(Facebook ADs\)'\s*\)/);
  });

  it('o Simples vem da view, e não é recalculado aqui', () => {
    /* Era a origem dos dois lucros: a tela usava dois meses de janela e a
       view usa três. Recalcular aqui recriaria a terceira. */
    const c = corpoDaFuncao();
    expect(c, 'a função não lê vw_aliquota_simples_mes').toMatch(/vw_aliquota_simples_mes/);
    expect(c, 'a função voltou a calcular a própria janela de alíquota')
      .not.toMatch(/rows between .* preceding/i);
  });

  it('o lucro líquido é depois das retiradas, e a cadeia fecha', () => {
    /* Decisão dela, 12/10/2026: "lucro líquido deve ser após esta retirada,
       pois é para os custos de vida dos sócios". */
    const c = corpoDaFuncao();
    expect(c).toMatch(/sobrou_depois_das_retiradas/);
    expect(c, 'o lucro líquido deixou de subtrair as retiradas')
      .toMatch(/-\s*j\.custos_pagos\s*-\s*j\.retiradas_socios\s*\)\s*as sobrou_depois_das_retiradas/);
  });

  it('o imposto entra UMA vez, dentro de impostos_e_taxas', () => {
    /* O plano o contava duas vezes: a "sobra antes do fixo" da UTMify já
       descontava o Simples, e o custo fixo trazia de novo R$ 14,3 mil sob o
       rótulo de "jurídico". Confirmado por ela: "é o imposto mesmo, pode
       tirar do custo fixo". */
    const c = corpoDaFuncao();
    expect(c).toMatch(/\(j\.taxa_payt \+ j\.imposto_meta \+ j\.simples\) as impostos_e_taxas/);
    const vezes = (c.match(/j\.simples\b/g) ?? []).length;
    expect(
      vezes,
      'o Simples aparece um número inesperado de vezes na cascata; ' +
      'cada aparição extra é um risco de ele descer duas vezes',
    ).toBeLessThanOrEqual(6);
  });

  it('não fica aberta ao anon', () => {
    const arquivo = readdirSync(MIGRACOES).filter(n => n.endsWith('.sql')).sort()
      .map(n => readFileSync(join(MIGRACOES, n), 'utf8'))
      .filter(s => /create\s+or\s+replace\s+function\s+public\.fn_resultado_mes/i.test(s))
      .pop() ?? '';
    expect(arquivo).toMatch(
      /revoke all on function public\.fn_resultado_mes\(uuid\) from public\s*,\s*anon/i);
  });
});
