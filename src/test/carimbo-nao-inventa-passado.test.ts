/**
 * O carimbo de empresa não pode dar à empresa de HOJE um passado que não é dela.
 *
 * Em 01/09/2026 a conta `Guia do Comportamento - TSL` foi ligada e apontada ao
 * projeto Guia dos Comportamentos, que tinha virado Aeliss naquela madrugada.
 * A conta nunca havia sido sincronizada: zero linhas em `metricas_meta`.
 *
 * `fn_carimbar_empresa_metricas` resolvia "de quem era este dia?" procurando
 * uma linha IRMÃ — mesma conta, mesmo dia, outro nível. Para o Desafios isso
 * bastava, porque ele já tinha métrica gravada quando a virada aconteceu. Para
 * uma conta que ENTRA depois não há irmã nenhuma, e a função caía no último
 * ramo: carimbar a empresa atual. O `modo=recente` das 05:20 puxa D-1 a D-7,
 * então sete dias de agosto entrariam como Aeliss no dia seguinte, sozinhos —
 * numa conta com R$ 103.816 de gasto acumulado rodando OUTROS produtos.
 *
 * A regra é: a partir da troca a conta é da empresa nova; o que ela gastou
 * antes era da anterior e continua sendo. `ofertas_editores.empresa_anterior`
 * é quem responde isso quando não há irmã.
 *
 * Este teste lê o SQL e não o banco, pela mesma razão do
 * `configuracoes-por-empresa`: contra o banco de hoje a função "está certa",
 * porque a conta do Guia ainda não tem linha antiga nenhuma. O defeito só
 * apareceria no dia em que alguém reescrevesse a função e deixasse o ramo de
 * fora — que é exatamente quando ninguém está olhando.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'supabase', 'migrations');

/** A definição que VALE é a da migração mais recente que redefine a função. */
function ultimaDefinicao(funcao: string): { arquivo: string; corpo: string } {
  const candidatos = readdirSync(DIR)
    .filter(n => n.endsWith('.sql'))
    .sort()
    .reverse();

  for (const arquivo of candidatos) {
    const texto = readFileSync(join(DIR, arquivo), 'utf8');
    const inicio = texto.search(
      new RegExp(`CREATE OR REPLACE FUNCTION\\s+(public\\.)?${funcao}\\b`, 'i'),
    );
    if (inicio === -1) continue;

    // Do começo da função até o `$function$;` que a fecha.
    const resto = texto.slice(inicio);
    const fim = resto.indexOf('$function$;');
    return { arquivo, corpo: fim === -1 ? resto : resto.slice(0, fim) };
  }
  throw new Error(`nenhuma migração define ${funcao}`);
}

describe('o carimbo de empresa das métricas', () => {
  const { arquivo, corpo } = ultimaDefinicao('fn_carimbar_empresa_metricas');

  it(`é definido por uma migração (achou em ${arquivo})`, () => {
    expect(corpo.length).toBeGreaterThan(200);
  });

  it('consulta `empresa_anterior` do projeto', () => {
    expect(corpo).toMatch(/empresa_anterior/);
  });

  it('usa `empresa_anterior` no ramo de data ANTERIOR à troca', () => {
    // O ramo começa em `NEW.data < v_desde` e termina no seu END IF.
    const ramo = corpo.slice(corpo.search(/NEW\.data\s*<\s*v_desde/));
    expect(ramo.length).toBeGreaterThan(0);

    const ateOFimDoRamo = ramo.slice(0, ramo.search(/END IF;/g) === -1 ? undefined : ramo.lastIndexOf('END IF;'));
    expect(ateOFimDoRamo).toMatch(/v_anterior/);
  });

  it('não deixa a empresa ATUAL ser o único destino de uma data anterior à troca', () => {
    // `coalesce(irmã, anterior)` é a forma que resolve isso hoje. Se alguém
    // trocar a forma, que troque este teste junto — de propósito, não por
    // acidente.
    expect(corpo).toMatch(/coalesce\(\s*v_irma\s*,\s*v_anterior\s*\)/i);
  });

  it('continua congelando o passado de quem nunca trocou de empresa', () => {
    expect(corpo).toMatch(/OLD\.empresa_id\s+IS\s+NOT\s+NULL/i);
    expect(corpo).toMatch(/NEW\.empresa_id\s*:=\s*OLD\.empresa_id/i);
  });
});
