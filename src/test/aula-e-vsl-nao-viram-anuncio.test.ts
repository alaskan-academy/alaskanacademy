/**
 * "Virou anúncio?" é pergunta para criativo. Aula e VSL não têm como responder.
 *
 * ── O que aconteceu ────────────────────────────────────────────────────────
 *
 * Em 21/09/2026 a aba "O que eu aprovei" mostrava, em laranja, **nunca virou
 * anúncio** ao lado de uma Aula — "Aula 0 - Welcome", do projeto Flow to Fit,
 * aprovada 27 dias antes. A tela estava acusando alguém de não ter feito algo
 * que o tipo do card nunca faz.
 *
 * `fn_fixar_vinculo_ads` é a única coisa que escreve em `producao_ads`, e ela
 * casa anúncio com card exigindo `p.fase = 'postado' AND p.tipo = 'criativo'`.
 * Aula e VSL não podem ganhar vínculo — por construção, não por omissão. O que
 * o banco media naquele dia:
 *
 *   criativo   3.784 cards   521 com anúncio ligado   13,8%
 *   aula         221 cards     0                       0,0%
 *   vsl           98 cards     0                       0,0%
 *
 * E não era só o rótulo. `tipo` já chegava em `AprovadosView` e nunca era
 * lido, então os 319 cards de aula e VSL entravam no DENOMINADOR de "viraram
 * anúncio (x%)" e na contagem de "nunca subiram". Numerador que só pode vir de
 * anúncio, denominador que vem de todo card.
 *
 * ── O que este teste trava ─────────────────────────────────────────────────
 *
 * 1. Um QUARTO tipo no banco obriga alguém a decidir de que lado ele cai —
 *    terceira armadilha do CLAUDE.md, lista no código que envelhece em
 *    silêncio. A fonte é o CHECK `criativos_tipo_check`, nas migrações, que é
 *    o banco versionado: nenhuma conexão, nenhum segredo.
 *
 * 2. As duas definições de "roda como anúncio" — a do código e a do vínculo no
 *    banco — não podem divergir. É a primeira armadilha, e ela JÁ está em
 *    vigor no projeto: `CriativoFormModal` usa `criativo || vsl`, e por isso 66
 *    das 98 VSLs têm `avaliacao` preenchida e 21 estão marcadas
 *    Validado/Escalado, enquanto as views de esteira (`tipo = 'criativo'`) não
 *    as enxergam. Esse desacordo está anotado em `situacao.ts` e é decisão
 *    dela, não conserto de passagem; o que este teste impede é o desacordo
 *    entrar no lado que PERGUNTA pelo anúncio.
 *
 * 3. A acusação não pode voltar. Esta parte interroga `respostaDoAnuncio` caso
 *    a caso, e não o texto do arquivo. A primeira versão ERA um grep — "quem
 *    lê `ads_ligados` e escreve 'nunca virou' tem de mencionar
 *    `rodaComoAnuncio`" — e quando plantei o defeito para conferir, ela passou:
 *    a palavra continuava no resumo, alguns parágrafos acima da célula que eu
 *    tinha estragado. Uma trava satisfeita por qualquer menção em qualquer
 *    lugar do arquivo não trava nada.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { VIRA_ANUNCIO, NAO_VIRA_ANUNCIO, rodaComoAnuncio } from '@/features/ads/situacao';
import { respostaDoAnuncio, DIAS_DE_CARENCIA } from '@/features/producao/components/AprovadosView';

const MIGRACOES = join(process.cwd(), 'supabase', 'migrations');
const SRC = join(process.cwd(), 'src');

function arquivosSql(): string[] {
  return readdirSync(MIGRACOES)
    .filter(n => n.endsWith('.sql'))
    .sort()
    .map(n => join(MIGRACOES, n));
}

/**
 * Os tipos de card que o banco aceita, lidos do CHECK.
 *
 * Lê o ÚLTIMO arquivo que declara a restrição, em ordem de nome — que é a
 * ordem em que as migrações rodam. Assim, redefinir o CHECK numa migração nova
 * passa a valer aqui sozinho.
 */
function tiposAceitosPeloBanco(): string[] {
  let achado: string[] | null = null;
  for (const caminho of arquivosSql()) {
    const texto = readFileSync(caminho, 'utf8');
    /* `tipo = ANY (ARRAY['criativo'::text, ...])` — e também a forma
       `tipo in ('a','b')`, caso alguém reescreva o CHECK à mão. */
    const m =
      texto.match(/constraint\s+criativos_tipo_check\s+CHECK\s*\(\((.*?)\)\)/is) ??
      texto.match(/criativos_tipo_check[^;]*?CHECK\s*\((.*?)\);/is);
    if (!m) continue;
    const valores = [...m[1].matchAll(/'([a-z_]+)'/gi)].map(x => x[1]);
    if (valores.length) achado = valores;
  }
  if (!achado) throw new Error('não achei criativos_tipo_check nas migrações — o teste ficou cego');
  return achado;
}

