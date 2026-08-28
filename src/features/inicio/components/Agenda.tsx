import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { toYMD } from '@/lib/recorrencia';
import { COR_TIPO, type ItemAgenda } from '../types';

/** As 42 células do mês, começando na segunda — como o mockup e como o RotinaCalendar. */
function gradeDoMes(ano: number, mes: number): Date[] {
  const primeiro = new Date(ano, mes, 1);
  const inicio = new Date(ano, mes, 1 - ((primeiro.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) =>
    new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i));
}

function agrupar(itens: ItemAgenda[]): Record<string, ItemAgenda[]> {
  const m: Record<string, ItemAgenda[]> = {};
  itens.forEach(i => { (m[i.data] = m[i.data] ?? []).push(i); });
  Object.values(m).forEach(lista => lista.sort((a, b) => (a.hora ?? '99').localeCompare(b.hora ?? '99')));
  return m;
}

/**
 * A agenda do mês.
 *
 * Havia também uma vista de semana, e ela era o padrão: com 6 pessoas o mês
 * ficava quase vazio e comunicava "isto aqui está morto". Com os feriados do
 * país dentro, o mês deixou de ser vazio — e é ele que responde a pergunta que
 * se faz aqui, que é "quando dá para contar com a equipe".
 *
 * Não há régua de horas: duas ou três reuniões por semana não justificam uma
 * faixa das 8h às 20h com 90% de vazio.
 */
export function Agenda({
  ancora, itens, hoje, onAbrir, onNovoNoDia,
}: {
  ancora: Date;
  itens: ItemAgenda[];
  hoje: string;
  onAbrir: (item: ItemAgenda) => void;
  onNovoNoDia?: (data: string) => void;
}) {
  const porDia = useMemo(() => agrupar(itens), [itens]);

  const celulas = gradeDoMes(ancora.getFullYear(), ancora.getMonth());

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px]">
        <div className="mb-1.5 grid grid-cols-7 gap-1.5">
          {['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map(r => (
            <span key={r} className="pb-1 text-center font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {r}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1.5">
          {celulas.map(d => {
            const ymd = toYMD(d);
            const noMes = d.getMonth() === ancora.getMonth();
            const ehHoje = ymd === hoje;
            const lista = noMes ? (porDia[ymd] ?? []) : [];

            return (
              <div
                key={ymd}
                className={cn(
                  'flex min-h-[80px] flex-col gap-0.5 rounded-lg border p-1.5',
                  ehHoje ? 'border-primary bg-primary/5' : 'border-border',
                  !noMes && 'opacity-35',
                )}
              >
                <span className={cn(
                  'text-[11px] font-semibold tabular-nums',
                  ehHoje ? 'text-primary' : 'text-muted-foreground',
                )}>{d.getDate()}</span>

                {lista.length === 0 && noMes && onNovoNoDia && (
                  <button
                    type="button"
                    onClick={() => onNovoNoDia(ymd)}
                    className="flex-1 rounded px-1 text-left font-mono text-[10px] text-transparent hover:bg-muted hover:text-muted-foreground"
                  >
                    + novo
                  </button>
                )}

                {lista.slice(0, 3).map(item => (
                  <button
                    key={item.chave}
                    type="button"
                    onClick={() => onAbrir(item)}
                    className="flex w-full items-center gap-1.5 overflow-hidden rounded px-1 py-0.5 text-left text-[10.5px] leading-tight text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', COR_TIPO[item.tipo]?.ponto ?? 'bg-primary')} />
                    <span className="truncate">{item.titulo}</span>
                  </button>
                ))}

                {lista.length > 3 && (
                  <span className="px-1 font-mono text-[10px] text-muted-foreground">
                    +{lista.length - 3}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
