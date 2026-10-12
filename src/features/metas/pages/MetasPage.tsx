import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { MetasNav } from '../components/MetasNav';
import { supabase } from '@/lib/supabase';
import { useFilters } from '@/contexts/FilterContext';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { Loader2, Target, AlertTriangle, Check, Info, Clock } from 'lucide-react';

/*
  As metas do ano, e quanto do caminho já andou.

  ── O que estava confuso na primeira versão ────────────────────────────────

  A tela anterior era a tabela do documento com uma coluna "Agora" ao lado, e
  debaixo de cada alvo escrevia "X% do alvo". Para a meta de jul/27 isso dava
  coisas como "9% do alvo" em outubro — que lê como fracasso quando é apenas
  cedo. A pergunta que a pessoa faz ao abrir ("estou indo bem?") não tinha
  resposta em lugar nenhum da tela.

  A troca é essa: em vez de comparar o medido com o alvo, comparar DOIS
  percursos — quanto do caminho andou (da base real até o alvo) contra quanto
  do prazo já passou. Uma meta de jul/27 com 2% do prazo decorrido e 0% de
  caminho não está atrasada; está começando. É o que a barra mostra, com a
  marca vertical em cima dizendo onde o relógio está.

  ── A tela não faz conta ───────────────────────────────────────────────────

  `caminho`, `tempo` e `situacao` vêm prontos de `fn_metas_progresso`. Isso é
  de propósito: `fn_metas_alertas` classifica com a mesma folga de 15 pontos,
  e se a conta existisse aqui também, ajustar um lado deixaria a tela dizendo
  "no caminho" com um aviso vermelho embaixo dizendo o contrário.

  ── Duas bases, e por que as duas aparecem ─────────────────────────────────

  `valor_base` é o que o plano afirmou; `base_real` é o que o banco mediu no
  dia 10/10. Dos cinco indicadores automáticos o plano acertou dois e errou
  três, e a diferença não é ruído a esconder — "o plano dizia 11%" ao lado de
  7,11% é a informação mais útil desta tela. O progresso conta da base real,
  senão a recompra apareceria 130% negativa por causa de uma definição
  trocada, não de queda.
*/

type Unidade = 'moeda' | 'percentual' | 'numero' | 'multiplicador';
type Situacao = 'batida' | 'ja_estava_batida' | 'no_caminho' | 'atrasada' | 'sem_medicao';

/** Uma linha de `fn_metas_progresso`: uma meta, com o progresso já calculado. */
interface Progresso {
  kpi: string;
  nome: string;
  unidade: Unidade;
  automatico: boolean;
  nota: string | null;
  ordem: number;
  prazo: string;
  valor_alvo: number;
  valor_base: number | null;
  base_real: number | null;
  medido: number | null;
  caminho: number | null;
  tempo: number | null;
  atingido: boolean;
  e_proximo: boolean;
  situacao: Situacao;
}

interface Alerta {
  codigo: string;
  severidade: 'critico' | 'atencao';
  titulo: string;
  detalhe: string | null;
}

interface Regra {
  chave: string;
  titulo: string;
  condicao: string;
  consequencia: string;
  automatica: boolean;
  porque_nao: string | null;
}

/** Um indicador com seus três prazos. */
interface Indicador {
  kpi: string;
  nome: string;
  unidade: Unidade;
  automatico: boolean;
  nota: string | null;
  ordem: number;
  base_real: number | null;
  valor_base: number | null;
  medido: number | null;
  prazos: Progresso[];
  atual: Progresso;
}

const ROTULO_SITUACAO: Record<Situacao, string> = {
  batida:           'Batida',
  ja_estava_batida: 'Já estava batida',
  no_caminho:       'No caminho',
  atrasada:         'Atrasada',
  sem_medicao:      'Sem medição',
};

