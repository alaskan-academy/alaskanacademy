import { cn } from '@/lib/utils';
import { AlertTriangle, Trophy, TrendingUp, Wallet } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { ColunaRev } from './TabelaLadoALado';

/**
 * O resumo da comparação, e uma sugestão de vencedor.
 *
 * A sugestão é por LUCRO POR REAL INVESTIDO, e não por lucro absoluto, porque a
 * pergunta que a tela responde é para onde vai o próximo real. Lucro absoluto
 * premia quem já recebe mais verba: um REV que gasta 20 mil e lucra 9 mil ganha
 * de um que gasta 2 mil e lucra 2 mil, mesmo o segundo devolvendo o dobro por
 * real. Escalar o segundo é a decisão certa, e o critério tem que enxergar isso.
 *
 * O eleito NÃO é apresentado como veredito. Aparecem os três recortes que podem
 * discordar entre si — mais eficiente, mais dinheiro no bolso, página mais
 * saudável —, e quando discordam a tela diz isso em voz alta, em vez de escolher
 * por ela. Foi o caso que ela mesma levantou: "não faz sentido sacrificar o
 * funil que entrega mais dinheiro", e o inverso também não.
 *
 * Front que não se paga desqualifica a sugestão de escala, mesmo com lucro
 * total no azul: escalar tráfego que não se paga só aumenta o buraco.
 */

interface Props {
  colunas: ColunaRev[];
}

/** Lucro por real investido. Sem investimento não há eficiência a medir. */
function eficiencia(c: ColunaRev): number | null {
  if (c.atual.investimento <= 0) return null;
  return c.atual.lucro_com_upsell / c.atual.investimento;
}

function melhorPor<T>(
  colunas: ColunaRev[], chave: (c: ColunaRev) => T | null,
): ColunaRev | null {
  const validos = colunas.filter(c => chave(c) != null);
  if (validos.length < 2) return null;
  return validos.reduce((a, b) => ((chave(b) as number) > (chave(a) as number) ? b : a));
}

export function ResumoComparacao({ colunas }: Props) {
  const maisEficiente = melhorPor(colunas, eficiencia);
  const maisLucro     = melhorPor(colunas, c => c.atual.lucro_com_upsell);
  const melhorFront   = melhorPor(colunas, c => c.atual.roas);

  if (!maisEficiente) return null;

  const ef = eficiencia(maisEficiente);
  const escalavel = maisEficiente.atual.front_se_paga !== false && (ef ?? 0) > 0;

  // Quem está no vermelho precisa aparecer mesmo não sendo o assunto do card.
  const noVermelho = colunas.filter(c => c.atual.lucro_com_upsell < 0);
  const discordam = new Set([
    maisEficiente.funil_id,
    maisLucro?.funil_id,
    melhorFront?.funil_id,
  ].filter(Boolean)).size > 1;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-baseline gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Resumo da comparação
        </h3>
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3 py-2.5',
        escalavel
          ? 'border-emerald-500/30 bg-emerald-500/[0.07]'
          : 'border-amber-500/30 bg-amber-500/10',
      )}>
        <Trophy className={cn('h-4 w-4 mt-0.5 shrink-0',
          escalavel ? 'text-emerald-400' : 'text-amber-400')} />
        <div className="text-xs space-y-1">
          <p>
            <strong className="text-sm">{maisEficiente.rev}</strong>
            {maisEficiente.projeto && (
              <span className="text-muted-foreground"> · {maisEficiente.projeto}</span>
            )}
            {' — '}
            {ef != null && (
              <>devolve <strong>{formatCurrency(ef)}</strong> de lucro por real investido</>
            )}
            {escalavel
              ? ', e o front dele se paga. É para onde o próximo real rende mais.'
              : maisEficiente.atual.front_se_paga === false
                ? '. Mas o front dele não se paga: escalar tráfego que não se paga só aumenta o buraco.'
                : '. Nenhum dos comparados devolve lucro no período.'}
          </p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {maisLucro && (
          <div className="flex items-start gap-2 rounded-md border border-border px-3 py-2">
            <Wallet className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
            <div className="text-xs">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Mais dinheiro no bolso
              </div>
              <div className="mt-0.5">
                <strong>{maisLucro.rev}</strong>
                <span className="text-muted-foreground tabular-nums">
                  {' · '}{formatCurrency(maisLucro.atual.lucro_com_upsell)}
                </span>
              </div>
            </div>
          </div>
        )}

        {melhorFront && (
          <div className="flex items-start gap-2 rounded-md border border-border px-3 py-2">
            <TrendingUp className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
            <div className="text-xs">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Página mais saudável
              </div>
              <div className="mt-0.5">
                <strong>{melhorFront.rev}</strong>
                <span className="text-muted-foreground tabular-nums">
                  {' · ROAS de front '}{melhorFront.atual.roas?.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Quando os três recortes apontam para REVs diferentes, dizer isso é
          mais útil que eleger um: é exatamente a tensão que ela descreveu entre
          "entrega mais dinheiro" e "precisa de otimização". */}
      {discordam && (
        <p className="text-[11px] text-muted-foreground">
          Os critérios não apontam para o mesmo REV — o que rende mais por real
          não é o que entrega mais dinheiro nem o que tem a melhor página. Escalar
          e otimizar aqui são decisões separadas.
        </p>
      )}

      {noVermelho.length > 0 && (
        <p className="text-[11px] text-amber-400/90 flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
          <span>
            {noVermelho.length === 1
              ? <><strong>{noVermelho[0].rev}</strong> fechou no vermelho: {formatCurrency(noVermelho[0].atual.lucro_com_upsell)} mesmo com o upsell.</>
              : <>{noVermelho.length} dos comparados fecharam no vermelho mesmo com o upsell: {noVermelho.map(c => c.rev).join(', ')}.</>}
          </span>
        </p>
      )}
    </div>
  );
}
