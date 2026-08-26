import { cn } from '@/lib/utils';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { variacao } from '../metricas';

/**
 * Um número com o do período anterior ao lado.
 *
 * Nenhuma métrica aparece sozinha aqui, de propósito: "ROAS 1,39" não diz nada,
 * "1,56 → 1,39" diz. É o que ela já fazia à mão nos PDFs do Obsidian, e é o que
 * transforma leitura em decisão.
 */

interface Props {
  rotulo: string;
  valor: number | null;
  anterior: number | null;
  formato?: (n: number) => string;
  /** Para métricas onde subir é ruim, como custo. */
  subirEhRuim?: boolean;
  /** Texto pequeno abaixo, para a ressalva do número. */
  nota?: string;
  destaque?: boolean;
}

export function CartaoMetrica({
  rotulo, valor, anterior, formato = n => String(n),
  subirEhRuim = false, nota, destaque = false,
}: Props) {
  const v = variacao(valor, anterior);

  // "Bom" e "ruim" não são a mesma coisa que "subiu" e "caiu": investimento que
  // sobe não é vitória. Sem esta separação a tela pintaria de verde um número
  // que piorou.
  const bom = v.direcao === 'igual' ? null : (v.direcao === 'subiu') !== subirEhRuim;

  const Icone = v.direcao === 'subiu' ? ArrowUp : v.direcao === 'caiu' ? ArrowDown : Minus;

  return (
    <div className={cn(
      'rounded-lg border p-3',
      destaque ? 'border-primary/30 bg-primary/5' : 'border-border bg-card',
    )}>
      <div className="text-[11px] text-muted-foreground">{rotulo}</div>

      <div className="mt-0.5 flex items-baseline gap-2 flex-wrap">
        <span className="text-xl font-semibold tabular-nums">
          {valor == null ? '—' : formato(valor)}
        </span>

        {v.pct != null && (
          <span className={cn(
            'inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums',
            bom === null ? 'text-muted-foreground'
              : bom ? 'text-emerald-400' : 'text-red-400',
          )}>
            <Icone className="h-3 w-3" />
            {/* Acima de 10x, "+18863,2%" não é lido como número — é lido como
                ruído, e treina a pessoa a ignorar a seta ao lado dos números
                que importam. O múltiplo diz a mesma coisa e cabe no olho. */}
            {Math.abs(v.pct) >= 1000 && valor != null && anterior
              ? `${(valor / anterior).toFixed(0)}×`
              : `${Math.abs(v.pct).toFixed(1)}%`}
          </span>
        )}
      </div>

      <div className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
        {anterior == null
          // Sem período anterior a comparação não existe — e dizer isso é
          // melhor que mostrar "0%", que pareceria estabilidade.
          ? 'sem período anterior'
          : `antes: ${formato(anterior)}`}
      </div>

      {nota && <div className="mt-1 text-[10px] text-amber-400/80">{nota}</div>}
    </div>
  );
}
