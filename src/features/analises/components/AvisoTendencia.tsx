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
  aov: number | null;
  /* As que explicam. Vivem só aqui, e não como colunas c1/c2/c3: aquelas
     existem porque os booleanos precisam delas, e duplicar o que já está na
     série seria o mesmo número em dois lugares. */
  cpv: number | null;
  conv_funil_pct: number | null;
  conv_checkout_pct: number | null;
  bump_adesao_pct: number | null;
  upsell_adesao_pct: number | null;
  margem_pct: number | null;
}

/**
 * O que explica, sem virar alarme.
 *
 * Cada uma separa uma causa diferente do que o alarme acusou. `pior` é a
 * direção que conta como piora, e é o que impede "margem subiu" de aparecer
 * como explicação de alarme.
 */
export const EXPLICAM = [
  { campo: 'cpv',               rotulo: 'CPV',                 pior: 'sobe', moeda: true  },
  { campo: 'conv_funil_pct',    rotulo: 'conversão do funil',  pior: 'desce', moeda: false },
  { campo: 'conv_checkout_pct', rotulo: 'conversão do checkout', pior: 'desce', moeda: false },
  { campo: 'bump_adesao_pct',   rotulo: 'adesão ao bump',      pior: 'desce', moeda: false },
  { campo: 'upsell_adesao_pct', rotulo: 'adesão ao upsell',    pior: 'desce', moeda: false },
  { campo: 'margem_pct',        rotulo: 'margem',              pior: 'desce', moeda: false },
] as const;

/** Três janelas na mesma direção ruim — o mesmo teste dos alarmes. */
export function pioraSeguida(vals: (number | null)[], pior: 'sobe' | 'desce'): boolean {
  if (vals.length !== 3 || vals.some(v => v == null)) return false;
  const [a, b, c] = vals as number[];
  return pior === 'sobe' ? b > a && c > b : b < a && c < b;
}

/**
 * O que andou junto do alarme.
 *
 * Mostra SÓ as que também pioraram nas três janelas, e não todas as seis: a
 * linha existe para apontar onde olhar, e seis séries em cinza por REV viram a
 * mesma parede de número que o aviso veio evitar.
 *
 * Quando nenhuma anda junto, isso é um achado e não um vazio: significa que a
 * queda não veio de nenhuma das causas conhecidas, e a tela diz isso em vez de
 * sumir com a linha.
 */
function Explicacao({ pontos }: { pontos: Ponto[] }) {
  const todas = EXPLICAM.map(e => {
    const vals = pontos.map(p => p[e.campo] as number | null);
    return {
      ...e, vals,
      // Série incompleta não é "segurou": é "não sei". REV sem upsell tem a
      // adesão nula nas três janelas, e listá-la como quem segurou seria
      // inventar uma estabilidade que ninguém mediu.
      completa: vals.length === 3 && vals.every(v => v != null),
    };
  });

  const juntas   = todas.filter(e => e.completa && pioraSeguida(e.vals, e.pior));
  const seguram  = todas.filter(e => e.completa && !pioraSeguida(e.vals, e.pior));
  const semDado  = todas.filter(e => !e.completa);

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 pl-0.5 text-[11px]">
      {juntas.length === 0 ? (
        <span className="text-muted-foreground/50">
          nenhuma outra métrica acompanhou — a queda não veio das causas que a tela conhece
        </span>
      ) : (
        <>
          <span className="text-muted-foreground/50">e junto:</span>
          {juntas.map(e => (
            <span key={e.campo} className="inline-flex items-baseline gap-1 tabular-nums text-muted-foreground/70">
              <span className="text-muted-foreground/50">{e.rotulo}</span>
              {e.vals.map((v, i) => (
                <span key={i} className="inline-flex items-baseline gap-1">
                  {i > 0 && <span className="text-muted-foreground/30">→</span>}
                  {v == null ? '—' : e.moeda ? formatCurrency(v) : `${v.toFixed(1)}%`}
                </span>
              ))}
            </span>
          ))}
        </>
      )}

      {/*
        O que SEGUROU, e é metade do diagnóstico.

        A linha de cima sozinha diz o que piorou; é a ausência que fecha a
        leitura. No REV1 de 04/10/2026 o CPV subiu e a margem caiu, mas a
        conversão do funil ficou parada em 2,1% — e foi isso que mostrou que a
        página não piorou, o tráfego é que ficou caro.

        Sem esta parte, uma métrica estável simplesmente não aparecia, e
        ausência é invisível: quem lê não tem como distinguir "segurou" de
        "nem está na lista".

        Nomes sem série de propósito. O que importa aqui é QUAIS seguraram; pôr
        três números em cada uma devolveria a parede de número que o aviso veio
        evitar, e a série está a um clique no REV.
      */}
      {seguram.length > 0 && (
        <span className="inline-flex items-baseline gap-1 text-muted-foreground/40">
          <span>segurou:</span>
          <span>{seguram.map(e => e.rotulo).join(' · ')}</span>
          {/* Sem isto, "segurou: X" daria a entender que as outras cinco
              pioraram — inclusive as que ninguém mediu. */}
          {semDado.length > 0 && (
            <span className="text-muted-foreground/30">
              ({semDado.length} sem dado)
            </span>
          )}
        </span>
      )}
    </div>
  );
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
  aov1: number | null; aov2: number | null; aov3: number | null;
  cpa_piorando: boolean;
  roas_piorando: boolean;
  /* AOV é o terceiro alarme porque NÃO é consequência dos outros dois: ele cai
     quando o mix de oferta muda, e isso acontece com o ROAS firme. Medido em
     04/10/2026: o REV3 - VSL do Saponaria estava com 89,33 → 88,32 → 87,84 e
     CPA e ROAS parados — invisível até existir este alarme. */
  aov_piorando: boolean;
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
 * MORA NO HISTÓRICO, e não no Comparar, desde 04/10/2026. O Comparar responde
 * "qual REV eu corto HOJE": é uma foto, com todos os REVs lado a lado no mesmo
 * período. Este aviso é o contrário — um REV só, ao longo do tempo. Posto lá,
 * ele disputava a atenção com a tabela que a pessoa foi ver, e o eixo dele é o
 * do Histórico.
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
      setItens(((data ?? []) as Tendencia[]).filter(t => t.cpa_piorando || t.roas_piorando || t.aov_piorando));
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
            <div key={t.funil_id} className="space-y-0.5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
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
              {t.aov_piorando && (
                <Trilha rotulo="AOV" valores={[t.aov1, t.aov2, t.aov3]} formato={formatCurrency} />
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
            <Explicacao pontos={t.pontos} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
