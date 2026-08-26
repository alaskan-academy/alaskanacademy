import { Fragment } from 'react';
import { cn } from '@/lib/utils';
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Crown } from 'lucide-react';
import { BlocoMetricas, variacao } from '../metricas';
import { LINHAS_COMPARACAO, indiceVencedor } from '../comparacao';

/**
 * A comparação transposta: uma linha por métrica, uma coluna por REV.
 *
 * É o desenho certo para "qual funil eu corto", porque a comparação acontece na
 * horizontal — o olho corre a linha do ROAS e vê os quatro de uma vez, em vez
 * de descer quatro telas guardando números na cabeça, que é como se decide
 * errado.
 *
 * A coluna vencedora de cada linha vem marcada, mas só onde existe direção de
 * verdade. Investimento não tem vencedor: gastar mais não é melhor nem pior, e
 * pintar de verde quem mais gastou ensinaria a ler errado.
 */

export interface ColunaRev {
  funil_id: string;
  rev: string;
  projeto: string | null;
  metodo: string | null;
  atual: BlocoMetricas;
  anterior: BlocoMetricas;
}

export function TabelaLadoALado({ colunas }: { colunas: ColunaRev[] }) {
  let grupoAnterior = '';

  return (
    <div className="space-y-1.5">
      {/* A legenda existe porque a pergunta apareceu: numa tabela de
          comparação, uma % ao lado do número convida a ser lida como "em
          relação à outra coluna". Ela é contra o passado do próprio REV, e
          isso precisa estar escrito, não deduzido. */}
      <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1">
          <ArrowUp className="h-3 w-3 text-emerald-400" />
          <ArrowDown className="h-3 w-3 text-red-400" />
          variação de cada REV contra o próprio período anterior — não contra a outra coluna
        </span>
        <span className="inline-flex items-center gap-1">
          <Crown className="h-3 w-3 text-emerald-400/80" />
          melhor da linha entre os REVs comparados
        </span>
      </p>

      <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-base">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-border bg-secondary/60">
            <th className="text-left font-medium px-3 py-2 w-60 min-w-[15rem] text-xs uppercase tracking-wide text-muted-foreground align-bottom">
              <span className="block">Métrica</span>
              <span className="block normal-case tracking-normal font-normal text-muted-foreground/70 mt-0.5">
                valor no período · vs. anterior
              </span>
            </th>
            {colunas.map(c => (
              <th key={c.funil_id} className="px-3 py-2 text-right min-w-[10.5rem]">
                <div className="flex items-center justify-end gap-1.5">
                  {/* O sinal de saúde do front vem no cabeçalho: é o que
                      qualifica a coluna inteira abaixo dele. */}
                  {c.atual.front_se_paga != null && (c.atual.front_se_paga
                    ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400/70" />
                    : <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />)}
                  <span className="text-base font-semibold">{c.rev}</span>
                </div>
                <div className="text-xs font-normal text-muted-foreground mt-0.5">
                  {c.projeto ?? 'sem projeto'}{c.metodo ? ` · ${c.metodo}` : ''}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {LINHAS_COMPARACAO.map(def => {
            const valores = colunas.map(c => def.valor(c.atual));
            const vencedor = indiceVencedor(valores, def.melhorEh);
            const abreGrupo = def.grupo !== grupoAnterior;
            grupoAnterior = def.grupo;

            return (
              <Fragment key={`${def.grupo}-${def.rotulo}`}>
                {abreGrupo && (
                  <tr className="bg-secondary/25">
                    <td
                      colSpan={colunas.length + 1}
                      className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {def.grupo}
                    </td>
                  </tr>
                )}
                <tr className="border-b border-border/40 last:border-0">
                  <td className="px-3 py-1.5 text-sm">{def.rotulo}</td>
                  {colunas.map((c, i) => {
                    const v = valores[i];
                    const ant = def.valor(c.anterior);
                    const varia = variacao(v, ant);
                    const bom = varia.direcao === 'igual' ? null
                      : (varia.direcao === 'subiu') !== Boolean(def.subirEhRuim);
                    const Icone = varia.direcao === 'subiu' ? ArrowUp : ArrowDown;

                    return (
                      <td key={c.funil_id} className={cn(
                        'px-3 py-1.5 text-right tabular-nums',
                        vencedor === i && 'bg-emerald-500/[0.07]',
                      )}>
                        <span className="inline-flex items-baseline justify-end gap-1.5">
                          {vencedor === i && (
                            <Crown className="h-3 w-3 shrink-0 text-emerald-400/80 self-center" />
                          )}
                          <span className={cn(
                            'text-base',
                            vencedor === i ? 'font-semibold' : 'font-medium',
                          )}>
                            {v == null ? '—' : def.formato(v)}
                          </span>
                          {varia.pct != null && varia.direcao !== 'igual' && (
                            <span className={cn(
                              'text-xs font-medium',
                              bom ? 'text-emerald-400' : 'text-red-400',
                            )}>
                              <Icone className="h-3 w-3 inline" />
                              {Math.abs(varia.pct) >= 1000
                                ? `${(Math.abs(varia.pct) / 100).toFixed(0)}×`
                                : `${Math.abs(varia.pct).toFixed(0)}%`}
                            </span>
                          )}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
