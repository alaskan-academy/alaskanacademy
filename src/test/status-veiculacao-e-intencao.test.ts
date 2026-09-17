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
    'rodando', 'parado', 'barrado_pelo_pai', 'bloqueado', 'sem_anuncio',
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
});
