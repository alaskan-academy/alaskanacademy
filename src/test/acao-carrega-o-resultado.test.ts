/**
 * A ação carrega o próprio veredito.
 *
 * ── O que estava assim ────────────────────────────────────────────────────
 *
 * `analise_acoes` tinha `expectativa`, escrita ANTES, e nada escrito DEPOIS.
 * O veredito de cada ação ia para a leitura solta da rodada, no formato que
 * ela usava de verdade em 04/10/2026:
 *
 *     - Testar Headline: sem aumento ou baixa significativa, então vamos manter
 *
 * E ali ele some na quinzena seguinte junto com o resto do texto, que é
 * exatamente o defeito do Google Chat que este módulo veio substituir. O
 * CLAUDE.md do módulo já dizia "alteração sem veredito é dívida"; faltava o
 * lugar de pagar a dívida.
 *
 * ── Por que não reusar `onSalvar` ─────────────────────────────────────────
 *
 * `onSalvar` grava texto e expectativa juntos. Mandar o resultado por ele
 * faria avaliar reescrever o registro de ANTES — e o registro de antes é o
 * que dá sentido ao depois. Daí um caminho próprio, que só carrega o veredito.
 *
 * ── E o espelho ───────────────────────────────────────────────────────────
 *
 * O Obsidian recebe a nota de cada rodada. Resultado que ficasse só no banco
 * faria a nota do vault contar metade da história, e o vault passaria a
 * discordar do painel sem nada denunciando — o mesmo defeito que levou o
 * DELETE explícito a existir na exportação.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { montarNota } from '@/features/analises/exportar';

const ler = (p: string) =>
  readFileSync(join(process.cwd(), p), 'utf8')
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')
    .replace(/\/\/[^\n]*/g, '');

const EDITAVEL  = 'src/features/analises/components/AcaoEditavel.tsx';
const RODADA    = 'src/features/analises/pages/AnalisesPage.tsx';
const HISTORICO = 'src/features/analises/pages/HistoricoPage.tsx';

describe('a ação carrega o próprio veredito', () => {
  it('avaliar não reescreve o texto nem a expectativa', () => {
    const codigo = ler(RODADA);
    const trecho = codigo.slice(codigo.indexOf('async function salvarResultado'));
    const ateOFim = trecho.slice(0, trecho.indexOf('async function apagarAcao'));
    expect(ateOFim, `${RODADA}: não achei salvarResultado`).not.toBe('');
    // Só `resultado` viaja no update. `texto` ou `expectativa` aqui dentro
    // significaria sobrescrever o registro de antes ao avaliar.
    expect(ateOFim, 'o update do resultado não pode carregar outros campos').toMatch(
      /\.update\(\{ resultado \}\)/,
    );
  });

  it('o campo não aparece em ação ainda aberta', () => {
    /*
      Resultado antes de a ação terminar é campo que pede adivinhação, e campo
      preenchido por obrigação vira ficção — a mesma razão de a expectativa ser
      opcional.

      A trava cobre os DOIS destinos: feita e cancelada. Era `acao.feita`
      sozinho até o cancelamento existir, e um teste preso na forma antiga
      quebraria sem nada estar errado.
    */
    const codigo = ler(EDITAVEL);
    expect(codigo, `${EDITAVEL}: o resultado perdeu a trava do estado`).toMatch(
      /\(acao\.feita \|\| cancelada\) && onResultado/,
    );
  });

  it('as duas telas gravam o resultado, não só a Rodada', () => {
    // O Histórico é onde se relê a decisão meses depois; se lá fosse só
    // leitura, quem percebesse o veredito faltando teria de voltar à Rodada.
    for (const tela of [RODADA, HISTORICO]) {
      expect(ler(tela), `${tela}: não grava resultado`).toMatch(
        /\.update\(\{ resultado \}\)/,
      );
      expect(ler(tela), `${tela}: não traz resultado na carga`).toMatch(
        /expectativa,resultado,/,
      );
    }
  });

  it('a nota do Obsidian leva o veredito junto da ação', () => {
    const md = montarNota({
      dataRodada: '2026-10-04', projeto: 'Saponaria', rev: 'REV3 - VSL', metodo: null,
      metricas: null, retencao: null, leitura: '',
      acoes: [
        {
          texto: 'Testar Headline',
          expectativa: 'Aumentar a conversão do funil',
          resultado: 'Sem aumento ou baixa significativa, então vamos manter.',
          feita: true,
          feita_em: '2026-09-08T18:02:00-03:00',
          feita_por_nome: 'Lucas Veiga',
        },
      ],
    } as never);

    expect(md).toContain('- [x] Testar Headline');
    expect(md).toContain('🎯 Aumentar a conversão do funil');
    expect(md).toContain('📊 Sem aumento ou baixa significativa, então vamos manter.');

    // A ordem é a dos acontecimentos: o que se esperava, quando se fez, o que
    // deu. Lida fora do painel, a nota conta a decisão inteira.
    expect(md.indexOf('🎯')).toBeLessThan(md.indexOf('✅'));
    expect(md.indexOf('✅')).toBeLessThan(md.indexOf('📊'));
  });

  it('ação sem veredito não inventa linha na nota', () => {
    const md = montarNota({
      dataRodada: '2026-10-04', projeto: null, rev: 'REV1', metodo: null,
      metricas: null, retencao: null, leitura: '',
      acoes: [{
        texto: 'Subir o preço', expectativa: null, resultado: null,
        feita: true, feita_em: '2026-10-01T10:00:00-03:00', feita_por_nome: null,
      }],
    } as never);

    expect(md).toContain('- [x] Subir o preço');
    expect(md).not.toContain('📊');
  });
});
