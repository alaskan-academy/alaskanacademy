/**
 * O empate é UM número, e agora ele mora em dois lugares.
 *
 * ── Por que isso é perigoso ────────────────────────────────────────────────
 *
 * `CRIVO.empate` em `AvaliacaoView.tsx` diz 1,6: é o ROAS em que o anúncio se
 * paga, medido em 06/09/2026 sobre 782 ADs e R$ 242.143 de mídia — taxa Payt
 * 6,1% + reembolso 1,7% + Simples 9% + 14% de imposto sobre a mídia + os
 * R$ 25.000/mês de custo fixo. Sem o custo fixo daria 1,37, e a primeira versão
 * da conta usava justamente esse, validando no empate e mandando escalar para o
 * vermelho.
 *
 * Em 24/09/2026 o mesmo 1,6 entrou em `vw_ad_morrendo` (migração 20260924b),
 * que é o que decide se o anúncio "deixou de se pagar". São dois campos
 * dizendo a mesma coisa — a primeira armadilha do CLAUDE.md —, e o gatilho que
 * os faz divergir é conhecido e está escrito no próprio comentário do CRIVO:
 * "se a taxa da Payt, o Simples ou o custo fixo mudarem, o 1,6 muda junto".
 *
 * No dia em que alguém refizer a conta, vai mexer na tela, porque é lá que o
 * número está visível e datado. A view fica para trás em silêncio, e o painel
 * passa a validar por uma régua e a acusar morte por outra.
 *
 * ── O que este teste faz ───────────────────────────────────────────────────
 *
 * Lê os dois e exige que sejam o mesmo número. Não resolve a duplicação — o
 * certo seria o empate sair de `configuracoes` por `fn_config`, junto dos
 * outros parâmetros fiscais — mas impede que ela custe dinheiro enquanto isso
 * não acontece.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRACOES = join(process.cwd(), 'supabase', 'migrations');
const SRC = join(process.cwd(), 'src');

describe('o empate é um só', () => {
  /** O 1,6 como a tela o mostra — vírgula, porque é texto para gente ler. */
  function doCrivo(): number {
    const texto = readFileSync(
      join(SRC, 'features', 'criativos', 'components', 'AvaliacaoView.tsx'), 'utf8');
    const m = texto.match(/empate:\s*'([\d,.]+)'/);
    if (!m) throw new Error('não achei CRIVO.empate em AvaliacaoView.tsx — o teste ficou cego');
    return parseFloat(m[1].replace(',', '.'));
  }

  /**
   * O mesmo número como a view o USA, na última migração que a define.
   *
   * Os comentários saem antes de procurar, e isso não é detalhe: a primeira
   * versão lia `texto.match(...)` no arquivo inteiro e casava com a linha
   * `--   roas_7 < 1.6   o EMPATE medido em...` do cabeçalho, que vem ANTES do
   * WHERE. Plantei a isca — troquei o 1.6 do WHERE por 1.4 — e o teste passou,
   * porque estava conferindo a documentação contra a tela em vez do código.
   * Um teste que lê o comentário concorda com qualquer coisa que o comentário
   * diga.
   */
  function daView(): number {
    let achado: number | null = null;
    for (const nome of readdirSync(MIGRACOES).filter(n => n.endsWith('.sql')).sort()) {
      const bruto = readFileSync(join(MIGRACOES, nome), 'utf8');
      if (!/create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?vw_ad_morrendo\b/i.test(bruto)) continue;
      const sql = bruto
        .replace(/--[^\n]*/g, '')          // comentário de linha
        .replace(/\/\*[\s\S]*?\*\//g, ''); // comentário de bloco
      /* `roas_7 < 1.6` no WHERE. Ponto, não vírgula: aqui é SQL. */
      const m = sql.match(/roas_7\s*<\s*([\d.]+)/);
      if (m) achado = parseFloat(m[1]);
    }
    if (achado === null) throw new Error('não achei o corte de ROAS em vw_ad_morrendo — o teste ficou cego');
    return achado;
  }

  it('a tela e a view usam o mesmo empate', () => {
    const tela = doCrivo();
    const view = daView();

    /* Nenhum dos dois pode ter virado zero ou NaN por uma extração quebrada:
       um teste que compara dois nadas passa sempre. */
    expect(tela, 'CRIVO.empate não virou número').toBeGreaterThan(0);
    expect(view, 'o corte da view não virou número').toBeGreaterThan(0);

    expect(
      view,
      `A tela valida com ROAS ${tela} e a view acusa morte abaixo de ${view}. ` +
        `São o mesmo empate e têm de ser o mesmo número: se a taxa da Payt, o ` +
        `Simples ou o custo fixo mudaram, atualize também a migração de ` +
        `vw_ad_morrendo (a última que a define).`,
    ).toBe(tela);
  });
});
