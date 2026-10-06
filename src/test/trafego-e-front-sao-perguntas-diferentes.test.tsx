/**
 * "Se paga" são DUAS perguntas, e a tela precisa saber qual está respondendo.
 *
 * ── O defeito que isto guarda ─────────────────────────────────────────────
 *
 * Até 06/10/2026 existia um sinalizador só, `front_se_paga`, e ele respondia
 * `faturamento >= investimento` — ou seja, no BRUTO. Enquanto a coprodução
 * entrava como receita, o faturamento vinha inflado e o selo quase nunca
 * discordava do lucro. Quando a coprodução saiu (migração `20261006a`), quatro
 * REVs apareceram com o selo verde "o front se paga" e prejuízo:
 *
 *     REV5              R$ 23.910 investidos,  lucro -R$ 6.107,90
 *     REV9              R$  8.981 investidos,  lucro -R$ 2.250,54
 *     REV1 - Original   R$  6.121 investidos,  lucro -R$ 1.248,09
 *     REV4              R$  8.212 investidos,  lucro -R$   334,93
 *
 * No REV4 a contradição estava dentro do MESMO cartão: o selo verde no topo e
 * "só front: -R$ 334,93" três linhas abaixo.
 *
 * ── A separação ───────────────────────────────────────────────────────────
 *
 *   trafego_se_paga   o faturamento cobre a MÍDIA. Pergunta de quem compra
 *                     tráfego, feita no bruto: imposto e taxa não são decisão
 *                     do anúncio.
 *   front_se_paga     sobra algo DEPOIS de mídia, imposto e taxa. Pergunta da
 *                     operação.
 *
 * O caso do meio é o que justifica os dois existirem: tráfego de pé e front no
 * vermelho pede um conserto diferente de "o anúncio não traz o suficiente".
 * Se alguém apagar esse ramo, a tela volta a mandar mexer no criativo errado.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BlocoUpsell } from '@/features/analises/components/BlocoUpsell';
import { montarNota, type RodadaParaExportar } from '@/features/analises/exportar';
import { selosDoRetrato, retratoLegivel, type BlocoMetricas } from '@/features/analises/metricas';

function bloco(over: Partial<BlocoMetricas> = {}): BlocoMetricas {
  return {
    dias: 31,
    investimento: 8212.63, faturamento: 10727.82, resultado: 2515.19, vendas: 105,
    roas: 1.31, imposto_simples: 1004.72, imposto_meta: 1149.77, taxa_plataforma: 695.63,
    taxa_plataforma_pct: 6.48, lucro_liquido: -334.93, margem_pct: -3.1, reembolsos: 0,
    oferta_principal_qtd: 105, oferta_principal_valor: 9947.89,
    bump_qtd: 62, bump_faturamento: 1894.1, bump_adesao_pct: 37.14, itens: [],
    pct_ofertas_extras: 15.99,
    upsell_qtd: 6, upsell_faturamento: 1450.44, upsell_adesao_pct: 5.71,
    faturamento_com_upsell: 12178.26, roas_com_upsell: 1.48,
    lucro_com_upsell: 877, margem_com_upsell_pct: 7.2,
    // O caso do REV4 em 05/09–05/10: o tráfego se paga, o front não.
    trafego_se_paga: true, front_se_paga: false,
    nivel_investimento: 'conjunto', conjuntos: 5,
    impressoes: 200836, cliques: 3357, visitas: 3015, checkouts_iniciados: 257,
    compras_meta: 117, vendas_de_anuncio: 101, cobertura_geral_pct: 99.7,
    conv_funil_pct: 3.48, conv_checkout_pct: 40.86, connect_rate_pct: 89.81,
    taxa_checkout_pct: 7.66,
    cpm: 40.89, cpc: 2.45, cpv: 2.72, cpi: 31.96, cpa: 78.22, epc: 3.56, aov: 102.17,
    epc_menos_cpv: 0.83,
    ...over,
  };
}

/** O texto corrido do bloco, sem depender de como ele quebra em elementos. */
function textoDoBloco(a: BlocoMetricas): string {
  const { container } = render(<BlocoUpsell a={a} ant={bloco()} />);
  return container.textContent ?? '';
}

function nota(a: BlocoMetricas): string {
  const r: RodadaParaExportar = {
    dataRodada: '2026-10-06', projeto: 'Alaskan', rev: 'REV4', metodo: null,
    metricas: { dias: 31, inicio: '2026-09-05', fim: '2026-10-05', atual: a, anterior: bloco() },
    retencao: null, leitura: '', acoes: [],
  };
  return montarNota(r);
}

const VERDE    = bloco({ trafego_se_paga: true,  front_se_paga: true,
                         lucro_liquido: 1200, margem_pct: 11.2 });
const MEIO     = bloco({ trafego_se_paga: true,  front_se_paga: false });
const VERMELHO = bloco({ trafego_se_paga: false, front_se_paga: false,
                         faturamento: 6000, lucro_liquido: -3500, margem_pct: -58.3 });

