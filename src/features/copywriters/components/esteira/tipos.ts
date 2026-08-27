/**
 * O que a Esteira lê do banco.
 *
 * A regra de "o que é novo, iteração e variação" NÃO mora aqui: mora na tabela
 * `criativo_tipos_teste` e na view `vw_esteira_lotes`. Se ela fosse escrita
 * também em TypeScript, em três meses discordaria da Produção — é a primeira
 * armadilha do CLAUDE.md, dois lugares dizendo a mesma coisa até divergirem.
 * Aqui só há tipos e rótulos.
 */

export type Familia = 'novo' | 'iteracao' | 'variacao' | 'sem_tipo' | 'outro';

/** Um lote: (projeto, número do AD, tipo_teste). Ver a migração para o porquê. */
export interface Lote {
  projeto_id: string | null;
  projeto: string | null;
  projeto_ativo: boolean;
  ad_num: number;
  tipo_teste: string | null;
  familia: Familia;
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

/**
 * Uma linha por (projeto ativo com verba, FUNIL).
 *
 * TSL e VSL são contas separadas: um mesmo projeto pode estar abastecido de um
 * lado e vazio do outro, e somar os dois esconde isso — a Saponaria aparecia
 * com "42% novo" quando o TSL estava em 33% e o VSL em 20%, ou seja, nenhum dos
 * dois. Um lote marcado "TSL+VSL" conta nos dois; um lote sem funil não conta
 * em nenhum, porque ninguém sabe qual ele serve.
 *
 * Projeto sem verba não entra — não tem defasagem de criativo, tem outra
 * conversa. São 4 dos 7 ativos hoje.
 */
export interface Defasagem {
  projeto_id: string;
  projeto: string | null;
  empresa: string | null;
  funil: string;
  /** Fica no tipo porque ORDENA a lista — mas não é exibido. */
  inv_7d: number | null;
  inv_30d: number | null;
  ads_novo: number;
  ads_iteracao: number;
  ads_variacao: number;
  cards_novo: number;
  cards_iteracao: number;
  cards_variacao: number;
  novo_dias: number | null;
  iteracao_dias: number | null;
  variacao_dias: number | null;
  falta_novo: boolean;
  falta_iteracao: boolean;
  falta_variacao: boolean;
  pct_novo: number;
  pct_novo_meta: number;
  mix_estourado: boolean;
  /** 0 vazio · 1 falta iteração · 2 falta variação · 3 mix estourado · 4 falta novo · 5 ok */
  prioridade: number;
  sug_ad: number | null;
  sug_hook: number | null;
  sug_validado_em: string | null;
  /** Ordena a sugestão (o que mais recebeu verba), mas não é exibido. */
  sug_investido: number | null;
  sug_total: number;
  /**
   * Lotes do projeto sem funil informado — não entram na conta de nenhum funil.
   * São 19 dos 38 hoje, e é por isso que este número precisa aparecer.
   */
  lotes_sem_funil: number;
}

/** Um pedido de variação, com o dinheiro do AD ao lado. */
export interface Pedido {
  id: string;
  producao_id: string;
  status: 'aberto' | 'atendido' | 'descartado';
  urgencia: 'alta' | 'media' | 'baixa';
  por_que: string;
  o_que_melhorar: string | null;
  tipo_sugerido: string | null;
  criado_em: string;
  atendido_em: string | null;
  nota_fechamento: string | null;
  dias_aberto: number;
  criativo: string;
  ad_num: number | null;
  hook: number | null;
  funil: string | null;
  avaliacao: string | null;
  projeto_id: string | null;
  projeto: string | null;
  projeto_ativo: boolean;
  solicitado_por_nome: string | null;
  atendido_por_nome: string | null;
  card_que_atendeu: string | null;
  inv_30d: number | null;
  roas_30d: number | null;
  ultimo_dia_com_gasto: string | null;
  /** Surgiu variação deste (AD, hook) depois do pedido. A fila sugere fechar. */
  ja_tem_variacao: boolean;
}

export const FAMILIA_LABEL: Record<string, string> = {
  novo:     'Novo',
  iteracao: 'Iteração',
  variacao: 'Variação',
  sem_tipo: 'Sem tipo de teste',
  outro:    'Tipo não mapeado',
};

export const URGENCIA_LABEL: Record<string, string> = {
  alta: 'Alta', media: 'Média', baixa: 'Baixa',
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
