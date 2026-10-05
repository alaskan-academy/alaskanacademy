/**
 * O alerta de rastreio mede QUEDA, e os cortes dele são calibração, não gosto.
 *
 * ── O que havia antes, e por que saiu ─────────────────────────────────────
 *
 * `fn_alerta_remendo_utm_resolvido` dizia "a UTM voltou, o remendo pode sair"
 * e mandava tirar `trafego_pago` de `checkouts_origem`. Duas coisas erradas:
 *
 *   1. O gatilho só age quando `ad_id_meta is null`. Num checkout 100%
 *      rastreado o remendo JÁ está inerte — não há o que remover.
 *   2. `checkouts_origem.trafego_pago` não é remendo, é CLASSIFICAÇÃO
 *      (tráfego · suporte · recuperação · bio · upsell). Ela continua
 *      verdadeira independente de UTM.
 *
 * Seguir aquele conselho repetiria 21/08/2026, quando esvaziar
 * `links_trafego_sem_utm` custou 58% do alerta de receita sem origem.
 *
 * ── O que ninguém estava vendo ────────────────────────────────────────────
 *
 * Rastreio que REGRIDE. O "Saponaria Brasil - Desconto de Aula" saiu de 79,8%
 * para 69,4% em seis semanas, com volume alto o tempo todo, e nenhuma tela
 * disse. O alerta de `receita_sem_rastreio` não pega: ele olha o total dos 7
 * dias, onde um checkout escorregando 10pp se dilui nos outros 44 links.
 *
 * ── Os cortes, e o número que cada um salvou ──────────────────────────────
 *
 * Medidos em 04/10/2026, na calibração. Juntos deixam passar EXATAMENTE um
 * link, o Desconto de Aula. Zero falso positivo — e aviso que aparece sempre
 * é aviso que ninguém lê, o defeito que o de "26% de origem desconhecida"
 * tinha.
 *
 *   janelas de 14 dias   com 7 dias a série do próprio link culpado dava
 *                        75,2 → 69,6 → 71,6 e NÃO passava. São as mesmas
 *                        janelas de `vw_rev_tendencia`.
 *   p1 >= 50             tira suporte, bio e recuperação, que ficam em 0,0%
 *                        nas três janelas. Derivado do dado, não lido de
 *                        `checkouts_origem`: um link que esteve em 78% é de
 *                        anúncio, tenha alguém classificado ou não.
 *   menor_volume >= 20   o Workshop Buquê Rev1 tem 15 vendas por janela,
 *                        onde uma venda mexe 6pp.
 *   p1 - p3 >= 5         evita acusar 100 → 99 → 98.
 *   piora nas TRÊS       o Fábrica das Velas fez 97,1 → 92,6 → 95,8 e o
 *                        Workshop Rev1 95,2 → 95,2 → 93,3. Nenhum é tendência.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRACOES = join(process.cwd(), 'supabase', 'migrations');

/** Nomes das migrações, em ordem — a última a tocar o objeto é a que vale. */
const NOMES = readdirSync(MIGRACOES).filter(n => n.endsWith('.sql')).sort();

/**
 * Sem os comentários.
 *
 * Cicatriz de `o-empate-e-um-so.test.ts`: a primeira versão dele casava com o
 * número escrito no cabeçalho em vez do que estava no código, e passou com o
 * defeito plantado.
 */
const semComentario = (s: string) =>
  s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

function ultimaQueDefine(re: RegExp): string {
  let achado: string | null = null;
  for (const nome of NOMES) {
    const bruto = readFileSync(join(MIGRACOES, nome), 'utf8');
    if (re.test(semComentario(bruto))) achado = semComentario(bruto);
  }
  if (!achado) throw new Error(`não achei ${re} nas migrações — o teste ficou cego`);
  return achado;
}

const sql = ultimaQueDefine(
  /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?fn_alerta_rastreio_regredindo\b/i,
);

