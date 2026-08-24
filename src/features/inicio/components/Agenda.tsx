import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { toYMD, segundaDa } from '@/lib/recorrencia';
import { COR_TIPO, type ItemAgenda } from '../types';

const DIA_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

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
 * A agenda em semana ou mês.
 *
 * Semana é o padrão de propósito: com 6 pessoas o grid mensal fica quase vazio
 * e comunica "isto aqui está morto". E não há régua de horas — duas ou três
 * reuniões por semana não justificam uma faixa das 8h às 20h com 90% de vazio.
 */
export function Agenda({
  vista, ancora, itens, hoje, onAbrir, onNovoNoDia,
}: {
  vista: 'semana' | 'mes';
  ancora: Date;
  itens: ItemAgenda[];
  hoje: string;
  onAbrir: (item: ItemAgenda) => void;
  onNovoNoDia?: (data: string) => void;
}) {
  const porDia = useMemo(() => agrupar(itens), [itens]);

  if (vista === 'semana') {
    const seg = segundaDa(ancora);
    const dias = Array.from({ length: 7 }, (_, i) =>
      new Date(seg.getFullYear(), seg.getMonth(), seg.getDate() + i));

    return (
      <div className="overflow-x-auto">
        <div className="grid min-w-[780px] grid-cols-7 gap-2">
          {dias.map(d => {
            const ymd = toYMD(d);
            const lista = porDia[ymd] ?? [];
            const ehHoje = ymd === hoje;
            const fds = d.getDay() === 0 || d.getDay() === 6;

            return (
              <div key={ymd} className="flex flex-col gap-1.5">
                <div className={cn(
                  'flex items-baseline gap-1.5 border-b px-0.5 pb-1.5',
                  ehHoje ? 'border-primary' : 'border-border',
                )}>
                  <span className={cn(
                    'font-mono text-[10px] uppercase tracking-wider',
                    ehHoje ? 'text-primary' : 'text-muted-foreground',
                  )}>{DIA_CURTO[d.getDay()]}</span>
                  <span className={cn(
                    'text-sm font-semibold tabular-nums',
                    ehHoje ? 'text-primary' : fds ? 'text-muted-foreground' : 'text-foreground',
                  )}>{d.getDate()}</span>
                </div>

                {lista.length === 0 && (
                  onNovoNoDia ? (
                    <button
                      type="button"
                      onClick={() => onNovoNoDia(ymd)}
                      className="rounded px-0.5 py-1.5 text-left font-mono text-[11px] text-muted-foreground/40 hover:text-muted-foreground"
                    >
                      {fds ? '—' : '+ livre'}
                    </button>
                  ) : (
                    <span className="px-0.5 py-1.5 font-mono text-[11px] text-muted-foreground/40">
                      {fds ? '—' : 'livre'}
                    </span>
                  )
                )}

                {lista.map(item => (
                  <button
                    key={item.chave}
                    type="button"
                    onClick={() => onAbrir(item)}
                    className={cn(
                      'w-full rounded border-l-2 bg-muted/60 px-2 py-1.5 text-left text-xs leading-snug',
                      'hover:bg-muted',
                      COR_TIPO[item.tipo]?.barra ?? 'border-l-primary',
                    )}
                  >
                    {item.hora && (
                      <span className="block font-mono text-[10px] text-muted-foreground">{item.hora}</span>
                    )}
                    <span className="block text-foreground">{item.titulo}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ---------------- mês ----------------
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

                {lista.slice(0, 2).map(item => (
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

                {lista.length > 2 && (
                  <span className="px-1 font-mono text-[10px] text-muted-foreground">
                    +{lista.length - 2}
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
