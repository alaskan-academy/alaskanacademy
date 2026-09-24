/**
 * A situação de um objeto da Meta, como ela aparece na tela.
 *
 * A classificação em si mora em `vw_meta_status`, no banco — aqui só há rótulo
 * e cor. Se a regra fosse escrita também em TypeScript, em três meses ela
 * discordaria da view, que é a primeira armadilha do CLAUDE.md.
 *
 * A ORDEM DESTE MAPA É A ORDEM DA TELA, e ela é por quanto pede ação:
 * primeiro o que alguém ligou e não está rodando, depois o que roda, e por
 * último o que foi desligado de propósito.
 */
export const SITUACAO: Record<string, { rotulo: string; ponto: string; selo: string; texto: string; explica: string }> = {
  bloqueado: {
    rotulo: 'Bloqueado',
    ponto: 'bg-red-500',
    selo: 'bg-red-500/15 text-red-400',
    texto: 'text-destructive',
    explica: 'Ligado, mas a Meta barrou — reprovado ou com problema.',
  },
  ativo_nunca_entregou: {
    rotulo: 'Nunca entregou',
    ponto: 'bg-red-400',
    selo: 'bg-red-500/15 text-red-300',
    texto: 'text-red-400',
    explica: 'Ligado e nunca teve uma impressão.',
  },
  ativo_sem_entregar: {
    rotulo: 'Sem entregar',
    ponto: 'bg-amber-400',
    selo: 'bg-amber-500/15 text-amber-300',
    texto: 'text-warning',
    explica: 'Ligado e sem impressão desde ontem — verba, público ou lance.',
  },
  barrado_pelo_pai: {
    rotulo: 'Pai pausado',
    ponto: 'bg-amber-500',
    selo: 'bg-amber-500/15 text-amber-400',
    texto: 'text-warning',
    explica: 'Ligado dentro de um conjunto ou campanha que está pausado.',
  },
  em_analise: {
    rotulo: 'Em análise',
    ponto: 'bg-blue-400',
    selo: 'bg-blue-500/15 text-blue-400',
    texto: 'text-blue-400',
    explica: 'Aguardando a revisão da Meta.',
  },
  rodando: {
    rotulo: 'Rodando',
    ponto: 'bg-emerald-500',
    selo: 'bg-emerald-500/15 text-emerald-400',
    texto: 'text-emerald-400',
    explica: 'Ligado e entregando.',
  },
  /**
   * Desligado, mas entregando até anteontem. É a única fatia de "parado" sobre
   * a qual ainda há o que fazer hoje, e por isso é a única em âmbar.
   *
   * Pintar TODO parado de âmbar foi a primeira ideia e estava errada: dos 5.988
   * parados medidos em 24/09/2026, 5.041 nunca entregaram uma impressão e 845
   * pararam há mais de duas semanas. O aviso teria nascido aceso em 99% dos
   * casos, e aviso sempre aceso o olho para de ver — a mesma razão pela qual o
   * vermelho fica fora da interface no CLAUDE.md.
   *
   * A regra mora em `vw_meta_status`, não aqui: `status <> 'ACTIVE' AND
   * ultima_entrega >= current_date - 7`. Ver a migração 20260924a.
   */
  parado_recente: {
    rotulo: 'Recém-parado',
    ponto: 'bg-amber-500',
    selo: 'bg-amber-500/15 text-amber-400',
    texto: 'text-warning',
    explica: 'Entregava até poucos dias atrás e alguém desligou — o corte é 7 dias.',
  },
  parado: {
    rotulo: 'Parado',
    ponto: 'bg-muted-foreground/40',
    selo: 'bg-secondary text-muted-foreground',
    texto: 'text-muted-foreground',
    explica: 'Desligado, e sem entregar há mais de uma semana.',
  },
  sem_dado: {
    rotulo: 'Sem dado',
    ponto: 'bg-muted-foreground/25',
    selo: 'bg-secondary text-muted-foreground',
    texto: 'text-muted-foreground/70',
    explica: 'A API não confirma mais este objeto — o último estado é passado.',
  },
  /**
   * Não é situação de anúncio: é a AUSÊNCIA de anúncio.
   *
   * Entra aqui porque `vw_producao_estado_ads` resume os anúncios de um card no
   * mesmo vocabulário desta tabela, e um card sem nenhum anúncio ligado precisa
   * de rótulo. Não ocorre em `vw_meta_status`, e por isso fica FORA de
   * `ORDEM_SITUACAO` — senão apareceria como coluna vazia na tela do Meta Ads.
   */
  sem_anuncio: {
    rotulo: 'sem anúncio',
    ponto: 'bg-muted-foreground/25',
    selo: 'bg-secondary text-muted-foreground',
    texto: 'text-muted-foreground/50',
    explica: 'Nenhum anúncio ligado a este card, ou o anúncio sumiu da API.',
  },
};

/**
 * A ordem em que os selos aparecem na tela do Meta Ads: o que pede ação primeiro.
 *
 * NÃO é a ordem de precedência para resumir vários anúncios num card — lá
 * "rodando" ganha de tudo, porque a pergunta é outra ("este criativo ainda está
 * no ar?"). Essa outra ordem mora em `vw_producao_estado_ads`, no banco. Duas
 * ordens porque são duas perguntas; usar esta para resumir faria card com
 * anúncio entregando ler "Pai pausado".
 */
