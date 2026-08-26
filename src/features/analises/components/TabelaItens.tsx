import { ItemVendido, variacao } from '../metricas';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { ArrowDown, ArrowUp } from 'lucide-react';

/**
 * O bloco de ofertas da planilha: oferta principal, cada order bump pelo nome,
 * e os upsells — com quantidade, valor e adesão, na mesma leitura de sempre.
 *
 * Os bumps saem de `venda_itens`, não de campo digitado. Uma oferta que vendia
 * e parou some da lista atual, então ela também precisa aparecer: por isso a
 * união dos dois períodos, e não só do atual.
 */

interface Linha {
  nome: string;
  qtd: number | null;
  antes: number | null;
  valor: number | null;
  adesao: number | null;
  forte?: boolean;
}

interface Props {
  atual: ItemVendido[];
  anterior: ItemVendido[];
  principal: { qtd: number; valor: number; antesQtd: number };
  upsell: { qtd: number; valor: number; antesQtd: number; adesao: number | null };
}

export function TabelaItens({ atual, anterior, principal, upsell }: Props) {
  const antesPor = new Map(anterior.map(i => [i.nome, i]));
  const nomes = [...new Set([...atual.map(i => i.nome), ...anterior.map(i => i.nome)])];

  const bumps: Linha[] = nomes
    .map(nome => {
      const agora = atual.find(i => i.nome === nome) ?? null;
      const antes = antesPor.get(nome) ?? null;
      return {
        nome,
        qtd: agora?.qtd ?? 0,
        antes: antes?.qtd ?? null,
        valor: agora?.faturamento ?? 0,
        adesao: agora?.adesao_pct ?? null,
      };
    })
    .sort((a, b) => (b.qtd ?? 0) - (a.qtd ?? 0));

  const linhas: Linha[] = [
    {
      nome: 'Oferta principal',
      qtd: principal.qtd, antes: principal.antesQtd,
      valor: principal.valor, adesao: null, forte: true,
    },
    ...bumps,
    {
      nome: 'Upsells',
      qtd: upsell.qtd, antes: upsell.antesQtd,
      valor: upsell.valor, adesao: upsell.adesao, forte: true,
    },
  ];

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary/40 text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="text-left  font-medium px-3 py-2">Oferta</th>
            <th className="text-right font-medium px-3 py-2">Qtd</th>
            <th className="text-right font-medium px-3 py-2">Antes</th>
            <th className="text-right font-medium px-3 py-2">Valor</th>
            <th className="text-right font-medium px-3 py-2">Adesão</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map(l => {
            const v = variacao(l.qtd, l.antes);
            const Icone = v.direcao === 'subiu' ? ArrowUp : ArrowDown;
            return (
              <tr key={l.nome} className={cn(
                'border-b border-border/50 last:border-0',
                l.forte && 'bg-secondary/20',
              )}>
                <td className={cn('px-3 py-2', l.forte && 'font-semibold')}>{l.nome}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">
                  {l.qtd != null ? formatNumber(l.qtd) : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    {l.antes != null ? formatNumber(l.antes) : '—'}
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
                  {l.valor != null ? formatCurrency(l.valor) : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {l.adesao != null ? `${l.adesao.toFixed(2)}%` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
