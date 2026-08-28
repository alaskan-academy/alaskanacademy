/**
 * As categorias de área do Laboratório, num lugar só.
 *
 * Estavam copiadas em três arquivos — `RadarPage`, `ReferenciasPage` e
 * `RadarConfigTab` — mais duas vezes nas Edge Functions do Sheets. Primeira
 * armadilha do CLAUDE.md na forma mais literal: cinco listas dizendo a mesma
 * coisa, e a sexta cópia é sempre a que esquece um item.
 *
 * `radar_areas.categoria` é texto livre no banco, então isto aqui é rótulo, não
 * validação: quem lê usa `CATEGORIA_LABEL[cat] ?? cat`, e uma categoria nova
 * aparece com o próprio nome em vez de sumir da tela.
 */

export const CATEGORIAS = [
  { value: 'trafego',        label: 'Tráfego' },
  { value: 'criativo',       label: 'Criativo' },
  { value: 'funil_oferta',   label: 'Funil & Oferta' },
  { value: 'produto',        label: 'Produto' },
  { value: 'relacionamento', label: 'Relacionamento' },
  { value: 'interno',        label: 'Interno' },
] as const;

export const CATEGORIA_LABEL: Record<string, string> =
  Object.fromEntries(CATEGORIAS.map(c => [c.value, c.label]));
