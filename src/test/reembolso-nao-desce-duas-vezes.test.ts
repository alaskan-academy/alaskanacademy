/**
 * A venda estornada já saiu da receita. Ninguém pode descontá-la de novo.
 *
 * ── Por que este teste existe, se já havia um ─────────────────────────────
 *
 * `src/test/financeiro.test.ts:105` se chama "não desconta reembolso, porque a
 * venda estornada já saiu da receita" e passa desde que foi escrito. Ele guarda
 * `calcularResultado()`, que está certo. E mesmo assim o defeito viveu meses em
 * outros dois lugares:
 *
 *  · `vw_faturamento_liquido` subtraía `reembolsos` de `receita_tributavel` em
 *    `faturamento_liquido` e `margem_pct` — R$ 12.783,36 de perda cobrada sobre
 *    uma base que nunca a continha, e dois dias da base exibindo prejuízo sem
 *    ter receita nenhuma;
 *  · `SettingsPage` refazia a cascata inteira em JavaScript, a partir de
 *    `faturamento_bruto`, com uma linha vermelha "(-) Reembolsos" na tela.
 *
 * A lição é a que o CLAUDE.md chama de primeira armadilha em outra forma: o
 * teste guardava UMA das cópias da regra, e o defeito mudou de cópia. Por isso
 * este aqui lê o código-fonte em vez de exercitar uma função — ele alcança as
 * cópias que a função não vê.
 *
 * Consertado em 17-18/09/2026 pela migração `20260918a`.
 *
 * ── O que continua permitido ──────────────────────────────────────────────
 *
 * EXIBIR o reembolso, em qualquer tela. O número informa, e informar é bom —
 * o que não se pode é subtraí-lo de uma base que só soma vendas aprovadas.
 *
 * E somá-lo DE VOLTA no topo antes de descontar uma vez, que é o que
 * `FinanceiroResultadoPage` faz: ali `pagoPelosClientes` inclui as perdas, e
 * aí a dedução é legítima porque a base as continha. Essa é a forma certa, e é
 * por isso que a regra abaixo olha a expressão do total, e não o arquivo todo.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function arquivosDe(dir: string, filtro: RegExp, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivosDe(caminho, filtro, acc);
    else if (filtro.test(nome)) acc.push(caminho);
  }
  return acc;
}

/** Um comentário explicando a regra não pode fazer o teste passar. */
function semComentarios(conteudo: string): string {
  return conteudo
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/^\s*--.*$/gm, ' ');
}

