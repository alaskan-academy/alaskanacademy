/**
 * O aviso de tendência acusa com três métricas e explica com seis.
 *
 * ── Por que AOV virou o terceiro alarme ───────────────────────────────────
 *
 * CPA e ROAS já existiam. AOV entra porque NÃO é consequência deles: ele cai
 * quando o mix de oferta muda, e isso acontece com o ROAS firme.
 *
 * Medido em 04/10/2026, assim que o alarme passou a existir: o REV3 - VSL do
 * Saponaria estava com AOV 89,33 → 88,32 → 87,84 e CPA e ROAS parados. Era um
 * REV perdendo ticket há seis semanas, invisível na tela.
 *
 * ── Por que as outras seis NÃO viraram alarme ─────────────────────────────
 *
 * São 10 REVs ativos e três janelas. Com oito alarmes, a chance de pelo menos
 * um REV ter pelo menos uma métrica caindo três vezes seguidas vira quase
 * certeza, e aviso que aparece sempre é aviso que ninguém lê — o mesmo defeito
 * do alerta de "26% da receita de origem desconhecida".
 *
 * E elas não são independentes: se a conversão do funil cai, o CPA sobe por
 * consequência. Alarme de conversão seria o mesmo alarme contado duas vezes.
 *
 * Então elas entram para dizer ONDE olhar. O valor disso apareceu no primeiro
 * dia, nos dois REVs que estavam acusados:
 *
 *   REV1, alarme de CPA e ROAS   andou junto CPV 1,44 → 1,46 → 1,60 e margem
 *                                17,6% → 9,9%; a conversão do funil ficou
 *                                parada em 2,1%. A página não piorou: o
 *                                tráfego ficou caro.
 *
 *   REV3, alarme de AOV          andou junto só a adesão ao bump,
 *                                42,4% → 40,9% → 37,3%, e a conversão do funil
 *                                até subiu. O ticket cai porque o bump parou
 *                                de colar.
 *
 * Nenhum dos dois diagnósticos era legível antes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pioraSeguida, EXPLICAM } from '@/features/analises/components/AvisoTendencia';

const TELA = 'src/features/analises/components/AvisoTendencia.tsx';
const codigo = readFileSync(join(process.cwd(), TELA), 'utf8')
  .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')
  .replace(/\/\/[^\n]*/g, '');

describe('o aviso de tendência acusa e explica', () => {
  it('exige as TRÊS janelas na mesma direção', () => {
    // Duas e uma virada não é tendência: é ruído com sorte.
    expect(pioraSeguida([1.44, 1.46, 1.60], 'sobe')).toBe(true);
    expect(pioraSeguida([1.44, 1.60, 1.46], 'sobe')).toBe(false);
    expect(pioraSeguida([17.6, 15.8, 9.9], 'desce')).toBe(true);
    expect(pioraSeguida([17.6, 9.9, 15.8], 'desce')).toBe(false);
  });

  it('empate não conta como piora', () => {
    // A conversão do funil do REV1 fez 2,12 → 2,10 → 2,12 e NÃO pode aparecer
    // como explicação: foi justamente ela parada que mostrou que a página não
    // era o problema.
    expect(pioraSeguida([2.12, 2.10, 2.12], 'desce')).toBe(false);
    expect(pioraSeguida([5, 5, 5], 'desce')).toBe(false);
    expect(pioraSeguida([5, 5, 5], 'sobe')).toBe(false);
  });

  it('série incompleta não vira tendência', () => {
    // REV novo tem janela sem dado. Chutar aqui inventaria uma queda.
    expect(pioraSeguida([null, 2, 1], 'desce')).toBe(false);
    expect(pioraSeguida([3, null, 1], 'desce')).toBe(false);
    expect(pioraSeguida([3, 2], 'desce')).toBe(false);
  });

  it('cada métrica sabe qual é a direção ruim', () => {
    /*
      A que mais importa: `margem` DESCENDO é piora. Se ela estivesse marcada
      como 'sobe', uma margem recuperando apareceria como explicação de alarme
      — e a linha diria o contrário do que aconteceu.
    */
    const dir = Object.fromEntries(EXPLICAM.map(e => [e.campo, e.pior]));
    expect(dir.cpv).toBe('sobe');
    expect(dir.margem_pct).toBe('desce');
    expect(dir.conv_funil_pct).toBe('desce');
    expect(dir.conv_checkout_pct).toBe('desce');
    expect(dir.bump_adesao_pct).toBe('desce');
    expect(dir.upsell_adesao_pct).toBe('desce');
  });

  it('só CPV é dinheiro; o resto é percentual', () => {
    // Formatar adesão ao bump como R$ 36,01 seria número com a cara errada.
    const moeda = EXPLICAM.filter(e => e.moeda).map(e => e.campo);
    expect(moeda).toEqual(['cpv']);
  });

  it('as seis explicam, e nenhuma delas vira alarme', () => {
    /*
      A trava contra a tentação de promover uma explicação a alarme. O filtro
      da tela tem de olhar exatamente os três gatilhos, nem mais nem menos.
    */
    expect(codigo, `${TELA}: o filtro de alarmes mudou`).toMatch(
      /filter\(t => t\.cpa_piorando \|\| t\.roas_piorando \|\| t\.aov_piorando\)/,
    );
    for (const e of EXPLICAM) {
      expect(codigo, `${TELA}: ${e.campo} virou alarme`).not.toMatch(
        new RegExp(`t\\.${e.campo}_piorando`),
      );
    }
  });

  it('o que SEGUROU também aparece', () => {
    /*
      Metade do diagnóstico mora na ausência. No REV1 o CPV subiu e a margem
      caiu, mas a conversão do funil ficou parada em 2,1% — e foi isso que
      mostrou que a página não piorou. Sem listar quem segurou, uma métrica
      estável simplesmente não aparece, e ausência é invisível.
    */
    expect(codigo, `${TELA}: sumiu a lista do que segurou`).toMatch(/segurou:/);
    expect(codigo, 'segurou precisa sair das completas que NÃO pioraram').toMatch(
      /seguram\s*=\s*todas\.filter\(e => e\.completa && !pioraSeguida/,
    );
  });

  it('série incompleta não entra como "segurou"', () => {
    // REV sem upsell tem a adesão nula nas três janelas. Listá-la como quem
    // segurou seria inventar uma estabilidade que ninguém mediu.
    expect(codigo, `${TELA}: a trava de série completa sumiu`).toMatch(
      /completa: vals\.length === 3 && vals\.every\(v => v != null\)/,
    );
    expect(codigo, 'o que não tem dado precisa ser contado à parte').toMatch(
      /sem dado/,
    );
  });

  it('quando nada anda junto, a tela diz isso', () => {
    // Vazio aqui seria perda de informação: "nenhuma causa conhecida" é um
    // achado, e some se a linha simplesmente não aparecer.
    expect(codigo, `${TELA}: sumiu o caso de nenhuma explicação`).toMatch(
      /as outras métricas seguraram/,
    );
  });
});
