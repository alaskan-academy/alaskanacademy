/**
 * Os tipos de evento, num lugar só.
 *
 * Estavam em quatro: o `type` aqui, o `ROTULO_TIPO`, o `COR_TIPO`, as opções do
 * `<Select>` no formulário e a legenda embaixo do calendário. Acrescentar
 * "recesso" queria dizer lembrar dos cinco — e esquecer um não quebra nada,
 * só faz o tipo novo sumir da legenda ou sair com a cor errada, em silêncio.
 * É a terceira armadilha do CLAUDE.md, em miniatura.
 *
 * Agora tudo deriva daqui. Sobra uma cópia só, a do CHECK em `eventos.tipo`,
 * e o comentário da coluna no banco aponta para cá.
 *
 * As classes são escritas inteiras de propósito: o Tailwind não gera classe
 * montada por interpolação.
 */
export const TIPOS_EVENTO = [
  { chave: 'reuniao', rotulo: 'Reunião', ponto: 'bg-primary',          barra: 'border-l-primary',          paraTodos: false },
  { chave: 'folga',   rotulo: 'Folga',   ponto: 'bg-teal-400',         barra: 'border-l-teal-400',         paraTodos: false },
  { chave: 'feriado', rotulo: 'Feriado', ponto: 'bg-muted-foreground', barra: 'border-l-muted-foreground', paraTodos: true  },
  { chave: 'recesso', rotulo: 'Recesso', ponto: 'bg-amber-400',        barra: 'border-l-amber-400',        paraTodos: true  },
  { chave: 'marco',   rotulo: 'Marco',   ponto: 'bg-violet-400',       barra: 'border-l-violet-400',       paraTodos: false },
] as const;

export type TipoEvento = (typeof TIPOS_EVENTO)[number]['chave'];

/**
 * Os tipos em que a empresa inteira para.
 *
 * Feriado é o que o calendário do país manda; recesso é o que a empresa
 * decide. São coisas diferentes — uma não se escolhe, a outra sim —, mas as
 * duas significam a mesma coisa para quem vai planejar a semana, e por isso as
 * duas avisam com antecedência no Início.
 */
export const TIPOS_QUE_PARAM: string[] = TIPOS_EVENTO.filter(t => t.paraTodos).map(t => t.chave);

/** Linha de `eventos` — o que é combinado e digitado. */
export interface Evento {
  id: string;
  tipo: TipoEvento;
  titulo: string;
  data: string;                    // yyyy-MM-dd — o primeiro dia
  /**
   * Último dia DESTA ocorrência; nulo quer dizer um dia só.
   *
   * Não confundir com `recorrencia_fim`, que é até quando a série se repete:
   * um é quanto tempo o evento dura, o outro é por quanto tempo ele volta.
   */
  data_fim: string | null;
  hora_inicio: string | null;      // HH:mm:ss
  hora_fim: string | null;
  link_call: string | null;
  link_gravacao: string | null;
  pauta: string | null;
  ata: string | null;
  participantes: string[];
  pessoa_id: string | null;
  motivo: string | null;
  recorrencia_tipo: string | null;
  recorrencia_dias_semana: number[] | null;
  recorrencia_fim: string | null;
  /** Datas em que a série não acontece — pular não é excluir. */
  recorrencia_puladas: string[];
  criado_por: string | null;
}

/**
 * O que a agenda desenha. `data` é a data em que ESTE item cai — para um evento
 * recorrente, é diferente de `evento.data`, que é a primeira ocorrência.
 */
export interface ItemAgenda {
  chave: string;
  data: string;
  tipo: TipoEvento;
  titulo: string;
  hora: string | null;
  evento?: Evento;
}

export const ROTULO_TIPO: Record<string, string> =
  Object.fromEntries(TIPOS_EVENTO.map(t => [t.chave, t.rotulo]));

export const COR_TIPO: Record<string, { barra: string; ponto: string }> =
  Object.fromEntries(TIPOS_EVENTO.map(t => [t.chave, { barra: t.barra, ponto: t.ponto }]));

export function horaCurta(h: string | null): string | null {
  return h ? h.slice(0, 5) : null;
}
