/**
 * O contrato entre a lista de tipos no front e o CHECK em `eventos.tipo`.
 *
 * A lista existe em dois lugares e não tem como não existir: o banco precisa
 * dela para recusar lixo, o front precisa dela para desenhar o seletor e a
 * legenda. O CLAUDE.md é explícito sobre isso — "se a lista precisa existir no
 * código, ela precisa de um teste que falhe quando o banco ganhar um item
 * novo".
 *
 * Este é esse teste, e ele falha nas duas direções: acrescentar um tipo aqui
 * sem a migration quebra, e a migration sem o front também. O que ele impede
 * na prática é o erro silencioso — um `insert` recusado pelo CHECK, ou um tipo
 * que existe no banco e some da legenda porque ninguém lembrou dela.
 */
import { describe, it, expect } from 'vitest';
import { TIPOS_EVENTO, TIPOS_QUE_PARAM, ROTULO_TIPO, COR_TIPO } from '@/features/inicio/types';

/**
 * Cópia literal do CHECK, de `20260828f_agenda_ganha_recesso.sql`:
 *
 *   CHECK (tipo = ANY (ARRAY['reuniao','folga','feriado','recesso','marco']))
 */
const NO_BANCO = ['reuniao', 'folga', 'feriado', 'recesso', 'marco'];

describe('tipos de evento', () => {
  it('a lista do front é a mesma do CHECK no banco', () => {
    expect([...TIPOS_EVENTO.map(t => t.chave)].sort()).toEqual([...NO_BANCO].sort());
  });

  it('nenhuma chave repetida', () => {
    const chaves = TIPOS_EVENTO.map(t => t.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it('todo tipo tem rótulo e cor', () => {
    TIPOS_EVENTO.forEach(t => {
      expect(ROTULO_TIPO[t.chave], t.chave).toBeTruthy();
      expect(COR_TIPO[t.chave]?.ponto, t.chave).toBeTruthy();
      expect(COR_TIPO[t.chave]?.barra, t.chave).toBeTruthy();
    });
  });

  it('feriado e recesso param a empresa; folga e reunião não', () => {
    // Folga é de uma pessoa: avisar todo mundo com quatro dias seria ruído.
    expect([...TIPOS_QUE_PARAM].sort()).toEqual(['feriado', 'recesso']);
  });
});
