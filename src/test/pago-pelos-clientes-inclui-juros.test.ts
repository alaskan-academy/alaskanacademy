/**
 * Toda tela que diz "Pago pelos clientes" inclui os juros do parcelamento.
 *
 * ── A regra de negócio ────────────────────────────────────────────────────
 *
 *     valor_total          o que a cliente DESEMBOLSOU, com juros
 *     valor_sem_juros      o mesmo sem eles. É a base que a Payt reporta
 *     juros_parcelamento   a diferença. Fica INTEIRA com a Payt e nunca chega
 *                          na conta, mas o fisco cobra Simples sobre ela
 *
 * Quem se chama "pago pelos clientes" tem de somar os juros, porque a cliente
 * pagou. Quem se chama receita, não, porque não é da empresa. E as cascatas das
 * duas telas subtraem os juros logo abaixo para chegar na receita, então com o
 * número sem juros em cima eles desciam DUAS vezes e as linhas não fechavam.
 *
 * ── Por que este teste descobre os arquivos em vez de listá-los ───────────
 *
 * A primeira versão, escrita em 06/10/2026, tinha
 * `const TELA = 'src/features/dashboard/pages/OverviewPage.tsx'` cravado. No
 * mesmo dia uma auditoria achou o MESMO defeito em
 * `FinanceiroResultadoPage.tsx`, que mostra o número na primeira linha da tela
 * e o exporta na coluna "Pago pelos clientes" do CSV que vai para a
 * contabilidade. O teste não viu porque não olhava para lá.
 *
 * Isso é a terceira armadilha do CLAUDE.md (lista fixa no código que envelhece
 * em silêncio), com o agravante de ser o próprio guardião do defeito. Agora ele
 * VARRE o `src/` atrás do rótulo e falha se aparecer uma tela nova que ele não
 * saiba conferir, em vez de ignorá-la.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const RAIZ = join(process.cwd(), 'src');
const ROTULO = 'Pago pelos clientes';

const semComentario = (s: string) =>
  s.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '').replace(/\/\/[^\n]*/g, '');

/*
  A busca ignora COMENTARIO de proposito. `resultado.ts` cita o rotulo na
  documentacao do campo `pagoPelosClientes`, para explicar o contrato, e isso
  nao e uma tela: exigir regra de conferencia dele faria o teste falhar por
  prosa. O contrato em si tem assercao propria, no fim deste arquivo.
*/
function varrer(dir: string, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) { varrer(caminho, achados); continue; }
    if (!/\.tsx?$/.test(nome)) continue;
    if (caminho.includes(`${join('src', 'test')}`)) continue;
    if (semComentario(readFileSync(caminho, 'utf8')).includes(ROTULO)) {
      achados.push(relative(process.cwd(), caminho).replace(/\\/g, '/'));
    }
  }
  return achados;
}

/**
 * Cada tela monta esse número de um jeito, porque uma lê `fn_overview` e a
 * outra lê `vw_faturamento_liquido`. O que não muda é a obrigação de somar os
 * juros, e é isso que cada regra confere.
 */
const REGRAS: Record<string, { soma: RegExp; usa: RegExp; descricao: string }> = {
  'src/features/dashboard/pages/OverviewPage.tsx': {
    soma: /const pagoClientes = fatBruto \+ juros;/,
    usa: /kpis\.pagoClientes/,
    descricao: 'o Resumo soma `fatBruto + juros` e os dois lugares leem `kpis.pagoClientes`',
  },
  'src/features/financeiro/pages/FinanceiroResultadoPage.tsx': {
    /*
      `[^;]` e a parte que importa, e nao enfeite. Com `[\s\S]{0,200}?` a regex
      atravessava o ponto e virgula e casava com a linha SEGUINTE,
      `c.juros += Number(r.juros_parcelamento ?? 0)`, que fala dos mesmos juros
      e esta a poucos caracteres de distancia. Com a isca plantada (a soma
      removida de `pagoPelosClientes`) o teste passava verde.
    */
    soma: /c\.pagoPelosClientes \+=[^;]{0,400}Number\(r\.juros_parcelamento \?\? 0\)[^;]{0,400};/,
    usa: /pagoPelosClientes/,
    descricao: 'o Financeiro soma `juros_parcelamento` da view ao `faturamento_bruto`',
  },
};

const telas = varrer(RAIZ);

