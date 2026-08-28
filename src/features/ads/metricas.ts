/**
 * O que `fn_metricas_meta_agregado` devolve.
 *
 * Duas telas leem a mesma função — Meta Ads e Análise de Ads — e as duas
 * faziam `data as any[]`. Descrever a linha uma vez custa menos que dois
 * `any`, e o `any` aqui não seria de graça: é justamente a checagem que diria
 * "esse campo mudou de nome no SQL" antes de a tela mostrar zero.
 *
 * Só as colunas SOMÁVEIS moram aqui. As razões (CTR, CPM, ROAS…) não vêm do
 * banco de propósito: razão de um dia não se soma, então quem agrega
 * recalcula, e a fórmula existe num lugar só.
 */
export interface LinhaMetricaMeta {
  nivel: 'campanha' | 'adset' | 'ad';
  nivel_id: string;
  /** Campanha do conjunto, conjunto do anúncio. Nulo na campanha. */
  parent_id: string | null;
  nome: string | null;
  produto: string | null;
  campanha_nome: string | null;
  adset_nome: string | null;
  impressoes: number;
  alcance: number;
  cliques: number;
  cliques_link: number;
  investimento: number;
  compras_meta: number;
  /** Atribuição do Meta, não a venda registrada na Payt. */
  faturamento_atribuido: number;
  initiate_checkout: number;
  visualizacoes_pagina: number;
  video_plays: number;
  video_3s: number;
  video_75pct: number;
}
