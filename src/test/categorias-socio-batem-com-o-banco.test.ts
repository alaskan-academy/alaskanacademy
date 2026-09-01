/**
 * A lista de categorias de sócio no código tem de conhecer todas as do banco.
 *
 * ── O que aconteceu ─────────────────────────────────────────────────────
 *
 * Em 01/09/2026 a migração `20260901b` criou a categoria `Aporte de Sócio`
 * (`tipo = 'socio'`), porque um PIX de R$ 2.000 entrando na conta nova da
 * Aeliss estava sendo classificado como "Retirada de Lucro".
 *
 * A categoria nasceu no banco e NÃO entrou em `CAT_SOCIOS`. Como `ehReceita`
 * só recusa o que está nessa lista, a capitalização passou a contar como
 * faturamento — dinheiro de sócio aparecendo como venda, sem nada dar erro.
 *
 * ── Por que a lista existe, já que derivar seria melhor ─────────────────
 *
 * `ehCustoOperacional` e `ehReceita` são funções puras, chamadas em laço sobre
 * milhares de transações e dentro de testes. Buscar `categorias_centro` a cada
 * chamada as tornaria assíncronas e arrastaria o banco para dentro do cálculo.
 *
 * O CLAUDE.md prevê exatamente este caso: "se a lista precisa existir no
 * código, ela precisa de um teste que falhe quando o banco ganhar um item
 * novo". Este é esse teste. A fonte da verdade que ele consulta são as
 * MIGRAÇÕES, que é o banco versionado — nenhuma conexão, nenhum segredo.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CAT_SOCIOS, CAT_RESERVA } from '@/features/financeiro/constants';

const DIR = join(process.cwd(), 'supabase', 'migrations');

/**
 * Toda categoria inserida em `categorias_centro` com o tipo pedido.
 *
 * Casa a forma usada nas migrações:
 *   values ('Aporte de Sócio', 'Sócios', 85, 'socio', true)
 * O tipo é o quarto campo; a categoria é o primeiro.
 */
function categoriasDoTipo(tipo: string): string[] {
  const achadas = new Set<string>();

  for (const arquivo of readdirSync(DIR).filter(n => n.endsWith('.sql'))) {
    const texto = readFileSync(join(DIR, arquivo), 'utf8');
    if (!texto.includes('categorias_centro')) continue;

    const linhas = texto.matchAll(
      /\(\s*'([^']+)'\s*,\s*'[^']*'\s*,\s*\d+\s*,\s*'([a-z_]+)'\s*,\s*(?:true|false)\s*\)/gi,
    );
    for (const m of linhas) {
      if (m[2].toLowerCase() === tipo) achadas.add(m[1]);
    }
  }
  return [...achadas];
}

describe('as categorias de sócio', () => {
  const noBanco = categoriasDoTipo('socio');

  it('as migrações realmente declaram alguma — senão o teste não prova nada', () => {
    // Guarda contra o pior defeito possível num teste assim: a regex parar de
    // casar, o conjunto ficar vazio e tudo "passar" para sempre.
    expect(noBanco.length).toBeGreaterThan(0);
    expect(noBanco).toContain('Aporte de Sócio');
  });

  it('todas estão em CAT_SOCIOS', () => {
    const faltando = noBanco.filter(c => !(CAT_SOCIOS as readonly string[]).includes(c));
    expect(faltando, `categoria(s) de sócio que o código não conhece: ${faltando.join(', ')}. `
      + 'Sem elas, `ehReceita` conta aporte como faturamento e `ehCustoOperacional` '
      + 'conta retirada como custo.').toEqual([]);
  });
});

describe('as categorias de reserva', () => {
  const noBanco = categoriasDoTipo('reserva');

  it('todas estão em CAT_RESERVA quando as migrações as declaram', () => {
    // Pode ser vazio: as três de reserva são anteriores ao versionamento atual.
    // O que não pode é existir uma declarada que o código ignore.
    const faltando = noBanco.filter(c => !(CAT_RESERVA as readonly string[]).includes(c));
    expect(faltando, `categoria(s) de reserva fora do código: ${faltando.join(', ')}`).toEqual([]);
  });
});
