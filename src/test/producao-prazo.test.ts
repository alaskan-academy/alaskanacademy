import { describe, it, expect } from 'vitest';
import { prazoEfetivo, getUrgency } from '@/features/producao/components/constants';

/**
 * A regra do prazo estava escrita em três lugares — `getUrgency`, o card do
 * calendário e o card de Hoje — e os três discordavam entre si. Dois usavam
 * `(data_prazo ?? '') < hoje`, que dá ATRASADO para todo card sem prazo,
 * porque string vazia é menor que qualquer data. O terceiro devolvia `null`
 * para os mesmos cards, ou seja, NUNCA atrasado.
 *
 * Com 41 dos 59 cards em andamento sem `data_prazo`, o mesmo card aparecia
 * vermelho numa tela e neutro na outra. Estes testes existem para que a regra
 * volte a ser uma só.
 */

const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const emDias = (delta: number) => {
  const d = new Date();
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('prazoEfetivo', () => {
  it('usa o prazo quando ele existe', () => {
    expect(prazoEfetivo('2026-08-20', '2026-08-10')).toBe('2026-08-20');
  });

  it('cai no início quando o prazo está vazio — entrega é no mesmo dia', () => {
    expect(prazoEfetivo(null, '2026-08-10')).toBe('2026-08-10');
  });

  it('devolve null só quando não há data nenhuma', () => {
    expect(prazoEfetivo(null, null)).toBeNull();
    expect(prazoEfetivo(null, undefined)).toBeNull();
  });

  it('devolve null, e não a string vazia que fazia tudo parecer atrasado', () => {
    // `'' < qualquer data` é verdadeiro — era esse o bug. `null` obriga quem
    // chama a tratar o caso antes de comparar.
    expect(prazoEfetivo(null, null)).toBeNull();
    expect(prazoEfetivo(null, null)).not.toBe('');
  });
});

describe('getUrgency', () => {
  it('sem prazo e sem início, não opina', () => {
    expect(getUrgency(null, 'edicao', null)).toBeNull();
  });

  it('sem prazo, julga pelo início — o caso dos 41 cards', () => {
    expect(getUrgency(null, 'edicao', emDias(-5))).toBe('late');
    expect(getUrgency(null, 'edicao', emDias(1))).toBe('warn');
    expect(getUrgency(null, 'edicao', emDias(30))).toBe('ok');
  });

  it('início de hoje é aviso, não atraso', () => {
    expect(getUrgency(null, 'edicao', hoje())).toBe('warn');
  });

  it('fase concluída não atrasa, mesmo com data velha', () => {
    for (const fase of ['aprovado', 'esteira_teste', 'postado', 'na_plataforma', 'arquivado']) {
      expect(getUrgency(null, fase, emDias(-90))).toBeNull();
      expect(getUrgency(emDias(-90), fase, null)).toBeNull();
    }
  });

  it('o prazo preenchido tem a palavra final sobre o início', () => {
    // Começou há muito tempo, mas o prazo é longe: não está atrasado.
    expect(getUrgency(emDias(30), 'edicao', emDias(-60))).toBe('ok');
  });
});
