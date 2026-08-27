/**
 * A fila do Gestor de Tráfego.
 *
 * A classificação (projeto → funil → família) NÃO é recalculada aqui: vem de
 * `vw_gestor_fila`, que usa `criativo_tipos_teste` e `fn_funil_video_norm` —
 * as mesmas da Esteira do Copy. Se este painel decidisse por conta própria o
 * que é iteração, em três meses os dois discordariam, e é literalmente a
 * primeira armadilha do CLAUDE.md.
 */

export interface CardDaFila {
  id: string;
  nome: string;
  fase: 'aprovado' | 'esteira_teste';
  tipo: string;
  tipo_teste: string | null;
  familia: 'novo' | 'iteracao' | 'variacao' | 'sem_tipo' | 'outro';
  funil: string | null;
  ad_num: number | null;
  hook: number | null;
  projeto_id: string | null;
  projeto: string | null;
  projeto_ativo: boolean;
  data_inicio: string | null;
  data_prazo: string | null;
  editor: string | null;
  video_editado_url: string | null;
  entrou_na_fase_em: string | null;
  dias_na_fase: number | null;
}

/**
 * Um AD: os hooks de um mesmo `(projeto, número, tipo_teste)`.
 *
 * É a unidade que ele seleciona — "mandar o AD 052 para teste" leva os cinco
 * hooks. O card continua acessível para quem quiser mandar só o H02 e o H04.
 */
export interface AdAgrupado {
  chave: string;
  ad_num: number | null;
  tipo_teste: string | null;
  familia: string;
  cards: CardDaFila[];
  /** O maior tempo de espera entre os hooks — o AD está parado desde o pior. */
  dias: number;
}

export const FAMILIA_ORDEM: Record<string, number> = {
  novo: 1, iteracao: 2, variacao: 3, sem_tipo: 8, outro: 9,
};

export const FAMILIA_LABEL: Record<string, string> = {
  novo: 'Novo', iteracao: 'Iteração', variacao: 'Variação',
  sem_tipo: 'Sem tipo de teste', outro: 'Tipo não mapeado',
};

export const FAMILIA_SELO: Record<string, string> = {
  novo:     'bg-primary/15 text-primary',
  iteracao: 'bg-emerald-500/15 text-emerald-400',
  variacao: 'bg-blue-500/15 text-blue-400',
  sem_tipo: 'bg-amber-500/15 text-amber-400',
  outro:    'bg-amber-500/15 text-amber-400',
};

/**
 * A partir de quantos dias um aprovado deixa de ser fila e vira esquecimento.
 *
 * Não é regra de negócio: é um limiar de leitura. Hoje há 33 cards esperando
 * há cerca de um ANO — se eles aparecerem iguais aos de ontem, a fila volta a
 * ser o que era, uma lista onde as coisas somem.
 */
export const DIAS_PARA_ESQUECIDO = 60;

export function rotuloDoAd(n: number | null): string {
  return n == null ? '—' : `AD ${String(n).padStart(3, '0')}`;
}

export function rotuloDeDias(dias: number | null): string {
  if (dias == null) return 'sem data';
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  if (dias < 365) return `há ${Math.round(dias / 30)} meses`;
  const anos = Math.floor(dias / 365);
  return anos === 1 ? 'há mais de 1 ano' : `há mais de ${anos} anos`;
}

/** `AD 052 H03` — o nome curto que a operação usa. */
export function rotuloDoHook(c: CardDaFila): string {
  return c.hook == null ? c.nome : `H${String(c.hook).padStart(2, '0')}`;
}

/**
 * Agrupa os cards de um mesmo tipo de teste em ADs.
 *
 * A chave inclui o `tipo_teste` porque a variação HERDA o número do AD: o
 * AD 045 pode estar na fila como Iteração e como Vertical ao mesmo tempo, e
 * são duas entregas diferentes.
 */
export function agruparEmAds(cards: CardDaFila[]): AdAgrupado[] {
  const mapa = new Map<string, CardDaFila[]>();
  for (const c of cards) {
    const k = `${c.ad_num ?? 'x'}|${c.tipo_teste ?? ''}`;
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k)!.push(c);
  }
  return Array.from(mapa, ([chave, cs]) => ({
    chave,
    ad_num: cs[0].ad_num,
    tipo_teste: cs[0].tipo_teste,
    familia: cs[0].familia,
    cards: cs.sort((a, b) => (a.hook ?? 99) - (b.hook ?? 99)),
    dias: Math.max(...cs.map(c => c.dias_na_fase ?? 0)),
  })).sort((a, b) => (b.ad_num ?? 0) - (a.ad_num ?? 0));
}
