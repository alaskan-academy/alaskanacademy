import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Plus, Clock } from 'lucide-react';
import { formatarData } from '../periodo';

/**
 * As ações do REV, marcáveis.
 *
 * Era um campo de texto solto por rodada. Texto solto não se marca, não se
 * cobra e some da vista na quinzena seguinte — e ação que ninguém revisita é o
 * Google Chat de novo, que é o que este módulo veio substituir.
 *
 * A ação pertence ao REV, não à rodada: escrita numa quinzena, ela continua
 * aparecendo até alguém marcar. É isto que transforma a análise em ciclo —
 * "o que eu disse que ia fazer" vira uma pergunta que a tela responde sozinha.
 */

export interface Acao {
  id: string;
  texto: string;
  feita: boolean;
  criada_em: string;
  /** Da rodada em que nasceu, para dizer "em aberto desde 12/08". */
  data_origem: string | null;
}

interface Props {
  acoes: Acao[];
  onAdicionar: (texto: string) => Promise<void>;
  onMarcar: (id: string, feita: boolean) => Promise<void>;
  /** Data da rodada em foco, para saber o que é herdado e o que é desta. */
  dataRodada: string | null;
}

export function ListaAcoes({ acoes, onAdicionar, onMarcar, dataRodada }: Props) {
  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function adicionar() {
    const t = texto.trim();
    if (!t || salvando) return;
    setSalvando(true);
    await onAdicionar(t);
    setSalvando(false);
    setTexto('');
  }

  // Abertas primeiro, e as mais antigas no topo: uma ação parada há três
  // quinzenas precisa incomodar mais que a escrita agora.
  const ordenadas = [...acoes].sort((a, b) =>
    Number(a.feita) - Number(b.feita) || a.criada_em.localeCompare(b.criada_em));

  const abertas = acoes.filter(a => !a.feita).length;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2 flex-wrap">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Próximas ações
        </h3>
        <div className="h-px flex-1 min-w-4 bg-border" />
        <span className="text-[10px] text-muted-foreground/80">
          {abertas === 0 ? 'nenhuma em aberto'
            : abertas === 1 ? '1 em aberto' : `${abertas} em aberto`}
        </span>
      </div>

      <div className="rounded-lg border border-border divide-y divide-border/40">
        {ordenadas.map(a => {
          // Herdada de outra rodada: é a dívida que o módulo existe para cobrar.
          const deOutraRodada = !a.feita && a.data_origem != null && a.data_origem !== dataRodada;
          return (
            <label
              key={a.id}
              className="flex items-start gap-2.5 px-3 py-2 cursor-pointer hover:bg-secondary/30"
            >
              <Checkbox
                checked={a.feita}
                onCheckedChange={c => onMarcar(a.id, c === true)}
                className="mt-0.5"
              />
              <span className={cn(
                'flex-1 text-sm',
                a.feita && 'line-through text-muted-foreground',
              )}>
                {a.texto}
              </span>
              {deOutraRodada && (
                <span className="shrink-0 inline-flex items-center gap-1 text-[10px] text-amber-400/90 mt-0.5">
                  <Clock className="h-3 w-3" />
                  desde {formatarData(a.data_origem!)}
                </span>
              )}
            </label>
          );
        })}

        <div className="flex items-center gap-2 px-3 py-2">
          <Input
            className="h-8 text-sm border-0 bg-transparent px-0 focus-visible:ring-0"
            placeholder="O que fazer a respeito…"
            value={texto}
            onChange={e => setTexto(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); adicionar(); } }}
          />
          <Button
            size="sm" variant="ghost" className="h-8 gap-1 shrink-0"
            onClick={adicionar} disabled={!texto.trim() || salvando}
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar
          </Button>
        </div>
      </div>
    </div>
  );
}
