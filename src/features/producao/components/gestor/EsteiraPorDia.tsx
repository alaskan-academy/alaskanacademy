import { useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { deYmd, hoje, emDias } from '@/lib/datas';
import {
  CardDaFila, agruparEmAds, rotuloDoAd, rotuloDoHook, FAMILIA_SELO, FAMILIA_LABEL,
} from './tipos';

const DIA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/**
 * O que está na esteira de teste, por dia.
 *
 * A pergunta que isto responde é "qual é a demanda da semana" — e por isso o
 * eixo é a data, ao contrário da fila, onde data nenhuma organiza.
 *
 * Cada AD é uma linha, com o mesmo formato de "Prontos para testar": o número
 * do AD à esquerda e clicável, depois projeto, funil e tipo. A primeira versão
 * comprimia tudo numa linha por projeto e empurrava os números dos ADs para a
 * direita, onde sumiam — dava para ver que havia "1 AD de Iteração" sem ver
 * QUAL.
 *
 * Cards sem `data_inicio` ganham um bloco próprio no fim em vez de sumirem: um
 * AD em teste sem dia marcado é justamente o que se perde de vista.
 */
export function EsteiraPorDia({ cards, onAbrirCard }: {
  cards: CardDaFila[];
  onAbrirCard: (id: string) => void;
}) {
  /*
    A pergunta é "a demanda da SEMANA", e a esteira pode acumular meses de
    histórico. Mostrar tudo por padrão soterra a semana, então a janela é o
    padrão e o resto fica a um clique. Contado, nunca escondido: a linha diz
    quantos ficaram de fora.
  */
  const [tudo, setTudo] = useState(false);

  /*
    Quais ADs estão abertos, mostrando os hooks.

    A chave é DIA + AD, e não só o AD: o mesmo AD pode estar marcado para dois
    dias diferentes, e abrir um abriria o outro junto — dois blocos se mexendo
    quando se clicou em um.

    Fechado por padrão: são 32 cards em 9 ADs hoje, e abrir tudo devolveria
    exatamente a lista comprida que o agrupamento existe para evitar.
  */
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const alternar = (chave: string) => setAbertos(prev => {
    const n = new Set(prev);
    if (n.has(chave)) n.delete(chave); else n.add(chave);
    return n;
  });

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
      <div className="rounded-lg border border-border bg-card px-4 py-8 text-center">
        <p className="text-sm text-muted-foreground">Nada na esteira de teste agora.</p>
        {/* Um vazio que não diz o caminho parece defeito. */}
        <p className="mt-1 text-[11px] text-muted-foreground/60">
          Marque ADs na fila acima e use “Enviar para a esteira” com a data do teste.
        </p>
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
                 <span className="text-amber-300/90">{foraDaJanela} {foraDaJanela === 1 ? 'card fora' : 'cards fora'} deste período</span>
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
        const ads = agruparEmAds(d.cards);
        const ehHoje = d.data === ymdHoje;

        return (
          <div key={d.data || 'sem-data'} className="border-b border-border last:border-0">
            <div className={cn('flex flex-wrap items-baseline gap-x-2 py-1.5 pl-3 pr-4',
              ehHoje ? 'bg-primary/10' : 'bg-secondary/30')}>
              <CalendarDays className={cn('h-3.5 w-3.5 shrink-0 translate-y-0.5',
                ehHoje ? 'text-primary' : 'text-muted-foreground')} />
              <span className={cn('text-xs font-medium',
                ehHoje ? 'text-primary' : 'text-foreground')}>
                {d.data ? rotuloDoDia(d.data) : 'Sem data de teste'}
              </span>
              {ehHoje && <span className="text-[10px] text-primary/80">hoje</span>}
              <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                {ads.length} {ads.length === 1 ? 'AD' : 'ADs'} · {d.cards.length} {d.cards.length === 1 ? 'card' : 'cards'}
              </span>
            </div>

            {/* Um AD por linha, com o mesmo recuo e ritmo da fila acima. */}
            {ads.map(ad => {
              const chaveAberto = `${d.data}|${ad.chave}`;
              const aberto = abertos.has(chaveAberto);
              return (
              <div key={ad.chave} className="border-b border-border/25 last:border-0">
              <div className="flex flex-wrap items-center gap-2 py-1.5 pl-3 pr-4 hover:bg-secondary/20">
                {/*
                  O chevron abre os hooks; o número do AD continua abrindo o
                  card. Dois alvos, porque são duas perguntas — "quais hooks
                  são?" e "quero ver este".

                  Antes o número abria `cards[0]` e os outros hooks não tinham
                  como ser alcançados daqui: para ver o H03 era preciso sair
                  para outra tela e procurar pelo nome.
                */}
                <button
                  type="button"
                  onClick={() => alternar(chaveAberto)}
                  title={aberto ? 'Esconder os hooks' : `Ver os ${ad.cards.length} hooks`}
                  aria-expanded={aberto}
                  className="shrink-0 text-muted-foreground/50 transition-colors hover:text-foreground"
                >
                  {aberto ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </button>

                <button onClick={() => onAbrirCard(ad.cards[0].id)} title="Abrir o card"
                        className="w-[62px] shrink-0 text-left text-xs font-medium tabular-nums text-foreground hover:text-primary hover:underline">
                  {rotuloDoAd(ad.ad_num)}
                </button>

                <span className="truncate text-xs text-muted-foreground">
                  {ad.cards[0].projeto ?? '—'}
                </span>

                <span className="shrink-0 rounded bg-secondary px-1.5 py-px text-[10px] text-muted-foreground">
                  {ad.cards[0].funil ?? 'Sem funil'}
                </span>

                <span className={cn('shrink-0 rounded px-1.5 py-px text-[10px]',
                  FAMILIA_SELO[ad.familia])}>
                  {ad.tipo_teste ?? FAMILIA_LABEL[ad.familia] ?? '—'}
                </span>

                {/* A contagem também abre: é o número que responde "quais?", e
                    mirar num chevron de 12px seria alvo pequeno à toa. */}
                <button
                  type="button"
                  onClick={() => alternar(chaveAberto)}
                  className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground/60 underline-offset-2 transition-colors hover:text-foreground hover:underline"
                >
                  {ad.cards.length} {ad.cards.length === 1 ? 'hook' : 'hooks'}
                </button>
              </div>

              {/*
                Um hook por linha, com o mesmo desenho da fila de aprovados:
                código curto, nome inteiro e o editor à direita. Repetir o
                formato de lá não é preguiça — é o que faz as duas listas serem
                lidas do mesmo jeito, e elas ficam uma embaixo da outra.
              */}
              {aberto && ad.cards.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onAbrirCard(c.id)}
                  title="Abrir o card"
                  className="flex w-full items-baseline gap-2 border-t border-border/15 py-1.5 pl-[62px] pr-4 text-left transition-colors hover:bg-secondary/20"
                >
                  <span className="w-10 shrink-0 text-[11px] tabular-nums text-foreground">
                    {rotuloDoHook(c)}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">{c.nome}</span>
                  {c.editor && (
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60">{c.editor}</span>
                  )}
                </button>
              ))}
              </div>
              );
            })}
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

/** `27/ago` — curto porque aparece dentro de uma frase. */
function rotuloCurto(ymd: string): string {
  return deYmd(ymd).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}