describe('pago pelos clientes inclui os juros', () => {
  it('o teste enxerga as telas que usam esse rótulo', () => {
    // Se cair para zero, a varredura quebrou e tudo abaixo passaria por nada.
    expect(telas.length, 'nenhuma tela com o rótulo: a varredura deixou de funcionar')
      .toBeGreaterThan(0);
  });

  it('nenhuma tela com esse rótulo fica sem regra de conferência', () => {
    /*
      É isto que a versão anterior não fazia. Tela nova com o rótulo entra aqui
      como falha, e quem a escreveu precisa dizer como ela monta o número, em
      vez de o defeito passar porque o teste olhava para outro arquivo.
    */
    const semRegra = telas.filter(t => !REGRAS[t]);
    expect(semRegra, `tela(s) com "${ROTULO}" e sem regra neste teste: ${semRegra.join(', ')}`)
      .toEqual([]);
  });

  it('cada tela soma os juros', () => {
    for (const [arquivo, regra] of Object.entries(REGRAS)) {
      expect(telas, `${arquivo} sumiu ou perdeu o rótulo`).toContain(arquivo);
      const codigo = semComentario(readFileSync(join(process.cwd(), arquivo), 'utf8'));
      expect(codigo, `${arquivo}: ${regra.descricao}`).toMatch(regra.soma);
      expect(codigo, `${arquivo}: o rótulo deixou de ler o número que soma os juros`)
        .toMatch(regra.usa);
    }
  });

  it('no Resumo, os dois lugares leem a grandeza com juros, não `fatBruto`', () => {
    /*
      São dois: o card de métrica e o topo da cascata. `fatBruto` continua
      existindo e SEM juros, porque é ele que vai no rateio de custo fixo contra
      `fat_bruto_total` e é ele que a conferência compara com a Payt.
    */
    const arquivo = 'src/features/dashboard/pages/OverviewPage.tsx';
    const codigo = semComentario(readFileSync(join(process.cwd(), arquivo), 'utf8'));

    const rotulos = codigo.match(/rotulo="Pago pelos clientes"/g) ?? [];
    expect(rotulos.length, `${arquivo}: mudou a quantidade de lugares com o rótulo`).toBe(2);

    for (const m of codigo.matchAll(/rotulo="Pago pelos clientes"([\s\S]{0,220}?)\/>/g)) {
      expect(m[1], `${arquivo}: um "${ROTULO}" voltou a ler fatBruto`)
        .not.toMatch(/kpis\.fatBruto/);
      expect(m[1], `${arquivo}: um "${ROTULO}" deixou de ler pagoClientes`)
        .toMatch(/kpis\.pagoClientes/);
    }

    expect(codigo, `${arquivo}: o rateio deixou de usar fatBruto`)
      .toMatch(/participacao\(fatBruto, num\(d\.fat_bruto_total\)\)/);
    expect(codigo, `${arquivo}: fatBruto ganhou juros e quebrou o rateio`)
      .toMatch(/const fatBruto = num\(d\.fat_bruto\);/);
  });

  it('a seta de variação do Resumo compara a mesma grandeza que mostra', () => {
    const codigo = semComentario(
      readFileSync(join(process.cwd(), 'src/features/dashboard/pages/OverviewPage.tsx'), 'utf8'));
    expect(codigo, 'o período anterior perdeu o pagoClientes').toMatch(
      /pagoClientes: num\(a\?\.fat_bruto\) \+ num\(a\?\.juros\)/,
    );
  });

  it('o contrato escrito continua dizendo que inclui os juros', () => {
    /*
      `resultado.ts` documenta `pagoPelosClientes` como "vendas aprovadas COM
      JUROS, mais o que depois voltou atrás". Esse texto estava certo enquanto o
      código estava errado, e foi ele que permitiu provar qual dos dois mentia.
      Se alguém alinhar a prosa ao defeito em vez do contrário, a próxima
      auditoria perde a testemunha.
    */
    const doc = readFileSync(
      join(process.cwd(), 'src/features/financeiro/lib/resultado.ts'), 'utf8');
    const trecho = doc.slice(Math.max(0, doc.indexOf(ROTULO) - 1200),
                             doc.indexOf('pagoPelosClientes: number'));
    expect(trecho, 'resultado.ts: o contrato deixou de dizer que inclui os juros')
      .toMatch(/COM JUROS/i);
  });
});
