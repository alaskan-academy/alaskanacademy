import { ItemVendido, variacao } from '../metricas';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { ArrowDown, ArrowUp } from 'lucide-react';

/**
 * O bloco de ofertas: oferta principal e cada order bump pelo nome.
 *
 * A ADESÃO é o número em evidência, a pedido dela, e é a escolha certa: 103
 * unidades do Combo não dizem nada sem saber sobre quantas vendas; 24,94% diz.
 * O montante e a contagem descem para a linha de baixo, dentro da mesma coluna,
 * para que "agora" e "antes" continuem comparáveis de cima a baixo.
 *
 * É a única parte da tela em várias colunas, e de propósito: aqui cada coluna é
 * o mesmo par de medidas em dois períodos. No resto da tela cada linha é uma
 * métrica diferente, e ali coluna só atrapalha.
 *
 * Os bumps saem de `venda_itens`, não de campo digitado. Uma oferta que vendia
 * e parou some da lista atual, então ela também precisa aparecer: por isso a
 * união dos dois períodos.
 */

interface Linha {
  nome: string;
  adesao: number | null;
  valor: number;
  qtd: number;
  adesaoAntes: number | null;
  valorAntes: number;
  qtdAntes: number;
  forte?: boolean;
}

interface Props {
  atual: ItemVendido[];
  anterior: ItemVendido[];
  principal: { qtd: number; valor: number; antesQtd: number; antesValor: number };
}

function Celula({ adesao, valor, qtd, secundaria = false }: {
  adesao: number | null; valor: number; qtd: number; secundaria?: boolean;
}) {
  return (
    <>
      <span className={cn(
        'block tabular-nums',
        secundaria ? 'text-[11px] text-muted-foreground' : 'text-sm font-semibold',
      )}>
        {adesao != null ? `${adesao.toFixed(2)}%` : '—'}
      </span>
      <span className={cn(
        'block tabular-nums mt-0.5',
        secundaria ? 'text-[10px] text-muted-foreground/70' : 'text-[10px] text-muted-foreground',
      )}>
        {formatCurrency(valor)} · {formatNumber(qtd)}
      </span>
    </>
  );
}

export function TabelaItens({ atual, anterior, principal }: Props) {
  const antesPor = new Map(anterior.map(i => [i.nome, i]));
  const nomes = [...new Set([...atual.map(i => i.nome), ...anterior.map(i => i.nome)])];

  const linhas: Linha[] = [
    {
      nome: 'Oferta principal', forte: true,
      // Adesão da oferta principal é 100% por definição — mostrar isso seria
      // ocupar a coluna com um número que nunca muda.
      adesao: null, valor: principal.valor, qtd: principal.qtd,
      adesaoAntes: null, valorAntes: principal.antesValor, qtdAntes: principal.antesQtd,
    },
    ...nomes
      .map(nome => {
        const agora = atual.find(i => i.nome === nome) ?? null;
        const antes = antesPor.get(nome) ?? null;
        return {
          nome,
          adesao: agora?.adesao_pct ?? null,
          valor: agora?.faturamento ?? 0,
          qtd: agora?.qtd ?? 0,
          adesaoAntes: antes?.adesao_pct ?? null,
          valorAntes: antes?.faturamento ?? 0,
          qtdAntes: antes?.qtd ?? 0,
        };
      })
      .sort((a, b) => (b.adesao ?? 0) - (a.adesao ?? 0)),
  ];

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm min-w-[26rem]">
        <thead>
          <tr className="border-b border-border bg-secondary/40 text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="text-left  font-medium px-3 py-1">Oferta</th>
            <th className="text-right font-medium px-3 py-1 w-36">Agora</th>
            <th className="text-right font-medium px-3 py-1 w-16" />
            <th className="text-right font-medium px-3 py-1 w-36">Anterior</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map(l => {
            // A variação segue a adesão, que é o número em evidência.
            const v = variacao(l.adesao, l.adesaoAntes);
            const Icone = v.direcao === 'subiu' ? ArrowUp : ArrowDown;
            return (
              <tr key={l.nome} className={cn(
                'border-b border-border/40 last:border-0 align-top',
                l.forte && 'bg-secondary/20',
              )}>
                <td className={cn('px-3 py-2 text-sm', l.forte && 'font-semibold')}>{l.nome}</td>
                <td className="px-3 py-2 text-right">
                  <Celula adesao={l.adesao} valor={l.valor} qtd={l.qtd} />
                </td>
                <td className="px-3 py-2 text-right">
                  {v.pct != null && v.direcao !== 'igual' && (
                    <span className={cn(
                      'inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums',
                      v.direcao === 'subiu' ? 'text-emerald-400' : 'text-red-400',
                    )}>
                      <Icone className="h-3 w-3" />
                      {Math.abs(v.pct).toFixed(1)}%
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <Celula adesao={l.adesaoAntes} valor={l.valorAntes} qtd={l.qtdAntes} secundaria />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
