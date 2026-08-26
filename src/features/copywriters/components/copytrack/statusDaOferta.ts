/**
 * Os status de uma oferta do CopyTrack, em UM lugar só.
 *
 * Estavam escritos em quatro, e os quatro discordavam: o CHECK do banco aceita
 * `monitorando`, `acompanhando` e `descartada`; o modal de editar oferecia
 * `acompanhando`, `ativo`, `pausado` e `arquivado`; o filtro da tabela oferecia
 * cinco; e o mapa de badges, outros cinco.
 *
 * O preço foi um erro de banco na cara de quem usa — trocar uma oferta para
 * "Ativo" quebrava com `violates check constraint`, porque `ativo` nunca
 * existiu em lugar nenhum além daquele dropdown. E o contrário também: as 7
 * ofertas `descartada` não tinham badge, não apareciam no filtro e não podiam
 * ser escolhidas no modal — dado real que a tela não sabia mostrar nem editar.
 *
 * É a armadilha nº 3 do CLAUDE.md com quatro cópias em vez de uma: lista fixa
 * no código que envelhece em silêncio. Enquanto os três valores viverem num
 * CHECK e não numa tabela, esta constante é o espelho dele — e `statusDaOferta`
 * abaixo é o que impede a tela de sumir com um valor que o banco ganhe depois.
 */

export interface StatusDaOferta {
  valor: string;
  label: string;
  /** Como o badge se pinta na lista. */
  cls: string;
  /** Se a linha inteira ganha destaque: é o que ela está de olho agora. */
  destaque?: boolean;
}

export const STATUS_OFERTA: StatusDaOferta[] = [
  {
    valor: 'acompanhando', label: 'Acompanhando', destaque: true,
    cls: 'bg-violet-500 text-white dark:bg-violet-500 dark:text-white',
  },
  {
    valor: 'monitorando', label: 'Monitorando',
    cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
  },
  {
    valor: 'descartada', label: 'Descartada',
    cls: 'bg-muted text-muted-foreground',
  },
];

/** O padrão de quem nasce: entra sendo observada, não sendo seguida de perto. */
export const STATUS_PADRAO = 'monitorando';

/**
 * O status de uma linha, mesmo quando o banco tem um valor que esta lista não
 * conhece.
 *
 * Devolver um desconhecido em vez de `undefined` é o que evita repetir o
 * defeito ao contrário: uma oferta com status novo continuaria visível e
 * editável, com o valor cru no badge, em vez de sumir da tela sem aviso. Foi
 * assim que `descartada` ficou invisível por meses.
 */
export function statusDaOferta(valor: string | null): StatusDaOferta {
  const conhecido = STATUS_OFERTA.find(s => s.valor === valor);
  if (conhecido) return conhecido;
  return {
    valor: valor ?? STATUS_PADRAO,
    label: valor ?? 'sem status',
    cls: 'bg-muted text-muted-foreground',
  };
}

/**
 * As opções de um seletor, incluindo o valor atual quando ele não está na
 * lista — senão o Select abriria vazio e salvar trocaria o status sem querer.
 */
export function opcoesComAtual(atual: string | null): StatusDaOferta[] {
  if (!atual || STATUS_OFERTA.some(s => s.valor === atual)) return STATUS_OFERTA;
  return [...STATUS_OFERTA, statusDaOferta(atual)];
}
