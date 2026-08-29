import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';

/**
 * O número de cada AD, para as telas de Criativos.
 *
 * POR QUE EXISTE
 *
 * Avaliar um criativo sem ver o que ele fez é chutar. As telas de Criativos
 * listavam nome, formato, ângulo e editor — e nenhum número: quem ia marcar
 * "Validado" ou "Não validado" tinha que abrir o Meta Ads noutra aba, achar o
 * AD e voltar.
 *
 * A conta mora em `fn_criativos_metricas`, no banco, e não aqui: o mesmo
 * criativo sobe como vários anúncios no Meta, e CTR, CPC, CPM, hook, ROAS e AOV
 * NÃO SE SOMAM entre eles — têm que ser recalculados sobre os totais. Escrever
 * essa conta em cada componente é como duas telas passam a discordar.
 *
 * PAYT E META LADO A LADO, SEMPRE
 *
 * As duas contam venda de jeitos diferentes e discordam bastante — há card com
 * 527 vendas pela Meta e 0 pela Payt. Mostrar só uma esconde a discordância;
 * mostrar as duas transforma a diferença em informação. Laranja é Payt e azul é
 * Meta, os mesmos tokens que o Meta Ads já usa.
 */
export interface MetricasDoAd {
  producao_id: string;
  ads: number;
  investimento: number | null;
  impressoes: number | null;
  cliques_link: number | null;
  vendas: number | null;
  receita: number | null;
  vendas_meta: number | null;
  receita_meta: number | null;
  hook: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  cpa: number | null;
  roas: number | null;
  roas_meta: number | null;
  aov: number | null;
  aov_meta: number | null;
}

/**
 * Carrega as métricas por card.
 *
 * `ini`/`fim` nulos significam a vida inteira do anúncio, que é o recorte certo
 * para avaliar um criativo: julgar uma peça pelo que ela fez no mês corrente
 * reprova todo AD que estreou ontem.
 */
export function useMetricasDoAd(ini?: string | null, fim?: string | null) {
  const [mapa, setMapa] = useState<Map<string, MetricasDoAd>>(new Map());
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      setCarregando(true);
      const { data, error } = await supabase.rpc('fn_criativos_metricas', {
        p_ini: ini ?? null,
        p_fim: fim ?? null,
      });
      if (!vivo) return;
      if (error) {
        console.error('fn_criativos_metricas:', error.message);
        setMapa(new Map());
      } else {
        const linhas = (data ?? []) as MetricasDoAd[];
        setMapa(new Map(linhas.map(l => [l.producao_id, l])));
      }
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [ini, fim]);

  return { metricas: mapa, carregandoMetricas: carregando };
}

const PAYT = 'text-[hsl(var(--fonte-payt))]';
const META = 'text-[hsl(var(--fonte-meta))]';

/** `1,52` vira `1,52x`; nulo vira travessão, nunca zero. */
const x = (v: number | null) => (v == null ? '—' : `${formatNumber(v)}x`);
const pct = (v: number | null) => (v == null ? '—' : `${formatNumber(v)}%`);
const rs = (v: number | null) => (v == null ? '—' : formatCurrency(v));

function Item({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-muted-foreground/60">{rotulo} </span>
      <span className="tabular-nums text-foreground">{children}</span>
    </span>
  );
}

/**
 * A tira de números que fica embaixo do AD.
 *
 * Ordem por quanto decide: primeiro o dinheiro (verba, ROAS, vendas, AOV),
 * depois o criativo (hook, CTR) e por último o custo unitário (CPC, CPM). Quem
 * avalia pergunta "deu retorno?" antes de "qual foi o CPM?".
 */
export function TiraDeMetricas({ m, className }: { m?: MetricasDoAd; className?: string }) {
  /*
    Sem anúncio vinculado, a tira some — não vira frase.

    A primeira versão escrevia "sem anúncio vinculado a este card" em cada linha
    sem dado. Com o filtro em "Personalizado" a lista passa de 2.700 criativos,
    a maioria de 2024 e sem anúncio nenhum: a explicação aparecia centenas de
    vezes seguidas e virava o conteúdo da tela. A ausência da tira já diz o que
    a frase dizia, e não custa uma linha por criativo.
  */
  if (!m) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]', className)}>
      <Item rotulo="verba">{rs(m.investimento)}</Item>

      <Item rotulo="ROAS">
        <span className={PAYT}>{x(m.roas)}</span>
        <span className="text-muted-foreground/40"> / </span>
        <span className={META}>{x(m.roas_meta)}</span>
      </Item>

      <Item rotulo="vendas">
        <span className={PAYT}>{m.vendas ?? 0}</span>
        <span className="text-muted-foreground/40"> / </span>
        <span className={META}>{m.vendas_meta ?? 0}</span>
      </Item>

      <Item rotulo="AOV">
        <span className={PAYT}>{rs(m.aov)}</span>
        <span className="text-muted-foreground/40"> / </span>
        <span className={META}>{rs(m.aov_meta)}</span>
      </Item>

      <span className="text-muted-foreground/25">|</span>

      <Item rotulo="hook">{pct(m.hook)}</Item>
      <Item rotulo="CTR">{pct(m.ctr)}</Item>
      <Item rotulo="CPC">{rs(m.cpc)}</Item>
      <Item rotulo="CPM">{rs(m.cpm)}</Item>

      {/* Quantos anúncios o card virou. Um CTR de 2,26% que sai de seis
          anúncios diz outra coisa que o mesmo número saído de um só. */}
      {m.ads > 1 && (
        <span className="text-muted-foreground/40">{m.ads} anúncios</span>
      )}
    </div>
  );
}

/**
 * A legenda de qual cor é qual fonte.
 *
 * Uma vez por tela, no cabeçalho da lista — repetir em cada linha seria ruído,
 * e não repetir em lugar nenhum deixaria duas cores sem explicação.
 */
export function LegendaFontes({ className }: { className?: string }) {
  return (
    <span className={cn('text-[10px] text-muted-foreground/60', className)}>
      Onde há dois números: <span className={PAYT}>Payt</span>
      {' / '}<span className={META}>Meta</span>
    </span>
  );
}