/** O corpo da última definição de uma função nas migrações. */
function corpoDaFuncao(nome: string): string {
  let corpo: string | null = null;
  for (const caminho of arquivosSql()) {
    const texto = readFileSync(caminho, 'utf8');
    const abre = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${nome}\\s*\\(`, 'i');
    const m = texto.match(abre);
    if (!m || m.index === undefined) continue;
    const resto = texto.slice(m.index);
    /* Até a próxima declaração de função, ou o fim do arquivo. */
    const proxima = resto.slice(1).search(/create\s+(?:or\s+replace\s+)?function/i);
    corpo = proxima === -1 ? resto : resto.slice(0, proxima + 1);
  }
  if (!corpo) throw new Error(`não achei a definição de ${nome} nas migrações — o teste ficou cego`);
  return corpo;
}

describe('aula e VSL não viram anúncio', () => {
  it('classifica TODO tipo que o banco aceita — um quarto tipo quebra aqui', () => {
    const doBanco = tiposAceitosPeloBanco().sort();
    const classificados = [...VIRA_ANUNCIO, ...NAO_VIRA_ANUNCIO].sort();

    expect(
      classificados,
      `producoes.tipo aceita [${doBanco.join(', ')}] e o código classifica ` +
        `[${classificados.join(', ')}]. Um tipo novo precisa entrar em VIRA_ANUNCIO ` +
        `ou NAO_VIRA_ANUNCIO, em src/features/ads/situacao.ts — decida de que ` +
        `lado ele cai em vez de deixá-lo cair no lado errado em silêncio.`,
    ).toEqual(doBanco);
  });

  it('nenhum tipo está nos dois conjuntos', () => {
    const nos_dois = [...VIRA_ANUNCIO].filter(t => NAO_VIRA_ANUNCIO.has(t));
    expect(nos_dois, `${nos_dois.join(', ')} está em VIRA_ANUNCIO e em NAO_VIRA_ANUNCIO`).toEqual([]);
  });

  it('o tipo declarado em types.ts é o mesmo que o banco aceita', () => {
    const texto = readFileSync(join(SRC, 'features', 'producao', 'components', 'types.ts'), 'utf8');
    const m = texto.match(/export\s+type\s+CriativoTipo\s*=([^;]+);/);
    expect(m, 'não achei CriativoTipo em producao/components/types.ts').toBeTruthy();
    const naUniao = [...m![1].matchAll(/'([a-z_]+)'/gi)].map(x => x[1]).sort();
    expect(naUniao, 'CriativoTipo discorda do CHECK do banco').toEqual(tiposAceitosPeloBanco().sort());
  });

  it('quem pergunta pelo anúncio usa a MESMA regra do vínculo no banco', () => {
    const corpo = corpoDaFuncao('fn_fixar_vinculo_ads');
    const exigidos = [...corpo.matchAll(/tipo\s*=\s*'([a-z_]+)'/gi)].map(x => x[1]);

    expect(
      exigidos.length,
      'fn_fixar_vinculo_ads deixou de restringir o tipo do card. Se o vínculo ' +
        'passou a aceitar outro tipo, VIRA_ANUNCIO em src/features/ads/situacao.ts ' +
        'tem de acompanhar — senão a tela volta a acusar quem não pode responder.',
    ).toBeGreaterThan(0);

    for (const t of new Set(exigidos)) {
      expect(
        rodaComoAnuncio(t),
        `fn_fixar_vinculo_ads liga anúncio a card tipo '${t}', mas VIRA_ANUNCIO ` +
          `não o inclui. As duas definições de "roda como anúncio" divergiram — ` +
          `é a primeira armadilha do CLAUDE.md.`,
      ).toBe(true);
    }
  });

  /*
    O COMPORTAMENTO, E NÃO O TEXTO DO ARQUIVO.

    A primeira versão desta trava era um grep: "arquivo que lê `ads_ligados` e
    escreve 'nunca virou' tem de mencionar `rodaComoAnuncio`". Plantei o defeito
    para conferir — tirei a checagem da célula — e o teste PASSOU, porque a
    palavra continuava no resumo, alguns parágrafos acima. Uma trava que aceita
    qualquer menção em qualquer lugar do arquivo não trava nada.

    `respostaDoAnuncio` existe para isto: a decisão virou uma função pura, e
    aqui ela é interrogada caso a caso. Não há como satisfazer isto por engano.
  */
  describe('respostaDoAnuncio', () => {
    const ONTEM = 1;
    const VELHO = DIAS_DE_CARENCIA + 20;

    for (const tipo of [...NAO_VIRA_ANUNCIO]) {
      it(`'${tipo}' nunca é acusado, por mais antigo que seja`, () => {
        expect(respostaDoAnuncio(tipo, 0, VELHO)).toBe('nao_se_aplica');
        expect(respostaDoAnuncio(tipo, 0, ONTEM)).toBe('nao_se_aplica');
        /* Mesmo que um vínculo apareça por outro caminho, a coluna não passa a
           cobrar deste tipo — quem manda é o tipo, não o dado. */
        expect(respostaDoAnuncio(tipo, 3, VELHO)).toBe('nao_se_aplica');
      });
    }

    for (const tipo of [...VIRA_ANUNCIO]) {
      it(`'${tipo}' com anúncio ligado responde 'tem_anuncio'`, () => {
        expect(respostaDoAnuncio(tipo, 1, VELHO)).toBe('tem_anuncio');
        expect(respostaDoAnuncio(tipo, 1, ONTEM)).toBe('tem_anuncio');
      });

      it(`'${tipo}' sem anúncio espera a carência antes de ser cobrado`, () => {
        expect(respostaDoAnuncio(tipo, 0, ONTEM)).toBe('cedo_demais');
        expect(respostaDoAnuncio(tipo, 0, VELHO)).toBe('nunca_subiu');
      });
    }

    it('a base de anúncio não pode ser refeita à mão em cada tela', () => {
      /*
        CATRACA, e assumidamente uma.

        Em DesempenhoAdsView e DesempenhoTab as taxas vivem dentro de `useMemo`
        de componente — não são funções puras que dê para interrogar daqui sem
        arrastar as duas telas para dentro do teste. O que dá para travar é a
        FORMA: `filtered` é a lista com tudo, `soAnuncio` é a que mede anúncio,
        e só DUAS coisas em cada arquivo têm direito de depender de `filtered`:
        a definição de `soAnuncio` e a tabela "por tipo", que existe justamente
        para mostrar VSL e aula.

        Um `useMemo` novo com `[filtered]` na lista de dependências quebra
        aqui. É o defeito de 21/09/2026 em forma reconhecível: em DesempenhoTab
        os cartões do topo já filtravam criativo e os três gráficos logo abaixo
        não, e ninguém percebeu porque cada memo parecia certo sozinho.
      */
      const telas = [
        { caminho: ['features', 'criativos', 'components', 'DesempenhoAdsView.tsx'], permitidos: 2 },
        { caminho: ['features', 'editores', 'components', 'DesempenhoTab.tsx'],      permitidos: 2 },
      ];

      for (const tela of telas) {
        const texto = readFileSync(join(SRC, ...tela.caminho), 'utf8');
        const nome = tela.caminho.at(-1);

        expect(texto, `${nome} deixou de ter uma base própria para anúncio`).toContain('soAnuncio');

        /* Listas de dependência que contêm `filtered` — e não `filteredSemData`,
           `soAnuncio` nem `soAnuncioSemData`. */
        const deps = [...texto.matchAll(/[)}]\s*,\s*\[([^\]]*)\]\s*,?\s*\)/g)]
          .map(m => m[1].split(',').map(s => s.trim()))
          .filter(lista => lista.includes('filtered'));

        expect(
          deps.length,
          `${nome} tem ${deps.length} useMemo dependendo de \`filtered\`, e o combinado são ` +
            `${tela.permitidos}: a definição de \`soAnuncio\` e a tabela por tipo de peça. ` +
            `Se o novo mede ANÚNCIO, ele tem de sair de \`soAnuncio\` — VSL e aula não viram ` +
            `anúncio e não entram em taxa de anúncio. Se ele é outro quadro por tipo, suba o ` +
            `número aqui e diga por quê.`,
        ).toBe(tela.permitidos);
      }
    });

    it('tipo desconhecido não é acusado — quem não está classificado fica de fora', () => {
      /* Se um quarto tipo nascer no banco e alguém esquecer de classificá-lo, o
         primeiro teste deste arquivo quebra. Até lá, o silêncio é o padrão
         seguro: acusar por omissão é o erro que este arquivo inteiro existe
         para impedir. */
      expect(respostaDoAnuncio('thumbnail', 0, VELHO)).toBe('nao_se_aplica');
      expect(respostaDoAnuncio(null, 0, VELHO)).toBe('nao_se_aplica');
    });
  });
});
