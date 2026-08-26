import { describe, it, expect } from 'vitest';
import {
  variacao, distanciaDoMeta, baseAnteriorFragil, BlocoMetricas,
} from '@/features/analises/metricas';
import { indiceVencedor } from '@/features/analises/comparacao';
import { janelaDeDias, janelaAnterior, diasDaJanela } from '@/features/analises/periodo';
import { montarNota } from '@/features/analises/exportar';

/**
 * As decisões do módulo Análises, presas por teste.
 *
 * Cada bloco aqui é um erro que já apareceu na tela — não hipótese. A regra que
 * define o que entra: se alguém pode reescrever a função de um jeito plausível
 * e voltar a mostrar o número errado, tem teste.
 */

// Um bloco mínimo; cada teste sobrescreve só o que interessa a ele.
function bloco(over: Partial<BlocoMetricas> = {}): BlocoMetricas {
  return {
    dias: 14,
    investimento: 1000, faturamento: 2000, resultado: 1000, vendas: 20,
    roas: 2, imposto_simples: 200, imposto_meta: 125, taxa_plataforma: 120,
    taxa_plataforma_pct: 6, lucro_liquido: 555, margem_pct: 27.8, reembolsos: 0,
    oferta_principal_qtd: 20, oferta_principal_valor: 1800,
    bump_qtd: 8, bump_faturamento: 200, bump_adesao_pct: 40, itens: [],
    pct_ofertas_extras: 10,
    upsell_qtd: 1, upsell_faturamento: 297, upsell_adesao_pct: 5,
    faturamento_com_upsell: 2297, roas_com_upsell: 2.3,
    lucro_com_upsell: 800, margem_com_upsell_pct: 34.8, front_se_paga: true,
    nivel_investimento: 'conjunto', conjuntos: 3,
    impressoes: 50000, cliques: 1000, visitas: 940, checkouts_iniciados: 50,
    compras_meta: 21, vendas_de_anuncio: 19, cobertura_geral_pct: 80,
    conv_funil_pct: 2.13, conv_checkout_pct: 40, connect_rate_pct: 94,
    taxa_checkout_pct: 5,
    cpm: 20, cpc: 1, cpv: 1.06, cpi: 20, cpa: 50, epc: 2.13, aov: 100,
    epc_menos_cpv: 1.06,
    ...over,
  };
}

describe('variação entre períodos', () => {
  it('conta a alta normal', () => {
    expect(variacao(120, 100).pct).toBeCloseTo(20);
    expect(variacao(120, 100).direcao).toBe('subiu');
  });

  it('trata variação abaixo de 1% como estável', () => {
    // Pintar seta de alta para 0,3% treina a pessoa a ignorar a seta.
    expect(variacao(100.3, 100).direcao).toBe('igual');
  });

  it('não inventa comparação quando não há período anterior', () => {
    // `null` NÃO é zero: mostrar "0%" pareceria estabilidade onde não há
    // histórico nenhum.
    expect(variacao(100, null).pct).toBeNull();
    expect(variacao(100, 0).pct).toBeNull();
  });

  // O defeito real: o REV5 mostrava "Lucro líquido −R$ 8.878 ↑261%" em verde.
  // O prejuízo tinha triplicado e a tela dizia que melhorou.
  it('não pinta de verde um prejuízo que aumentou', () => {
    const v = variacao(-8878, -2459);
    expect(v.direcao).toBe('caiu');
    expect(v.pct).toBeLessThan(0);
  });

  it('reconhece quem saiu do vermelho para o azul', () => {
    expect(variacao(100, -50).direcao).toBe('subiu');
  });

  it('reconhece quem caiu do azul para o vermelho', () => {
    expect(variacao(-50, 100).direcao).toBe('caiu');
  });

  it('reconhece prejuízo que diminuiu como melhora', () => {
    expect(variacao(-100, -500).direcao).toBe('subiu');
  });
});

describe('distância entre a nossa contagem e a do Meta', () => {
  it('acusa o REV cuja atribuição está quebrada', () => {
    // O caso que denunciou um CPA de R$ 198 num REV que dava lucro: contamos
    // 406 vendas, o Meta reporta 437 compras para os mesmos anúncios.
    const d = distanciaDoMeta(bloco({ vendas: 406, compras_meta: 437 }));
    expect(d).not.toBeNull();
    expect(d!).toBeCloseTo(0.071, 2);
  });

  it('não alerta quando não há anúncio rodando', () => {
    // Sem investimento não há atribuição para comparar, e alertar ali seria
    // alarme falso.
    expect(distanciaDoMeta(bloco({ investimento: 0 }))).toBeNull();
    expect(distanciaDoMeta(bloco({ compras_meta: 0 }))).toBeNull();
  });
});

describe('base do período anterior', () => {
  it('avisa quando os anúncios mal rodaram antes', () => {
    // O REV3 gastou R$ 63,50 num único dia da janela anterior e R$ 20.221 na
    // atual. O ROAS "antes" dava 475 — correto e vazio.
    const frágil = baseAnteriorFragil(
      bloco({ investimento: 20221 }),
      bloco({ investimento: 63.5 }),
    );
    expect(frágil).toBe(true);
  });

  it('fica quieta quando os dois períodos rodaram de verdade', () => {
    expect(baseAnteriorFragil(
      bloco({ investimento: 20221 }),
      bloco({ investimento: 9172 }),
    )).toBe(false);
  });

  it('não avisa quando não há investimento nenhum agora', () => {
    expect(baseAnteriorFragil(
      bloco({ investimento: 0 }),
      bloco({ investimento: 0 }),
    )).toBe(false);
  });
});

