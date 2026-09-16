/**
 * A expansão de recorrência não tinha teste nenhum.
 *
 * Ela desenha a agenda inteira: cada ocorrência de cada série vem daqui. Um
 * erro de um dia não quebra a tela — ele só põe a reunião no dia errado, que é
 * o tipo de defeito que ninguém reporta como bug.
 *
 * Escrevi ao mexer no `recorrencia_puladas`, mas cobrindo tudo, e não só o que
 * eu acabei de mexer: teste que só cobre a última mudança não protege o resto.
 */
import { describe, it, expect } from 'vitest';
import { ocorrencias, diasOcupados, duracaoEmDias, toYMD, daYMD } from '@/lib/recorrencia';

const base = {
  inicio: '2026-09-01', // terça
  recorrencia_tipo: null as string | null,
  recorrencia_dias_semana: null as number[] | null,
  recorrencia_fim: null as string | null,
};

describe('ocorrencias', () => {
  it('sem recorrência devolve só o próprio dia', () => {
    expect(ocorrencias(base, '2026-09-01', '2026-09-30')).toEqual(['2026-09-01']);
  });

  it('não devolve nada quando o dia está fora da janela', () => {
    expect(ocorrencias(base, '2026-10-01', '2026-10-31')).toEqual([]);
  });

  it('diário repete todo dia até o fim da série', () => {
    const r = { ...base, recorrencia_tipo: 'diario', recorrencia_fim: '2026-09-04' };
    expect(ocorrencias(r, '2026-09-01', '2026-09-30')).toEqual([
      '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04',
    ]);
  });

  it('semanal cai nos dias marcados', () => {
    // 2 = terça, 4 = quinta
    const r = {
      ...base,
      recorrencia_tipo: 'semanal',
      recorrencia_dias_semana: [2, 4],
      recorrencia_fim: '2026-09-12',
    };
    expect(ocorrencias(r, '2026-09-01', '2026-09-30')).toEqual([
      '2026-09-01', '2026-09-03', '2026-09-08', '2026-09-10',
    ]);
  });

  it('semanal sem dia marcado repete no dia da semana do início', () => {
    const r = {
      ...base,
      recorrencia_tipo: 'semanal',
      recorrencia_dias_semana: [],
      recorrencia_fim: '2026-09-22',
    };
    expect(ocorrencias(r, '2026-09-01', '2026-09-30')).toEqual([
      '2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22',
    ]);
  });

  it('mensal cai no mesmo dia do mês', () => {
    const r = { ...base, recorrencia_tipo: 'mensal', recorrencia_fim: '2026-12-31' };
    expect(ocorrencias(r, '2026-09-01', '2026-12-31')).toEqual([
      '2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01',
    ]);
  });

  it('anual cai no mesmo dia e mês, ano após ano', () => {
    const natal = { ...base, inicio: '2026-12-25', recorrencia_tipo: 'anual' };
    expect(ocorrencias(natal, '2026-01-01', '2029-12-31')).toEqual([
      '2026-12-25', '2027-12-25', '2028-12-25', '2029-12-25',
    ]);
  });

  it('anual alcança um ano distante sem precisar de janela larga', () => {
    // A consulta traz TODA série recorrente, independente da janela. Um feriado
    // cadastrado anos atrás tem que continuar caindo no ano que está na tela.
    const natal = { ...base, inicio: '2020-12-25', recorrencia_tipo: 'anual' };
    expect(ocorrencias(natal, '2026-12-01', '2026-12-31')).toEqual(['2026-12-25']);
  });

  /**
   * 29 de fevereiro é o caso que quebra a implementação ingênua.
   *
   * Somar um ano em cima do valor corrente faz 29/02 virar 01/03, e daí em
   * diante a série inteira anda em 1º de março — um evento que muda de data
   * sozinho e ninguém percebe. Contando sempre a partir da base, ele
   * simplesmente não cai nos anos sem 29 de fevereiro.
   */
  it('anual em 29 de fevereiro só cai em ano bissexto, e nunca escorrega para março', () => {
    const r = { ...base, inicio: '2024-02-29', recorrencia_tipo: 'anual' };
    const dias = ocorrencias(r, '2024-01-01', '2033-12-31');
    expect(dias).toEqual(['2024-02-29', '2028-02-29', '2032-02-29']);
    expect(dias.some(d => d.slice(5, 7) === '03')).toBe(false);
  });

  it('anual respeita o fim da série', () => {
    const r = { ...base, inicio: '2026-12-25', recorrencia_tipo: 'anual',
                recorrencia_fim: '2028-01-01' };
    expect(ocorrencias(r, '2026-01-01', '2032-12-31')).toEqual(['2026-12-25', '2027-12-25']);
  });

  it('anual respeita os dias pulados', () => {
    const r = { ...base, inicio: '2026-12-25', recorrencia_tipo: 'anual',
                recorrencia_puladas: ['2027-12-25'] };
    expect(ocorrencias(r, '2026-01-01', '2028-12-31')).toEqual(['2026-12-25', '2028-12-25']);
  });

  it('série sem fim marcado para no fim da janela pedida', () => {
    const r = { ...base, recorrencia_tipo: 'diario' };
    expect(ocorrencias(r, '2026-09-01', '2026-09-03')).toEqual([
      '2026-09-01', '2026-09-02', '2026-09-03',
    ]);
  });

  it('incluirBase falso devolve só as repetições', () => {
    const r = { ...base, recorrencia_tipo: 'diario', recorrencia_fim: '2026-09-03' };
    expect(ocorrencias(r, '2026-09-01', '2026-09-30', { incluirBase: false })).toEqual([
      '2026-09-02', '2026-09-03',
    ]);
  });

  it('a janela recorta a série sem deslocá-la', () => {
    const r = { ...base, recorrencia_tipo: 'diario', recorrencia_fim: '2026-09-10' };
    expect(ocorrencias(r, '2026-09-05', '2026-09-07')).toEqual([
      '2026-09-05', '2026-09-06', '2026-09-07',
    ]);
  });

  it('dia pulado some da série, e só ele', () => {
    const r = {
      ...base,
      recorrencia_tipo: 'semanal',
      recorrencia_dias_semana: [2],
      recorrencia_fim: '2026-09-29',
      recorrencia_puladas: ['2026-09-15'],
    };
    expect(ocorrencias(r, '2026-09-01', '2026-09-30')).toEqual([
      '2026-09-01', '2026-09-08', '2026-09-22', '2026-09-29',
    ]);
  });

  it('pular o primeiro dia tira o primeiro dia, não a série', () => {
    const r = {
      ...base,
      recorrencia_tipo: 'diario',
      recorrencia_fim: '2026-09-03',
      recorrencia_puladas: ['2026-09-01'],
    };
    expect(ocorrencias(r, '2026-09-01', '2026-09-30')).toEqual([
      '2026-09-02', '2026-09-03',
    ]);
  });

  it('lista de pulados vazia ou nula não muda nada', () => {
    const r = { ...base, recorrencia_tipo: 'diario', recorrencia_fim: '2026-09-02' };
    const esperado = ['2026-09-01', '2026-09-02'];
    expect(ocorrencias({ ...r, recorrencia_puladas: [] }, '2026-09-01', '2026-09-30')).toEqual(esperado);
    expect(ocorrencias({ ...r, recorrencia_puladas: null }, '2026-09-01', '2026-09-30')).toEqual(esperado);
  });

  it('série longa não trava a tela: para nos 400 passos', () => {
    const r = { ...base, recorrencia_tipo: 'diario' };
    expect(ocorrencias(r, '2026-09-01', '2030-01-01').length).toBe(401);
  });
});

