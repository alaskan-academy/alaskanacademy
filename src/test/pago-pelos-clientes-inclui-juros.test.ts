/**
 * "Pago pelos clientes" inclui os juros, e a cascata subtrai uma vez só.
 *
 * ── O que a tela mostrava, medido em 06/10/2026 ───────────────────────────
 *
 * O card se chamava "Pago pelos clientes", prometia no subtítulo "inclui
 * R$ 6.443,33 de juros", e mostrava `fat_bruto`, que é a soma de
 * `valor_sem_juros` e portanto **exclui** os juros. No período 05/09 a 05/10:
 *
 *     card dizia              R$ 211.765,02
 *     o cliente pagou         R$ 218.208,35
 *     diferença                 R$ 6.443,33   (3,04%)
 *
 * A cascata "Do pago ao lucro" provava o defeito sozinha, porque ela SUBTRAI
 * os juros desta linha para chegar na Receita:
 *
 *     Pago pelos clientes   ← vinha sem juros
 *     − Juros parcelamento  ← tirava de novo
 *     − Coprodução
 *     = Receita             ← não fechava
 *
 * ── Os três números são diferentes de propósito ───────────────────────────
 *
 * `pagoClientes`  o que o cliente desembolsou, COM juros. É o topo da cascata.
 * `fatBruto`      sem juros. É a base que a Payt reporta, com a qual a
 *                 conferência compara, e o denominador do rateio de custo fixo
 *                 contra `fat_bruto_total`. Não pode ganhar juros.
 * `base_simples`  líquido de coprodução MAIS juros, porque o fisco cobra sobre
 *                 eles ainda que fiquem inteiros com a Payt. Ver 20260917a.
 *
 * Trocar um pelo outro é o que este teste existe para impedir.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TELA = 'src/features/dashboard/pages/OverviewPage.tsx';
const codigo = readFileSync(join(process.cwd(), TELA), 'utf8')
  .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')
  .replace(/\/\/[^\n]*/g, '');

describe('pago pelos clientes', () => {
  it('é o bruto MAIS os juros', () => {
    expect(codigo, `${TELA}: sumiu a soma dos juros`).toMatch(
      /const pagoClientes = fatBruto \+ juros;/,
    );
  });

  it('o card e a cascata mostram essa grandeza, não `fatBruto`', () => {
    /*
      São exatamente duas telas onde o rótulo "Pago pelos clientes" aparece: o
      card de métrica e o topo da cascata. As duas têm de ler `pagoClientes`.
    */
    const rotulos = codigo.match(/rotulo="Pago pelos clientes"/g) ?? [];
    expect(rotulos.length, `${TELA}: mudou a quantidade de lugares com esse rótulo`).toBe(2);

    for (const m of codigo.matchAll(/rotulo="Pago pelos clientes"([\s\S]{0,220}?)\/>/g)) {
      expect(m[1], `${TELA}: um "Pago pelos clientes" voltou a ler fatBruto`)
        .not.toMatch(/kpis\.fatBruto/);
      expect(m[1], `${TELA}: um "Pago pelos clientes" deixou de ler pagoClientes`)
        .toMatch(/kpis\.pagoClientes/);
    }
  });

  it('a seta de variação compara a mesma grandeza que o card mostra', () => {
    // Mostrar com juros e comparar sem juros daria uma variação que não
    // corresponde a nenhum dos dois números.
    expect(codigo, `${TELA}: o período anterior perdeu o pagoClientes`).toMatch(
      /pagoClientes: num\(a\?\.fat_bruto\) \+ num\(a\?\.juros\)/,
    );
  });

  it('`fatBruto` continua SEM juros, porque é ele que vai no rateio', () => {
    /*
      `share` divide por `fat_bruto_total`, que vem do banco sem juros. Somar
      juros de um lado só distorceria a participação de cada empresa no custo
      fixo, que é exatamente o defeito que o comentário do `fat_bruto_total`
      no `fn_overview` descreve.
    */
    expect(codigo, `${TELA}: o rateio deixou de usar fatBruto`).toMatch(
      /participacao\(fatBruto, num\(d\.fat_bruto_total\)\)/,
    );
    expect(codigo, `${TELA}: fatBruto ganhou juros e quebrou o rateio`).toMatch(
      /const fatBruto = num\(d\.fat_bruto\);/,
    );
  });
});
