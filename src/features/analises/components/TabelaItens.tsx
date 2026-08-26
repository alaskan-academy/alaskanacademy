import { ItemVendido, variacao } from '../metricas';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { ArrowDown, ArrowUp } from 'lucide-react';

/**
 * As linhas "Orderbump 1..5" da planilha — mas lidas de `venda_itens` em vez de
 * digitadas.
 *
 * Cada oferta aparece com o próprio nome e com o período anterior ao lado. Uma
 * oferta que vendia e parou some da lista atual, então ela também precisa
 * aparecer: por isso a união dos dois períodos, e não só do atual.
 */

interface Props {
  atual: ItemVendido[];
  anterior: ItemVendido[];
}

export function TabelaItens({ atual, anterior }: Props) {
  const antesPor = new Map(anterior.map(i => [i.nome, i]));
  const nomes = [...new Set([...atual.map(i => i.nome), ...anterior.map(i => i.nome)])];

  const linhas = nomes
    .map(nome => ({
      nome,
      agora: atual.find(i => i.nome === nome) ?? null,
      antes: antesPor.get(nome) ?? null,
    }))
    .sort((a, b) => (b.agora?.qtd ?? 0) - (a.agora?.qtd ?? 0));

  if (linhas.length === 0) {
    return (
      <p className="text-xs text-muted-foreground/60 italic">
        Nenhum order bump ou upsell convertido no período.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary/40 text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="text-left  font-medium px-3 py-2">Oferta</th>
            <th className="text-right font-medium px-3 py-2">Qtd</th>
            <th className="text-right font-medium px-3 py-2">Antes</th>
            <th className="text-right font-medium px-3 py-2">Adesão</th>
            <th className="text-right font-medium px-3 py-2">Faturamento</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map(l => {
            const v = variacao(l.agora?.qtd ?? 0, l.antes?.qtd ?? null);
            const Icone = v.direcao === 'subiu' ? ArrowUp : ArrowDown;
            return (
              <tr key={l.nome} className="border-b border-border/50 last:border-0">
                <td className="px-3 py-2">
                  <div className="font-medium">{l.nome}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {l.agora?.tipo ?? l.antes?.tipo}
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">
                  {l.agora ? formatNumber(l.agora.qtd) : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    {l.antes ? formatNumber(l.antes.qtd) : '—'}
                    {v.pct != null && v.direcao !== 'igual' && (
                      <span className={cn(
                        'inline-flex items-center text-[10px]',
                        v.direcao === 'subiu' ? 'text-emerald-400' : 'text-red-400',
                      )}>
                        <Icone className="h-3 w-3" />
                        {Math.abs(v.pct).toFixed(0)}%
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {l.agora?.adesao_pct != null ? `${l.agora.adesao_pct.toFixed(1)}%` : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {l.agora ? formatCurrency(l.agora.faturamento) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
