/**
 * O que `fn_utm_agregado` devolve: uma tupla CRUA de UTM, já somada.
 *
 * Crua de propósito. A limpeza dos valores — "FBjLj6a8…" virar "meta ads",
 * placement virar rótulo legível — mora em `cleanUtmValue`, na página, e é
 * aplicada depois. Descrever a linha aqui evita o `data as any[]` que o resto
 * do arquivo já tem de sobra, e serve para o dia em que um campo mudar de nome
 * no SQL: o erro aparece na compilação, não numa coluna que ficou zerada.
 */
export interface LinhaUtmAgregada {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  produto: string | null;
  vendas_aprovadas: number;
  vendas_pendentes: number;
  vendas_canceladas: number;
  /** Soma de `valor_oferta_principal` das aprovadas. */
  faturamento: number;
}
