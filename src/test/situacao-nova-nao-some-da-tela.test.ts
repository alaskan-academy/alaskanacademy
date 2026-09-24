/**
 * Situação nova no banco não pode sumir da tela nem virar "sem anúncio".
 *
 * ── O que quase aconteceu em 24/09/2026 ────────────────────────────────────
 *
 * Ela pediu que "parado" deixasse de ser cinza, para acusar anúncio que rodava
 * e hoje não roda. A mudança nasce em `vw_meta_status`, que ganhou a situação
 * `parado_recente`. Só que `vw_producao_estado_ads` — a view que resume os
 * anúncios de um CARD — repete o vocabulário com a LISTA ESCRITA À MÃO:
 *
 *     count(*) filter (where ms.situacao = 'parado')  as parados
 *     ...
 *     when parados > 0 then 'parado' when sem_dado > 0 then 'sem_dado'
 *     else 'sem_anuncio'
 *
 * Mexer só na primeira view faria o card cujo único anúncio acabou de parar
 * escapar de todas as contagens e cair no `else`: ele passaria a dizer
 * **"sem anúncio"**, com anúncio vinculado na ponte. Medido depois de
 * consertado: seriam **31 cards** mentindo, e mentindo de forma plausível —
 * ninguém desconfia de "sem anúncio" num card sem anúncio aparente.
 *
 * É a terceira armadilha do CLAUDE.md na forma mais cara: a lista fixa não
 * quebra nada, ela só cala.
 *
 * ── O que este teste trava ─────────────────────────────────────────────────
 *
 * 1. Toda situação que `vw_meta_status` sabe emitir tem rótulo em
 *    `SITUACAO`, senão a tela mostra a string crua ('parado_recente') no meio
 *    de nomes em português.
 * 2. Toda situação que `vw_meta_status` sabe emitir é TRATADA por
 *    `vw_producao_estado_ads` — contada ou ramificada. Uma que não seja cai no
 *    `else` e vira "sem anúncio".
 * 3. Quem afirma "alguém desligou" na aba Avaliação conhece as duas formas de
 *    parado, senão o ⚠ de contradição some justamente nos casos quentes.
 *
 * A fonte dos três é o SQL das migrações — o banco versionado. Nenhuma
 * conexão, nenhum segredo.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SITUACAO } from '@/features/ads/situacao';

const MIGRACOES = join(process.cwd(), 'supabase', 'migrations');
const SRC = join(process.cwd(), 'src');

/** `desconhecido` é o `else` proposital de `vw_meta_status`: a Meta inventa
 *  `effective_status` sem avisar, e `situacaoDe` mostra o valor cru em cinza de
 *  propósito, para não virar célula vazia. Ele não tem — nem deve ter — rótulo. */
const FALLBACK = 'desconhecido';

function arquivosSql(): string[] {
  return readdirSync(MIGRACOES).filter(n => n.endsWith('.sql')).sort()
    .map(n => join(MIGRACOES, n));
}

/**
 * O bloco `CASE … END AS <alias>` da ÚLTIMA migração que define a view.
 *
 * Lê em ordem de nome, que é a ordem em que as migrações rodam — redefinir a
 * view numa migração nova passa a valer aqui sozinho.
 */
function blocoDoCase(view: string, alias: string): string {
  let achado: string | null = null;
  for (const caminho of arquivosSql()) {
    const texto = readFileSync(caminho, 'utf8');
    const criaView = new RegExp(
      `create\\s+(?:or\\s+replace\\s+)?view\\s+(?:public\\.)?${view}\\b`, 'i');
    if (!criaView.test(texto)) continue;
    const corpo = texto.slice(texto.search(criaView));
    const fim = corpo.search(new RegExp(`END\\s+AS\\s+${alias}\\b`, 'i'));
    if (fim === -1) continue;
    /* Do último CASE antes do alias até ele: evita pegar o CASE de outra
       coluna (`campanha_id` tem um logo acima de `situacao`). */
    const inicio = corpo.slice(0, fim).toUpperCase().lastIndexOf('CASE');
    if (inicio === -1) continue;
    achado = corpo.slice(inicio, fim);
  }
  if (!achado) throw new Error(`não achei o CASE de ${alias} em ${view} — o teste ficou cego`);
  return achado;
}