export const ORDEM_SITUACAO = Object.keys(SITUACAO).filter(s => s !== 'sem_anuncio');

/**
 * O que mostrar para uma situação.
 *
 * Valor fora do mapa NÃO some: aparece cru, em cinza. A Meta acrescenta
 * `effective_status` novo sem avisar, a view devolve 'desconhecido' para o que
 * não reconhece, e um rótulo faltando aqui não pode virar linha em branco na
 * tela — terceira armadilha do CLAUDE.md.
 */
export function situacaoDe(s: string | null | undefined) {
  if (!s) return null;
  return SITUACAO[s] ?? {
    rotulo: s,
    ponto: 'bg-muted-foreground/40',
    selo: 'bg-secondary text-muted-foreground',
    texto: 'text-muted-foreground',
    explica: 'Situação que o painel ainda não conhece.',
  };
}

/**
 * De quais tipos de card faz sentido perguntar "virou anúncio?".
 *
 * ── Por que a pergunta não se aplica a aula e VSL ──────────────────────────
 *
 * `fn_fixar_vinculo_ads` — a ÚNICA coisa que escreve em `producao_ads`, e
 * portanto a única origem de `vw_producao_estado_ads` — casa anúncio com card
 * exigindo `p.fase = 'postado' AND p.tipo = 'criativo'`. Uma aula ou uma VSL
 * nunca pode ganhar vínculo, por construção.
 *
 * Logo `ads_ligados = 0` nesses dois tipos não é notícia sobre o trabalho de
 * ninguém: é a regra de vínculo refletida de volta. Medido em 21/09/2026:
 *
 *   criativo   3.784 cards   521 com anúncio   13,8%
 *   aula         221 cards     0 com anúncio    0,0%
 *   vsl           98 cards     0 com anúncio    0,0%
 *
 * A tela "O que eu aprovei" mostrava "nunca virou anúncio" em laranja para uma
 * Aula — acusando alguém de não ter feito algo que o tipo do card nunca faz — e
 * ainda punha os 319 cards de aula e VSL no denominador de "viraram anúncio
 * (x%)", afundando a porcentagem.
 *
 * ── Por que isto é um Set e não `tipo === 'criativo'` espalhado ────────────
 *
 * Porque o projeto tinha QUATRO lugares respondendo "VSL é anúncio?", e eles
 * se dividiam dois a dois — a primeira armadilha do CLAUDE.md:
 *
 *   dizem que É          `CriativoFormModal` (`isAdType = criativo || vsl`)
 *                        `CriativoDrawer` (bloco Veiculação abre para VSL)
 *   dizem que NÃO É      `fn_fixar_vinculo_ads` (`tipo = 'criativo'`)
 *                        as views de esteira (`tipo = 'criativo'`)
 *
 * Ela decidiu em 21/09/2026: **VSL não é anúncio, e quem manda é o vínculo.**
 * Este Set é essa decisão, num lugar só.
 *
 * O que a decisão NÃO significa: que VSL deixa de ser avaliada. Ela continua
 * ganhando `avaliacao` e `status_veiculacao` no formulário, e as 66 já
 * avaliadas continuam gravadas — o julgamento humano da VSL é legítimo, só
 * não é taxa de anúncio. Por isso VSL aparece com os números DELA em "Por
 * tipo de peça", em Criativos → Desempenho e em Editores → Desempenho, ao
 * lado da linha de criativo e nunca dentro dela.
 *
 * `src/test/aula-e-vsl-nao-viram-anuncio.test.ts` trava as pontas: se o banco
 * ganhar um quarto tipo, se alguém afrouxar o vínculo, ou se uma tela montar
 * taxa de anúncio sobre a lista completa, o teste quebra — terceira
 * armadilha, lista no código que envelhece em silêncio.
 */
export const VIRA_ANUNCIO: ReadonlySet<string> = new Set(['criativo']);

/** Os tipos de card de que NÃO se pergunta "virou anúncio?". Ver `VIRA_ANUNCIO`. */
export const NAO_VIRA_ANUNCIO: ReadonlySet<string> = new Set(['aula', 'vsl']);

/**
 * Este card pode ter anúncio ligado?
 *
 * `false` significa "a pergunta não se aplica", nunca "a resposta é não" — a
 * distinção é a diferença entre um traço cinza e uma acusação em laranja.
 */
export function rodaComoAnuncio(tipo: string | null | undefined): boolean {
  return !!tipo && VIRA_ANUNCIO.has(tipo);
}

/** O estado de um objeto, como a tela do Meta Ads precisa dele. */
export interface EstadoDoObjeto {
  nivel: string;
  objeto_id: string;
  situacao: string;
  status: string | null;
  effective_status: string | null;
  dias_sem_entregar: number | null;
}

/** A chave que casa `vw_meta_status` com as linhas de `metricas_meta`. */
export function chaveEstado(nivel: string, objetoId: string) {
  return `${nivel}|${objetoId}`;
}
