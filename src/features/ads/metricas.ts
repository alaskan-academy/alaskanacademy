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

/**
 * Uma linha já com as razões calculadas — o que a tabela desenha.
 *
 * Ela existe porque a linha de TOTAL do rodapé passa pelo mesmo caminho das
 * linhas comuns: soma as contagens e refaz as razões com a mesma função. Sem
 * um tipo para o resultado, os dois lados ficariam em `any` e um campo
 * renomeado passaria batido até virar coluna vazia na tela.
 *
 * `nivel` e `nivel_id` são opcionais porque o total não pertence a nível
 * nenhum: ele é a soma do que está na tela.
 */
export interface LinhaCalculada extends Partial<LinhaMetricaMeta> {
  nome: string | null;
  impressoes: number;
  cliques: number;
  investimento: number;
  compras_meta: number;
  faturamento_atribuido: number;
  initiate_checkout: number;
  visualizacoes_pagina: number;
  video_plays: number;
  video_3s: number;
  video_75pct: number;
  /** Faturamento atribuído − gasto. Não desconta taxa nem imposto. */
  resultado: number;
  margem: number;
  roas: number;
  cpa: number;
  ctr: number;
  cpm: number;
  cpc: number;
  taxa_video_3s: number;
  taxa_video_75pct: number;
  taxa_compras_video75: number;
  taxa_ic: number;
  custo_por_ic: number;
  taxa_conv_checkout: number;
  taxa_conexao: number;
  custo_por_vis_pagina: number;
  taxa_vendas_vis_pagina: number;
}