describe('reembolso não desce duas vezes', () => {
  it('nenhuma tela monta a cascata subtraindo reembolso', () => {
    /*
      A regra: uma linha que calcula um TOTAL (líquido, lucro, margem, sobra) não
      pode citar reembolso/estorno/chargeback na mesma expressão.

      Olha a linha da atribuição, e não o arquivo, justamente para deixar passar
      quem soma a perda de volta no topo — `FinanceiroResultadoPage` cita
      `perda_reembolso` no arquivo inteiro e está certo.
    */
    const TOTAIS = /\b(fatLiqPreview|faturamentoLiquido|lucroOperacional|lucroLiquido|margemPreview|margemPct|sobraAposImpostos|resultado)\s*=/;
    const PERDA  = /reembolso|reembolsos|estorno|chargeback/i;

    const suspeitos: string[] = [];
    for (const arquivo of arquivosDe('src', /\.tsx?$/).filter(f => !f.includes('test'))) {
      const linhas = semComentarios(readFileSync(arquivo, 'utf8')).split('\n');
      linhas.forEach((linha, i) => {
        if (TOTAIS.test(linha) && PERDA.test(linha)) {
          suspeitos.push(`${arquivo}:${i + 1} — ${linha.trim().slice(0, 100)}`);
        }
      });
    }

    expect(suspeitos.join(' | ')).toEqual('');
  });

  it('nenhuma tela usa faturamento_bruto como base de margem ou imposto', () => {
    /*
      `faturamento_bruto` inclui a fatia do coprodutor, que a Payt paga direto e
      que nunca passa pela conta da empresa. `receita_tributavel` é a base certa,
      e a view já a calcula — quem refaz a conta por fora tem que partir dela.

      Na Aeliss a diferença é 9,4% do faturamento: nove vezes o reembolso dela.

      Ler a coluna para EXIBIR continua permitido; o que não se pode é montar a
      cascata em cima dela.
    */
    const suspeitos: string[] = [];
    for (const arquivo of arquivosDe('src', /\.tsx?$/).filter(f => !f.includes('test'))) {
      const codigo = semComentarios(readFileSync(arquivo, 'utf8'));
      if (!codigo.includes('faturamento_bruto')) continue;

      /* Quais variáveis recebem o bruto. Duas formas, e só elas: o `setX(...)`
         de um `useState` e a declaração direta. Tentar rastrear a variável por
         dentro da expressão não funciona — a primeira versão deste teste usava
         `[^)]*` e não atravessava o parêntese de um `.reduce()`, então passou
         limpo pela isca. Casar o NOME de quem recebe é curto e não depende da
         forma da expressão. */
      const nomes = new Set<string>();
      for (const linha of codigo.split('\n')) {
        if (!linha.includes('faturamento_bruto')) continue;
        for (const [, nome] of linha.matchAll(/\bset([A-Z]\w*)\s*\(/g)) {
          nomes.add(nome[0].toLowerCase() + nome.slice(1));
        }
        for (const [, nome] of linha.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=/g)) {
          nomes.add(nome);
        }
      }
      if (nomes.size === 0) continue;

      codigo.split('\n').forEach((linha, i) => {
        if (!/\b(fatLiq\w*|margem\w*|imposto\w*|lucro\w*)\s*=[^=]/i.test(linha)) return;
        for (const n of nomes) {
          if (new RegExp(`\\b${n}\\b`).test(linha)) {
            suspeitos.push(`${arquivo}:${i + 1} — cascata sobre '${n}', que recebe faturamento_bruto`);
            return;
          }
        }
      });
    }

    expect(suspeitos.join(' | ')).toEqual('');
  });

  it('nenhuma migração nova reintroduz a subtração na view', () => {
    /*
      Só as migrações POSTERIORES a 20260918a são olhadas. As anteriores contêm
      a expressão antiga legitimamente — a própria 20260917a a carrega como
      âncora de substituição, e a baseline a criou. Reescrever a história para
      agradar um teste seria pior que o defeito.
    */
    const CORTE = '20260918a';
    const PROIBIDO = /-\s*reembolsos\s*-\s*\(?\s*receita_tributavel/;

    const suspeitos = arquivosDe('supabase/migrations', /\.sql$/)
      .filter(f => {
        const nome = f.split(/[\\/]/).pop() ?? '';
        return nome.slice(0, CORTE.length) > CORTE;
      })
      .filter(f => PROIBIDO.test(semComentarios(readFileSync(f, 'utf8'))))
      .map(f => `${f} — voltou a subtrair reembolsos de receita_tributavel`);

    expect(suspeitos.join(' | ')).toEqual('');
  });

  it('calcularResultado continua sem aceitar reembolso', () => {
    /*
      A implementação canônica. Se alguém abrir uma porta aqui, as três telas que
      a usam passam a descontar duas vezes de uma vez só — e o teste de
      `financeiro.test.ts` sozinho não pega, porque ele passa um objeto literal e
      um campo novo opcional não quebraria nada.
    */
    const fonte = semComentarios(readFileSync('src/lib/financeiro.ts', 'utf8'));
    const bloco = fonte.match(/interface EntradaResultado\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(bloco).not.toEqual('');
    expect(/reembolso|estorno|chargeback/i.test(bloco)).toBe(false);
  });
});
