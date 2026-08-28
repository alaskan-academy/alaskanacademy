export type TipoEvento = 'reuniao' | 'folga' | 'feriado' | 'marco';

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

export const ROTULO_TIPO: Record<string, string> = {
  reuniao: 'Reunião',
  folga: 'Folga',
  feriado: 'Feriado',
  marco: 'Marco',
};

/**
 * Cor por tipo, em classes do Tailwind que já existem no projeto — nada de
 * classe montada por interpolação, que o Tailwind não gera.
 */
export const COR_TIPO: Record<string, { barra: string; ponto: string }> = {
  reuniao:   { barra: 'border-l-primary',      ponto: 'bg-primary' },
  folga:     { barra: 'border-l-teal-400',     ponto: 'bg-teal-400' },
  feriado:   { barra: 'border-l-muted-foreground', ponto: 'bg-muted-foreground' },
  marco:     { barra: 'border-l-violet-400',   ponto: 'bg-violet-400' },
};

export function horaCurta(h: string | null): string | null {
  return h ? h.slice(0, 5) : null;
}
