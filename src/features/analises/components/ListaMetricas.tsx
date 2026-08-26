import { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { variacao } from '../metricas';

/**
 * Uma métrica por linha, em coluna única.
 *
 * A versão em cartões colocava oito números em duas colunas, e a leitura ficou
 * "meio confusa, pouca leitura scan". O problema não era a quantidade: era o
 * olho ter que voltar para a esquerda a cada dois números e reencontrar a
 * altura certa.
 *
 * Aqui os valores caem todos na mesma coluna, com largura fixa e
 * `tabular-nums`, então dá para descer a lista comparando grandezas sem ler
 * rótulo nenhum. Duas colunas ficaram reservadas para onde elas significam
 * alguma coisa — a tabela de Ofertas, onde cada coluna é uma medida diferente
 * da mesma oferta.
 */

export function ListaMetricas({
  titulo, nota, children,
}: { titulo: string; nota?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-baseline gap-2 flex-wrap">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {titulo}
        </h3>
        <div className="h-px flex-1 min-w-4 bg-border" />
        {nota && <span className="text-[10px] text-muted-foreground/80">{nota}</span>}
      </div>
      <div className="rounded-lg border border-border overflow-x-auto">
        <div className="min-w-[34rem]">
          {/* Um cabeçalho por bloco, em vez de "antes:" repetido em cada linha:
              o rótulo da coluna precisa existir uma vez, não vinte. */}
          <div className="flex items-baseline gap-3 px-3 py-1 border-b border-border bg-secondary/40
                          text-[10px] uppercase tracking-wide text-muted-foreground">
            <span className="flex-1 min-w-0" />
            <span className="w-32 shrink-0 text-right">agora</span>
            <span className="w-16 shrink-0" />
            <span className="w-28 shrink-0 text-right">período anterior</span>
            <span className="w-44 shrink-0" />
          </div>
          {children}
        </div>
      </div>
    </section>
  );
}

interface Props {
  rotulo: string;
  valor: number | null;
  anterior: number | null;
  formato?: (n: number) => string;
  /** Para métricas onde subir é ruim, como custo. */
  subirEhRuim?: boolean;
  /** O que vem à direita: custo por unidade, taxa da etapa, ressalva. */
  extra?: ReactNode;
  destaque?: boolean;
}

export function LinhaMetrica({
  rotulo, valor, anterior, formato = n => String(n),
  subirEhRuim = false, extra, destaque = false,
}: Props) {
  const v = variacao(valor, anterior);

  // "Bom" e "ruim" não são a mesma coisa que "subiu" e "caiu": investimento que
  // sobe não é vitória. Sem esta separação a tela pintaria de verde um número
  // que piorou.
  const bom = v.direcao === 'igual' ? null : (v.direcao === 'subiu') !== subirEhRuim;
  const Icone = v.direcao === 'subiu' ? ArrowUp : ArrowDown;

  return (
    <div className={cn(
      'flex items-baseline gap-3 px-3 py-2 border-b border-border/40 last:border-0',
      destaque && 'bg-secondary/30',
    )}>
      {/* Sem `truncate`: cortar o rótulo esconde a identidade da linha, que é
          justamente o que não pode faltar. Se apertar, ele quebra em duas. */}
      <span className={cn('flex-1 min-w-0 text-xs', destaque && 'font-semibold')}>
        {rotulo}
      </span>

      <span className={cn(
        'w-32 shrink-0 text-right tabular-nums',
        destaque ? 'text-base font-semibold' : 'text-sm font-medium',
      )}>
        {valor == null ? '—' : formato(valor)}
      </span>

      <span className="w-16 shrink-0 text-right">
        {v.pct != null && v.direcao !== 'igual' && (
          <span className={cn(
            'inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums',
            bom ? 'text-emerald-400' : 'text-red-400',
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
      </span>

      <span className="w-28 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
        {anterior == null
          // Sem período anterior a comparação não existe — e dizer isso é
          // melhor que mostrar "0%", que pareceria estabilidade.
          ? 'sem anterior'
          : formato(anterior)}
      </span>

      <span className="w-44 shrink-0 text-right text-[11px] text-muted-foreground">
        {extra}
      </span>
    </div>
  );
}
