import { describe, it, expect } from 'vitest';
import {
  rotuloDoAd, rotuloDoAdHook, rotuloDeDias, FAMILIA_LABEL,
} from '@/features/copywriters/components/esteira/tipos';

describe('rotuloDoAd', () => {
  it('põe o zero à esquerda que a operação usa nos nomes', () => {
    expect(rotuloDoAd(1)).toBe('AD 001');
    expect(rotuloDoAd(45)).toBe('AD 045');
    expect(rotuloDoAd(123)).toBe('AD 123');
  });

  it('não trunca acima de três dígitos', () => {
    // Os números vão até 123 hoje; passar de 999 não pode virar "AD 000".
    expect(rotuloDoAd(1004)).toBe('AD 1004');
  });
});

describe('rotuloDoAdHook', () => {
  it('junta AD e hook no formato do nome do card', () => {
    expect(rotuloDoAdHook(45, 4)).toBe('AD 045 H04');
    expect(rotuloDoAdHook(6, 12)).toBe('AD 006 H12');
  });

  it('omite o hook quando o nome não tinha um', () => {
    // `AD 089 IMG01` é um estático: existe no banco e não tem H.
    expect(rotuloDoAdHook(89, null)).toBe('AD 089');
  });
});

describe('rotuloDeDias', () => {
  it('trata zero como hoje, e não como "parado há 0 dias"', () => {
    // A view faz `greatest(..., 0)`, então um card agendado para amanhã
    // também chega aqui como zero.
    expect(rotuloDeDias(0)).toBe('hoje');
  });

  it('usa dias abaixo de um mês', () => {
    expect(rotuloDeDias(1)).toBe('ontem');
    expect(rotuloDeDias(8)).toBe('há 8 dias');
    expect(rotuloDeDias(29)).toBe('há 29 dias');
  });

  it('vira meses a partir de 30', () => {
    expect(rotuloDeDias(30)).toBe('há 1 meses');
    expect(rotuloDeDias(175)).toBe('há 6 meses');
    expect(rotuloDeDias(364)).toBe('há 12 meses');
  });

  it('vira anos a partir de 365 — o caso que existe de verdade', () => {
    // Desafios na Sala de Aula tem 10 lotes aprovados em agosto de 2025.
    expect(rotuloDeDias(365)).toBe('há mais de 1 ano');
    expect(rotuloDeDias(367)).toBe('há mais de 1 ano');
    expect(rotuloDeDias(800)).toBe('há mais de 2 anos');
  });

  it('diz "sem data" em vez de somar com null', () => {
    expect(rotuloDeDias(null)).toBe('sem data');
  });
});

describe('FAMILIA_LABEL', () => {
  it('tem rótulo para as duas famílias e para os dois casos de escape', () => {
    // 'outro' e 'sem_tipo' existem para um tipo_teste desconhecido APARECER na
    // tela em vez de sumir da conta — se perderem o rótulo, some de novo.
    for (const k of ['novo', 'variacao', 'sem_tipo', 'outro']) {
      expect(FAMILIA_LABEL[k]).toBeTruthy();
    }
  });
});