describe('vencedor da linha na comparação', () => {
  it('escolhe o maior quando maior é melhor', () => {
    expect(indiceVencedor([1.2, 1.8, 0.9], 'maior')).toBe(1);
  });

  it('escolhe o menor quando menor é melhor, como em custo', () => {
    expect(indiceVencedor([50, 30, 70], 'menor')).toBe(1);
  });

  it('não elege vencedor onde não há direção — investir mais não é melhor', () => {
    expect(indiceVencedor([100, 200], null)).toBeNull();
    expect(indiceVencedor([100, 200], undefined)).toBeNull();
  });

  it('não coroa corrida de um corredor só', () => {
    expect(indiceVencedor([1.5, null], 'maior')).toBeNull();
  });

  it('não escolhe vencedor no empate', () => {
    expect(indiceVencedor([2, 2, 1], 'maior')).toBeNull();
  });

  it('ignora as colunas sem valor ao decidir', () => {
    expect(indiceVencedor([null, 0.5, 0.9], 'maior')).toBe(2);
  });
});

describe('janela da análise', () => {
  it('termina ontem, nunca hoje', () => {
    // O dia corrente está pela metade: comparar meio dia contra um período
    // inteiro faria toda métrica de volume parecer em queda de manhã.
    const hoje = new Date();
    const ontem = new Date(hoje);
    ontem.setDate(ontem.getDate() - 1);
    const esperado = `${ontem.getFullYear()}-`
      + `${String(ontem.getMonth() + 1).padStart(2, '0')}-`
      + `${String(ontem.getDate()).padStart(2, '0')}`;
    expect(janelaDeDias(14).fim).toBe(esperado);
  });

  it('cobre exatamente o número de dias pedido, contando as duas pontas', () => {
    expect(diasDaJanela(janelaDeDias(14))).toBe(14);
    expect(diasDaJanela(janelaDeDias(1))).toBe(1);
    expect(diasDaJanela(janelaDeDias(90))).toBe(90);
  });

  it('cola a janela anterior atrás da atual, do mesmo tamanho', () => {
    const j = { inicio: '2026-08-08', fim: '2026-08-23' };
    const a = janelaAnterior(j);
    expect(a.fim).toBe('2026-08-07');
    expect(a.inicio).toBe('2026-07-23');
    expect(diasDaJanela(a)).toBe(diasDaJanela(j));
  });

  it('não pula um dia à noite, quando o UTC já virou', () => {
    // Usar `toISOString()` fazia a janela andar sozinha depois das 21h no fuso
    // do Brasil. As datas saem de componentes locais.
    const j = janelaDeDias(30);
    expect(j.inicio).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(j.fim).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(diasDaJanela(j)).toBe(30);
  });
});

describe('nota do Obsidian', () => {
  const rodada = {
    dataRodada: '2026-08-26',
    projeto: 'Saponaria Brasil',
    rev: 'REV3 - VSL',
    metodo: 'VSL',
    metricas: { dias: 14, inicio: '2026-08-12', fim: '2026-08-25', atual: bloco(), anterior: bloco() },
    retencao: {
      play_rate_pct: 64, um_minuto_pct: 70.8, fim_da_lead_pct: null,
      pitch_pct: 28.8, final_pct: 5.6,
      lead_fim_seg: null, pitch_seg: 801, duracao_seg: 1347, nome: 'VSL 02',
    },
    leitura: 'Escalamos 4x e a margem caiu.',
    acoes: [
      { texto: 'Segurar a escala', expectativa: 'Margem voltar a 30%',
        feita: false, feita_em: null, feita_por_nome: null },
      { texto: 'Trocar a headline', expectativa: null,
        feita: true, feita_em: '2026-08-20T14:02:00-03:00', feita_por_nome: 'Jessica' },
    ],
  };

  it('abre com frontmatter que o Obsidian consegue filtrar', () => {
    const md = montarNota(rodada);
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('rev: "REV3 - VSL"');
    expect(md).toContain('front_se_paga: true');
    expect(md).toContain('tags: [analise, alaskan]');
  });

  it('leva a frase do veredito, não só a tabela', () => {
    // Sem ela a nota é um monte de número, e "o front se paga?" teria que ser
    // respondido de cabeça toda vez que alguém reabrisse a nota.
    expect(montarNota(rodada)).toContain('O front se paga');
  });

  it('marca ação feita com checkbox de markdown, e a pendente vazia', () => {
    const md = montarNota(rodada);
    expect(md).toContain('- [ ] Segurar a escala');
    expect(md).toContain('- [x] Trocar a headline');
  });

  it('leva expectativa e carimbo de execução junto da ação', () => {
    const md = montarNota(rodada);
    expect(md).toContain('🎯 Margem voltar a 30%');
    expect(md).toMatch(/✅ feita em .+ por Jessica/);
  });

  it('destaca a leitura no formato que ela já usa no Obsidian', () => {
    expect(montarNota(rodada)).toContain('==Escalamos 4x e a margem caiu.==');
  });

  it('avisa que o upsell é caixa e não receita recorrente', () => {
    expect(montarNota(rodada)).toContain('não receita recorrente do período');
  });

  it('não quebra quando não há métricas nem retenção', () => {
    const vazia = { ...rodada, metricas: null, retencao: null, acoes: [] };
    const md = montarNota(vazia);
    expect(md).toContain('# Saponaria Brasil · REV3 - VSL');
    expect(md).not.toContain('undefined');
    expect(md).not.toContain('NaN');
  });
});
