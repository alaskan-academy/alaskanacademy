import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { MarkdownRenderer } from '@/features/processos/components/MarkdownRenderer';
import { cn } from '@/lib/utils';
import { Video, PlayCircle, Link2, Pencil, Trash2 } from 'lucide-react';
import { ROTULO_TIPO, horaCurta, type ItemAgenda } from '../types';

const DIA_LONGO = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function quando(data: string, hIni: string | null, hFim: string | null): string {
  const d = new Date(data + 'T00:00:00');
  let s = `${DIA_LONGO[d.getDay()]}, ${d.getDate()} de ${MES_CURTO[d.getMonth()]}`;
  const i = horaCurta(hIni);
  const f = horaCurta(hFim);
  if (i) s += ` · ${i}${f ? ` – ${f}` : ''}`;
  return s;
}

/**
 * O detalhe do que está na agenda.
 *
 * A decisão que sustenta esta tela: **o evento muda de cara com o tempo**.
 * Antes da reunião o que importa é a pauta e entrar na call; depois, o link da
 * call é lixo que disputa espaço com a gravação. Então a ação em destaque troca
 * sozinha na data, sem ninguém marcar nada como encerrado.
 */
export function EventoDrawer({
  item, nomes, podeEditar, onFechar, onEditar, onExcluir,
}: {
  item: ItemAgenda | null;
  nomes: Record<string, string>;
  podeEditar: boolean;
  onFechar: () => void;
  onEditar: (item: ItemAgenda) => void;
  onExcluir: (item: ItemAgenda) => void;
}) {
  if (!item) return null;

  const ev = item.evento;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const passou = new Date(item.data + 'T23:59:59') < hoje;

  return (
    <Sheet open onOpenChange={v => !v && onFechar()}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col gap-0 p-0">
        <div className="border-b border-border px-5 py-4">
          <SheetTitle asChild>
            <h2 className="text-base font-semibold leading-snug text-foreground">{item.titulo}</h2>
          </SheetTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {ROTULO_TIPO[item.tipo] ?? item.tipo} · {quando(item.data, ev?.hora_inicio ?? null, ev?.hora_fim ?? null)}
            {ev?.recorrencia_tipo && ' · se repete'}
          </p>
        </div>

        <div className="flex flex-col gap-5 overflow-y-auto px-5 py-5">

          {/* ---- reunião: a ação em destaque depende da data ---- */}
          {ev?.tipo === 'reuniao' && (
            <div className="flex flex-col gap-2">
              {!passou && ev.link_call && (
                <Button asChild className="w-full">
                  <a href={ev.link_call} target="_blank" rel="noreferrer noopener">
                    <Video className="mr-2 h-4 w-4" /> Entrar na call
                  </a>
                </Button>
              )}

              {passou && ev.link_gravacao && (
                <Button asChild className="w-full bg-teal-500 text-teal-950 hover:bg-teal-400">
                  <a href={ev.link_gravacao} target="_blank" rel="noreferrer noopener">
                    <PlayCircle className="mr-2 h-4 w-4" /> Ver gravação
                  </a>
                </Button>
              )}

              {/* Depois da reunião o link da call vira referência, não convite. */}
              {passou && ev.link_call && (
                <a
                  href={ev.link_call}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex w-fit items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Link2 className="h-3 w-3" /> link da call (encerrada)
                </a>
              )}

              {passou && !ev.link_gravacao && (
                <p className="text-xs text-muted-foreground">Sem gravação registrada.</p>
              )}
              {!passou && !ev.link_call && (
                <p className="text-xs text-muted-foreground">Sem link de call.</p>
              )}
            </div>
          )}

          {/* ---- folga ---- */}
          {ev?.tipo === 'folga' && (
            <div className="text-sm text-foreground">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">De quem</p>
              <p className="mt-1">{ev.pessoa_id ? (nomes[ev.pessoa_id] ?? '—') : '—'}</p>
              {ev.motivo && (
                <>
                  <p className="mt-4 text-xs uppercase tracking-wider text-muted-foreground">Motivo</p>
                  <p className="mt-1 text-muted-foreground">{ev.motivo}</p>
                </>
              )}
            </div>
          )}

          {/* ---- participantes ---- */}
          {ev && ev.participantes.length > 0 && (
            <div>
              <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Quem</p>
              <div className="flex flex-wrap gap-1.5">
                {ev.participantes.map(id => (
                  <span key={id} className="rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs text-muted-foreground">
                    {nomes[id] ?? '—'}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ---- pauta antes, ata depois ---- */}
          {ev?.tipo === 'reuniao' && (
            <>
              <div>
                <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                  {passou ? 'Pauta que foi combinada' : 'Pauta'}
                </p>
                {ev.pauta
                  ? <MarkdownRenderer content={ev.pauta} className="text-sm" />
                  : <p className={cn(
                      'rounded-lg border border-dashed border-border px-3 py-3 text-center text-xs italic',
                      'text-muted-foreground',
                    )}>
                      Sem pauta. Reunião sem pauta vira improviso.
                    </p>}
              </div>

              <div>
                <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Ata</p>
                {ev.ata
                  ? <MarkdownRenderer content={ev.ata} className="text-sm" />
                  : <p className="rounded-lg border border-dashed border-border px-3 py-3 text-center text-xs italic text-muted-foreground">
                      {passou ? 'Ninguém escreveu a ata desta reunião.' : 'A ata aparece aqui depois da reunião.'}
                    </p>}
              </div>
            </>
          )}

          {/* ---- editar e excluir: só quem pode ---- */}
          {ev && podeEditar && (
            <div className="flex gap-2 border-t border-border pt-4">
              <Button variant="outline" size="sm" onClick={() => onEditar(item)}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" /> Editar
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => onExcluir(item)}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Excluir
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
