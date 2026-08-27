import { useState, useEffect, useCallback, useRef } from 'react';
import { CalendarIcon, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * Um mês, ou um intervalo de meses.
 *
 * Substitui dois `<input type="month">` lado a lado. O campo nativo mostra
 * "junho de 2026" numa caixa de texto e obriga a abrir dois seletores para
 * dizer uma coisa só — e nada ali mostra que junho e agosto são vizinhos, nem
 * quantos meses o intervalo tem.
 *
 * A grade de doze mostra o ano inteiro de uma vez: onde o período começa, onde
 * termina e o que ficou de fora aparecem juntos, sem precisar ler duas datas e
 * fazer a conta de cabeça.
 *
 * O gesto é o mesmo do `SeletorDePrazo` das datas, e de propósito: clicar
 * escolhe um mês, clicar noutro MOVE, e arrastar de um até outro faz o
 * intervalo. Duas telas com o mesmo desenho e regras diferentes seria pior do
 * que duas telas diferentes.
 */

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGOS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** `yyyy-MM`, que é o formato que as consultas já usam. */
function rotuloDeUmMes(ym: string): string {
  const [ano, mes] = ym.split('-').map(Number);
  return `${MESES_LONGOS[mes - 1]} de ${ano}`;
}

export function rotuloDeMeses(de: string | null, ate: string | null): string {
  if (!de || !ate) return 'Selecionar período';
  if (de === ate) return rotuloDeUmMes(de);
  const [anoDe, mesDe] = de.split('-').map(Number);
  const [anoAte, mesAte] = ate.split('-').map(Number);
  // Dentro do mesmo ano o ano aparece uma vez só: "jun → ago de 2026".
  return anoDe === anoAte
    ? `${MESES_CURTOS[mesDe - 1]} → ${MESES_LONGOS[mesAte - 1]} de ${anoAte}`
    : `${MESES_CURTOS[mesDe - 1]}/${anoDe} → ${MESES_CURTOS[mesAte - 1]}/${anoAte}`;
}

interface Props {
  /** `yyyy-MM` */
  de: string;
  ate: string;
  onChange: (de: string, ate: string) => void;
  className?: string;
}

export function SeletorDeMeses({ de, ate, onChange, className }: Props) {
  const [aberto, setAberto] = useState(false);
  const [ano, setAno] = useState(() => Number((de || ate || '').slice(0, 4)) || new Date().getFullYear());

  // Âncora do arrasto e a prévia que ele desenha. Nada é gravado enquanto
  // arrasta: o que a tela mostra é a prévia, e só o soltar decide.
  const [ancora, setAncora] = useState<string | null>(null);
  const [previa, setPrevia] = useState<{ de: string; ate: string } | null>(null);

  // O clique do mouse chega DEPOIS do soltar. Sem esta marca, um arrasto de
  // três meses seria desfeito pelo clique que o encerra, que cairia como
  // "mês único" no último mês.
  const viaPonteiro = useRef(false);

  const comprometer = useCallback((a: string, b: string) => {
    onChange(a <= b ? a : b, a <= b ? b : a);
  }, [onChange]);

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
  const dentro = (ym: string) => !!mostrado && ym >= mostrado.de && ym <= mostrado.ate;

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-8 items-center gap-2 rounded-md border border-input bg-background px-2',
            'text-xs transition-colors hover:bg-accent',
            className,
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{rotuloDeMeses(de, ate)}</span>
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-3" align="start">
        <div className="mb-2 flex items-center justify-between">
          <button type="button" onClick={() => setAno(a => a - 1)}
                  aria-label="Ano anterior"
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-medium tabular-nums">{ano}</span>
          <button type="button" onClick={() => setAno(a => a + 1)}
                  aria-label="Próximo ano"
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1">
          {MESES_CURTOS.map((rotulo, i) => {
            const ym = `${ano}-${String(i + 1).padStart(2, '0')}`;
            const marcado = dentro(ym);
            const ehPonta = mostrado && (ym === mostrado.de || ym === mostrado.ate);
            return (
              <button
                key={ym}
                type="button"
                onPointerDown={ev => {
                  // Com Shift o arrasto NÃO começa. Ele começaria gravando o
                  // mês sozinho no soltar, e o clique — que chega depois —
                  // encontraria esse mês já no lugar do início, estendendo de
                  // si para si. O intervalo virava um mês só, e parecia que o
                  // Shift não fazia nada.
                  if (ev.shiftKey) return;
                  viaPonteiro.current = true;
                  setAncora(ym);
                  setPrevia({ de: ym, ate: ym });
                }}
                onPointerEnter={() => {
                  if (!ancora) return;
                  setPrevia(ym < ancora ? { de: ym, ate: ancora } : { de: ancora, ate: ym });
                }}
                onClick={ev => {
                  // Teclado (Enter num mês) não dispara `pointerdown`, então
                  // continua caindo aqui e escolhendo o mês único.
                  if (viaPonteiro.current && !ev.shiftKey) { viaPonteiro.current = false; return; }
                  viaPonteiro.current = false;

                  // Shift estende a partir do que já está escolhido — o mesmo
                  // gesto de qualquer lista. Existe porque o arrasto depende
                  // de o ponteiro passar por cima dos meses do meio, e isso
                  // falha em telas de toque, com o teclado, e para quem clica
                  // rápido demais. Um intervalo não pode ter um caminho só.
                  if (ev.shiftKey && de) { comprometer(de, ym); return; }
                  comprometer(ym, ym);
                }}
                className={cn(
                  'h-8 rounded text-xs capitalize transition-colors',
                  marcado
                    ? ehPonta
                      ? 'bg-primary font-medium text-primary-foreground'
                      : 'bg-primary/25 text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {rotulo}
              </button>
            );
          })}
        </div>

        <p className="mt-2.5 text-[10.5px] leading-snug text-muted-foreground">
          Clique num mês. Arraste — ou Shift+clique — para um intervalo.
        </p>
      </PopoverContent>
    </Popover>
  );
}

/** O botão de limpar, para quem tem um estado "sem período". */
export function LimparMeses({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Limpar período"
            className="rounded p-0.5 text-muted-foreground/50 hover:text-foreground">
      <X className="h-3 w-3" />
    </button>
  );
}
