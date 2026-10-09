/**
 * `status_veiculacao` é INTENÇÃO. O fato mora em `vw_producao_estado_ads`.
 *
 * ── O que este teste está impedindo de voltar ──────────────────────────────
 *
 * `producoes.status_veiculacao` é um texto que alguém digita: Rodando, Pausado,
 * Encerrado, Bloqueado, Arquivado. E o sync da Meta já sabe a resposta
 * verdadeira para cada anúncio, de hora em hora. São dois campos respondendo
 * "este anúncio está no ar?" — a primeira armadilha do CLAUDE.md — e eles já
 * divergiram, em dinheiro:
 *
 *  · em 16/09/2026, dos 470 cards com anúncio para conferir, 26 divergiam;
 *  · dos 28 marcados "Pausado", 9 tinham anúncio rodando — 32% errados;
 *  · R$ 3.581,08 saíram em 7 dias de criativos dados por Encerrado ou Pausado.
 *
 * E ele estava sendo lido como fato em dois lugares: na linha de ANÚNCIO da
 * tela dos editores, ao lado de ROAS e CPA reais, e carregado no `select` do
 * Desempenho sem nunca ser renderizado — campo que trafega sem aparecer é campo
 * que alguém vai acabar mostrando sem saber o que ele é.
 *
 * Nada disso dá erro. O campo está preenchido, a tela renderiza, o número
 * parece um fato. O único jeito de não voltar é um teste que falhe quando
 * alguém o usar como resposta para "está rodando?".
 *
 * ── O que continua permitido ───────────────────────────────────────────────
 *
 * Gravar, filtrar e exibir como MARCAÇÃO. A intenção tem valor: é o julgamento
 * dela sobre o criativo, e é a contradição entre os dois que vale ser vista —
 * o ⚠ da aba Avaliação existe exatamente para isso.
 *
 * O que não é permitido é derivar dele um estado de veiculação, ou chamá-lo de
 * "Status" numa tela onde ele convive com número de anúncio.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function arquivosDe(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivosDe(caminho, acc);
    else if (/\.tsx?$/.test(nome)) acc.push(caminho);
  }
  return acc;
}

/**
 * O código sem os comentários.
 *
 * Este arquivo mesmo cita `status_veiculacao` dezenas de vezes na explicação
 * acima, e os arquivos que o campo toca ganharam comentários explicando por que
 * ele não é fato. Contar comentário faria o teste reclamar exatamente de quem
 * documentou a regra.
 */
