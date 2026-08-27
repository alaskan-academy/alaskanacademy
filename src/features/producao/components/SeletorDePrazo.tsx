import { useState, useEffect, useCallback, useRef } from 'react';
import { CalendarIcon, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { DayContentProps } from 'react-day-picker';
import { ptBR } from 'date-fns/locale';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { rotuloDoPrazo } from './constants';

/**
 * Uma data, ou um período quando for mesmo um período.
 *
 * Antes eram dois campos `<input type="date">` lado a lado, Início e Prazo.
 * Dois campos para o que quase sempre é um dia só: de 4.089 cards, 3.749 têm
 * só início e 173 repetem a mesma data nos dois — 96% são um dia. Período de
 * verdade são 45, ou 1,1%.
 *
 * Por isso o clique simples MOVE a data em vez de abrir um intervalo: o gesto
 * mais comum devolve o resultado mais comum. O intervalo existe, mas pede um
 * gesto próprio — arrastar de um dia até outro —, na proporção em que é usado.
 *
 * O par que sai daqui segue o que o banco já tem: dia único grava
 * `data_prazo = null`, e não a mesma data duas vezes. É o que `prazoEfetivo`
 * sabe ler.
 */

function paraYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function paraData(ymd: string): Date {
  return new Date(ymd + 'T00:00:00');
}

/** Cada dia carrega a sua data no DOM.
 *
 *  O react-day-picker avisa quando o ponteiro ENTRA num dia, mas não quando
 *  ele é pressionado — e um arrasto precisa saber onde começou. Marcando o
 *  dia, o `pointerdown` que escuto na moldura descobre sozinho de onde partiu.
 *  `DayContent` é o ponto de extensão da própria biblioteca; o `inset-0` é
 *  para o pressionar valer em todo o botão, e não só sobre o número. */
function DiaMarcado({ date }: DayContentProps) {
  return (
    <span data-ymd={paraYmd(date)} className="absolute inset-0 flex items-center justify-center">
      {date.getDate()}
    </span>
  );
}

interface Props {
  inicio: string | null;
  prazo: string | null;
  onChange: (inicio: string | null, prazo: string | null) => void;
  disabled?: boolean;
  className?: string;
}

export function SeletorDePrazo({ inicio, prazo, onChange, disabled, className }: Props) {
  const [aberto, setAberto] = useState(false);

  // Âncora do arrasto e a prévia que ele desenha. Enquanto arrasta, nada é
  // gravado: o que a tela mostra é a prévia, e só o soltar decide.
  const [ancora, setAncora] = useState<string | null>(null);
  const [previa, setPrevia] = useState<{ de: string; ate: string } | null>(null);

  // O clique do mouse chega DEPOIS do soltar. Sem esta marca, um arrasto de
  // 3 dias seria desfeito pelo clique que o encerra, que cairia como "dia
  // único" no último dia. A marca some no primeiro clique que ela barra, e
  // com isso o teclado (Enter num dia, sem ponteiro nenhum) continua valendo.
  const viaPonteiro = useRef(false);

  const de  = inicio ?? prazo;
  const ate = prazo  ?? inicio;

  const comprometer = useCallback((d: string, a: string) => {
    // Dia único não grava a data duas vezes — grava prazo nulo, como os 3.749
    // cards que já existem.
    if (d === a) onChange(d, null);
    else         onChange(d, a);
  }, [onChange]);

  // O soltar vem do documento, não do dia: quem arrasta para fora da grade
  // (ou solta sobre o cabeçalho) ainda solta em algum lugar, e sem isto o
  // arrasto ficaria preso, seguindo o mouse depois de ter acabado.
  useEffect(() => {
    if (!ancora) return;
    const soltar = () => {
      if (previa) comprometer(previa.de, previa.ate);
      setAncora(null);
      setPrevia(null);
    };
    document.addEventListener('pointerup', soltar);
    return () => document.removeEventListener('pointerup', soltar);
  }, [ancora, previa, comprometer]);

  const mostrado = previa ?? (de && ate ? { de, ate } : null);

  const selecionado = mostrado
    ? { from: paraData(mostrado.de), to: paraData(mostrado.ate) }
    : undefined;

  const limpar = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null, null);
  };

  const temData = !!de;

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'w-full flex items-center gap-2 h-8 px-2 rounded-md border border-input bg-background',
            'text-xs text-left transition-colors hover:bg-accent disabled:opacity-50',
            className,
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className={cn('flex-1 truncate', !temData && 'text-muted-foreground')}>
            {rotuloDoPrazo(inicio, prazo)}
          </span>
          {temData && !disabled && (
            // Não escondo o limpar atrás de hover: num campo de formulário ele
            // precisa ser alcançável sem antes ser descoberto.
            <span
              role="button"
              tabIndex={-1}
              aria-label="Limpar data"
              onClick={limpar}
              className="shrink-0 text-muted-foreground/50 hover:text-foreground rounded p-0.5"
            >
              <X className="h-3 w-3" />
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-0" align="start">
        <div
          onPointerDown={e => {
            const alvo = (e.target as HTMLElement).closest('[data-ymd]') as HTMLElement | null;
            const ymd  = alvo?.dataset.ymd;
            // Sem data no alvo é seta de mês ou cabeçalho — não começa arrasto.
            if (!ymd) return;
            viaPonteiro.current = true;
            setAncora(ymd);
            setPrevia({ de: ymd, ate: ymd });
          }}
        >
          <Calendar
            mode="range"
            selected={selecionado}
            defaultMonth={de ? paraData(de) : undefined}
            // A seleção é toda nossa: o `mode="range"` aqui só desenha o meio
            // e as pontas. Entregar `onSelect` devolveria ao day-picker a
            // regra do segundo clique, que é justamente a que não queremos.
            onSelect={() => {}}
            onDayClick={(d: Date) => {
              if (viaPonteiro.current) { viaPonteiro.current = false; return; }
              const ymd = paraYmd(d);
              comprometer(ymd, ymd);
            }}
            onDayPointerEnter={(d: Date) => {
              if (!ancora) return;
              const ymd = paraYmd(d);
              setPrevia(ymd < ancora ? { de: ymd, ate: ancora } : { de: ancora, ate: ymd });
            }}
            components={{
              DayContent: DiaMarcado,
              // Repetidos de propósito: `Calendar` espalha as props DEPOIS do
              // seu próprio `components`, então passar o meu substituiria o
              // objeto inteiro e as setas de mês sumiriam.
              IconLeft:  () => <ChevronLeft  className="h-4 w-4" />,
              IconRight: () => <ChevronRight className="h-4 w-4" />,
            }}
            locale={ptBR}
            initialFocus
          />
        </div>
        <p className="px-3 pb-2.5 -mt-1 text-[10.5px] leading-snug text-muted-foreground">
          Clique num dia para a data. Arraste de um dia até outro para um período.
        </p>
      </PopoverContent>
    </Popover>
  );
}
