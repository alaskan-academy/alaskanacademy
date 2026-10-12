import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { MetasNav } from '../components/MetasNav';
import { supabase } from '@/lib/supabase';
import { useFilters } from '@/contexts/FilterContext';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';
import { Loader2, Target, AlertTriangle, Check, Clock, CornerDownRight } from 'lucide-react';

/*
  As metas do ano, na árvore que o plano já tinha.

  ── Por que árvore, e não mais uma lista ──────────────────────────────────

  A primeira versão era a tabela do documento com uma coluna "Agora" ao lado,
  e levou três críticas em sequência: pouco detalhe, confusa, e faltando
  metade do que o documento traz. A terceira foi a mais fácil de consertar
  (as ações datadas viraram /metas/prazos); a segunda exigiu entender o que
  confundia.

  Confundia que as listas do módulo — dez indicadores, oitenta ações, vinte e
  quatro ideias, três regras — não diziam por que a outra existe. Um
  indicador aparecia ao lado do outro sem hierarquia, e "Bumps abertos" tinha
  o mesmo peso visual que "Lucro líquido por mês". E, debaixo de cada alvo,
  um "X% do alvo" que para jul/27 dava "9%" em outubro — lê como fracasso
  quando é apenas cedo.

  Os dois consertos:

  1. A HIERARQUIA vem do documento, não de mim. A seção 2 declara UM objetivo
     e TRÊS alavancas; a seção 6 decompõe a primeira em seis fontes com alvo
     próprio em R$/mês. Isto aqui é só desenhar aquilo.

  2. A BARRA compara dois percursos: quanto do caminho andou (da base real
     até o alvo) contra quanto do prazo já passou, no risco vertical. Uma
     meta de jul/27 com 2% do prazo e 0% de caminho não está atrasada; está
     começando.

  ── A tela não faz conta ───────────────────────────────────────────────────

  `fn_plano_arvore` devolve as 16 linhas ordenadas pelo caminho, com os
  indicadores de cada nó em JSON e o progresso de cada um já calculado.
  A classificação "no caminho / atrasada" vem pronta porque
  `fn_metas_alertas` usa a mesma, e as duas não podem divergir.

  ── O que a tela mostra de propósito, em vez de esconder ──────────────────

  · nó sem indicador — a alavanca 3 e suas duas frentes são assim: o plano
    as declara e não diz como medir
  · submeta sem ação nenhuma atrás dela
  · as 4 ações que não couberam em nó nenhum, no fim da página

  Os três são perguntas abertas, e uma pergunta aberta na tela vale mais que
  uma resposta inventada.
*/

type Unidade = 'moeda' | 'percentual' | 'numero' | 'multiplicador';
type Situacao = 'batida' | 'ja_estava_batida' | 'no_caminho' | 'atrasada' | 'sem_medicao';

/** Um indicador pendurado num nó, com o progresso já calculado pelo banco. */
interface Indicador {
  kpi: string;
  nome: string;
  unidade: Unidade;
  e_meta: boolean;
  automatico: boolean;
  medido: number | null;
  /* Só vem preenchido para indicador manual, de `metas_medicao`. Número
     digitado envelhece, e sem a data ninguém sabe se o que está na tela é de
     hoje ou de agosto. Ver 20261012zd. */
  medido_em: string | null;
  origem: string | null;
  alvo: number | null;
  prazo: string | null;
  caminho: number | null;
  tempo: number | null;
  situacao: Situacao | null;
}