function semComentarios(conteudo: string): string {
  return conteudo
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

const ARQUIVOS = arquivosDe('src').filter(f => !f.includes('test'));

describe('status_veiculacao é intenção, não fato', () => {
  /**
   * Comparar `status_veiculacao` com o vocabulário da Meta é derivar estado.
   *
   * `vw_meta_status.situacao` fala rodando / parado / barrado_pelo_pai; o campo
   * digitado fala Rodando / Pausado / Encerrado. Um `===` ligando os dois lados
   * é alguém traduzindo um no outro — e a tradução é onde a divergência entra.
   *
   * `contradiz()` em `AvaliacaoView` faz exatamente isso e está CERTO: ele
   * existe para achar a discordância, não para escondê-la. Por isso o teste
   * olha o nome da função em volta, e não só a comparação.
   */
  const VOCABULARIO_META = [
    'rodando', 'parado', 'parado_recente', 'barrado_pelo_pai', 'bloqueado', 'sem_anuncio',
    'ativo_sem_entregar', 'ativo_nunca_entregou', 'em_analise', 'sem_dado',
  ];

  it('nenhuma tela deriva estado de anúncio a partir da marcação', () => {
    const suspeitos: string[] = [];

    for (const arquivo of ARQUIVOS) {
      const codigo = semComentarios(readFileSync(arquivo, 'utf8'));
      if (!codigo.includes('status_veiculacao')) continue;

      /* A janela é a linha e as duas seguintes: uma comparação costuma caber
         aí, e ampliar demais pegaria trechos sem relação. */
      const linhas = codigo.split('\n');
      for (let i = 0; i < linhas.length; i++) {
        if (!linhas[i].includes('status_veiculacao')) continue;
        const janela = linhas.slice(i, i + 3).join(' ');
        /* `contradiz` é o uso legítimo: ele compara os dois justamente para
           acusar a divergência. */
        if (/contradiz/.test(janela)) continue;
        const achado = VOCABULARIO_META.find(v => janela.includes(`'${v}'`));
        if (achado) {
          suspeitos.push(`${arquivo}:${i + 1} — compara a marcação com '${achado}'`);
        }
      }
    }

    expect(suspeitos.join(' | ')).toEqual('');
  });

  it('a marcação não aparece rotulada como "Status" onde há número de anúncio', () => {
    /*
      O nome é metade do problema. Chamado de "Status" ao lado de ROAS e CPA,
      o campo é lido como fato — foi assim que ele chegou à linha de anúncio da
      tela dos editores. Onde ele aparece, o rótulo tem que dizer que é
      marcação.
    */
    const suspeitos: string[] = [];

    for (const arquivo of ARQUIVOS) {
      const codigo = semComentarios(readFileSync(arquivo, 'utf8'));
      if (!codigo.includes('status_veiculacao')) continue;
      if (/label="Status"|label={'Status'}|>Status</.test(codigo)) {
        suspeitos.push(`${arquivo} — rotula a marcação como "Status"`);
      }
      if (/Status de Veicula/.test(codigo)) {
        suspeitos.push(`${arquivo} — usa o rótulo "Status de Veiculação"`);
      }
    }

    expect(suspeitos.join(' | ')).toEqual('');
  });

  it('a marcação não é carregada sem ser usada', () => {
    /*
      `DesempenhoAdsView` carregava `status_veiculacao` no `select` e nunca o
      renderizava. Campo que trafega sem aparecer é campo que alguém vai acabar
      mostrando sem saber que é digitado à mão.

      A regra: quem cita o campo no `select` de uma consulta tem que citá-lo em
      outro lugar do arquivo também — gravando, filtrando ou exibindo.
    */
    const suspeitos: string[] = [];

    for (const arquivo of ARQUIVOS) {
      const codigo = semComentarios(readFileSync(arquivo, 'utf8'));
      const total = (codigo.match(/status_veiculacao/g) ?? []).length;
      if (total === 0) continue;
      const soNoSelect = total === 1
        && /select\([^)]*status_veiculacao/s.test(codigo);
      if (soNoSelect) {
        suspeitos.push(`${arquivo} — carrega a marcação e não faz nada com ela`);
      }
    }

    expect(suspeitos.join(' | ')).toEqual('');
  });

  /**
   * Em 09/10/2026 a tela ganhou um botão `[marcar Encerrado]` na linha da
   * contradição, e isso mexe perigosamente perto desta regra.
   *
   * O botão é legítimo: ele OFERECE o que o fato sugere, e gravar continua sendo
   * um clique dela. O que não pode acontecer é a oferta virar automação — nem
   * por uma função do banco, nem por um `useEffect` que aplica sozinho. A
   * diferença entre as duas coisas é a diferença entre um atalho e a perda do
   * alarme que achou R$ 5.691,62 em sete dias.
   */
  it('nenhuma migração escreve em producoes.status_veiculacao', () => {
    /*
      A marcação nunca foi derivada, e o banco é onde ela poderia passar a ser
      sem ninguém ver: um gatilho ou uma função que "sincronizasse" a marcação
      com o estado da Meta acabaria com a divergência em silêncio, e nenhuma
      tela denunciaria — o campo continuaria preenchido, só nunca mais
      discordaria de nada.
    */
    const dir = join('supabase', 'migrations');
    const suspeitos: string[] = [];

    for (const nome of readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) {
      /* A régua de avaliação estreou em 09/10/2026. Antes disso houve uma
         migração legítima mexendo nos dois campos — `20260827zo`, que mesclou
         cards duplicados da importação, quando os dois eram digitados e não
         havia régua. Condenar a história retroativamente faria este caso nascer
         vermelho, e teste que nasce vermelho alguém desliga. */
      if (nome < '20261009') continue;
      const sql = semComentarios(readFileSync(join(dir, nome), 'utf8'));
      for (const bloco of sql.match(/update\s+(?:public\.)?producoes[\s\S]*?;/gi) ?? []) {
        if (/\bset\b[\s\S]*?\bstatus_veiculacao\s*=/i.test(bloco)) {
          suspeitos.push(`${nome} — migração escrevendo a marcação`);
        }
      }
      /* E nenhum gatilho/função atribuindo em `new.status_veiculacao`. */
      if (/\bnew\.status_veiculacao\s*:?=/i.test(sql)) {
        suspeitos.push(`${nome} — gatilho atribuindo a marcação`);
      }
    }

    expect(suspeitos.join(' | ')).toEqual('');
  });

  it('o atalho da marcação é um clique, e o mapa do Meta mora longe dela', () => {
    /*
      Duas pontas, e a segunda é estrutural.

      A primeira: gravar a marcação só acontece dentro de um `onClick`. Um
      `useEffect` que chamasse `handleChange(c, 'status_veiculacao', …)` seria
      derivação com outro nome — a tela aplicaria o fato sozinha, e a
      contradição desapareceria sem ninguém decidir nada.

      A segunda: o mapa que traduz o fato em marcação sugerida vive em
      `@/features/ads/situacao`, um arquivo que NÃO contém a string
      `status_veiculacao`. Não é organização: é o que faz o primeiro caso deste
      arquivo continuar valendo. Ele reprova literal do vocabulário da Meta a
      menos de três linhas de uma menção à marcação, e manter os literais do
      outro lado da fronteira é a regra escrita como estrutura de arquivo.
    */
    const tela = semComentarios(readFileSync(
      join('src', 'features', 'criativos', 'components', 'AvaliacaoView.tsx'), 'utf8'));

    expect(tela, 'a tela deixou de oferecer a correção da marcação')
      .toMatch(/marcacaoQueOMetaSugere/);

    /* Toda escrita da marcação está num handler de clique. */
    const escritas = [...tela.matchAll(/handleChange\(\s*c\s*,\s*'status_veiculacao'/g)];
    expect(escritas.length, 'ninguém mais grava a marcação — o teste ficou cego')
      .toBeGreaterThan(0);
    for (const m of escritas) {
      const antes = tela.slice(Math.max(0, m.index! - 200), m.index!);
      expect(antes, 'há escrita da marcação fora de um handler de clique')
        .toMatch(/on(Click|Change)\s*=|onChange=\{/);
    }

    /*
      E o CÓDIGO do arquivo do mapa não cita a marcação, de propósito.

      Sem comentários, pela mesma razão que o primeiro caso deste arquivo: o
      docblock de `VIRA_ANUNCIO` explica que a VSL "continua ganhando
      `avaliacao` e `status_veiculacao` no formulário", e o de
      `marcacaoQueOMetaSugere` explica a própria fronteira citando o nome dela.
      Contar comentário faria o teste reclamar exatamente de quem documentou a
      regra — e foi o que aconteceu na primeira versão deste caso.
    */
    const mapa = semComentarios(
      readFileSync(join('src', 'features', 'ads', 'situacao.ts'), 'utf8'));
    expect(mapa, 'o código de situacao.ts passou a citar status_veiculacao — a fronteira caiu')
      .not.toContain('status_veiculacao');
    expect(mapa, 'situacao.ts não tem mais o mapa da marcação sugerida')
      .toMatch(/marcacaoQueOMetaSugere/);
  });
});
