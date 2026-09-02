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
 * LÊ A LISTA DE COLUNAS DO PRÓPRIO INSERT, não uma ordem fixa.
 *
 * A primeira versão casava a posição: categoria no 1º campo, tipo no 4º —
 * a ordem que a migração `20260901b` usou. Em 02/09/2026 a `20260902g`
 * declarou 'Pagamento de Fatura' com (categoria, centro, TIPO, ORDEM, ativo),
 * que é SQL igualmente válido, e a regex simplesmente não casou. O teste
 * passou, a categoria ficou fora de `CAT_RESERVA`, e o pagamento de fatura
 * teria voltado a contar como custo.
 *
 * Ou seja: a trava contra "lista fixa que envelhece em silêncio" tinha, ela
 * mesma, uma lista fixa que envelheceu em silêncio. Agora ela lê os nomes das
 * colunas e mapeia por nome — a ordem deixa de importar.
 */
function categoriasDoTipo(tipo: string): string[] {
  const achadas = new Set<string>();

  for (const arquivo of readdirSync(DIR).filter(n => n.endsWith('.sql'))) {
    const texto = readFileSync(join(DIR, arquivo), 'utf8');
    if (!texto.includes('categorias_centro')) continue;

    /* Cada `insert into categorias_centro (colunas) values (tuplas)`. O corpo
       vai até o `;` — basta para as formas usadas aqui, e um INSERT ... SELECT
       não casa (não tem `values`), que é o correto: não há literais para ler. */
    const inserts = texto.matchAll(
      /insert\s+into\s+(?:public\.)?categorias_centro\s*\(([^)]*)\)\s*values([\s\S]*?);/gi,
    );

    for (const ins of inserts) {
      const colunas = ins[1].split(',').map(c => c.trim().toLowerCase().replace(/"/g, ''));
      const iCat = colunas.indexOf('categoria');
      const iTipo = colunas.indexOf('tipo');
      if (iCat < 0 || iTipo < 0) continue;

      for (const tupla of ins[2].matchAll(/\(([^()]*)\)/g)) {
        /* Divide só nas vírgulas de fora das aspas: uma categoria pode conter
           vírgula, e partir por `,` cru deslocaria todas as posições. */
        const campos = tupla[1].match(/'(?:[^']|'')*'|[^,]+/g)?.map(c => c.trim()) ?? [];
        const limpo = (v?: string) =>
          v?.startsWith("'") ? v.slice(1, -1).replace(/''/g, "'") : v?.trim();
        const cat = limpo(campos[iCat]);
        const tp = limpo(campos[iTipo])?.toLowerCase();
        if (cat && tp === tipo) achadas.add(cat);
      }
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

  it('as migrações declaram alguma — senão o teste não prova nada', () => {
    /* Deixou de poder ser vazio quando a `20260902g` declarou 'Pagamento de
       Fatura'. Daqui em diante, conjunto vazio quer dizer regex quebrada, não
       "nenhuma categoria nova" — e é essa confusão que faz um teste destes
       passar para sempre sem olhar nada. */
    expect(noBanco.length).toBeGreaterThan(0);
    expect(noBanco).toContain('Pagamento de Fatura');
  });

  it('todas estão em CAT_RESERVA', () => {
    const faltando = noBanco.filter(c => !(CAT_RESERVA as readonly string[]).includes(c));
    expect(faltando, `categoria(s) de reserva fora do código: ${faltando.join(', ')}. `
      + 'Sem elas, ehCustoOperacional conta transferencia entre contas como custo.').toEqual([]);
  });

  it('lê a coluna pelo NOME, não pela posição', () => {
    /* As duas migrações usam ordens diferentes de coluna. Achar as duas prova
       que o mapeamento é por nome; se voltar a ser posicional, uma some. */
    expect(noBanco).toContain('Pagamento de Fatura');
    expect(categoriasDoTipo('socio')).toContain('Aporte de Sócio');
  });
});
