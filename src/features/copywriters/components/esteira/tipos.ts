/**
 * O que a Esteira lê do banco.
 *
 * A regra de "o que é novo e o que é variação" NÃO mora aqui: mora na tabela
 * `criativo_tipos_teste` e na view `vw_esteira_lotes`. Se ela fosse escrita
 * também em TypeScript, em três meses discordaria da Produção — é a primeira
 * armadilha do CLAUDE.md, dois lugares dizendo a mesma coisa até divergirem.
 * Aqui só há tipos e rótulos.
 */

/** Um lote: (projeto, número do AD, tipo_teste). Ver a migração para o porquê. */
export interface Lote {
  projeto_id: string | null;
  projeto: string | null;
  projeto_ativo: boolean;
  ad_num: number;
  tipo_teste: string | null;
  familia: 'novo' | 'variacao' | 'sem_tipo' | 'outro';
  funil: string | null;
  cards: number;
  hooks: number;
  cards_totais: number;
  hooks_totais: number;
  fase: string;
  fases: string[];
  comecou_em: string | null;
  mexido_em: string | null;
  dias_parado: number | null;
}

/** Uma linha por projeto ativo, de `fn_esteira_defasagem()`. */
export interface Defasagem {
  projeto_id: string;
  projeto: string | null;
  empresa: string | null;
  ads_novo: number;
  cards_novo: number;
  novo_dias: number | null;
  ads_variacao: number;
  cards_variacao: number;
  variacao_dias: number | null;
  falta_novo: boolean;
  falta_variacao: boolean;
  /** 0 = falta tudo · 1 = falta um lado · 2 = ok */
  prioridade: number;
  sug_ad: number | null;
  sug_hook: number | null;
  sug_funil: string | null;
  sug_validado_em: string | null;
  sug_total: number;
  /**
   * O TSL/VSL do projeto, para o alerta de "falta novo" dizer para qual funil
   * escrever. Sai de `funil_video`, que é a única fonte que existe: `funis.metodo`
   * diria isso melhor, mas `producoes.funil_id` e `funil_ids` estão vazios em
   * 131 de 131 cards da esteira.
   */
  funis_projeto: string | null;
}

export const FAMILIA_LABEL: Record<string, string> = {
  novo:     'Novo',
  variacao: 'Variação',
  sem_tipo: 'Sem tipo de teste',
  outro:    'Tipo não mapeado',
};

/** `AD 045`, com o zero à esquerda que a operação usa nos nomes. */
export function rotuloDoAd(n: number): string {
  return `AD ${String(n).padStart(3, '0')}`;
}

/** `AD 045 H04`, ou só o AD quando o hook não veio no nome. */
export function rotuloDoAdHook(ad: number, hook: number | null): string {
  return hook == null ? rotuloDoAd(ad) : `${rotuloDoAd(ad)} H${String(hook).padStart(2, '0')}`;
}

/**
 * Quanto tempo um lote está parado, em palavras.
 *
 * Zero dias não é "parado há 0 dias", é "hoje" — e o clamp na view faz com que
 * um card agendado para amanhã também caia aqui.
 */
export function rotuloDeDias(dias: number | null): string {
  if (dias == null) return 'sem data';
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  if (dias < 365) return `há ${Math.round(dias / 30)} meses`;
  const anos = Math.floor(dias / 365);
  return anos === 1 ? 'há mais de 1 ano' : `há mais de ${anos} anos`;
}

/**
 * A partir de quantos dias um lote deixa de ser estoque e vira entulho.
 *
 * Não é uma regra do negócio, é um limiar de LEITURA: o estoque foi definido
 * como "tudo que não está postado", sem janela de tempo, e sem isto um card
 * esquecido em briefing calaria o alerta daquele projeto para sempre. O painel
 * continua contando o lote velho — só não deixa ele passar despercebido.
 */
export const DIAS_PARA_VELHO = 60;
