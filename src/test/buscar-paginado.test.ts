/**
 * A paginação que impede o PostgREST de mentir em silêncio.
 *
 * O teto do PostgREST não devolve erro: devolve 200 com menos linhas. Quem
 * chama não tem como saber que foi cortado — e o sintoma nunca é uma tela
 * vazia, é um número plausível e errado.
 *
 * Casos medidos em 01/09/2026 que estes testes representam:
 *   Resultado    janela de 9 meses, 1.248 linhas → março e abril com R$ 0,00
 *                de anúncio e margem de 78,5%
 *   Caixa & DRE  modo YTD, 1.174 linhas → totais por categoria errados
 *   Conciliação  YTD, 1.174 linhas contra `.limit(1000)` → 174 sumindo da tela
 *                do extrato "completo"
 */
import { describe, it, expect } from 'vitest';
import { buscarTudo } from '@/features/financeiro/lib/buscar';

/** Uma tabela falsa de `total` linhas que corta em 1.000, como o PostgREST. */
function tabelaFalsa(total: number) {
  const chamadas: Array<[number, number]> = [];
  const todas = Array.from({ length: total }, (_, i) => ({ id: i }));
  return {
    chamadas,
    pagina: (de: number, ate: number) => {
      chamadas.push([de, ate]);
      // O `range` pede no máximo 1.000; o servidor nunca devolve mais que isso.
      const fim = Math.min(ate + 1, de + 1000, total);
      return Promise.resolve({ data: todas.slice(de, fim), error: null });
    },
  };
}

describe('buscarTudo', () => {
  it('traz TODAS as linhas quando o total passa do teto', async () => {
    const t = tabelaFalsa(1_248);
    const { linhas, erro } = await buscarTudo<{ id: number }>(t.pagina);

    expect(erro).toBeNull();
    expect(linhas).toHaveLength(1_248);
    // sem repetir nem pular nenhuma
    expect(new Set(linhas.map(l => l.id)).size).toBe(1_248);
    expect(t.chamadas).toEqual([[0, 999], [1000, 1999]]);
  });

  it('para na primeira página quando tudo coube nela', async () => {
    const t = tabelaFalsa(231);
    const { linhas } = await buscarTudo<{ id: number }>(t.pagina);
    expect(linhas).toHaveLength(231);
    expect(t.chamadas).toHaveLength(1);
  });

  it('pede a segunda página quando a primeira veio EXATAMENTE cheia', async () => {
    /* O caso que um `if (lote.length === 0) break` erraria: mil linhas cheias
       não provam que acabou. Só um lote incompleto prova. */
    const t = tabelaFalsa(1_000);
    const { linhas } = await buscarTudo<{ id: number }>(t.pagina);
    expect(linhas).toHaveLength(1_000);
    expect(t.chamadas).toHaveLength(2);
  });

  it('tabela vazia devolve lista vazia numa chamada só', async () => {
    const t = tabelaFalsa(0);
    const { linhas, erro } = await buscarTudo<{ id: number }>(t.pagina);
    expect(linhas).toEqual([]);
    expect(erro).toBeNull();
    expect(t.chamadas).toHaveLength(1);
  });

  it('devolve o erro JUNTO com o que já tinha lido, e para de pedir', async () => {
    /* Descartar as linhas lidas junto com o erro trocaria um número errado por
       uma tela vazia. Quem chama decide o que fazer com cada um. */
    let n = 0;
    const { linhas, erro } = await buscarTudo<{ id: number }>(() => {
      n++;
      if (n === 1) return Promise.resolve({ data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null });
      return Promise.resolve({ data: null, error: { message: 'caiu' } });
    });

    expect(erro).toEqual({ message: 'caiu' });
    expect(linhas).toHaveLength(1000);
    expect(n).toBe(2);
  });
});
