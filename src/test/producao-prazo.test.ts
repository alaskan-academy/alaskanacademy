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
  /**
   * As fases concluídas chegam por PARÂMETRO desde 31/08/2026.
   *
   * Antes a função lia uma constante do próprio módulo, que era uma cópia da
   * coluna `producao_fases.concluida` — dois lugares dizendo a mesma coisa. A
   * cópia saiu; quem chama passa o conjunto que leu do banco.
   *
   * Aqui a lista é escrita à mão de propósito: num teste, o valor esperado
   * PRECISA ser explícito. Derivá-lo da mesma fonte que o código usa seria um
   * teste que concorda consigo mesmo.
   */
  const CONCLUIDAS = new Set(['aprovado', 'esteira_teste', 'postado', 'na_plataforma', 'arquivado']);

  it('sem prazo e sem início, não opina', () => {
    expect(getUrgency(CONCLUIDAS, null, 'edicao', null)).toBeNull();
  });

  it('sem prazo, julga pelo início — o caso dos 41 cards', () => {
    expect(getUrgency(CONCLUIDAS, null, 'edicao', emDias(-5))).toBe('late');
    expect(getUrgency(CONCLUIDAS, null, 'edicao', emDias(1))).toBe('warn');
    expect(getUrgency(CONCLUIDAS, null, 'edicao', emDias(30))).toBe('ok');
  });

  it('início de hoje é aviso, não atraso', () => {
    expect(getUrgency(CONCLUIDAS, null, 'edicao', hoje())).toBe('warn');
  });

  it('fase concluída não atrasa, mesmo com data velha', () => {
    for (const fase of CONCLUIDAS) {
      expect(getUrgency(CONCLUIDAS, null, fase, emDias(-90))).toBeNull();
      expect(getUrgency(CONCLUIDAS, emDias(-90), fase, null)).toBeNull();
    }
  });

  it('fase que o banco NÃO marca como concluída continua atrasando', () => {
    // O ponto da mudança: a resposta passou a vir de fora. Um conjunto vazio
    // faz até o "postado" atrasar — e é assim que se vê que a função deixou
    // mesmo de ter opinião própria sobre quais fases terminaram.
    expect(getUrgency(new Set(), null, 'postado', emDias(-90))).toBe('late');
  });

  it('o prazo preenchido tem a palavra final sobre o início', () => {
    // Começou há muito tempo, mas o prazo é longe: não está atrasado.
    expect(getUrgency(CONCLUIDAS, emDias(30), 'edicao', emDias(-60))).toBe('ok');
  });
});
