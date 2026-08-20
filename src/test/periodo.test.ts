import { describe, it, expect } from 'vitest';
import { inicioDiaBRT, fimDiaBRT, diaBRT } from '@/lib/periodo';

describe('limites do período no fuso da operação', () => {
  it('abre o dia à meia-noite de Brasília, não de UTC', () => {
    expect(inicioDiaBRT('2026-08-20')).toBe('2026-08-20T00:00:00.000-03:00');
  });

  it('fecha o dia no último instante de Brasília', () => {
    expect(fimDiaBRT('2026-08-20')).toBe('2026-08-20T23:59:59.999-03:00');
  });

  it('exclui a venda das 22h do dia anterior — o bug que inflava a contagem', () => {
    // 19/08 22:00 BRT vira 20/08 01:00 UTC. Filtrar por "2026-08-20" solto
    // incluía essa venda no dia 20; com offset explícito ela fica no dia 19.
    const vendaTardeDoDia19 = new Date('2026-08-19T22:00:00-03:00');
    expect(vendaTardeDoDia19 >= new Date(inicioDiaBRT('2026-08-20'))).toBe(false);
    expect(vendaTardeDoDia19 >= new Date(inicioDiaBRT('2026-08-19'))).toBe(true);
  });

  it('inclui a venda das 23h59 do próprio dia', () => {
    const fimDoDia = new Date('2026-08-20T23:59:00-03:00');
    expect(fimDoDia <= new Date(fimDiaBRT('2026-08-20'))).toBe(true);
  });

  it('agrupa o timestamp no dia certo de Brasília', () => {
    // 20/08 01:00 UTC = 19/08 22:00 BRT
    expect(diaBRT('2026-08-20T01:00:00Z')).toBe('2026-08-19');
    expect(diaBRT('2026-08-20T12:00:00Z')).toBe('2026-08-20');
  });

  it('mantém o intervalo coerente de ponta a ponta', () => {
    const inicio = new Date(inicioDiaBRT('2026-08-01'));
    const fim = new Date(fimDiaBRT('2026-08-31'));
    expect(fim.getTime() - inicio.getTime()).toBe(31 * 86_400_000 - 1);
  });
});
