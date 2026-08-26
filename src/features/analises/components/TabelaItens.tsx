import { ItemVendido, variacao } from '../metricas';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { ArrowDown, ArrowUp } from 'lucide-react';

/**
 * O bloco de ofertas: oferta principal e cada order bump pelo nome.
 *
 * É a única parte da tela em várias colunas, e de propósito: aqui cada coluna é
 * uma medida diferente da MESMA oferta (quanto vendeu, quanto rendeu, que fatia
 * das vendas levou), então comparar na horizontal significa alguma coisa. No
 * resto da tela cada linha é uma métrica diferente, e ali coluna só atrapalha.
 *
 * Os bumps saem de `venda_itens`, não de campo digitado. Uma oferta que vendia
 * e parou some da lista atual, então ela também precisa aparecer: por isso a
 * união dos dois períodos, e não só do atual.
 *
 * Upsell não entra: por decisão dela a análise olha só a venda de front e seus
 * order bumps — upsell mede a oferta de outra página.
 */

interface Linha {
  nome: string;
  qtd: number;
  antes: number | null;
  valor: number;
  adesao: number | null;
  forte?: boolean;
}

interface Props {
  atual: ItemVendido[];
  anterior: ItemVendido[];
  principal: { qtd: number; valor: number; antesQtd: number };
}

export function TabelaItens({ atual, anterior, principal }: Props) {
  const antesPor = new Map(anterior.map(i => [i.nome, i]));
  const nomes = [...new Set([...atual.map(i => i.nome), ...anterior.map(i => i.nome)])];

  const linhas: Linha[] = [
    {
      nome: 'Oferta principal', forte: true,
      qtd: principal.qtd, antes: principal.antesQtd,
      valor: principal.valor, adesao: null,
    },
    ...nomes
      .map(nome => {
        const agora = atual.find(i => i.nome === nome) ?? null;
        return {
          nome,
          qtd: agora?.qtd ?? 0,
          antes: antesPor.get(nome)?.qtd ?? null,
          valor: agora?.faturamento ?? 0,
          adesao: agora?.adesao_pct ?? null,
        };
      })
      .sort((a, b) => b.qtd - a.qtd),
  ];

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm min-w-[34rem]">
        <thead>
          <tr className="border-b border-border bg-secondary/40 text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="text-left  font-medium px-3 py-1.5">Oferta</th>
            <th className="text-right font-medium px-3 py-1.5 w-24">Qtd</th>
            <th className="text-right font-medium px-3 py-1.5 w-28">Antes</th>
            <th className="text-right font-medium px-3 py-1.5 w-32">Valor</th>
            <th className="text-right font-medium px-3 py-1.5 w-24">Adesão</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map(l => {
            const v = variacao(l.qtd, l.antes);
            const Icone = v.direcao === 'subiu' ? ArrowUp : ArrowDown;
            return (
              <tr key={l.nome} className={cn(
                'border-b border-border/40 last:border-0',
                l.forte && 'bg-secondary/20',
              )}>
                <td className={cn('px-3 py-2', l.forte && 'font-semibold')}>{l.nome}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">
                  {formatNumber(l.qtd)}
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
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(l.valor)}</td>
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