describe('o alerta de rastreio que regride', () => {
  it('lê três janelas de 14 dias, não de 7', () => {
    // Com 7 dias o único caso real não passava. Encurtar aqui cega o alerta.
    for (const par of [['42', '29'], ['28', '15'], ['14', '1']]) {
      expect(sql, `a janela ${par[0]}..${par[1]} mudou`).toMatch(
        new RegExp(`d\\s*-\\s*${par[0]}[\\s\\S]{0,40}d\\s*-\\s*${par[1]}`),
      );
    }
  });

  it('exige piora nas TRÊS leituras', () => {
    /*
      Duas e uma virada não é tendência: é ruído com sorte. É a mesma regra de
      `pioraSeguida` na tela e de `vw_rev_tendencia` no banco — se este alerta
      afrouxar, o painel passa a ter duas definições de "piorando".
    */
    expect(sql, 'sumiu a comparação da segunda janela').toMatch(/p2\s*<\s*p1/);
    expect(sql, 'sumiu a comparação da terceira janela').toMatch(/p3\s*<\s*p2/);
  });

  it('mantém os três cortes de calibração', () => {
    expect(sql, 'o piso de rastreio inicial saiu: suporte e bio voltam a acusar')
      .toMatch(/p1\s*>=\s*50/);
    expect(sql, 'o piso de volume saiu: link de 15 vendas volta a oscilar')
      .toMatch(/menor_volume\s*>=\s*20/);
    expect(sql, 'o piso de queda saiu: 100 -> 99 -> 98 volta a virar alarme')
      .toMatch(/p1\s*-\s*p3\s*>=\s*5/);
  });

  it('não lê a classificação de checkouts_origem', () => {
    /*
      A tentação óbvia é filtrar por `checkouts_origem.trafego_pago is true`,
      como a função antiga fazia. Seria lista mantida à mão decidindo o que o
      alerta vê — a terceira armadilha —, e um checkout novo ainda sem
      classificação ficaria invisível justo na estreia, que é quando a UTM mais
      sai errada. `p1 >= 50` responde a mesma pergunta a partir do dado.
    */
    expect(sql, 'o alerta voltou a depender de cadastro').not.toMatch(
      /checkouts_origem/i,
    );
  });

  it('deixa o upsell de fora', () => {
    /*
      NÃO porque upsell seja mal rastreado: medido em 04/10/2026, ele está em
      82,3% contra 76,5% do front. É porque o link de upsell não é clicado em
      anúncio nenhum — ele vem da página de obrigado, e o ad_id dele é herdado
      da venda da frente. Queda ali não diz nada sobre UTM em anúncio.

      É também o mesmo recorte de `receita_sem_rastreio`, que já exclui upsell.
    */
    expect(sql, 'o upsell voltou para a conta').toMatch(/is_upsell\s+is\s+not\s+true/i);
  });

  it('o alerta antigo não volta', () => {
    /*
      A última migração a mencionar a função velha tem de ser a que a apaga. Se
      alguém recriá-la, o painel volta a aconselhar o estrago de 21/08/2026.
    */
    const ultima = NOMES.filter(n =>
      semComentario(readFileSync(join(MIGRACOES, n), 'utf8'))
        .includes('fn_alerta_remendo_utm_resolvido'),
    ).pop();
    expect(ultima, 'ninguém mais cita a função antiga — sobrou o teste cego')
      .toBeTruthy();
    expect(
      semComentario(readFileSync(join(MIGRACOES, ultima!), 'utf8')),
      `${ultima}: a função antiga foi recriada depois do DROP`,
    ).toMatch(/drop\s+function\s+if\s+exists\s+(?:public\.)?fn_alerta_remendo_utm_resolvido/i);
  });

  it('entra na vw_alertas com as quatro colunas na ordem', () => {
    /*
      Coluna nova no meio de um `CREATE OR REPLACE VIEW` devolve 42P16, e isso
      já apareceu duas vezes neste projeto. E o ramo precisa existir: função
      que ninguém chama é alerta que nunca aparece.
    */
    const view = ultimaQueDefine(/create\s+or\s+replace\s+view\s+(?:public\.)?vw_alertas\b/i);
    expect(view, 'o ramo do alerta novo não entrou na view').toMatch(
      /fn_alerta_rastreio_regredindo\(\)\s+\w+\(codigo,\s*severidade,\s*titulo,\s*detalhe\)/i,
    );
    expect(view, 'o apelido velho ficou dentro da view').not.toMatch(
      /\)\s+fn_alerta_remendo_utm_resolvido\s*\(/i,
    );
  });
});