const COR_SITUACAO: Record<Situacao, string> = {
  batida:           'bg-emerald-500/15 text-emerald-400',
  ja_estava_batida: 'bg-sky-500/15 text-sky-400',
  no_caminho:       'bg-primary/15 text-primary',
  atrasada:         'bg-amber-500/15 text-amber-400',
  sem_medicao:      'bg-muted text-muted-foreground',
};

/** A cor da barra segue a situação, não o valor. */
const COR_BARRA: Record<Situacao, string> = {
  batida:           'bg-emerald-500',
  ja_estava_batida: 'bg-sky-500',
  no_caminho:       'bg-primary',
  atrasada:         'bg-amber-500',
  sem_medicao:      'bg-muted-foreground/30',
};

function formatar(valor: number | null | undefined, unidade: Unidade) {
  if (valor === null || valor === undefined) return '—';
  switch (unidade) {
    case 'moeda':         return formatCurrency(valor);
    case 'percentual':    return `${valor.toFixed(1).replace('.', ',')}%`;
    case 'multiplicador': return `${valor.toFixed(2).replace('.', ',')}x`;
    default:              return formatNumber(valor);
  }
}

const ROTULO_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** "2026-12-31" → "dez/26". Sem `new Date`, que na virada do fuso volta um mês. */
function rotuloDoPrazo(prazo: string) {
  const [ano, mes] = prazo.split('-');
  return `${ROTULO_MES[Number(mes) - 1]}/${ano.slice(2)}`;
}

/**
 * A barra que responde "estou indo bem?": o preenchimento é o caminho andado
 * e o risco vertical é onde o prazo está. Risco à frente do preenchimento
 * significa atraso, e dá para ver de longe sem ler número nenhum.
 */
function BarraDeProgresso({ caminho, tempo, situacao }: {
  caminho: number | null; tempo: number | null; situacao: Situacao;
}) {
  if (caminho === null) {
    return (
      <div className="h-2 w-full rounded-full bg-secondary" title="Sem medição automática para este indicador" />
    );
  }
  const pctCaminho = Math.round(caminho * 100);
  const pctTempo   = tempo === null ? null : Math.round(tempo * 100);

  return (
    <div className="relative h-2 w-full rounded-full bg-secondary">
      <div
        className={cn('absolute inset-y-0 left-0 rounded-full transition-all', COR_BARRA[situacao])}
        style={{ width: `${pctCaminho}%` }}
      />
      {pctTempo !== null && (
        <div
          className="absolute -top-0.5 h-3 w-0.5 rounded-full bg-foreground/70"
          style={{ left: `calc(${pctTempo}% - 1px)` }}
          title={`${pctTempo}% do prazo já passou`}
        />
      )}
    </div>
  );
}

