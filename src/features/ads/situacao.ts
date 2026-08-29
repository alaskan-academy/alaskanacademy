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
export const SITUACAO: Record<string, { rotulo: string; ponto: string; selo: string; explica: string }> = {
  bloqueado: {
    rotulo: 'Bloqueado',
    ponto: 'bg-red-500',
    selo: 'bg-red-500/15 text-red-400',
    explica: 'Ligado, mas a Meta barrou — reprovado ou com problema.',
  },
  ativo_nunca_entregou: {
    rotulo: 'Nunca entregou',
    ponto: 'bg-red-400',
    selo: 'bg-red-500/15 text-red-300',
    explica: 'Ligado e nunca teve uma impressão.',
  },
  ativo_sem_entregar: {
    rotulo: 'Sem entregar',
    ponto: 'bg-amber-400',
    selo: 'bg-amber-500/15 text-amber-300',
    explica: 'Ligado e sem impressão desde ontem — verba, público ou lance.',
  },
  barrado_pelo_pai: {
    rotulo: 'Pai pausado',
    ponto: 'bg-amber-500',
    selo: 'bg-amber-500/15 text-amber-400',
    explica: 'Ligado dentro de um conjunto ou campanha que está pausado.',
  },
  em_analise: {
    rotulo: 'Em análise',
    ponto: 'bg-blue-400',
    selo: 'bg-blue-500/15 text-blue-400',
    explica: 'Aguardando a revisão da Meta.',
  },
  rodando: {
    rotulo: 'Rodando',
    ponto: 'bg-emerald-500',
    selo: 'bg-emerald-500/15 text-emerald-400',
    explica: 'Ligado e entregando.',
  },
  parado: {
    rotulo: 'Parado',
    ponto: 'bg-muted-foreground/40',
    selo: 'bg-secondary text-muted-foreground',
    explica: 'Alguém desligou.',
  },
  sem_dado: {
    rotulo: 'Sem dado',
    ponto: 'bg-muted-foreground/25',
    selo: 'bg-secondary text-muted-foreground',
    explica: 'A API não confirma mais este objeto — o último estado é passado.',
  },
};

/** A ordem em que os selos aparecem: o que pede ação primeiro. */
export const ORDEM_SITUACAO = Object.keys(SITUACAO);

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
    explica: 'Situação que o painel ainda não conhece.',
  };
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