describe('diasOcupados', () => {
  it('sem data_fim é a mesma coisa que ocorrencias', () => {
    const r = { ...base, recorrencia_tipo: 'diario', recorrencia_fim: '2026-09-03' };
    expect(diasOcupados(r, '2026-09-01', '2026-09-30')).toEqual(ocorrencias(r, '2026-09-01', '2026-09-30'));
  });

  it('data_fim igual à data continua sendo um dia só', () => {
    const r = { ...base, data_fim: '2026-09-01' };
    expect(duracaoEmDias(r)).toBe(0);
    expect(diasOcupados(r, '2026-09-01', '2026-09-30')).toEqual(['2026-09-01']);
  });

  it('feriado emendado pinta todos os dias', () => {
    const r = { ...base, inicio: '2026-12-24', data_fim: '2026-12-26' };
    expect(diasOcupados(r, '2026-12-01', '2026-12-31')).toEqual([
      '2026-12-24', '2026-12-25', '2026-12-26',
    ]);
  });

  it('aparece na janela mesmo tendo começado antes dela', () => {
    // O caso que motivou alargar a janela para trás: o começo está fora, mas o
    // evento está acontecendo dentro.
    const r = { ...base, inicio: '2026-12-24', data_fim: '2026-12-26' };
    expect(diasOcupados(r, '2026-12-25', '2026-12-31')).toEqual(['2026-12-25', '2026-12-26']);
  });

  it('o fim da janela corta o que passa dela', () => {
    const r = { ...base, inicio: '2026-12-28', data_fim: '2027-01-02' };
    expect(diasOcupados(r, '2026-12-01', '2026-12-31')).toEqual([
      '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31',
    ]);
  });

  it('a duração vale para cada ocorrência da série', () => {
    // Toda terça, de terça a quarta.
    const r = {
      ...base,
      data_fim: '2026-09-02',
      recorrencia_tipo: 'semanal',
      recorrencia_dias_semana: [2],
      recorrencia_fim: '2026-09-15',
    };
    expect(diasOcupados(r, '2026-09-01', '2026-09-30')).toEqual([
      '2026-09-01', '2026-09-02',
      '2026-09-08', '2026-09-09',
      '2026-09-15', '2026-09-16',
    ]);
  });

  it('pular tira só aquele dia, e não a ocorrência inteira', () => {
    // A diferença que motivou filtrar os pulados fora de `ocorrencias`: lá o
    // dia 24 derrubaria os três.
    const r = { ...base, inicio: '2026-12-24', data_fim: '2026-12-26', recorrencia_puladas: ['2026-12-24'] };
    expect(diasOcupados(r, '2026-12-01', '2026-12-31')).toEqual(['2026-12-25', '2026-12-26']);
  });

  it('pular no meio do período deixa as duas pontas', () => {
    const r = { ...base, inicio: '2026-12-24', data_fim: '2026-12-26', recorrencia_puladas: ['2026-12-25'] };
    expect(diasOcupados(r, '2026-12-01', '2026-12-31')).toEqual(['2026-12-24', '2026-12-26']);
  });

  it('ocorrências que se sobrepõem não repetem o mesmo dia', () => {
    // Um evento de três dias (01 a 03) repetindo todo dia até 03: as três
    // ocorrências cobrem 01-03, 02-04 e 03-05, e os dias em comum aparecem uma
    // vez só — repetidos, seriam o mesmo evento desenhado duas vezes na célula.
    const r = { ...base, data_fim: '2026-09-03', recorrencia_tipo: 'diario', recorrencia_fim: '2026-09-03' };
    expect(diasOcupados(r, '2026-09-01', '2026-09-30')).toEqual([
      '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05',
    ]);
  });
});

describe('datas da agenda', () => {
  it('daYMD não anda um dia para trás no fuso do Brasil', () => {
    expect(toYMD(daYMD('2026-09-01'))).toBe('2026-09-01');
  });

});
