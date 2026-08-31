import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { diasOcupados } from '@/lib/recorrencia';
import { TIPOS_EVENTO, TIPOS_QUE_PARAM } from '@/features/inicio/types';

/**
 * Quem não está, nos dias em que não está — para o calendário da Produção.
 *
 * POR QUE EXISTE
 *
 * A folga é marcada na Agenda do Início e só era vista lá. Quem monta o
 * cronograma trabalha no calendário da Produção, e nada naquela tela dizia que
 * a pessoa não estaria: dava para pôr entrega no dia de folga de alguém sem
 * nenhum aviso, e só descobrir no dia.
 *
 * Erro que se descobre no dia é o mais caro: já custou o dia.
 *
 * FERIADO E RECESSO ENTRAM JUNTO
 *
 * Ela pediu a folga, mas o motivo vale mais ainda para os dias em que a empresa
 * INTEIRA para — e esses já estão na mesma tabela, com o mesmo formato. Deixá-los
 * de fora seria resolver o caso menor e manter o maior. A lista de quais tipos
 * param todo mundo sai de `TIPOS_QUE_PARAM`, que já existe: um tipo novo entra
 * sozinho, em vez de precisar ser lembrado aqui.
 *
 * A RECORRÊNCIA NÃO É REIMPLEMENTADA
 *
 * `diasOcupados` de `@/lib/recorrencia` é o mesmo que a Agenda e o RotinaCalendar
 * usam. Uma segunda expansão de série neste arquivo seria dois modelos de
 * recorrência no mesmo produto — e um deles estaria errado.
 */

export interface Ausencia {
  id: string;
  tipo: string;
  titulo: string;
  /** Nulo em feriado e recesso: não é de ninguém, é de todo mundo. */
  pessoa_id: string | null;
  paraTodos: boolean;
}

const CHAVE_PARA_TIPO = new Map(TIPOS_EVENTO.map(t => [t.chave as string, t]));

/** Os tipos que interessam ao cronograma: a folga de alguém e o que para todos. */
const TIPOS_DE_AUSENCIA = ['folga', ...TIPOS_QUE_PARAM];

interface LinhaEvento {
  id: string;
  tipo: string;
  titulo: string;
  data: string;
  data_fim: string | null;
  pessoa_id: string | null;
  recorrencia_tipo: string | null;
  recorrencia_dias_semana: number[] | null;
  recorrencia_fim: string | null;
  recorrencia_puladas: string[] | null;
}

const COLUNAS =
  'id,tipo,titulo,data,data_fim,pessoa_id,recorrencia_tipo,recorrencia_dias_semana,recorrencia_fim,recorrencia_puladas';

/**
 * As ausências de uma janela, já expandidas por dia.
 *
 * Duas consultas em vez de uma porque as condições são de naturezas diferentes,
 * e espremê-las num `or` só produziria um filtro ilegível e frouxo:
 *
 *   evento de data fixa   precisa CRUZAR a janela
 *   série recorrente      precisa ter começado antes do fim da janela e não ter
 *                         terminado antes do começo dela
 *
 * Buscar tudo e filtrar no cliente seria mais simples hoje — são 9 eventos —
 * e viraria um problema calado quando as folgas de um ano se acumularem e o
 * PostgREST cortar em 1.000 linhas sem avisar.
 */
export function useAusencias(inicioJanela: string, fimJanela: string) {
  const [porDia, setPorDia] = useState<Map<string, Ausencia[]>>(new Map());

  useEffect(() => {
    if (!inicioJanela || !fimJanela) return;
    let vivo = true;

    void (async () => {
      const [fixos, series] = await Promise.all([
        supabase.from('eventos').select(COLUNAS)
          .in('tipo', TIPOS_DE_AUSENCIA)
          .is('recorrencia_tipo', null)
          .lte('data', fimJanela)
          // Evento de vários dias cruza a janela pelo fim; o de um dia, pela
          // própria data.
          .or(`data_fim.gte.${inicioJanela},and(data_fim.is.null,data.gte.${inicioJanela})`),
        supabase.from('eventos').select(COLUNAS)
          .in('tipo', TIPOS_DE_AUSENCIA)
          .not('recorrencia_tipo', 'is', null)
          .lte('data', fimJanela)
          .or(`recorrencia_fim.is.null,recorrencia_fim.gte.${inicioJanela}`),
      ]);

      if (!vivo) return;
      if (fixos.error)  console.error('ausencias (fixos):', fixos.error.message);
      if (series.error) console.error('ausencias (series):', series.error.message);

      const linhas = [
        ...((fixos.data ?? []) as unknown as LinhaEvento[]),
        ...((series.data ?? []) as unknown as LinhaEvento[]),
      ];

      const mapa = new Map<string, Ausencia[]>();
      for (const e of linhas) {
        const cfg = CHAVE_PARA_TIPO.get(e.tipo);
        const ausencia: Ausencia = {
          id: e.id,
          tipo: e.tipo,
          titulo: e.titulo,
          pessoa_id: e.pessoa_id,
          paraTodos: cfg?.paraTodos ?? false,
        };
        const dias = diasOcupados(
          {
            inicio: e.data,
            recorrencia_tipo: e.recorrencia_tipo,
            recorrencia_dias_semana: e.recorrencia_dias_semana,
            recorrencia_fim: e.recorrencia_fim,
            recorrencia_puladas: e.recorrencia_puladas,
            data_fim: e.data_fim,
          },
          inicioJanela,
          fimJanela,
        );
        for (const d of dias) {
          if (!mapa.has(d)) mapa.set(d, []);
          mapa.get(d)!.push(ausencia);
        }
      }

      setPorDia(mapa);
    })();

    return () => { vivo = false; };
  }, [inicioJanela, fimJanela]);

  return porDia;
}

/** A cor do tipo, vinda de `TIPOS_EVENTO` — nunca escrita de novo aqui. */
export function pontoDoTipo(tipo: string): string {
  return CHAVE_PARA_TIPO.get(tipo)?.ponto ?? 'bg-muted-foreground';
}

export function rotuloDoTipo(tipo: string): string {
  return CHAVE_PARA_TIPO.get(tipo)?.rotulo ?? tipo;
}
