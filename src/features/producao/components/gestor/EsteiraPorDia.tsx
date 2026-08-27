import { useMemo, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';
import { deYmd, hoje, emDias } from '@/lib/datas';
import { CardDaFila, rotuloDoAd, FAMILIA_SELO, FAMILIA_LABEL } from './tipos';

const DIA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/**
 * O que está em teste, por dia.
 *
 * A pergunta que isto responde é "qual é a demanda da semana" — e por isso o
 * eixo é a data, ao contrário da fila, onde data nenhuma organiza.
 *
 * Cards sem `data_inicio` ganham um bloco próprio no fim em vez de sumirem:
 * um AD em teste sem dia marcado é justamente o que se perde de vista.
 */
export function EsteiraPorDia({ cards, onAbrirCard }: {
  cards: CardDaFila[];
  onAbrirCard: (id: string) => void;
}) {
  /*
    A pergunta é "a demanda da SEMANA", e a esteira tem 69 cards espalhados por
    um ano — de outubro, novembro, março. Mostrar tudo por padrão soterra a
    semana debaixo de um cemitério, então a janela é o padrão e o resto fica a
    um clique. Contado, nunca escondido: a linha diz quantos ficaram de fora.
  */
  const [tudo, setTudo] = useState(false);

  const ymdHoje = hoje();
  const de  = emDias(-7);
  const ate = emDias(21);

  const naJanela = (c: CardDaFila) =>
    c.data_inicio != null && c.data_inicio >= de && c.data_inicio <= ate;

  const visiveis = tudo ? cards : cards.filter(naJanela);
  const foraDaJanela = cards.length - cards.filter(naJanela).length;

  const dias = useMemo(() => {
    const mapa = new Map<string, CardDaFila[]>();
    for (const c of visiveis) {
      const k = c.data_inicio ?? '';
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k)!.push(c);
    }
    return Array.from(mapa, ([data, cs]) => ({ data, cards: cs }))
      /* Sem data por último: é exceção, não o começo da leitura. */
      .sort((a, b) => (a.data === '' ? 1 : b.data === '' ? -1 : b.data.localeCompare(a.data)));
  }, [visiveis]);

  if (cards.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Nada em esteira de teste.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {foraDaJanela > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-2 border-b border-border bg-secondary/20 px-3 py-2 text-[11px]">
          <span className="text-muted-foreground">
            {tudo
              ? 'Mostrando tudo, inclusive o que já deveria ter saído da esteira.'
              : <>Mostrando de {rotuloCurto(de)} a {rotuloCurto(ate)}.{' '}
                 <span className="text-amber-300/90">{foraDaJanela} cards fora deste período</span>
                 {' '}continuam marcados como em teste.</>}
          </span>
          <button onClick={() => setTudo(t => !t)}
                  className="ml-auto text-primary underline-offset-2 hover:underline">
            {tudo ? 'ver só a janela' : 'ver todos'}
          </button>
        </div>
      )}

      {dias.length === 0 && (
        <p className="p-6 text-center text-xs text-muted-foreground">
          Nada em teste neste período.
        </p>
      )}

      {dias.map(d => {
        const ads = new Set(d.cards.map(c => `${c.ad_num ?? 'x'}|${c.tipo_teste ?? ''}`));
        const ehHoje = d.data === ymdHoje;

        return (
          <div key={d.data || 'sem-data'} className="border-b border-border last:border-0">
            <div className={cn('flex flex-wrap items-baseline gap-x-2 px-3 py-1.5',
              ehHoje ? 'bg-primary/10' : 'bg-secondary/30')}>
              <CalendarDays className={cn('h-3.5 w-3.5 shrink-0 translate-y-0.5',
                ehHoje ? 'text-primary' : 'text-muted-foreground')} />
              <span className={cn('text-xs font-medium',
                ehHoje ? 'text-primary' : 'text-foreground')}>
                {d.data ? rotuloDoDia(d.data) : 'Sem data de teste'}
              </span>
              {ehHoje && <span className="text-[10px] text-primary/80">hoje</span>}
              <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                {ads.size} {ads.size === 1 ? 'AD' : 'ADs'} · {d.cards.length} cards
              </span>
            </div>

            <div className="divide-y divide-border/25">
              {agruparPorProjetoEFunil(d.cards).map(g => (
                <div key={g.chave} className="flex flex-wrap items-baseline gap-x-2 px-3 py-1.5 pl-8">
                  <span className="text-xs text-foreground">{g.projeto}</span>
                  <span className="rounded bg-secondary px-1.5 py-px text-[10px] text-muted-foreground">
                    {g.funil}
                  </span>
                  {g.familias.map(f => (
                    <span key={f.familia}
                          className={cn('rounded px-1.5 py-px text-[10px]', FAMILIA_SELO[f.familia])}>
                      {FAMILIA_LABEL[f.familia] ?? f.familia} {f.ads}
                    </span>
                  ))}
                  <span className="ml-auto flex flex-wrap gap-x-1.5 text-[10px] tabular-nums">
                    {g.ads.map(a => (
                      <button key={a.id} onClick={() => onAbrirCard(a.id)} title="Abrir o card"
                              className="text-muted-foreground/60 hover:text-primary hover:underline">
                        {a.r}
                      </button>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** `qua, 27 de agosto` — o dia da semana importa para ler a demanda. */
function rotuloDoDia(ymd: string): string {
  const d = deYmd(ymd);
  return `${DIA_SEMANA[d.getDay()]}, ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}`;
}

function agruparPorProjetoEFunil(cards: CardDaFila[]) {
  const mapa = new Map<string, CardDaFila[]>();
  for (const c of cards) {
    const k = `${c.projeto ?? '—'}|${c.funil ?? 'Sem funil'}`;
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k)!.push(c);
  }
  return Array.from(mapa, ([chave, cs]) => {
    const porFamilia = new Map<string, Set<string>>();
    for (const c of cs) {
      const s = porFamilia.get(c.familia) ?? new Set<string>();
      s.add(`${c.ad_num ?? 'x'}|${c.tipo_teste ?? ''}`);
      porFamilia.set(c.familia, s);
    }
    return {
      chave,
      projeto: cs[0].projeto ?? '—',
      funil: cs[0].funil ?? 'Sem funil',
      familias: Array.from(porFamilia, ([familia, ads]) => ({ familia, ads: ads.size })),
      ads: Array.from(new Map(cs.map(c => [rotuloDoAd(c.ad_num), c.id])), ([r, id]) => ({ r, id }))
        .sort((a, b) => a.r.localeCompare(b.r)),
    };
  }).sort((a, b) => a.projeto.localeCompare(b.projeto));
}

/** `27/ago` — curto porque aparece dentro de uma frase. */
function rotuloCurto(ymd: string): string {
  return deYmd(ymd).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}
