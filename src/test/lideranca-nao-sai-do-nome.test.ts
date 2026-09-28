/**
 * Quem é líder sai da tabela, não do nome do cargo.
 *
 * ── O que estava assim ─────────────────────────────────────────────────────
 *
 *     const cargoNome = String(cargoSel?.nome || '')...toLowerCase();
 *     const isHeadOuLider = cargoNome.includes('head') || cargoNome.includes('lider');
 *
 * Texto livre decidindo dinheiro. Dois problemas medidos em 28/09/2026:
 *
 *   · `cargos.comissao_time_pct` existe e diz exatamente isto — Head/Líder 20%,
 *     Líder Estratégico 10%, Gerente Criativo 0% — e ninguém lia. Dos 9 cargos
 *     com `pode_aprovar`, TRÊS ("Gerente Criativo") não casavam pelo nome.
 *   · renomear um cargo apagava a liderança de quem já era líder, na próxima
 *     vez que a avaliação fosse salva. São 5 avaliações com essa marca.
 *
 * Terceira armadilha do CLAUDE.md, na forma de casamento por substring.
 *
 * ── E o percentual tinha o defeito do multiplicador ────────────────────────
 *
 * `pctLideranca` caía num `0.2` fixo quando não havia valor individual,
 * ignorando `cargos.comissao_time_pct`. Um Líder Estratégico sem valor próprio
 * receberia 20% onde o cadastro diz 10% — o dobro. Hoje é latente (a única
 * líder tem os dois em 20%), e latente é o estado em que dá para consertar sem
 * mexer no que já foi pago.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TELA = 'src/features/editores/components/AvaliacoesTab.tsx';
const codigo = readFileSync(join(process.cwd(), TELA), 'utf8')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('liderança não sai do nome do cargo', () => {
  it('a decisão vem de `comissao_time_pct`, não de includes no nome', () => {
    expect(codigo, 'a liderança deixou de sair da coluna do cargo').toMatch(
      /comissao_time_pct/,
    );
    expect(
      /includes\(\s*'(head|lider)'/i.test(codigo),
      'voltou a decidir liderança casando substring no nome do cargo — ' +
        'renomear um cargo apagaria a liderança de quem já é líder',
    ).toBe(false);
  });

  it('o percentual tem o degrau do cargo entre o individual e o neutro', () => {
    /* individual → cargo → 0.2. Sem o degrau do meio, um Líder Estratégico
       recebe o dobro do que o cadastro dele diz. */
    expect(codigo, 'o degrau do cargo sumiu do percentual de liderança').toMatch(
      /percentual_lideranca[\s\S]{0,200}?pctDoCargo/,
    );
    expect(
      /percentual_lideranca[^;]*?:\s*0\.2\s*\)/.test(codigo),
      'o percentual voltou a cair direto no 0.2 fixo, pulando o cargo',
    ).toBe(false);
  });
});
