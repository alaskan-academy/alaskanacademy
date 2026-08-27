import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  paraYmd, hoje, deYmd, emDias, primeiroDiaDoMes, ultimoDiaDoMes, diasEntre,
} from '@/lib/datas';

/**
 * O fuso já enganou este projeto três vezes, e as três correções foram
 * escritas em cantos separados. Estes testes existem para que a quarta não
 * aconteça — cada um deles falha se alguém voltar a usar `toISOString()`
 * para produzir uma data.
 *
 * O horário escolhido nos testes é sempre entre 21h e meia-noite, porque é
 * exatamente a faixa em que UTC e Brasil discordam de dia. Fora dela o bug
 * não aparece, e foi por isso que ele sobreviveu tanto tempo: quem testava de
 * manhã via tudo certo.
 */

afterEach(() => {
  vi.useRealTimers();
});

/** Finge que agora é `local` no fuso da máquina que roda o teste. */
function fingirAgora(local: Date) {
  vi.useFakeTimers();
  vi.setSystemTime(local);
}

describe('paraYmd', () => {
  it('lê os componentes locais, não os de UTC', () => {
    // 26/08 às 22h locais. Em UTC-3 isso é 01h do dia 27 em UTC.
    const d = new Date(2026, 7, 26, 22, 0, 0);
    expect(paraYmd(d)).toBe('2026-08-26');
  });

  it('não escorrega com hora de fim de dia', () => {
    // O caso que quebrava o Desempenho de Ads: `setHours(23,59,59)` no último
    // dia do mês virava o dia 1º do mês seguinte em UTC.
    const fimDoMes = new Date(2026, 7, 31, 23, 59, 59, 999);
    expect(paraYmd(fimDoMes)).toBe('2026-08-31');
  });

  it('preenche mês e dia com zero à esquerda', () => {
    expect(paraYmd(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('discorda de toISOString justamente na faixa da noite', () => {
    const d = new Date(2026, 7, 26, 23, 30);
    const utc = d.toISOString().slice(0, 10);
    // Este teste só afirma algo em fusos negativos (as Américas). Em UTC ou
    // em fuso positivo os dois coincidem, e aí não há o que comparar.
    if (d.getTimezoneOffset() > 0) {
      expect(paraYmd(d)).not.toBe(utc);
    }
    expect(paraYmd(d)).toBe('2026-08-26');
  });
});

describe('hoje', () => {
  it('é a data local mesmo às 23h', () => {
    fingirAgora(new Date(2026, 7, 26, 23, 45));
    expect(hoje()).toBe('2026-08-26');
  });

  it('vira junto com a meia-noite local', () => {
    fingirAgora(new Date(2026, 7, 27, 0, 1));
    expect(hoje()).toBe('2026-08-27');
  });
});

describe('deYmd', () => {
  it('devolve a meia-noite local, e não o dia anterior', () => {
    // `new Date('2026-08-26')` sozinho é lido como UTC e cai às 21h do dia 25
    // no Brasil. O `T00:00:00` sem sufixo é o que evita isso.
    const d = deYmd('2026-08-26');
    expect(d.getDate()).toBe(26);
    expect(d.getMonth()).toBe(7);
    expect(d.getHours()).toBe(0);
  });

  it('faz a volta completa com paraYmd', () => {
    for (const ymd of ['2026-02-28', '2026-08-31', '2027-01-01', '2028-02-29']) {
      expect(paraYmd(deYmd(ymd))).toBe(ymd);
    }
  });
});

describe('emDias', () => {
  it('anda para frente e para trás', () => {
    const base = new Date(2026, 7, 26, 22, 0);
    expect(emDias(1, base)).toBe('2026-08-27');
    expect(emDias(-1, base)).toBe('2026-08-25');
  });

  it('atravessa a virada do mês', () => {
    expect(emDias(1, new Date(2026, 7, 31, 22, 0))).toBe('2026-09-01');
  });

  it('atravessa a virada do ano', () => {
    expect(emDias(1, new Date(2026, 11, 31, 23, 0))).toBe('2027-01-01');
  });
});

describe('primeiroDiaDoMes e ultimoDiaDoMes', () => {
  it('acham as bordas de um mês de 31 dias', () => {
    const d = new Date(2026, 7, 15, 22, 0);
    expect(primeiroDiaDoMes(d)).toBe('2026-08-01');
    expect(ultimoDiaDoMes(d)).toBe('2026-08-31');
  });

  it('acham as bordas de fevereiro, inclusive bissexto', () => {
    expect(ultimoDiaDoMes(new Date(2026, 1, 10))).toBe('2026-02-28');
    expect(ultimoDiaDoMes(new Date(2028, 1, 10))).toBe('2028-02-29');
  });

  it('o último dia não vaza para o mês seguinte à noite', () => {
    // A borda calculada às 23h de um dia 31 era o caso que escorregava.
    expect(ultimoDiaDoMes(new Date(2026, 7, 31, 23, 59))).toBe('2026-08-31');
  });
});

describe('diasEntre', () => {
  it('conta dias corridos entre duas datas', () => {
    expect(diasEntre('2026-08-20', '2026-08-26')).toBe(6);
  });

  it('é zero no mesmo dia e negativo para trás', () => {
    expect(diasEntre('2026-08-26', '2026-08-26')).toBe(0);
    expect(diasEntre('2026-08-26', '2026-08-24')).toBe(-2);
  });

  it('não se confunde com o horário de verão', () => {
    // Um intervalo que atravessa uma mudança de relógio tem um dia de 23h ou
    // 25h. Contando entre meias-noites e arredondando, o resultado continua
    // inteiro — dividir milissegundos direto daria 30,96 e truncaria para 30.
    expect(diasEntre('2026-10-01', '2026-11-01')).toBe(31);
    expect(diasEntre('2026-02-01', '2026-03-01')).toBe(28);
  });

  it('conta o ano bissexto certo', () => {
    expect(diasEntre('2028-02-01', '2028-03-01')).toBe(29);
  });
});