describe('tráfego e front são perguntas diferentes', () => {
  describe('o bloco de upsell na tela', () => {
    it('front no azul: diz que o upsell é lucro em cima', () => {
      const t = textoDoBloco(VERDE);
      expect(t).toContain('O front se paga');
      expect(t).toContain('lucro em cima');
    });

    it('tráfego de pé e front no vermelho: nomeia a causa, que é imposto e taxa', () => {
      const t = textoDoBloco(MEIO);
      expect(t).toContain('O tráfego se paga, o front não');
      expect(t).toContain('imposto e taxa');
      // Mandar "mexer na página" aqui é o conselho errado: a página converte,
      // o que leva a sobra vem depois dela.
      expect(t).not.toContain('nem chega a cobrir a mídia');
    });

    it('nem o tráfego se paga: diz que o faturamento não cobre a mídia', () => {
      const t = textoDoBloco(VERMELHO);
      expect(t).toContain('O front não se paga');
      expect(t).toContain('nem chega a cobrir a mídia');
      expect(t).not.toContain('O tráfego se paga');
    });

    it('nunca mostra o selo verde com o front no vermelho', () => {
      // A regressão exata de 06/10: selo verde em cima de lucro negativo.
      for (const b of [MEIO, VERMELHO]) {
        const t = textoDoBloco(b);
        expect(b.lucro_liquido, 'o fixture precisa estar no vermelho').toBeLessThan(0);
        expect(t, 'selo verde sobre prejuízo').not.toContain('O front se paga.');
      }
    });

    it('o selo some quando não há investimento para comparar', () => {
      const t = textoDoBloco(bloco({ trafego_se_paga: null, front_se_paga: null }));
      expect(t).not.toContain('se paga');
      // E o resto do bloco continua aparecendo: só o veredito sai.
      expect(t).toContain('Adesão ao upsell');
    });
  });

  describe('a nota que vai para o Obsidian', () => {
    it('carrega os dois campos no frontmatter, não só um', () => {
      const md = nota(MEIO);
      expect(md).toContain('trafego_se_paga: true');
      expect(md).toContain('front_se_paga: false');
    });

    it('leva os mesmos três vereditos da tela', () => {
      expect(nota(VERDE)).toContain('**O front se paga.**');
      expect(nota(MEIO)).toContain('**O tráfego se paga, o front não.**');
      expect(nota(VERMELHO)).toContain('nem chega a cobrir a mídia');
    });

    it('o caso do meio não vira "o front não se paga" seco na nota', () => {
      // Quem lê a nota meses depois não tem a tela do lado para desambiguar.
      const md = nota(MEIO);
      expect(md).not.toContain('**O front não se paga.**');
    });
  });

  /*
    Os 14 retratos gravados em `analise_itens.metricas` antes de 06/10/2026 não
    têm `trafego_se_paga`, e o `front_se_paga` deles é o bruto. QUATRO dizem
    verde sobre prejuízo. Sem derivar na leitura, o Histórico e a re-exportação
    repetem a mentira — e o campo faltando empurraria todos para o ramo errado.
  */
  describe('retrato gravado antes da separação', () => {
    /** Como o jsonb antigo chega: sem o campo novo e com o selo bruto. */
    function antigo(over: Partial<BlocoMetricas> = {}): BlocoMetricas {
      const b = bloco(over) as BlocoMetricas & { trafego_se_paga?: boolean | null };
      delete b.trafego_se_paga;
      return b;
    }

    it('deriva os dois selos dos números do próprio retrato', () => {
      // O caso dos 4: bruto positivo (10.727 >= 8.212), líquido negativo.
      const r = selosDoRetrato(antigo({ front_se_paga: true }));
      expect(r.trafego_se_paga).toBe(true);
      expect(r.front_se_paga).toBe(false);
    });

    it('conserta o retrato que dizia verde sobre prejuízo', () => {
      const r = selosDoRetrato(antigo({ front_se_paga: true, lucro_liquido: -334.93 }));
      expect(r.front_se_paga, 'o veredito antigo sobreviveu ao prejuízo').toBe(false);
    });

    it('não toca em nenhum número do retrato', () => {
      // Recalcular número faria uma análise de agosto mudar sozinha quando uma
      // venda fosse recategorizada em setembro. Só o veredito se deriva.
      const antes = antigo({ front_se_paga: true });
      const depois = selosDoRetrato(antes);
      for (const campo of ['faturamento', 'investimento', 'lucro_liquido',
                           'roas', 'margem_pct', 'upsell_faturamento'] as const) {
        expect(depois[campo], `${campo} foi recalculado`).toBe(antes[campo]);
      }
    });

    it('sem investimento não há veredito a dar', () => {
      const r = selosDoRetrato(antigo({ investimento: 0, faturamento: 0, lucro_liquido: 0 }));
      expect(r.trafego_se_paga).toBeNull();
      expect(r.front_se_paga).toBeNull();
    });

    it('não mexe em retrato novo, que já traz os dois selos', () => {
      // Incluindo o caso legítimo de `trafego_se_paga: null`, que é um valor
      // gravado e não um campo ausente.
      for (const b of [MEIO, bloco({ trafego_se_paga: null, front_se_paga: null })]) {
        expect(selosDoRetrato(b)).toBe(b);
      }
    });

    it('retratoLegivel cobre os dois períodos, e aguenta retrato ausente', () => {
      const m = retratoLegivel({
        dias: 31, inicio: '2026-09-05', fim: '2026-10-05',
        atual: antigo({ front_se_paga: true }),
        anterior: antigo({ front_se_paga: true, lucro_liquido: -50 }),
      });
      expect(m?.atual.trafego_se_paga).toBe(true);
      expect(m?.atual.front_se_paga).toBe(false);
      expect(m?.anterior.front_se_paga, 'o período anterior ficou de fora').toBe(false);
      expect(retratoLegivel(null)).toBeNull();
    });
  });
});