/**
 * O que um `CASE` PRODUZ — os literais depois de `THEN` e de `ELSE`.
 *
 * A primeira versão pegava todo `'x'::text` do bloco e voltava com `ACTIVE`,
 * `DISAPPROVED`, `CAMPAIGN_PAUSED`: os literais de ENTRADA, que estão nos
 * `WHEN` e são o vocabulário da Meta, não o nosso. O teste acusou sete
 * situações inexistentes — falso positivo é tão ruim quanto teste cego, porque
 * ensina a ignorar o arquivo.
 *
 * O `ARRAY[...]` entra de propósito: em `vw_producao_estado_ads` o ramo
 * `(ARRAY[...])[pior]` é saída tanto quanto um `THEN` literal.
 */
function saidas(sql: string): string[] {
  const achadas = new Set<string>();
  for (const parte of sql.split(/\b(?:THEN|ELSE)\b/i).slice(1)) {
    const ateOProximoRamo = parte.split(/\bWHEN\b|\bEND\b/i)[0];
    for (const m of ateOProximoRamo.matchAll(/'([a-z_]+)'::text/g)) achadas.add(m[1]);
  }
  return [...achadas];
}

describe('situação nova não some da tela', () => {
  const doBanco = saidas(blocoDoCase('vw_meta_status', 'situacao'))
    .filter(s => s !== FALLBACK);

  it('o banco emite pelo menos o vocabulário que já existia', () => {
    /* Se a extração quebrar, ela devolveria pouco ou nada e os outros testes
       passariam vazios. Este é o teste do teste. */
    expect(doBanco.length, `só extraí [${doBanco.join(', ')}] de vw_meta_status`)
      .toBeGreaterThanOrEqual(8);
    expect(doBanco).toContain('rodando');
    expect(doBanco).toContain('parado');
  });

  it('toda situação do banco tem rótulo em SITUACAO', () => {
    const semRotulo = doBanco.filter(s => !(s in SITUACAO));
    expect(
      semRotulo,
      `${semRotulo.join(', ')} sai de vw_meta_status e não tem entrada em ` +
        `SITUACAO (src/features/ads/situacao.ts). Sem rótulo a tela mostra a ` +
        `string crua em cinza, no meio de nomes em português.`,
    ).toEqual([]);
  });

  it('toda situação do banco é tratada por vw_producao_estado_ads', () => {
    const tratadas = saidas(blocoDoCase('vw_producao_estado_ads', 'estado'));
    const esquecidas = doBanco.filter(s => !tratadas.includes(s));
    expect(
      esquecidas,
      `${esquecidas.join(', ')} sai de vw_meta_status mas vw_producao_estado_ads ` +
        `não trata — o card cai no \`else\` e passa a dizer "sem anúncio" tendo ` +
        `anúncio vinculado. Foi o que quase aconteceu com 31 cards em 24/09/2026.`,
    ).toEqual([]);
  });

  it('a aba Avaliação conhece as duas formas de parado', () => {
    const texto = readFileSync(
      join(SRC, 'features', 'criativos', 'components', 'AvaliacaoView.tsx'), 'utf8');
    const m = texto.match(/const\s+ALGUEM_DESLIGOU\s*=\s*\[([^\]]*)\]/);
    expect(m, 'não achei ALGUEM_DESLIGOU em AvaliacaoView.tsx').toBeTruthy();
    const lista = [...m![1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]);

    /* Toda situação do banco cujo rótulo diz que o anúncio NÃO está no ar conta
       como "alguém desligou". Derivado do próprio `explica`, e não de uma
       segunda lista escrita aqui — senão eu criaria a armadilha que o arquivo
       inteiro existe para impedir. */
    const desligadas = doBanco.filter(s => /desligou|desligado/i.test(SITUACAO[s]?.explica ?? ''));
    const faltando = desligadas.filter(s => !lista.includes(s));
    expect(
      faltando,
      `${faltando.join(', ')} descreve anúncio desligado mas está fora de ` +
        `ALGUEM_DESLIGOU — o ⚠ de contradição pararia de acusar esses casos.`,
    ).toEqual([]);
  });
});
