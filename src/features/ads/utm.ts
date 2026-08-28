/**
 * O que `fn_utm_agregado` devolve: uma tupla CRUA de UTM, já somada.
 *
 * Crua de propósito. A limpeza dos valores — "FBjLj6a8…" virar "meta ads" —
 * mora em `cleanUtmValue`, na página, e é aplicada depois. Descrever a linha
 * aqui evita o `data as any[]` que o resto do arquivo já tem de sobra, e serve
 * para o dia em que um campo mudar de nome no SQL: o erro aparece na
 * compilação, não numa coluna que ficou zerada.
 *
 * A exceção é `utm_placement`, que vem PRONTO. Ele é enum no banco e o gatilho
 * `fn_campos_data` o deriva de `utm_term`. O front chegou a refazer essa mesma
 * escada de regras em JavaScript, e as duas cópias já divergiam na cauda:
 * `Whatsapp_Status` era `outro` no banco e `whatsapp_status` na tela.
 */
export interface LinhaUtmAgregada {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  /** O valor cru que a Meta mandou, ex.: "Instagram_Stories". */
  utm_term: string | null;
  /** Já classificado pelo banco: feed, stories, reels, marketplace, search, audience_network, outro. */
  utm_placement: string | null;
  produto: string | null;
  vendas_aprovadas: number;
  vendas_pendentes: number;
  vendas_canceladas: number;
  /** Soma de `valor_total` das aprovadas — a mesma definição do resto do dashboard. */
  faturamento: number;
  /** Das aprovadas, as que dizem de QUAL anúncio vieram (`ad_id_meta` preenchido). */
  vendas_com_anuncio: number;
  faturamento_com_anuncio: number;
}

/** Uma tupla já com os valores limpos e as razões refeitas sobre os totais. */
export interface TuplaUtm {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_placement: string;
  produto: string | null;
  vendas_aprovadas: number;
  vendas_pendentes: number;
  vendas_canceladas: number;
  faturamento: number;
  vendas_com_anuncio: number;
  faturamento_com_anuncio: number;
}

/** Uma linha da tabela do drill-down, no nível aberto no momento. */
export interface LinhaNivelUtm {
  name: string;
  displayName: string;
  vendas_aprovadas: number;
  /** Tentativas: aprovadas + pendentes + recusadas. É a base da taxa. */
  tentativas: number;
  faturamento: number;
  taxa_aprovacao_pct: number;
  ticket_medio: number;
}
