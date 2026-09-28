/**
 * "Na quarta" só pode ser dito da quarta que vem.
 *
 * ── O que aconteceu ────────────────────────────────────────────────────────
 *
 * A faixa verde do Início ("fora daqui pra frente") lê uma janela de **uma
 * semana além** do mês aberto na agenda. Em 28/09/2026, com setembro na tela,
 * ela mostrava o aniversário de **07/10** como "Jessica na quarta".
 *
 * Lado a lado com um calendário de setembro, isso se lê como a quarta DESTA
 * semana. E a única folga visível em setembro era a de 08/09 — já passada. O
 * aviso parecia estar anunciando coisa vencida.
 *
 * Não estava: a data era futura, e o filtro `ate >= hoje` funciona. O defeito
 * era o RÓTULO, que dizia o dia da semana sem dizer qual. Para além de 6 dias,
 * "7 de out" não tem como ser lido errado.
 *
 * ── Por que 6 e não 7 ──────────────────────────────────────────────────────
 *
 * Porque no sétimo dia o nome do dia se repete: daqui a 7 dias de uma quarta é
 * outra quarta, e "na quarta" volta a ser ambíguo — só que agora apontando para
 * a semana errada por uma semana inteira.
 */
import { describe, it, expect } from 'vitest';
import { quandoDizer } from '@/features/inicio/pages/InicioPage';

/** `yyyy-MM-dd` de daqui a `n` dias, do mesmo jeito que a página calcula. */
function emDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

describe('o aviso de ausência diz QUAL dia', () => {
  it('dentro da semana, fala o dia da semana', () => {
    for (const n of [0, 1, 3, 6]) {
      const texto = quandoDizer(emDias(n));
      expect(
        DIAS.some(d => texto.includes(d)),
        `daqui a ${n} dia(s) deveria dizer o dia da semana, disse "${texto}"`,
      ).toBe(true);
    }
  });

  it('a partir do sétimo dia, fala a DATA — senão o nome do dia se repete', () => {
    for (const n of [7, 9, 20, 60]) {
      const texto = quandoDizer(emDias(n));
      expect(
        texto,
        `daqui a ${n} dias tem que dizer a data, e disse "${texto}"`,
      ).toMatch(/\d+ de (jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)/);
      expect(
        DIAS.some(d => texto.includes(d)),
        `daqui a ${n} dias ainda diz o dia da semana ("${texto}") — é o defeito de 28/09`,
      ).toBe(false);
    }
  });

  it('o caso exato que ela viu: 9 dias à frente não pode virar "na quarta"', () => {
    /* 28/09/2026 olhando setembro, aniversário em 07/10: nove dias. */
    const texto = quandoDizer(emDias(9));
    expect(texto).not.toMatch(/^n[ao] /);
  });
});
