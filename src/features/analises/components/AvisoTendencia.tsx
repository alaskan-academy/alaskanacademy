import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';

/** Um ponto da série. `fonte` é o que impede a linha de esconder duas verdades. */
interface Ponto {
  n: number;
  inicio: string;
  fim: string;
  fonte: 'analise' | 'calculado';
  investimento: number | null;
  vendas: number | null;
  cpa: number | null;
  roas: number | null;
}

interface Tendencia {
  funil_id: string;
  rev: string;
  produto: string | null;
  pontos: Ponto[];
  pontos_de_analise: number;
  menor_investimento: number | null;
  cpa1: number | null; cpa2: number | null; cpa3: number | null;
  roas1: number | null; roas2: number | null; roas3: number | null;
  cpa_piorando: boolean;
  roas_piorando: boolean;
}

/** Uma métrica acusada, já com a série na ordem e a direção certa. */
function Trilha({ rotulo, valores, formato }: {
  rotulo: string;
  valores: (number | null)[];
  formato: (n: number) => string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1 tabular-nums">
      <span className="text-muted-foreground">{rotulo}</span>
      {valores.map((v, i) => (
        <span key={i} className="inline-flex items-baseline gap-1">
          {i > 0 && <span className="text-muted-foreground/40">→</span>}
          <span className={i === valores.length - 1 ? 'font-medium text-warning' : 'text-muted-foreground/70'}>
            {v == null ? '—' : formato(v)}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * "Esta métrica vem piorando há três janelas."
 *
 * A pergunta que a rodada não responde: ela compara DOIS períodos, e duas
 * leituras seguidas de "piorou um pouco" não somam sozinhas na cabeça de
 * ninguém. Três janelas na mesma direção somam.
 *
 * A SÉRIE MISTURA DUAS FONTES, e isso está à mostra de propósito. O retrato da
 * análise tem preferência; onde não houve análise, a janela é recalculada
 * agora. Foi decisão dela em 24/09/2026, com o risco dito: são duas fontes
 * alimentando o mesmo número, que é a primeira armadilha do CLAUDE.md. A
 * mitigação possível era não deixar a linha esconder qual é qual — por isso
 * cada ponto carrega `fonte` e a tela diz quantos vieram de análise.
 *
 * Hoje quase toda série é recalculada: existem 2 rodadas e 7 itens, e nenhum
 * REV foi analisado duas vezes. A proporção se inverte sozinha conforme as
 * rodadas acontecem.
 */
export function AvisoTendencia({ aoAbrir }: { aoAbrir?: (funilId: string) => void }) {
  const [itens, setItens] = useState<Tendencia[]>([]);

  useEffect(() => {
    const carregar = async () => {
      /* Sem filtro no PostgREST, de propósito. A primeira versão usava
         `.or('cpa_piorando.eq.true,...')` e voltava vazia sem erro — booleano
         em `or` tem sintaxe própria, e o modo de falhar é o pior possível:
         zero linhas é indistinguível de "nada piorando". A view tem uma linha
         por REV ativo (10 hoje), então peneirar aqui não custa nada e não tem
         como enganar. */
      const { data, error } = await supabase
        .from('vw_rev_tendencia')
        .select('*');
      if (error) {
        /* Falha não vira bloco vazio calado: bloco vazio aqui se lê como "nada
           piorando", que é a leitura mais cara possível. */
        console.error('vw_rev_tendencia:', error.message);
        return;
      }
      setItens(((data ?? []) as Tendencia[]).filter(t => t.cpa_piorando || t.roas_piorando));
    };
    void carregar();
  }, []);

  if (itens.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-medium text-warning">
          {itens.length === 1 ? '1 REV vem piorando' : `${itens.length} REVs vêm piorando`} há três janelas
        </span>
        <span className="text-xs text-muted-foreground">
          janelas de 14 dias · só REVs com mais de {formatCurrency(1000)} em cada uma
        </span>
      </div>

      <div className="mt-2 flex flex-col gap-1.5">
        {itens.map(t => {
          const deAnalise = t.pontos_de_analise;
          return (
            <div key={t.funil_id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
              {/* O nome do REV sozinho é ambíguo: há CINCO funis chamados
                  "REV1 - Original", um por produto. */}
              {aoAbrir ? (
                <button
                  type="button"
                  onClick={() => aoAbrir(t.funil_id)}
                  className="font-medium text-foreground hover:text-primary hover:underline"
                >
                  {t.rev} <span className="text-muted-foreground">· {t.produto ?? '—'}</span>
                </button>
              ) : (
                <span className="font-medium text-foreground">
                  {t.rev} <span className="text-muted-foreground">· {t.produto ?? '—'}</span>
                </span>
              )}

              {t.cpa_piorando && (
                <Trilha rotulo="CPA" valores={[t.cpa1, t.cpa2, t.cpa3]} formato={formatCurrency} />
              )}
              {t.roas_piorando && (
                <Trilha rotulo="ROAS" valores={[t.roas1, t.roas2, t.roas3]} formato={n => n.toFixed(2)} />
              )}

              {/* De onde vieram os números. Sem isto a linha parece uma série só. */}
              <span
                className={cn('text-muted-foreground/60',
                              deAnalise === 0 && 'text-muted-foreground/40')}
                title={
                  deAnalise === 0
                    ? 'Nenhum ponto veio de uma análise gravada: os três foram recalculados agora, então uma venda recategorizada pode mudar este passado.'
                    : `${deAnalise} de 3 pontos vieram do retrato gravado na análise; o resto foi recalculado agora.`
                }
              >
                {deAnalise === 0 ? 'tudo recalculado' : `${deAnalise}/3 de análise`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