/** Um nó da árvore. */
interface No {
  chave: string;
  parte_de: string | null;
  nivel: number;
  titulo: string;
  descricao: string | null;
  valor_min: number | null;
  valor_max: number | null;
  unidade_valor: string | null;
  secao: number | null;
  indicadores: Indicador[];
  acoes_total: number;
  acoes_feitas: number;
  acoes_vencidas: number;
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

/** "R$ 20–25 mil/mês" · "R$ 10 mil/mês". Em milhares, como o plano escreve. */
function faixa(min: number | null, max: number | null) {
  if (min === null && max === null) return null;
  const mil = (v: number) => `${Math.round(v / 1000)}`;
  if (min !== null && max !== null && min !== max) return `R$ ${mil(min)}–${mil(max)} mil/mês`;
  return `R$ ${mil((min ?? max) as number)} mil/mês`;
}

const ROTULO_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** "2026-12-31" → "dez/26". Sem `new Date`, que na virada do fuso volta um mês. */
function rotuloDoPrazo(prazo: string) {
  const [ano, mes] = prazo.split('-');
  return `${ROTULO_MES[Number(mes) - 1]}/${ano.slice(2)}`;
}

/**
 * A barra que responde "estou indo bem?": o preenchimento é o caminho andado
 * e o risco vertical é onde o prazo está. Risco à frente do preenchimento é
 * atraso, e dá para ver de longe sem ler número nenhum.
 */
function Barra({ caminho, tempo, situacao }: {
  caminho: number | null; tempo: number | null; situacao: Situacao;
}) {
  if (caminho === null) {
    return <div className="h-1.5 w-full rounded-full bg-secondary" title="Sem medição automática" />;
  }
  const pctCaminho = Math.round(caminho * 100);
  const pctTempo   = tempo === null ? null : Math.round(tempo * 100);

  return (
    <div className="relative h-1.5 w-full rounded-full bg-secondary">
      <div
        className={cn('absolute inset-y-0 left-0 rounded-full transition-all', COR_BARRA[situacao])}
        style={{ width: `${pctCaminho}%` }}
      />
      {pctTempo !== null && (
        <div
          className="absolute -top-0.5 h-2.5 w-0.5 rounded-full bg-foreground/70"
          style={{ left: `calc(${pctTempo}% - 1px)` }}
          title={`${pctTempo}% do prazo já passou`}
        />
      )}
    </div>
  );
}

/** Um indicador: medido, alvo, situação e barra. */
function LinhaIndicador({ i }: { i: Indicador }) {
  const situacao = i.situacao ?? 'sem_medicao';
  return (
    <div className="py-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {i.nome}
          {!i.e_meta && (
            <span className="rounded bg-muted px-1 py-px text-[9px] uppercase tracking-wide">
              apoio
            </span>
          )}
          {!i.automatico && (
            <span className="rounded bg-muted px-1 py-px text-[9px] uppercase tracking-wide">
              manual
            </span>
          )}
        </span>
        <span className="flex items-baseline gap-2 tabular-nums">
          <b className="text-sm text-foreground">{formatar(i.medido, i.unidade)}</b>
          {/* Quem mede à mão precisa dizer quando. Um número de dois meses
              atrás com cara de número de hoje é pior que campo vazio. */}
          {i.medido_em && (
            <span
              className="text-[10px] text-muted-foreground/70"
              title={i.origem === 'area_membros'
                ? 'carimbado da Área de Membros'
                : 'medido à mão'}
            >
              medido em {i.medido_em.slice(8, 10)}/{i.medido_em.slice(5, 7)}
            </span>
          )}
          {i.e_meta && i.alvo !== null && i.prazo && (
            <span className="text-[11px] text-muted-foreground">
              → {formatar(i.alvo, i.unidade)} em {rotuloDoPrazo(i.prazo)}
            </span>
          )}
          {/* Situação é uma leitura sobre o ALVO — batida, no caminho,
              atrasada. Indicador de apoio não tem alvo, então não pode estar
              em nenhuma delas: o `?? 'sem_medicao'` punha o selo "SEM MEDIÇÃO"
              ao lado do próprio número medido. A barra já saía por este mesmo
              motivo; o selo é que tinha passado batido. */}
          {i.e_meta && (
            <span className={cn(
              'rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide',
              COR_SITUACAO[situacao],
            )}>
              {ROTULO_SITUACAO[situacao]}
            </span>
          )}
        </span>
      </div>
      {/* Indicador de apoio não tem alvo, e desenhar barra para ele daria a
          impressão de uma meta que ninguém definiu. */}
      {i.e_meta && (
        <div className="mt-1">
          <Barra caminho={i.caminho} tempo={i.tempo} situacao={situacao} />
        </div>
      )}
    </div>
  );
}

/**
 * O rodapé de um nó: quantas ações do plano estão atrás dele.
 *
 * `total` vem contado da árvore e não escrito aqui: já esteve como "80" no
 * texto, e no dia em que ela mandou remover uma ação a tela passou a mentir
 * em dois lugares. Lista fixa no código, em miniatura.
 */
function ContagemDeAcoes({ no, total }: { no: No; total: number }) {
  if (no.acoes_total === 0) {
    return (
      <span className="text-[11px] text-muted-foreground/60">
        Nenhuma das {total} ações do plano está ligada a esta frente.
      </span>
    );
  }
  return (
    <Link
      to="/metas/prazos"
      className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
    >
      <Check className="h-3 w-3" />
      <span className="tabular-nums">{no.acoes_feitas} de {no.acoes_total} ações feitas</span>
      {no.acoes_vencidas > 0 && (
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-400 tabular-nums">
          {no.acoes_vencidas} vencida{no.acoes_vencidas > 1 ? 's' : ''}
        </span>
      )}
    </Link>
  );
}

export default function MetasPage() {
  const { empresaId } = useFilters();

  const [arvore, setArvore]   = useState<No[]>([]);
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [regras, setRegras]   = useState<Regra[]>([]);
  const [semMeta, setSemMeta] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro]       = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);

    const [tree, avisos, decisoes, soltas] = await Promise.all([
      supabase.rpc('fn_plano_arvore',  { p_empresa: empresaId }),
      supabase.rpc('fn_metas_alertas', { p_empresa: empresaId }),
      supabase.from('plano_regras')
        .select('chave, titulo, condicao, consequencia, automatica, porque_nao').order('ordem'),
      supabase.from('plano_acoes').select('titulo').is('objetivo_id', null).order('ordem'),
    ]);

    /* Erro visível em vez de tela com zeros: zero e "não consegui ler" são
       coisas diferentes, e confundi-los é a origem conhecida de metade dos
       defeitos deste painel. */
    if (tree.error) {
      setErro(tree.error.message);
      setLoading(false);
      return;
    }

    setArvore((tree.data ?? []) as No[]);
    setAlertas((avisos.data ?? []) as Alerta[]);
    setRegras((decisoes.data ?? []) as Regra[]);
    setSemMeta(((soltas.data ?? []) as { titulo: string }[]).map(a => a.titulo));
    setLoading(false);
  }, [empresaId]);

  useEffect(() => { carregar(); }, [carregar]);

  const raiz      = arvore.find(n => n.nivel === 0);
  const alavancas = arvore.filter(n => n.nivel === 1);
  const filhosDe  = (chave: string) => arvore.filter(n => n.parte_de === chave);

  /* Contado, nunca escrito: as ligadas aos nós mais as que não acharam nó.
     Esteve como "80" no texto, e bastou ela mandar remover uma ação para a
     tela passar a mentir em dois lugares. */
  const totalAcoes = arvore.reduce((a, n) => a + n.acoes_total, 0) + semMeta.length;

  return (
    <DashboardLayout title="Metas" hideFilters>
      <MetasNav />

      <div className="space-y-5">
        {/* A raiz: o objetivo do ano, e o indicador que o mede. */}
        {raiz && (
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <h2 className="font-display text-base text-foreground">{raiz.titulo}</h2>
            {raiz.descricao && (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{raiz.descricao}</p>
            )}
            {raiz.indicadores.length > 0 && (
              <div className="mt-2 border-t border-border/50 pt-1">
                {raiz.indicadores.map(i => <LinhaIndicador key={i.kpi} i={i} />)}
              </div>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground/70">
              A barra de cada meta é <b className="text-foreground/80">quanto do caminho andou</b>;
              o risco vertical em cima dela é <b className="text-foreground/80">quanto do prazo já
              passou</b>. Risco à frente da barra é atraso.
            </p>
          </div>
        )}

        {/* Avisos. O plano tem regras de decisão literais, e elas vivem aqui. */}
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
        ) : arvore.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Target className="h-5 w-5" />
            Nenhuma meta cadastrada ainda.
          </div>
        ) : (
          <>
            {alavancas.map(alav => {
              const submetas = filhosDe(alav.chave);
              return (
                <section key={alav.chave}>
                  <div className="mb-1 flex flex-wrap items-baseline gap-2">
                    <h3 className="text-sm font-semibold text-foreground">{alav.titulo}</h3>
                    {faixa(alav.valor_min, alav.valor_max) && (
                      <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-primary">
                        {faixa(alav.valor_min, alav.valor_max)}
                      </span>
                    )}
                  </div>
                  {alav.descricao && (
                    <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
                      {alav.descricao}
                    </p>
                  )}

                  {/* Os indicadores da própria alavanca, antes das submetas. */}
                  {(alav.indicadores.length > 0 || alav.acoes_total > 0) && (
                    <div className="mb-2 rounded-lg border border-border bg-card px-4 py-2">
                      {alav.indicadores.map(i => <LinhaIndicador key={i.kpi} i={i} />)}
                      <div className={cn(
                        alav.indicadores.length > 0 && 'mt-1.5 border-t border-border/50 pt-1.5',
                      )}>
                        <ContagemDeAcoes no={alav} total={totalAcoes} />
                      </div>
                    </div>
                  )}

                  <div className="space-y-2 border-l border-border/60 pl-3">
                    {submetas.map(sub => (
                      <div key={sub.chave} className="rounded-lg border border-border bg-card px-4 py-3">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <CornerDownRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                          <span className="text-sm font-medium text-foreground">{sub.titulo}</span>
                          {faixa(sub.valor_min, sub.valor_max) && (
                            <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                              {faixa(sub.valor_min, sub.valor_max)}
                            </span>
                          )}
                        </div>
                        {sub.descricao && (
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {sub.descricao}
                          </p>
                        )}

                        {sub.indicadores.length > 0 ? (
                          <div className="mt-2 border-t border-border/50 pt-1">
                            {sub.indicadores.map(i => <LinhaIndicador key={i.kpi} i={i} />)}
                          </div>
                        ) : (
                          /* Nó sem indicador é informação, não lacuna a esconder:
                             o plano declara a frente e não diz como medi-la. */
                          <p className="mt-2 text-[11px] text-muted-foreground/60">
                            O plano não dá indicador para esta frente.
                          </p>
                        )}

                        <div className="mt-2 border-t border-border/50 pt-1.5">
                          <ContagemDeAcoes no={sub} total={totalAcoes} />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}

            {/* As que não couberam. Ligação errada é pior que ausente, então
                elas ficam visíveis em vez de penduradas em qualquer nó. */}
            {semMeta.length > 0 && (
              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Ações ainda sem meta ({semMeta.length})
                </h3>
                <div className="rounded-lg border border-dashed border-border bg-card/40 px-4 py-3">
                  <p className="mb-1.5 text-xs text-muted-foreground">
                    O documento não amarra estas a nenhuma das três alavancas, e cada uma dá
                    para argumentar em duas direções. Ficam aqui em vez de serem encaixadas
                    no chute.
                  </p>
                  <ul className="space-y-0.5">
                    {semMeta.map(t => (
                      <li key={t} className="text-xs text-foreground/80">· {t}</li>
                    ))}
                  </ul>
                </div>
              </section>
            )}

            {/* As regras de decisão da seção 11, inclusive as que o painel
                ainda não mede. Sumir é o que faz uma regra virar ficção. */}
            {regras.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Regras de decisão
                </h3>
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
                        <b className="text-foreground/80">Se</b> {r.condicao} → {r.consequencia}
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

            <p className="flex items-center gap-1.5 pt-1 text-[11px] text-muted-foreground/70">
              <Clock className="h-3 w-3" />
              Plano de crescimento Out/26 a Jul/27, de 10/10/2026. As {totalAcoes} ações estão em{' '}
              <Link to="/metas/prazos" className="text-primary hover:underline">Prazos</Link>.
            </p>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