export default function MetasPage() {
  const { empresaId } = useFilters();

  const [indicadores, setIndicadores] = useState<Indicador[]>([]);
  const [alertas, setAlertas]         = useState<Alerta[]>([]);
  const [regras, setRegras]           = useState<Regra[]>([]);
  const [loading, setLoading]         = useState(true);
  const [erro, setErro]               = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);

    const [prog, avisos, decisoes] = await Promise.all([
      supabase.rpc('fn_metas_progresso', { p_empresa: empresaId }),
      supabase.rpc('fn_metas_alertas',   { p_empresa: empresaId }),
      supabase.from('plano_regras')
        .select('chave, titulo, condicao, consequencia, automatica, porque_nao')
        .order('ordem'),
    ]);

    /* Erro visível em vez de tela com zeros: zero e "não consegui ler" são
       coisas diferentes, e confundi-los é a origem conhecida de metade dos
       defeitos deste painel. */
    if (prog.error) {
      setErro(prog.error.message);
      setLoading(false);
      return;
    }

    const porKpi = new Map<string, Indicador>();
    for (const p of (prog.data ?? []) as Progresso[]) {
      let ind = porKpi.get(p.kpi);
      if (!ind) {
        ind = {
          kpi: p.kpi, nome: p.nome, unidade: p.unidade, automatico: p.automatico,
          nota: p.nota, ordem: p.ordem, base_real: p.base_real,
          valor_base: p.valor_base, medido: p.medido,
          prazos: [], atual: p,
        };
        porKpi.set(p.kpi, ind);
      }
      ind.prazos.push(p);
      if (p.e_proximo) ind.atual = p;
    }

    // Os avisos podem falhar sozinhos sem derrubar a tela: sem eles as metas
    // continuam legíveis.
    setIndicadores([...porKpi.values()].sort((a, b) => a.ordem - b.ordem));
    setAlertas((avisos.data ?? []) as Alerta[]);
    setRegras((decisoes.data ?? []) as Regra[]);
    setLoading(false);
  }, [empresaId]);

  useEffect(() => { carregar(); }, [carregar]);

  const contagem = indicadores.reduce<Record<string, number>>((acc, i) => {
    acc[i.atual.situacao] = (acc[i.atual.situacao] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <DashboardLayout title="Metas" hideFilters>
      <MetasNav />

      <div className="space-y-5">
        {/* O norte, em uma linha. Sai do próprio plano. */}
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-sm text-muted-foreground">
            <b className="font-display text-base text-foreground">R$ 100 mil de lucro líquido por mês até jul/27</b>
            <span className="ml-2">
              — não gastando mais em tráfego, e sim subindo o ROAS para ~2,0x e construindo
              R$ 100 mil/mês de receita que não depende de anúncio.
            </span>
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Plano de crescimento de 10/10/2026. A barra de cada meta mostra{' '}
            <b className="text-foreground">quanto do caminho andou</b>; o risco vertical em cima dela
            é <b className="text-foreground">quanto do prazo já passou</b>. Risco à frente da barra
            é atraso.
          </p>
        </div>

        {/* Avisos. O plano tem uma regra de decisão literal, e ela vive aqui. */}
        {alertas.length > 0 && (
          <div className="space-y-2">
            {alertas.map(a => (
              <div
                key={a.codigo}
                className={cn(
                  'flex gap-2.5 rounded-lg border px-4 py-3 text-sm',
                  a.severidade === 'critico'
                    ? 'border-destructive/40 bg-destructive/10'
                    : 'border-amber-500/30 bg-amber-500/10',
                )}
              >
                <AlertTriangle className={cn(
                  'mt-0.5 h-4 w-4 shrink-0',
                  a.severidade === 'critico' ? 'text-destructive' : 'text-amber-400',
                )} />
                <div>
                  <p className={cn(
                    'font-medium',
                    a.severidade === 'critico' ? 'text-destructive' : 'text-amber-200',
                  )}>
                    {a.titulo}
                  </p>
                  {a.detalhe && (
                    <p className={cn(
                      'mt-0.5 text-xs',
                      a.severidade === 'critico' ? 'text-destructive/80' : 'text-amber-200/70',
                    )}>
                      {a.detalhe}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {erro && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Não consegui ler as metas: {erro}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando metas…
          </div>
        ) : indicadores.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Target className="h-5 w-5" />
            Nenhuma meta cadastrada ainda.
          </div>
        ) : (
          <>
            {/* Onde as dez estão, de relance. */}
            <div className="flex flex-wrap gap-2">
              {(Object.keys(ROTULO_SITUACAO) as Situacao[])
                .filter(s => contagem[s])
                .map(s => (
                  <span key={s} className={cn(
                    'rounded-full px-2.5 py-1 text-xs font-medium',
                    COR_SITUACAO[s],
                  )}>
                    {contagem[s]} {ROTULO_SITUACAO[s].toLowerCase()}
                  </span>
                ))}
            </div>

            <div className="space-y-3">
              {indicadores.map(ind => {
                const atual = ind.atual;
                /* O plano dizia uma coisa e a medição disse outra. Só quando
                   divergem de verdade — 5% é arredondamento, não descoberta. */
                const divergeDoPlano =
                  ind.base_real !== null && ind.valor_base !== null && ind.valor_base !== 0 &&
                  Math.abs(ind.base_real - ind.valor_base) / Math.abs(ind.valor_base) > 0.05;

                return (
                  <div key={ind.kpi} className="rounded-lg border border-border bg-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-medium text-foreground">{ind.nome}</h3>
                          <span className={cn(
                            'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                            COR_SITUACAO[atual.situacao],
                          )}>
                            {ROTULO_SITUACAO[atual.situacao]}
                          </span>
                          {!ind.automatico && (
                            <span
                              className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                              title={ind.nota ?? 'Ainda não tem fonte automática no painel'}
                            >
                              manual
                            </span>
                          )}
                        </div>
                        {ind.nota && (
                          <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                            <Info className="mt-0.5 h-3 w-3 shrink-0" />
                            {ind.nota}
                          </p>
                        )}
                      </div>

                      <div className="text-right">
                        <div className="text-xl font-semibold tabular-nums text-foreground">
                          {formatar(ind.medido, ind.unidade)}
                        </div>
                        <div className="text-[11px] text-muted-foreground">agora</div>
                      </div>
                    </div>

                    {/* O percurso: de onde saiu, onde está, para onde vai. */}
                    <div className="mt-3">
                      <div className="mb-1.5 flex items-baseline justify-between text-[11px] text-muted-foreground">
                        <span className="tabular-nums">
                          {formatar(ind.base_real, ind.unidade)}
                          {divergeDoPlano && (
                            <span className="ml-1.5 text-muted-foreground/70">
                              (o plano dizia {formatar(ind.valor_base, ind.unidade)})
                            </span>
                          )}
                        </span>
                        <span className="tabular-nums">
                          {formatar(atual.valor_alvo, ind.unidade)} até {rotuloDoPrazo(atual.prazo)}
                        </span>
                      </div>

                      <BarraDeProgresso
                        caminho={atual.caminho}
                        tempo={atual.tempo}
                        situacao={atual.situacao}
                      />

                      <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                        {atual.caminho !== null ? (
                          <>
                            <span className="tabular-nums">
                              {Math.round(atual.caminho * 100)}% do caminho
                            </span>
                            {atual.tempo !== null && (
                              <span className="flex items-center gap-1 tabular-nums">
                                <Clock className="h-3 w-3" />
                                {Math.round(atual.tempo * 100)}% do prazo
                              </span>
                            )}
                          </>
                        ) : (
                          <span>Este indicador ainda não é medido pelo painel.</span>
                        )}
                      </div>
                    </div>

                    {/* Os três horizontes. O atual em destaque; os outros são
                        contexto, não cobrança. */}
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border/50 pt-2.5 text-xs">
                      {ind.prazos.map(p => (
                        <span
                          key={p.prazo}
                          className={cn(
                            'flex items-center gap-1 tabular-nums',
                            p.e_proximo ? 'font-medium text-foreground' : 'text-muted-foreground',
                          )}
                        >
                          {p.atingido && <Check className="h-3 w-3 text-emerald-400" />}
                          {rotuloDoPrazo(p.prazo)}{' '}
                          <b className="font-semibold">{formatar(p.valor_alvo, ind.unidade)}</b>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* As regras de decisão da seção 11, inclusive as que o painel
                ainda não mede. Sumir é o que faz uma regra virar ficção. */}
            {regras.length > 0 && (
              <section>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Regras de decisão
                </h2>
                <div className="space-y-2">
                  {regras.map(r => (
                    <div key={r.chave} className="rounded-lg border border-border bg-card px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{r.titulo}</span>
                        <span className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                          r.automatica
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-muted text-muted-foreground',
                        )}>
                          {r.automatica ? 'o painel avisa' : 'conferir na mão'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        <b className="text-foreground/80">Se</b> {r.condicao} →{' '}
                        {r.consequencia}
                      </p>
                      {r.porque_nao && (
                        <p className="mt-1 text-[11px] text-muted-foreground/70">
                          Por que ainda não é automático: {r.porque_nao}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
