/**
 * A esteira do dia se lê por projeto.
 *
 * ── O que estava assim ────────────────────────────────────────────────────
 *
 * Ordenado só pelo número do AD, decrescente. Como o dia junta os ADs de
 * todos os projetos, a lista saía embaralhada:
 *
 *     AD 083  Guia dos Comportamentos
 *     AD 048  Saponaria Brasil
 *     AD 016  Velas Lembrancinhas
 *     AD 015  Saponaria Brasil
 *     AD 012  Workshop Buquê de Velas
 *     AD 011  Velas Lembrancinhas
 *
 * Quem sobe os anúncios trabalha por projeto, um de cada vez. Para saber
 * "quanto tem de Saponaria hoje" era preciso varrer a lista inteira e juntar
 * de cabeça, numa tela cujo trabalho era justamente contar isso.
 *
 * ── E a chave ganhou o projeto ────────────────────────────────────────────
 *
 * `agruparEmAds` agrupava por `ad_num|tipo_teste`, sem o projeto. Medido em
 * 28/09/2026: o número do AD é global, nenhum `ad_num` aparece em dois
 * projetos ativos, então isso nunca fundiu nada. Mas a garantia era de
 * convenção, não de construção: no dia em que alguém reiniciar a numeração
 * por projeto, dois ADs diferentes viram UMA linha, com os hooks dos dois
 * misturados e o nome de um só. Na esteira isso apareceria como um AD que
 * trocou de dono.
 */
import { describe, it, expect } from 'vitest';
import { agruparEmAds, type CardDaFila } from '@/features/producao/components/gestor/tipos';

let n = 0;
function card(p: Partial<CardDaFila>): CardDaFila {
  n += 1;
  return {
    id: `c${n}`, nome: `AD ${p.ad_num ?? 0}`, fase: 'esteira_teste', tipo: 'criativo',
    tipo_teste: null, familia: 'novo', funil: 'TSL', ad_num: null, hook: 1,
    projeto_id: null, projeto: null, projeto_ativo: true,
    data_inicio: '2026-09-28', data_prazo: null, editor: null,
    video_editado_url: null, entrou_na_fase_em: null, dias_na_fase: 0,
    ...p,
  };
}

describe('a esteira do dia agrupa e ordena por projeto', () => {
  it('junta os ADs do mesmo projeto, em ordem alfabética de projeto', () => {
    // A mesma mistura do dia 28/09/2026 na tela.
    const ads = agruparEmAds([
      card({ ad_num: 83, projeto_id: 'g', projeto: 'Guia dos Comportamentos' }),
      card({ ad_num: 48, projeto_id: 's', projeto: 'Saponaria Brasil' }),
      card({ ad_num: 16, projeto_id: 'v', projeto: 'Velas Lembrancinhas' }),
      card({ ad_num: 15, projeto_id: 's', projeto: 'Saponaria Brasil' }),
      card({ ad_num: 12, projeto_id: 'w', projeto: 'Workshop Buquê de Velas' }),
      card({ ad_num: 11, projeto_id: 'v', projeto: 'Velas Lembrancinhas' }),
    ]);

    expect(ads.map(a => [a.projeto, a.ad_num])).toEqual([
      ['Guia dos Comportamentos', 83],
      ['Saponaria Brasil', 48],
      ['Saponaria Brasil', 15],
      ['Velas Lembrancinhas', 16],
      ['Velas Lembrancinhas', 11],
      ['Workshop Buquê de Velas', 12],
    ]);
  });

  it('dentro do projeto o mais novo vem primeiro', () => {
    const ads = agruparEmAds([
      card({ ad_num: 9,  projeto_id: 'w', projeto: 'Workshop' }),
      card({ ad_num: 48, projeto_id: 'w', projeto: 'Workshop' }),
      card({ ad_num: 12, projeto_id: 'w', projeto: 'Workshop' }),
    ]);
    expect(ads.map(a => a.ad_num)).toEqual([48, 12, 9]);
  });

  it('acento não joga o projeto para o fim da lista', () => {
    // `localeCompare` sem locale ordena por código: "Área" cairia depois de
    // "Zona", e o gestor procuraria o projeto onde ele não está.
    const ads = agruparEmAds([
      card({ ad_num: 2, projeto_id: 'z', projeto: 'Zona Sul' }),
      card({ ad_num: 1, projeto_id: 'a', projeto: 'Área Nova' }),
    ]);
    expect(ads.map(a => a.projeto)).toEqual(['Área Nova', 'Zona Sul']);
  });

  it('mesmo número de AD em projetos diferentes são DOIS ADs', () => {
    /*
      A trava contra o futuro. Hoje o número é global e isto não acontece; se
      um dia a numeração reiniciar por projeto, sem o projeto na chave os dois
      virariam uma linha só, com os hooks misturados.
    */
    const ads = agruparEmAds([
      card({ ad_num: 12, hook: 1, projeto_id: 'a', projeto: 'Alfa' }),
      card({ ad_num: 12, hook: 2, projeto_id: 'a', projeto: 'Alfa' }),
      card({ ad_num: 12, hook: 1, projeto_id: 'b', projeto: 'Beta' }),
    ]);
    expect(ads).toHaveLength(2);
    expect(ads.map(a => [a.projeto, a.cards.length])).toEqual([['Alfa', 2], ['Beta', 1]]);
  });

  it('o mesmo AD com tipos de teste diferentes continua separado', () => {
    // Era assim antes e precisa continuar: na tela, o AD 011 de Velas aparece
    // duas vezes, Horizontal e Vertical.
    const ads = agruparEmAds([
      card({ ad_num: 11, tipo_teste: 'Horizontal', projeto_id: 'v', projeto: 'Velas' }),
      card({ ad_num: 11, tipo_teste: 'Vertical',   projeto_id: 'v', projeto: 'Velas' }),
    ]);
    expect(ads).toHaveLength(2);
  });

  it('os hooks de um AD continuam em ordem crescente', () => {
    const ads = agruparEmAds([
      card({ ad_num: 5, hook: 3, projeto_id: 'a', projeto: 'Alfa' }),
      card({ ad_num: 5, hook: 1, projeto_id: 'a', projeto: 'Alfa' }),
      card({ ad_num: 5, hook: 2, projeto_id: 'a', projeto: 'Alfa' }),
    ]);
    expect(ads[0].cards.map(c => c.hook)).toEqual([1, 2, 3]);
  });
});
