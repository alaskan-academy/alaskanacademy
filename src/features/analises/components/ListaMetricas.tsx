import { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { variacao } from '../metricas';

/**
 * Uma métrica por linha, com três colunas de número e nada mais.
 *
 * Duas correções vieram de olhar a tela em uso:
 *
 * 1. O que a métrica É saía na frente, dentro do rótulo ("CPV — custo por
 *    visitante", "EPC — quanto cada um traz"). Isso empurrava o nome para duas
 *    linhas e roubava o lugar de quem manda no scan, que é o número. Agora o
 *    nome fica sozinho e curto, e a explicação desce para uma linha miúda
 *    abaixo, onde só é lida por quem precisa.
 *
 * 2. O custo unitário e a taxa da etapa moravam numa quinta coluna colada na
 *    borda direita, longe do valor -- "fica difícil de ver o custo e a % atual".
 *    Foram para a mesma linha miúda de baixo, ao lado da explicação, a poucos
 *    pixels do nome.
 *
 * O que sobrou nas colunas alinhadas é só o que se compara descendo o olho:
 * valor, variação, período anterior.
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
        <div className="min-w-[26rem]">
          {/* Um cabeçalho por bloco, em vez de "antes:" repetido em cada linha:
              o rótulo da coluna precisa existir uma vez, não vinte. */}
          <div className="flex items-baseline gap-3 px-3 py-1 border-b border-border bg-secondary/40
                          text-[10px] uppercase tracking-wide text-muted-foreground">
            <span className="flex-1 min-w-0" />
            <span className="w-32 shrink-0 text-right">agora</span>
            <span className="w-16 shrink-0" />
            <span className="w-28 shrink-0 text-right">anterior</span>
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
  /** Linha miúda sob o rótulo: o que é, quanto custa, que fatia representa. */
  detalhe?: ReactNode;
  destaque?: boolean;
}

export function LinhaMetrica({
  rotulo, valor, anterior, formato = n => String(n),
  subirEhRuim = false, detalhe, destaque = false,
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
      <span className="flex-1 min-w-0">
        <span className={cn('block text-sm leading-tight', destaque && 'font-semibold')}>
          {rotulo}
        </span>
        {detalhe && (
          <span className="block text-[10px] leading-tight text-muted-foreground mt-0.5">
            {detalhe}
          </span>
        )}
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
    </div>
  );
}

interface PropsFunil {
  rotulo: string;
  /** O que fica grande: no funil, o custo da etapa. */
  custo: number | null;
  custoAntes: number | null;
  /** Embaixo do custo: a taxa da etapa e a contagem. */
  taxaPct: number | null;
  qtd: number;
  taxaPctAntes: number | null;
  qtdAntes: number;
  formatoCusto: (n: number) => string;
  destaque?: boolean;
}

/**
 * A linha do funil, onde a métrica em evidência é o CUSTO da etapa.
 *
 * O resto da tela põe a contagem em destaque e o custo miúdo embaixo do rótulo.
 * Aqui é o contrário, a pedido dela, e faz sentido: 20.410 cliques não dizem
 * nada sozinhos — R$ 1,01 por clique diz. A contagem e a taxa de passagem
 * descem para a linha de baixo, dentro da MESMA coluna, para que "agora" e
 * "anterior" continuem comparáveis de cima a baixo.
 *
 * A seta segue o custo, e custo que sobe é vermelho.
 */
export function LinhaFunil({
  rotulo, custo, custoAntes, taxaPct, qtd, taxaPctAntes, qtdAntes,
  formatoCusto, destaque = false,
}: PropsFunil) {
  const v = variacao(custo, custoAntes);
  const Icone = v.direcao === 'subiu' ? ArrowUp : ArrowDown;
  const sub = (pct: number | null, n: number) =>
    `${pct != null ? `${pct.toFixed(2)}% · ` : ''}${n.toLocaleString('pt-BR')}`;

  return (
    <div className={cn(
      'flex items-start gap-3 px-3 py-2 border-b border-border/40 last:border-0',
      destaque && 'bg-secondary/30',
    )}>
      <span className={cn('flex-1 min-w-0 text-sm leading-tight', destaque && 'font-semibold')}>
        {rotulo}
      </span>

      <span className="w-32 shrink-0 text-right">
        <span className={cn(
          'block tabular-nums',
          destaque ? 'text-base font-semibold' : 'text-sm font-medium',
        )}>
          {custo == null ? '—' : formatoCusto(custo)}
        </span>
        <span className="block text-[10px] text-muted-foreground tabular-nums mt-0.5">
          {sub(taxaPct, qtd)}
        </span>
      </span>

      <span className="w-16 shrink-0 text-right">
        {v.pct != null && v.direcao !== 'igual' && (
          <span className={cn(
            'inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums',
            // Custo que sobe é ruim, sempre.
            v.direcao === 'subiu' ? 'text-red-400' : 'text-emerald-400',
          )}>
            <Icone className="h-3 w-3" />
            {Math.abs(v.pct).toFixed(1)}%
          </span>
        )}
      </span>

      <span className="w-28 shrink-0 text-right">
        <span className="block text-[11px] text-muted-foreground tabular-nums">
          {custoAntes == null ? 'sem anterior' : formatoCusto(custoAntes)}
        </span>
        <span className="block text-[10px] text-muted-foreground/70 tabular-nums mt-0.5">
          {sub(taxaPctAntes, qtdAntes)}
        </span>
      </span>
    </div>
  );
}
