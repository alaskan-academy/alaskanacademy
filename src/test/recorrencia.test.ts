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
import { ocorrencias, segundaDa, toYMD, daYMD } from '@/lib/recorrencia';

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

describe('datas da agenda', () => {
  it('daYMD não anda um dia para trás no fuso do Brasil', () => {
    expect(toYMD(daYMD('2026-09-01'))).toBe('2026-09-01');
  });

  it('segundaDa devolve a segunda da semana, e a própria segunda', () => {
    expect(toYMD(segundaDa(daYMD('2026-09-01')))).toBe('2026-08-31'); // terça -> segunda
    expect(toYMD(segundaDa(daYMD('2026-08-31')))).toBe('2026-08-31');
    expect(toYMD(segundaDa(daYMD('2026-09-06')))).toBe('2026-08-31'); // domingo fecha a semana
  });
});
